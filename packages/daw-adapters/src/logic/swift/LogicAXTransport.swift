import Foundation
import ApplicationServices
import Cocoa

// MARK: - LogicAXTransport
// Dedicated transport module for Apple Logic Pro X.
// Handles Play, Stop, Locate, Cycle-Off and Cycle-Region framing.

func getCycleElement(appElement: AXUIElement) -> (AXUIElement, CGPoint, CGSize)? {
    for w in getLogicWindows(appElement) {
        if let el = findElementDFS(root: w, roleFilter: nil, maxDepth: 10, predicate: { (getAXString($0, kAXDescriptionAttribute as String) ?? "") == "Cycle-Bereich" }) {
            var pVal: AnyObject?; var sVal: AnyObject?
            AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &pVal)
            AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &sVal)
            if let pv = pVal, let sv = sVal {
                var pt = CGPoint.zero; var sz = CGSize.zero
                AXValueGetValue(pv as! AXValue, .cgPoint, &pt); AXValueGetValue(sv as! AXValue, .cgSize, &sz)
                return (el, pt, sz)
            }
        }
    }
    return nil
}

func ensureCycleOff(appElement: AXUIElement) -> Bool {
    var menuBarVal: AnyObject?
    AXUIElementCopyAttributeValue(appElement, kAXMenuBarAttribute as CFString, &menuBarVal)
    if let mb = menuBarVal as! AXUIElement? {
        if let miPlay = findElementDFS(root: mb, roleFilter: "AXMenuItem", maxDepth: 6, predicate: {
            let t = (getAXString($0, kAXTitleAttribute as String) ?? "").lowercased()
            return t.contains("vom cycle-start wiedergeben") || t.contains("play from cycle start")
        }) {
            var mark: AnyObject?
            AXUIElementCopyAttributeValue(miPlay, "AXMenuItemMarkChar" as CFString, &mark)
            if let m = mark as? String, !m.isEmpty { _ = AXUIElementPerformAction(miPlay, kAXPressAction as CFString) }
        }
        if let mi = findElementDFS(root: mb, roleFilter: "AXMenuItem", maxDepth: 6, predicate: {
            let t = (getAXString($0, kAXTitleAttribute as String) ?? "").lowercased()
            return t == "cycle" || t.starts(with: "cycle") || t.contains("cycle-modus") || t.contains("cycle mode")
        }) {
            var markVal: AnyObject?; var val: AnyObject?
            AXUIElementCopyAttributeValue(mi, "AXMenuItemMarkChar" as CFString, &markVal)
            AXUIElementCopyAttributeValue(mi, kAXValueAttribute as CFString, &val)
            let isChecked = (markVal != nil && !((markVal as? String) ?? "").isEmpty) || (val as? Int == 1) || (val as? Bool == true)
            if isChecked {
                let err = AXUIElementPerformAction(mi, kAXPressAction as CFString)
                return err == .success || err == .cannotComplete
            } else { return true }
        }
    }
    for w in getLogicWindows(appElement) {
        if let el = findElementDFS(root: w, roleFilter: nil, maxDepth: 12, predicate: { e in
            let r = getAXString(e, kAXRoleAttribute as String) ?? ""
            let d = (getAXString(e, kAXDescriptionAttribute as String) ?? "").lowercased()
            let t = (getAXString(e, kAXTitleAttribute as String) ?? "").lowercased()
            return (r == "AXLayoutItem" && d == "cycle-bereich") ||
                   ((r == "AXCheckBox" || r == "AXButton" || r == "AXRadioButton") && (d.contains("cycle") || t.contains("cycle")))
        }) {
            var val: AnyObject?
            AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &val)
            if (val as? Int == 1) || (val as? Bool == true) || ((val as? String) == "1") {
                let err = AXUIElementPerformAction(el, kAXPressAction as CFString)
                return err == .success || err == .cannotComplete
            } else if val != nil { return true }
        }
    }
    return true
}

func performTransportLocate(appElement: AXUIElement, barNum: Int) -> (dialogOpened: Bool, windowFound: Bool, pid: pid_t) {
    if let app = getLogicRunningApp() { app.activate(options: [.activateAllWindows]) }
    AXUIElementSetAttributeValue(appElement, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    usleep(50_000)
    var dialogOpened = false
    var menuBarVal: AnyObject?
    AXUIElementCopyAttributeValue(appElement, kAXMenuBarAttribute as CFString, &menuBarVal)
    if let mb = menuBarVal as! AXUIElement?, let mi = findElementDFS(root: mb, roleFilter: "AXMenuItem", maxDepth: 6, predicate: {
        let t = (getAXString($0, kAXTitleAttribute as String) ?? "").lowercased()
        return t == "position …" || t == "position..." || (t.contains("position") && (t.contains("…") || t.contains("...")))
    }) {
        let err = AXUIElementPerformAction(mi, kAXPressAction as CFString)
        dialogOpened = (err == .success || err == .cannotComplete)
    }
    let logicPid = getLogicPID() ?? 0
    if !dialogOpened && logicPid > 0 { postKeyToLogic(pid: logicPid, keyCode: 75, delayUs: 40_000) }
    var foundWindow = false
    for _ in 0..<12 {
        usleep(30_000)
        if getLogicWindows(appElement).contains(where: { (getAXString($0, kAXTitleAttribute as String) ?? "").lowercased().contains("position") }) {
            foundWindow = true; break
        }
    }
    if logicPid > 0 {
        sendDigitsToLogic(pid: logicPid, text: "\(barNum)"); usleep(30_000)
        postKeyToLogic(pid: logicPid, keyCode: 36, delayUs: 60_000)
    }
    return (dialogOpened, foundWindow, logicPid)
}

func handleTransportCommands(command: String, appElement: AXUIElement) -> Bool {
    switch command {
    case "transport-play":
        var played = false
        let allWindows = getLogicWindows(appElement)
        for w in allWindows {
            if let playBtn = findElementDFS(root: w, roleFilter: nil, maxDepth: 12, predicate: { el in
                let desc = (getAXString(el, kAXDescriptionAttribute as String) ?? "").lowercased()
                let t = (getAXString(el, kAXTitleAttribute as String) ?? "").lowercased()
                let role = getAXString(el, kAXRoleAttribute as String) ?? ""
                return (role == "AXCheckBox" || role == "AXButton") &&
                       (desc == "wiedergabe" || desc == "play" || t == "wiedergabe" || t == "play" ||
                        desc.contains("wiedergabe") || desc.contains("play"))
            }) {
                var val: AnyObject?
                AXUIElementCopyAttributeValue(playBtn, kAXValueAttribute as CFString, &val)
                let isAlreadyPlaying = (val as? Int) == 1
                if !isAlreadyPlaying {
                    let err = AXUIElementPerformAction(playBtn, kAXPressAction as CFString)
                    played = (err == .success || err == .cannotComplete)
                } else {
                    played = true
                }
                if played { break }
            }
        }

        usleep(150_000)
        var isConfirmedPlaying = false
        for w in allWindows {
            if let playBtn = findElementDFS(root: w, roleFilter: nil, maxDepth: 12, predicate: { el in
                let desc = (getAXString(el, kAXDescriptionAttribute as String) ?? "").lowercased()
                let role = getAXString(el, kAXRoleAttribute as String) ?? ""
                return (role == "AXCheckBox" || role == "AXButton") &&
                       (desc == "wiedergabe" || desc == "play" || desc.contains("wiedergabe") || desc.contains("play"))
            }) {
                var val: AnyObject?
                AXUIElementCopyAttributeValue(playBtn, kAXValueAttribute as CFString, &val)
                if (val as? Int) == 1 {
                    isConfirmedPlaying = true
                }
                break
            }
        }

        if !isConfirmedPlaying {
            let _ = sendSpacebarToLogic()
            played = true
        }

        printJSON(["success": true, "action": "play"])
        return true

    case "transport-stop":
        var stopped = false
        let allWindows = getLogicWindows(appElement)
        for w in allWindows {
            if let stopBtn = findElementDFS(root: w, roleFilter: nil, maxDepth: 12, predicate: { el in
                let desc = (getAXString(el, kAXDescriptionAttribute as String) ?? "").lowercased()
                let t = (getAXString(el, kAXTitleAttribute as String) ?? "").lowercased()
                return desc.contains("stopp") || desc.contains("stop") || t.contains("stopp") || t.contains("stop")
            }) {
                let err = AXUIElementPerformAction(stopBtn, kAXPressAction as CFString)
                stopped = (err == .success || err == .cannotComplete)
                if stopped { break }
            }

            if !stopped {
                if let playBtn = findElementDFS(root: w, roleFilter: nil, maxDepth: 12, predicate: { el in
                    let desc = (getAXString(el, kAXDescriptionAttribute as String) ?? "").lowercased()
                    let t = (getAXString(el, kAXTitleAttribute as String) ?? "").lowercased()
                    let role = getAXString(el, kAXRoleAttribute as String) ?? ""
                    return (role == "AXCheckBox" || role == "AXButton") &&
                           (desc == "wiedergabe" || desc == "play" || t == "wiedergabe" || t == "play")
                }) {
                    var val: AnyObject?
                    AXUIElementCopyAttributeValue(playBtn, kAXValueAttribute as CFString, &val)
                    if (val as? Int) == 1 {
                        let err = AXUIElementPerformAction(playBtn, kAXPressAction as CFString)
                        stopped = (err == .success || err == .cannotComplete)
                    } else {
                        stopped = true
                    }
                    if stopped { break }
                }
            }
        }

        if !stopped {
            stopped = sendSpacebarToLogic()
        }

        printJSON(["success": true, "action": "stop"])
        return true

    case "cycle-off", "ensure-cycle-off":
        let success = ensureCycleOff(appElement: appElement)
        printJSON(["success": success, "action": "cycle-off"])
        return true

    case "set-cycle-region":
        guard let startStr = getArg("--start"), let startNum = Int(startStr), startNum >= 1 else {
            printJSON(["success": false, "error": "Missing or invalid --start argument"])
            exit(0)
        }
        let endNum = Int(getArg("--end") ?? "") ?? (startNum + 4)
        if let app = getLogicRunningApp() { app.activate(options: [.activateAllWindows]) }
        AXUIElementSetAttributeValue(appElement, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
        usleep(50_000)

        var endX: CGFloat? = nil
        if endNum > startNum {
            _ = performTransportLocate(appElement: appElement, barNum: endNum)
            usleep(50_000)
            endX = getPlayheadX(appElement: appElement)
        }
        _ = performTransportLocate(appElement: appElement, barNum: startNum)
        usleep(50_000)
        let startX = getPlayheadX(appElement: appElement)

        var cycleMoved = false
        if let (cycleEl, cyclePt, cycleSz) = getCycleElement(appElement: appElement), let sX = startX {
            var newPt = CGPoint(x: sX, y: cyclePt.y)
            if let axVal = AXValueCreate(.cgPoint, &newPt) {
                _ = AXUIElementSetAttributeValue(cycleEl, kAXPositionAttribute as CFString, axVal)
                cycleMoved = true
            }
            usleep(40_000)
            if let eX = endX, eX > sX {
                if let (_, curPt, curSz) = getCycleElement(appElement: appElement) {
                    let curRight = curPt.x + curSz.width
                    if abs(curRight - eX) > 4 {
                        let startDrag = CGPoint(x: curRight - 2, y: curPt.y + curSz.height / 2)
                        let endDrag = CGPoint(x: eX, y: curPt.y + curSz.height / 2)
                        let src = CGEventSource(stateID: .hidSystemState)
                        let md = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: startDrag, mouseButton: .left)
                        let mDrag = CGEvent(mouseEventSource: src, mouseType: .leftMouseDragged, mouseCursorPosition: endDrag, mouseButton: .left)
                        let mu = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: endDrag, mouseButton: .left)
                        InputShield.tagEvent(md)
                        InputShield.tagEvent(mDrag)
                        InputShield.tagEvent(mu)
                        md?.post(tap: .cghidEventTap); usleep(30_000)
                        mDrag?.post(tap: .cghidEventTap); usleep(30_000)
                        mu?.post(tap: .cghidEventTap); usleep(50_000)
                        var resetPt = CGPoint(x: sX, y: cyclePt.y)
                        if let finalAx = AXValueCreate(.cgPoint, &resetPt) {
                            _ = AXUIElementSetAttributeValue(cycleEl, kAXPositionAttribute as CFString, finalAx)
                        }
                    }
                }
            }
        }
        printJSON(["success": true, "action": "set-cycle-region", "start": startNum, "end": endNum, "cycleMoved": cycleMoved])
        return true

    case "transport-locate":
        guard let barStr = getArg("--bar"), let barNum = Int(barStr), barNum >= 1 else {
            printJSON(["success": false, "error": "Missing or invalid --bar argument (must be >= 1)"])
            exit(0)
        }
        let keepCycle = (getArg("--keep-cycle") ?? "false") == "true"
        if !keepCycle { _ = ensureCycleOff(appElement: appElement) }
        let res = performTransportLocate(appElement: appElement, barNum: barNum)
        printJSON(["success": true, "action": "locate", "bar": barNum, "dialogOpened": res.dialogOpened, "windowFound": res.windowFound, "pid": res.pid, "isTrusted": AXIsProcessTrusted()])
        return true

    default:
        return false
    }
}
