import Foundation
import ApplicationServices
import Cocoa

// MARK: - Helper Functions for AXUIElement C-API

func getAXAttribute(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let err = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard err == .success else { return nil }
    return value
}

func getAXString(_ element: AXUIElement, _ attribute: String) -> String? {
    return getAXAttribute(element, attribute) as? String
}

func getAXDouble(_ element: AXUIElement, _ attribute: String) -> Double? {
    guard let val = getAXAttribute(element, attribute) else { return nil }
    if let num = val as? NSNumber { return num.doubleValue }
    if let str = val as? String { return Double(str.replacingOccurrences(of: ",", with: ".")) }
    return nil
}

func getAXChildren(_ element: AXUIElement) -> [AXUIElement] {
    return (getAXAttribute(element, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

func findLogicApplicationElement() -> AXUIElement? {
    let bundleApps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.logic10")
    if let app = bundleApps.first {
        return AXUIElementCreateApplication(app.processIdentifier)
    }
    for app in NSWorkspace.shared.runningApplications {
        if app.localizedName == "Logic Pro" || app.bundleIdentifier == "com.apple.logic10" {
            return AXUIElementCreateApplication(app.processIdentifier)
        }
    }
    return nil
}

func getLogicRunningApp() -> NSRunningApplication? {
    let bundleApps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.logic10")
    if let app = bundleApps.first {
        return app
    }
    for app in NSWorkspace.shared.runningApplications {
        if app.localizedName == "Logic Pro" || app.bundleIdentifier == "com.apple.logic10" {
            return app
        }
    }
    return nil
}

func getLogicPID() -> pid_t? {
    return getLogicRunningApp()?.processIdentifier
}

func sendReturnKeyToLogic() {
    guard let pid = getLogicPID() else { return }
    let src = CGEventSource(stateID: .hidSystemState)
    let keyDown = CGEvent(keyboardEventSource: src, virtualKey: 36, keyDown: true)
    let keyUp = CGEvent(keyboardEventSource: src, virtualKey: 36, keyDown: false)
    keyDown?.postToPid(pid)
    keyUp?.postToPid(pid)
}

func sendSpacebarToLogic() -> Bool {
    guard let pid = getLogicPID() else { return false }
    let src = CGEventSource(stateID: .hidSystemState)
    let keyDown = CGEvent(keyboardEventSource: src, virtualKey: 49, keyDown: true)
    let keyUp = CGEvent(keyboardEventSource: src, virtualKey: 49, keyDown: false)
    keyDown?.postToPid(pid)
    keyUp?.postToPid(pid)
    return true
}

func digitToKeyCode(_ char: Character) -> CGKeyCode? {
    let map: [Character: CGKeyCode] = ["0": 29, "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22, "7": 26, "8": 28, "9": 25]
    return map[char]
}

func postKeyToLogic(pid: pid_t, keyCode: CGKeyCode, delayUs: useconds_t = 30_000) {
    let src = CGEventSource(stateID: .hidSystemState)
    let keyDown = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: true)
    let keyUp = CGEvent(keyboardEventSource: src, virtualKey: keyCode, keyDown: false)
    keyDown?.postToPid(pid)
    usleep(10_000)
    keyUp?.postToPid(pid)
    usleep(delayUs)
}

func sendDigitsToLogic(pid: pid_t, text: String) {
    for char in text {
        if let kc = digitToKeyCode(char) {
            postKeyToLogic(pid: pid, keyCode: kc, delayUs: 35_000)
        }
    }
}

func clickAtPoint(point: CGPoint) {
    guard let pid = getLogicPID() else { return }
    let src = CGEventSource(stateID: .hidSystemState)
    let mouseDown = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
    let mouseUp = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
    mouseDown?.postToPid(pid)
    mouseUp?.postToPid(pid)
}

func getLogicWindows(_ appElement: AXUIElement) -> [AXUIElement] {
    if let val = getAXAttribute(appElement, kAXWindowsAttribute as String) as? [AXUIElement], !val.isEmpty {
        return val
    }
    return getAXChildren(appElement).filter { (getAXString($0, kAXRoleAttribute as String) ?? "") == "AXWindow" }
}

// Extract plugin name from a window's top-level static text elements or EQ group
func detectPluginName(in window: AXUIElement, windowTitle: String) -> String {
    var candidateName = ""
    var hasEQGroup = false

    for child in getAXChildren(window) {
        let role = getAXString(child, kAXRoleAttribute as String) ?? ""
        if role == "AXStaticText" {
            let val = getAXString(child, kAXValueAttribute as String) ?? getAXString(child, kAXTitleAttribute as String) ?? ""
            let trimmed = val.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty && trimmed != "Ansicht:" && trimmed != "View:" && trimmed.lowercased() != windowTitle.lowercased() {
                candidateName = trimmed
            }
        } else if role == "AXGroup" && (getAXString(child, kAXDescriptionAttribute as String) ?? "") == "EQ" {
            hasEQGroup = true
        }
    }

    if !candidateName.isEmpty {
        return candidateName
    }
    if hasEQGroup {
        return "Channel EQ"
    }
    return windowTitle
}

// Locate target plugin window by title, child static text, or dialog fallback (with retry)
func findTargetWindowOnce(_ appElement: AXUIElement, query: String) -> AXUIElement? {
    let windows = getLogicWindows(appElement)
    let lowerQuery = query.lowercased()

    // 1. Exact or substring match on kAXTitleAttribute (e.g. Track Name "Motown Revisited")
    if !lowerQuery.isEmpty {
        for w in windows {
            let title = (getAXString(w, kAXTitleAttribute as String) ?? "").lowercased()
            if title == lowerQuery || title.contains(lowerQuery) {
                return w
            }
        }

        // 2. Match by child AXStaticText plugin name (e.g. "Channel EQ", "Compressor")
        for w in windows {
            let subrole = getAXString(w, kAXSubroleAttribute as String) ?? ""
            if subrole == "AXDialog" || subrole == "AXFloatingWindow" {
                let title = getAXString(w, kAXTitleAttribute as String) ?? ""
                let pName = detectPluginName(in: w, windowTitle: title).lowercased()
                if pName.contains(lowerQuery) {
                    return w
                }
            }
        }
    }

    // 3. Fallback: First AXDialog / AXFloatingWindow that contains an EQ or slider group
    for w in windows {
        let subrole = getAXString(w, kAXSubroleAttribute as String) ?? ""
        if subrole == "AXDialog" || subrole == "AXFloatingWindow" {
            for child in getAXChildren(w) {
                let role = getAXString(child, kAXRoleAttribute as String) ?? ""
                if role == "AXGroup" {
                    let desc = getAXString(child, kAXDescriptionAttribute as String) ?? ""
                    if desc == "EQ" {
                        return w
                    }
                    for grandChild in getAXChildren(child) {
                        let gRole = getAXString(grandChild, kAXRoleAttribute as String) ?? ""
                        if gRole == "AXSlider" || gRole == "AXCheckBox" {
                            return w
                        }
                    }
                }
            }
        }
    }

    return nil
}

func findPluginWindow(_ appElement: AXUIElement, query: String) -> AXUIElement? {
    for attempt in 0..<4 {
        if let win = findTargetWindowOnce(appElement, query: query) { return win }
        if attempt < 3 { usleep(100_000) }
    }
    return nil
}

func findTargetWindow(_ appElement: AXUIElement, query: String) -> AXUIElement? { findPluginWindow(appElement, query: query) }

func buildWindowError(_ appElement: AXUIElement, query: String) -> String {
    let windows = getLogicWindows(appElement)
    if windows.isEmpty {
        // NOTE: Do NOT gate on AXIsProcessTrusted() here.
        // When logic-ax-bridge is spawned as a child process by the Tauri app,
        // AXIsProcessTrusted() returns false for the child even though the parent
        // (Oszillation Mixing Buddy) is trusted. AX API calls still work via
        // the responsible-process mechanism. Returning a "Bedienungshilfe" error
        // here prevents the auto open-insert fallback from triggering in Rust.
        // Instead, trigger a silent TCC prompt and return a fallback-compatible error.
        // NOTE: Do NOT check AXIsProcessTrusted() here or trigger a TCC prompt.
        // When logic-ax-bridge runs as a child of the Tauri app, AXIsProcessTrusted()
        // returns false even though the parent is trusted. Calling AXIsProcessTrustedWithOptions
        // here would pop up a system dialog on every EQ parameter call. The parent app
        // (Oszillation Mixing Buddy) already has TCC permission — no additional prompt needed.
        return "Plugin-Fenster nicht geöffnet: Logic Pro Mixer nicht erreichbar. Bitte öffne den Mixer (Taste X) und versuche es erneut."
    }
    let names = windows.compactMap { w -> String? in
        let t = getAXString(w, kAXTitleAttribute as String) ?? ""
        let p = detectPluginName(in: w, windowTitle: t)
        return t.isEmpty ? nil : (p != t ? "\(t) (\(p))" : t)
    }
    return "Plugin-Fenster für '\(query)' ist in Logic Pro derzeit nicht geöffnet (geöffnet sind: \(names.joined(separator: ", ")))"
}

// MARK: - Recursive DFS Element Search

struct SearchCriteria {
    var role: String?
    var identifier: String?
    var description: String?
    var helpPrefix: String?
}

func findElementDFS(
    root: AXUIElement,
    roleFilter: String?,
    maxDepth: Int = 8,
    currentDepth: Int = 0,
    predicate: (AXUIElement) -> Bool
) -> AXUIElement? {
    let role = getAXString(root, kAXRoleAttribute as String) ?? ""
    let roleMatches = (roleFilter == nil || roleFilter!.isEmpty || role == roleFilter!)

    if roleMatches && predicate(root) {
        return root
    }

    if currentDepth >= maxDepth {
        return nil
    }

    let children = getAXChildren(root)
    for child in children {
        if let found = findElementDFS(
            root: child,
            roleFilter: roleFilter,
            maxDepth: maxDepth,
            currentDepth: currentDepth + 1,
            predicate: predicate
        ) {
            return found
        }
    }

    return nil
}

func getPlayheadX(appElement: AXUIElement) -> CGFloat? {
    for w in getLogicWindows(appElement) {
        if let el = findElementDFS(root: w, roleFilter: nil, maxDepth: 10, predicate: { (getAXString($0, kAXDescriptionAttribute as String) ?? "") == "Symbol der Abspielposition" }) {
            var pVal: AnyObject?; AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &pVal)
            if let v = pVal { var pt = CGPoint.zero; AXValueGetValue(v as! AXValue, .cgPoint, &pt); return pt.x }
        }
    }
    return nil
}

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
    if let app = getLogicRunningApp() { app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps]) }
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


func findTargetElement(in window: AXUIElement, criteria: SearchCriteria) -> AXUIElement? {
    if let targetId = criteria.identifier, !targetId.isEmpty {
        if let found = findElementDFS(root: window, roleFilter: criteria.role, predicate: { (getAXString($0, "AXIdentifier") ?? "") == targetId }) {
            return found
        }
    }
    if let targetDesc = criteria.description, !targetDesc.isEmpty {
        let lowerDesc = targetDesc.lowercased()
        if let found = findElementDFS(root: window, roleFilter: criteria.role, predicate: {
            let desc = (getAXString($0, kAXDescriptionAttribute as String) ?? "").lowercased()
            let title = (getAXString($0, kAXTitleAttribute as String) ?? "").lowercased()
            return desc == lowerDesc || title == lowerDesc
        }) {
            return found
        }
    }
    if let targetHelp = criteria.helpPrefix, !targetHelp.isEmpty {
        let lowerHelp = targetHelp.lowercased()
        if let found = findElementDFS(root: window, roleFilter: criteria.role, predicate: {
            (getAXString($0, kAXHelpAttribute as String) ?? "").lowercased().hasPrefix(lowerHelp)
        }) {
            return found
        }
    }
    return nil
}


// Collect all interactive controls in a plugin window for full fast tree inspection
func collectInteractiveControls(
    root: AXUIElement,
    maxDepth: Int = 8,
    currentDepth: Int = 0,
    into results: inout [[String: Any]]
) {
    let role = getAXString(root, kAXRoleAttribute as String) ?? ""
    let interactiveRoles: Set<String> = [
        "AXSlider", "AXCheckBox", "AXButton", "AXPopUpButton", "AXRadioButton"
    ]

    if interactiveRoles.contains(role) {
        var entry: [String: Any] = ["role": role]
        if let id = getAXString(root, "AXIdentifier"), !id.isEmpty {
            entry["identifier"] = id
        }
        if let title = getAXString(root, kAXTitleAttribute as String), !title.isEmpty {
            entry["title"] = title
        }
        if let desc = getAXString(root, kAXDescriptionAttribute as String), !desc.isEmpty {
            entry["description"] = desc
        }
        if let help = getAXString(root, kAXHelpAttribute as String), !help.isEmpty {
            entry["help"] = help
        }
        if let numVal = getAXDouble(root, kAXValueAttribute as String) {
            entry["value"] = numVal
        } else if let strVal = getAXString(root, kAXValueAttribute as String) {
            entry["value"] = strVal
        }
        if let valDesc = getAXString(root, kAXValueDescriptionAttribute as String), !valDesc.isEmpty {
            entry["valueDescription"] = valDesc
        }
        if let minVal = getAXDouble(root, kAXMinValueAttribute as String) {
            entry["minValue"] = minVal
        }
        if let maxVal = getAXDouble(root, kAXMaxValueAttribute as String) {
            entry["maxValue"] = maxVal
        }
        results.append(entry)
    }

    if currentDepth >= maxDepth { return }
    for child in getAXChildren(root) {
        collectInteractiveControls(root: child, maxDepth: maxDepth, currentDepth: currentDepth + 1, into: &results)
    }
}

// MARK: - JSON Serialization Helper

func printJSON(_ object: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: []),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    } else {
        print("{\"success\":false,\"error\":\"JSON serialization failed\"}")
    }
}

// ─── CHANNEL STRIP HELPERS & TYPES ───────────────────────────────────────────

func isSubsequence(_ sub: String, _ full: String) -> Bool {
    var subIter = sub.makeIterator()
    var currentSub = subIter.next()
    for ch in full {
        if ch == currentSub {
            currentSub = subIter.next()
            if currentSub == nil { return true }
        }
    }
    return currentSub == nil
}

func matchesTrackName(_ stripName: String, query: String) -> Bool {
    let s = stripName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if s.isEmpty || q.isEmpty { return false }
    if s == q { return true }
    if s.contains(q) || q.contains(s) { return true }
    
    // 1. Normalized alphanumeric without spaces/punctuation
    let sClean = s.replacingOccurrences(of: "[^a-z0-9]", with: "", options: .regularExpression)
    let qClean = q.replacingOccurrences(of: "[^a-z0-9]", with: "", options: .regularExpression)
    if !sClean.isEmpty && !qClean.isEmpty {
        if sClean == qClean || sClean.contains(qClean) || qClean.contains(sClean) {
            return true
        }
    }
    
    // 2. Explicit MCU LCD abbreviations table (e.g. Logic 6-char LCDs)
    let mcuMap: [String: String] = [
        "moreki": "motown revisited kit",
        "simfou": "simple foundation",
        "stdgrn": "studio grand",
        "stout": "stereo out",
        "st_out": "stereo out"
    ]
    if let mapped = mcuMap[qClean] {
        let mappedClean = mapped.replacingOccurrences(of: " ", with: "")
        if sClean == mappedClean || sClean.contains(mappedClean) {
            return true
        }
    }
    
    // 3. Subsequence matching (e.g. "stdgrn" in "studiogrand", "moreki" in "motownrevisitedkit", "simfou" in "simplefoundation")
    if qClean.count >= 2 && sClean.first == qClean.first && isSubsequence(qClean, sClean) {
        return true
    }
    
    // 4. Word tokens
    let sWords = s.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
    let qWords = q.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
    
    // 5. Initials / Acronym match (e.g. "mrk" -> "motown revisited kit")
    let initials = sWords.compactMap { $0.first }.map { String($0) }.joined()
    if !initials.isEmpty && (initials == qClean || qClean == initials) {
        return true
    }
    
    // 6. CamelCase / Syllable parts matching (e.g. "MoReKi" -> ["mo", "re", "ki"])
    let camelParts: [String] = {
        var parts: [String] = []
        var cur = ""
        for ch in query.trimmingCharacters(in: .whitespacesAndNewlines) {
            if ch.isUppercase && !cur.isEmpty {
                parts.append(cur.lowercased())
                cur = String(ch)
            } else {
                cur.append(ch)
            }
        }
        if !cur.isEmpty { parts.append(cur.lowercased()) }
        return parts
    }()
    
    if camelParts.count > 1 && camelParts.count <= sWords.count {
        var allMatch = true
        for (idx, cp) in camelParts.enumerated() {
            if idx < sWords.count {
                if !sWords[idx].hasPrefix(cp) && !isSubsequence(cp, sWords[idx]) {
                    allMatch = false
                    break
                }
            } else {
                allMatch = false
                break
            }
        }
        if allMatch { return true }
    }
    
    // 7. Individual word prefix/contains matching
    for sw in sWords where sw.count >= 3 {
        for qw in qWords where qw.count >= 3 {
            if sw == qw || sw.hasPrefix(qw) || qw.hasPrefix(sw) {
                return true
            }
        }
    }
    return false
}

func parseDbString(_ raw: String) -> Double {
    let lower = raw.lowercased()
    if lower.contains("∞") || lower.contains("inf") {
        return -100.0
    }
    let pattern = "[-+]?[0-9]+([.,][0-9]+)?"
    if let regex = try? NSRegularExpression(pattern: pattern),
       let match = regex.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)),
       let range = Range(match.range, in: raw) {
        let numStr = raw[range].replacingOccurrences(of: ",", with: ".")
        return Double(numStr) ?? 0.0
    }
    return 0.0
}

/// Logics Fader-Kennlinie (0..233):
/// +6 dB = 233.0 (1.00)
///  0 dB = 173.0 (~0.75)
/// -6 dB = 140.0 (~0.60)
/// -12 dB = 106.0 (~0.45)
/// -18 dB = 90.0 (~0.38)
/// -30 dB = 50.0 (~0.21)
/// -50 dB = 15.0 (~0.06)
/// -96 dB = 0.0 (0.00)
func dbToLogicSliderValue(_ db: Double) -> Double {
    if db >= 6.0 { return 233.0 }
    if db >= 0.0 { return 173.0 + (db / 6.0) * (233.0 - 173.0) }
    if db >= -6.0 { return 140.0 + ((db + 6.0) / 6.0) * (173.0 - 140.0) }
    if db >= -12.0 { return 106.0 + ((db + 12.0) / 6.0) * (140.0 - 106.0) }
    if db >= -18.0 { return 90.0 + ((db + 18.0) / 6.0) * (106.0 - 90.0) }
    if db >= -30.0 { return 50.0 + ((db + 30.0) / 12.0) * (90.0 - 50.0) }
    if db >= -50.0 { return 15.0 + ((db + 50.0) / 20.0) * (50.0 - 15.0) }
    if db <= -96.0 { return 0.0 }
    return max(0.0, ((db + 96.0) / 46.0) * 15.0)
}

func stepFaderToTargetDb(slider: AXUIElement, targetDb: Double) -> (success: Bool, finalDb: Double) {
    for _ in 0..<70 {
        let curDesc = getAXString(slider, kAXValueDescriptionAttribute as String) ?? ""
        let curDb = parseDbString(curDesc)
        let diff = targetDb - curDb
        
        if abs(diff) <= 0.15 {
            return (true, curDb)
        }
        
        if diff <= -1.2 {
            // Coarse step down (~1.0 dB to 1.5 dB per step)
            AXUIElementPerformAction(slider, "AXDecrement" as CFString)
        } else if diff >= 1.2 {
            // Coarse step up
            AXUIElementPerformAction(slider, "AXIncrement" as CFString)
        } else if diff < 0 {
            // Fine step down (-0.1 dB per micro-step)
            var low = -100.0
            if let cf = CFNumberCreate(kCFAllocatorDefault, .doubleType, &low) {
                AXUIElementSetAttributeValue(slider, kAXValueAttribute as CFString, cf)
            }
        } else {
            // Fine step up (+0.1 dB per micro-step)
            var high = 300.0
            if let cf = CFNumberCreate(kCFAllocatorDefault, .doubleType, &high) {
                AXUIElementSetAttributeValue(slider, kAXValueAttribute as CFString, cf)
            }
        }
    }
    let finalDesc = getAXString(slider, kAXValueDescriptionAttribute as String) ?? ""
    let finalDb = parseDbString(finalDesc)
    return (abs(finalDb - targetDb) <= 0.5, finalDb)
}

func stepPanToTarget(knob: AXUIElement, targetPan: Double) -> (success: Bool, finalPan: Double) {
    let clampedTarget = max(-64.0, min(63.0, targetPan))
    
    for _ in 0..<50 {
        let cur = getAXDouble(knob, kAXValueAttribute as String) ?? 0.0
        let diff = clampedTarget - cur
        
        if abs(diff) < 1.0 {
            return (true, cur)
        }
        
        if diff >= 10.0 {
            AXUIElementPerformAction(knob, "AXIncrement" as CFString)
        } else if diff <= -10.0 {
            AXUIElementPerformAction(knob, "AXDecrement" as CFString)
        } else if diff > 0 {
            var high = 100.0
            if let cf = CFNumberCreate(kCFAllocatorDefault, .doubleType, &high) {
                AXUIElementSetAttributeValue(knob, kAXValueAttribute as CFString, cf)
            }
        } else {
            var low = -100.0
            if let cf = CFNumberCreate(kCFAllocatorDefault, .doubleType, &low) {
                AXUIElementSetAttributeValue(knob, kAXValueAttribute as CFString, cf)
            }
        }
    }
    
    let finalVal = getAXDouble(knob, kAXValueAttribute as String) ?? 0.0
    return (abs(finalVal - clampedTarget) <= 2.0, finalVal)
}

func findAllChannelStripElements(_ windows: [AXUIElement]) -> [AXUIElement] {
    func searchInRoot(_ root: AXUIElement, depth: Int = 0) -> [AXUIElement] {
        if depth > 10 { return [] }
        let role = getAXString(root, kAXRoleAttribute as String) ?? ""
        let desc = (getAXString(root, kAXDescriptionAttribute as String) ?? "").lowercased()
        
        // Logic Pro: AXLayoutArea desc="Mixer" contains AXLayoutItem for each track
        if role == "AXLayoutArea" && desc.contains("mixer") {
            let items = getAXChildren(root).filter {
                (getAXString($0, kAXRoleAttribute as String) ?? "") == "AXLayoutItem"
            }
            if !items.isEmpty { return items }
        }
        
        var best: [AXUIElement] = []
        for c in getAXChildren(root) {
            let res = searchInRoot(c, depth: depth + 1)
            if res.count > best.count {
                best = res
            }
        }
        if !best.isEmpty { return best }
        
        // Fallback: any AXLayoutArea that contains items with volume fader sliders
        if role == "AXLayoutArea" {
            let items = getAXChildren(root).filter { item in
                let ch = getAXChildren(item)
                return ch.contains {
                    let r = getAXString($0, kAXRoleAttribute as String) ?? ""
                    let d = (getAXString($0, kAXDescriptionAttribute as String) ?? "").lowercased()
                    return r == "AXSlider" && (d.contains("lautstärke") || d.contains("volume"))
                }
            }
            if !items.isEmpty { return items }
        }
        
        return []
    }
    
    // Check main window first (AXStandardWindow)
    for w in windows {
        let sr = getAXString(w, kAXSubroleAttribute as String) ?? ""
        let t = (getAXString(w, kAXTitleAttribute as String) ?? "").lowercased()
        if sr == "AXStandardWindow" || t.contains("spuren") || t.contains("tracks") || t.contains("mixer") {
            let strips = searchInRoot(w)
            if !strips.isEmpty { return strips }
        }
    }
    
    for w in windows {
        let strips = searchInRoot(w)
        if !strips.isEmpty { return strips }
    }
    return []
}

struct ParsedSendSlot {
    let slot: Int
    let bus: Int?
    let name: String
    let levelDb: Double
    let button: AXUIElement?
    let slider: AXUIElement?
}

func parseSends(strip: AXUIElement) -> [ParsedSendSlot] {
    let children = getAXChildren(strip)
    var sliders: [(slider: AXUIElement, pos: CGPoint)] = []
    var groups: [(group: AXUIElement, pos: CGPoint, desc: String)] = []

    for c in children {
        let r = getAXString(c, kAXRoleAttribute as String) ?? ""
        let d = (getAXString(c, kAXDescriptionAttribute as String) ?? "").lowercased()
        if r == "AXSlider" && d.contains("send") {
            var pVal: AnyObject?
            AXUIElementCopyAttributeValue(c, kAXPositionAttribute as CFString, &pVal)
            var p = CGPoint.zero
            if let pv = pVal { AXValueGetValue(pv as! AXValue, .cgPoint, &p) }
            sliders.append((slider: c, pos: p))
        }
        if r == "AXGroup" && (d.contains("bus") || d.contains("aux") || d.contains("send")) {
            var pVal: AnyObject?
            AXUIElementCopyAttributeValue(c, kAXPositionAttribute as CFString, &pVal)
            var p = CGPoint.zero
            if let pv = pVal { AXValueGetValue(pv as! AXValue, .cgPoint, &p) }
            groups.append((group: c, pos: p, desc: getAXString(c, kAXDescriptionAttribute as String) ?? ""))
        }
    }

    sliders.sort { $0.pos.y < $1.pos.y }

    var result: [ParsedSendSlot] = []
    for (idx, sItem) in sliders.enumerated() {
        let slotNum = idx + 1
        let matchingGroup = groups.first { abs($0.pos.y - sItem.pos.y) <= 8.0 }
        let groupDesc = matchingGroup?.desc ?? "Bus \(slotNum)"

        var busNum: Int? = nil
        let parts = groupDesc.components(separatedBy: CharacterSet.decimalDigits.inverted).filter { !$0.isEmpty }
        if let firstNum = parts.first, let num = Int(firstNum) {
            busNum = num
        }

        var slotBtn: AXUIElement? = nil
        if let g = matchingGroup?.group {
            slotBtn = getAXChildren(g).first { c in
                let r = getAXString(c, kAXRoleAttribute as String) ?? ""
                let d = (getAXString(c, kAXDescriptionAttribute as String) ?? "").lowercased()
                return r == "AXButton" && (d.contains("liste") || d.contains("list") || d.isEmpty)
            } ?? g
        }

        let valDesc = getAXString(sItem.slider, kAXValueDescriptionAttribute as String) ?? ""
        let db = parseDbString(valDesc)

        result.append(ParsedSendSlot(
            slot: slotNum,
            bus: busNum,
            name: groupDesc,
            levelDb: db,
            button: slotBtn,
            slider: sItem.slider
        ))
    }
    return result
}

struct ParsedChannelStrip {
    let element: AXUIElement
    let trackName: String
    let faderDb: Double
    let pan: Double
    let mute: Bool
    let solo: Bool
    let inserts: [[String: Any]]
    let sends: [[String: Any]]
    let faderSlider: AXUIElement?
    let faderTextField: AXUIElement?
    let balanceSlider: AXUIElement?
    let pluginGroups: [(name: String, group: AXUIElement)]
    let sendSlots: [ParsedSendSlot]
}

func parseChannelStripElement(_ strip: AXUIElement) -> ParsedChannelStrip {
    var trackName = getAXString(strip, kAXDescriptionAttribute as String) ?? ""
    var faderDb: Double = 0.0
    var pan: Double = 0.0
    var muted = false
    var soloed = false
    var inserts: [[String: Any]] = []
    var faderSlider: AXUIElement? = nil
    var faderTextField: AXUIElement? = nil
    var balanceSlider: AXUIElement? = nil
    var rawPluginGroups: [(name: String, group: AXUIElement, y: CGFloat)] = []
    var insertBtnYs: [CGFloat] = []
    
    let children = getAXChildren(strip)
    for c in children {
        let role = getAXString(c, kAXRoleAttribute as String) ?? ""
        let desc = getAXString(c, kAXDescriptionAttribute as String) ?? ""
        let title = getAXString(c, kAXTitleAttribute as String) ?? ""
        let descLower = desc.lowercased()
        
        if role == "AXTextField" && descLower == "name" {
            let val = getAXString(c, kAXValueAttribute as String) ?? ""
            if !val.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                trackName = val.trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        
        if role == "AXSlider" {
            if descLower.contains("lautstärke") || descLower.contains("volume") || descLower.contains("fader") {
                faderSlider = c
                let valDesc = getAXString(c, kAXValueDescriptionAttribute as String) ?? ""
                if !valDesc.isEmpty {
                    faderDb = parseDbString(valDesc)
                }
            } else if descLower.contains("balance") || descLower.contains("pan") {
                balanceSlider = c
                pan = getAXDouble(c, kAXValueAttribute as String) ?? 0.0
            }
        }
        
        if role == "AXTextField" && descLower.contains("pegel des lautstärkereglers") {
            faderTextField = c
            let t = title.isEmpty ? desc : title
            if let commaRange = t.range(of: ",") {
                // e.g. "Pegel des Lautstärkereglers, -6,7 dB" -> "-6,7 dB"
                let part = String(t[commaRange.upperBound...])
                faderDb = parseDbString(part)
            }
        }
        
        if role == "AXButton" {
            if descLower.contains("takt einfügen") || descLower.contains("insert") || descLower.contains("audio-plug-in") {
                var pVal: AnyObject?
                AXUIElementCopyAttributeValue(c, kAXPositionAttribute as CFString, &pVal)
                var p = CGPoint.zero
                if let pv = pVal { AXValueGetValue(pv as! AXValue, .cgPoint, &p) }
                insertBtnYs.append(p.y)
            }
            if descLower.contains("ton aus") || descLower.contains("mute") || descLower.contains("stumm") {
                let v = (getAXString(c, kAXValueAttribute as String) ?? "").lowercased()
                muted = (v == "ein" || v == "1" || v == "true")
            }
            if descLower.contains("solo") {
                let v = (getAXString(c, kAXValueAttribute as String) ?? "").lowercased()
                soloed = (v == "ein" || v == "1" || v == "true")
            }
        }
        
        if role == "AXGroup" {
            let ignored = ["automation", "read", "gruppe", "stereo-ausgabe", "pegelreduktionsmesser", "bus", "send", "aux"]
            let isIgnored = ignored.contains(where: { descLower.contains($0) })
            if !desc.isEmpty && !isIgnored {
                var pVal: AnyObject?
                AXUIElementCopyAttributeValue(c, kAXPositionAttribute as CFString, &pVal)
                var p = CGPoint.zero
                if let pv = pVal { AXValueGetValue(pv as! AXValue, .cgPoint, &p) }
                rawPluginGroups.append((name: desc, group: c, y: p.y))
            }
        }
    }
    
    // Filter out instrument group if audio insert buttons exist (e.g. Bass, Drum Kit, Piano)
    let minInsertY = insertBtnYs.min() ?? -1
    let audioPluginGroups = rawPluginGroups.filter { g in
        if minInsertY > 0 && g.y < minInsertY - 5.0 {
            return false
        }
        return true
    }
    
    // Sort vertically ascending: lowest Y is top of channel strip (Slot 1)
    let sortedGroups = audioPluginGroups.sorted { $0.y < $1.y }
    let pluginGroups = sortedGroups.map { (name: $0.name, group: $0.group) }
    
    // Convert pluginGroups to 1-indexed inserts
    for (i, pg) in pluginGroups.enumerated() {
        inserts.append([
            "slot": i + 1,
            "name": pg.name
        ])
    }

    // Parse send slots
    let parsedSendsList = parseSends(strip: strip)
    var sends: [[String: Any]] = []
    for s in parsedSendsList {
        sends.append([
            "slot": s.slot,
            "bus": s.bus ?? 0,
            "name": s.name,
            "levelDb": s.levelDb
        ])
    }
    
    return ParsedChannelStrip(
        element: strip,
        trackName: trackName,
        faderDb: faderDb,
        pan: pan,
        mute: muted,
        solo: soloed,
        inserts: inserts,
        sends: sends,
        faderSlider: faderSlider,
        faderTextField: faderTextField,
        balanceSlider: balanceSlider,
        pluginGroups: pluginGroups,
        sendSlots: parsedSendsList
    )
}

// MARK: - Sprint 8 Helpers: Channel Strip and Audio FX Menu Traversal

func selectTrackByName(appElement: AXUIElement, trackName: String) -> Bool {
    let allWindows = getLogicWindows(appElement)
    let target = trackName.lowercased()
    for w in allWindows {
        let subrole = getAXString(w, kAXSubroleAttribute as String) ?? ""
        guard subrole == "AXStandardWindow" else { continue }
        if let trackRow = findElementDFS(root: w, roleFilter: "AXRow", predicate: { el in
            let title = (getAXString(el, kAXTitleAttribute as String) ?? "").lowercased()
            let desc  = (getAXString(el, kAXDescriptionAttribute as String) ?? "").lowercased()
            return title.contains(target) || desc.contains(target)
        }) {
            _ = AXUIElementSetAttributeValue(trackRow, kAXSelectedAttribute as CFString, true as CFTypeRef)
            _ = AXUIElementPerformAction(trackRow, kAXPressAction as CFString)
            return true
        }
        if let nameCell = findElementDFS(root: w, roleFilter: "AXStaticText", predicate: { el in
            let val = (getAXString(el, kAXValueAttribute as String) ?? "").lowercased()
            let title = (getAXString(el, kAXTitleAttribute as String) ?? "").lowercased()
            return val.contains(target) || title.contains(target)
        }) {
            if let parentVal = getAXAttribute(nameCell, kAXParentAttribute as String) {
                let p = parentVal as! AXUIElement
                _ = AXUIElementPerformAction(p, kAXPressAction as CFString)
                return true
            } else {
                _ = AXUIElementPerformAction(nameCell, kAXPressAction as CFString)
                return true
            }
        }
    }
    return false
}

func findChannelStripForTrack(appElement: AXUIElement, trackName: String) -> ParsedChannelStrip? {
    let allWins = getLogicWindows(appElement)
    let stripElements = findAllChannelStripElements(allWins)
    
    for el in stripElements {
        let parsed = parseChannelStripElement(el)
        if matchesTrackName(parsed.trackName, query: trackName) {
            return parsed
        }
    }
    
    // Fallback: Select track to bring Inspector into focus
    if selectTrackByName(appElement: appElement, trackName: trackName) {
        usleep(150_000)
        let updatedWins = getLogicWindows(appElement)
        let updatedStrips = findAllChannelStripElements(updatedWins)
        for el in updatedStrips {
            let parsed = parseChannelStripElement(el)
            if matchesTrackName(parsed.trackName, query: trackName) {
                return parsed
            }
        }
        if let first = updatedStrips.first {
            return parseChannelStripElement(first)
        }
    }
    return nil
}

func findAudioFXSlotButton(strip: ParsedChannelStrip, slotNum: Int) -> AXUIElement? {
    // 1. If slot is occupied by an existing plugin
    if slotNum >= 1 && slotNum <= strip.pluginGroups.count {
        let pg = strip.pluginGroups[slotNum - 1].group
        for c in getAXChildren(pg) {
            let r = getAXString(c, kAXRoleAttribute as String) ?? ""
            if r == "AXPopUpButton" || r == "AXButton" {
                return c
            }
        }
        return pg
    }
    
    // 2. If slot is empty: collect empty Audio FX slot buttons
    let children = getAXChildren(strip.element)
    var emptyFXButtons: [AXUIElement] = []
    
    for c in children {
        let role = getAXString(c, kAXRoleAttribute as String) ?? ""
        guard role == "AXButton" || role == "AXPopUpButton" else { continue }
        let desc = (getAXString(c, kAXDescriptionAttribute as String) ?? "").lowercased()
        let title = (getAXString(c, kAXTitleAttribute as String) ?? "").lowercased()
        let help = (getAXString(c, kAXHelpAttribute as String) ?? "").lowercased()
        
        let isIgnored = desc.contains("ton aus") || desc.contains("mute") || desc.contains("stumm") ||
                        desc.contains("solo") || desc.contains("rec") || desc.contains("aufnahme") ||
                        desc.contains("read") || desc.contains("touch") || desc.contains("latch") ||
                        desc.contains("automation") || desc.contains("input") || desc.contains("eingang") ||
                        desc.contains("stereo-ausgabe") || desc.contains("output") || desc.contains("send") ||
                        title == "m" || title == "s" || title == "r" || title == "i"
        guard !isIgnored else { continue }
        
        if desc.contains("audio-fx") || desc.contains("audio fx") || desc.contains("audio-effekt") ||
           desc.contains("insert") || desc.contains("plug-in") || desc.contains("plugin") ||
           help.contains("audio-fx") || help.contains("insert") || help.contains("plug-in") {
            emptyFXButtons.append(c)
        } else if desc.isEmpty && title.isEmpty {
            emptyFXButtons.append(c)
        }
    }
    
    let emptyIdx = slotNum - (strip.pluginGroups.count + 1)
    if emptyIdx >= 0 && emptyIdx < emptyFXButtons.count {
        return emptyFXButtons[emptyIdx]
    }
    return emptyFXButtons.first
}

func findActiveMenu(appElement: AXUIElement, slotButton: AXUIElement) -> AXUIElement? {
    func isValidMenu(_ m: AXUIElement) -> Bool {
        let ch = getAXChildren(m)
        let titles = ch.compactMap { getAXString($0, kAXTitleAttribute as String) }
        if titles.contains("Über diesen Mac") || titles.contains("About This Mac") {
            return false
        }
        return true
    }

    // 1. Direct children of slotButton
    for c in getAXChildren(slotButton) {
        if (getAXString(c, kAXRoleAttribute as String) ?? "") == "AXMenu" && isValidMenu(c) {
            return c
        }
    }
    // 2. Direct children of appElement
    for c in getAXChildren(appElement) {
        let r = getAXString(c, kAXRoleAttribute as String) ?? ""
        if r == "AXMenu" && isValidMenu(c) {
            return c
        }
    }
    // 3. Search in windows
    for w in getLogicWindows(appElement) {
        if (getAXString(w, kAXRoleAttribute as String) ?? "") == "AXMenu" && isValidMenu(w) {
            return w
        }
        for c in getAXChildren(w) {
            if (getAXString(c, kAXRoleAttribute as String) ?? "") == "AXMenu" && isValidMenu(c) {
                return c
            }
        }
    }
    // 4. DFS search in appElement children (excluding AXMenuBar)
    for c in getAXChildren(appElement) {
        let r = getAXString(c, kAXRoleAttribute as String) ?? ""
        if r != "AXMenuBar" {
            if let menu = findElementDFS(root: c, roleFilter: "AXMenu", maxDepth: 4, predicate: { isValidMenu($0) }) {
                return menu
            }
        }
    }
    return nil
}

func getSubmenu(of item: AXUIElement, appElement: AXUIElement) -> AXUIElement? {
    // 1. Check children of the item
    for c in getAXChildren(item) {
        if (getAXString(c, kAXRoleAttribute as String) ?? "") == "AXMenu" {
            return c
        }
    }
    // 2. Check AXSubmenu attribute if present
    if let subVal = getAXAttribute(item, "AXSubmenu") {
        return (subVal as! AXUIElement)
    }
    // 3. Trigger submenu opening with AXPress
    _ = AXUIElementPerformAction(item, kAXPressAction as CFString)
    usleep(80_000)
    for c in getAXChildren(item) {
        if (getAXString(c, kAXRoleAttribute as String) ?? "") == "AXMenu" {
            return c
        }
    }
    // 4. In macOS, newly opened submenus may be appended to appElement's children
    let menus = getAXChildren(appElement).filter {
        (getAXString($0, kAXRoleAttribute as String) ?? "") == "AXMenu"
    }
    if let lastMenu = menus.last {
        return lastMenu
    }
    return nil
}

func findMenuItem(menu: AXUIElement, query: String) -> AXUIElement? {
    let items = getAXChildren(menu).filter {
        (getAXString($0, kAXRoleAttribute as String) ?? "") == "AXMenuItem"
    }
    let q = query.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
    
    // Exact match
    if let exact = items.first(where: {
        (getAXString($0, kAXTitleAttribute as String) ?? "").lowercased().trimmingCharacters(in: .whitespacesAndNewlines) == q
    }) {
        return exact
    }
    
    // Substring match
    if let sub = items.first(where: {
        (getAXString($0, kAXTitleAttribute as String) ?? "").lowercased().contains(q)
    }) {
        return sub
    }
    return nil
}

func closeMenu(_ menu: AXUIElement?) {
    guard let m = menu else { return }
    _ = AXUIElementPerformAction(m, kAXCancelAction as CFString)
}

// MARK: - Sprint 9 Helpers: Bus Sends, Routing & Send Level Control

func findSendSlotButton(strip: ParsedChannelStrip, slotNum: Int) -> AXUIElement? {
    // 1. If slot is already assigned to a bus, return its button/list button to reassign
    if slotNum >= 1 && slotNum <= strip.sendSlots.count {
        return strip.sendSlots[slotNum - 1].button
    }

    // 2. Otherwise find the unassigned Send slot button (e.g. desc="Taste „Send“" or help containing "Send-Slot")
    let children = getAXChildren(strip.element)
    var emptySendButtons: [AXUIElement] = []
    for c in children {
        let r = getAXString(c, kAXRoleAttribute as String) ?? ""
        guard r == "AXButton" || r == "AXPopUpButton" else { continue }
        let d = (getAXString(c, kAXDescriptionAttribute as String) ?? "").lowercased()
        let h = (getAXString(c, kAXHelpAttribute as String) ?? "").lowercased()
        let t = (getAXString(c, kAXTitleAttribute as String) ?? "").lowercased()
        if (d.contains("send") || h.contains("send-slot") || t.contains("send")) && !d.contains("stereo-ausgabe") && !d.contains("output") {
            emptySendButtons.append(c)
        }
    }

    // In Logic Pro, unassigned send slots are filled in sequence
    let emptyIdx = slotNum - (strip.sendSlots.count + 1)
    if emptyIdx >= 0 && emptyIdx < emptySendButtons.count {
        return emptySendButtons[emptyIdx]
    }
    return emptySendButtons.first
}

func findSendMenu(appElement: AXUIElement) -> AXUIElement? {
    func findIn(_ el: AXUIElement, depth: Int = 0) -> AXUIElement? {
        if depth > 6 { return nil }
        let r = getAXString(el, kAXRoleAttribute as String) ?? ""
        if r == "AXMenu" {
            let p = getAXChildren(el)
            let titles = p.compactMap { getAXString($0, kAXTitleAttribute as String) }
            if titles.contains("Bus") || titles.contains("Kein Send") || titles.contains("Post-Pan") || titles.contains("No Send") {
                return el
            }
        }
        for c in getAXChildren(el) {
            if let m = findIn(c, depth: depth + 1) { return m }
        }
        return nil
    }

    for w in getLogicWindows(appElement) {
        if let m = findIn(w) { return m }
    }
    for c in getAXChildren(appElement) {
        let r = getAXString(c, kAXRoleAttribute as String) ?? ""
        if r != "AXMenuBar" {
            if let m = findIn(c) { return m }
        }
    }
    return nil
}

func dragSendKnobToDb(slider: AXUIElement, targetDb: Double) -> (success: Bool, finalDb: Double) {
    var pVal: AnyObject?
    var sVal: AnyObject?
    AXUIElementCopyAttributeValue(slider, kAXPositionAttribute as CFString, &pVal)
    AXUIElementCopyAttributeValue(slider, kAXSizeAttribute as CFString, &sVal)
    var p = CGPoint.zero
    var s = CGSize.zero
    if let pv = pVal { AXValueGetValue(pv as! AXValue, .cgPoint, &p) }
    if let sv = sVal { AXValueGetValue(sv as! AXValue, .cgSize, &s) }
    let center = CGPoint(x: p.x + s.width / 2.0, y: p.y + s.height / 2.0)

    // If target is -inf / mute
    if targetDb <= -70.0 {
        for _ in 0..<20 {
            _ = AXUIElementPerformAction(slider, "AXDecrement" as CFString)
            let desc = getAXString(slider, kAXValueDescriptionAttribute as String) ?? ""
            if parseDbString(desc) <= -70.0 {
                return (true, -100.0)
            }
        }
    }

    // If currently at -inf, wake up the knob
    let initDesc = getAXString(slider, kAXValueDescriptionAttribute as String) ?? ""
    if parseDbString(initDesc) <= -70.0 && targetDb > -70.0 {
        _ = AXUIElementPerformAction(slider, "AXIncrement" as CFString)
        usleep(10_000)
    }

    let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: center, mouseButton: .left)
    down?.post(tap: .cghidEventTap)
    usleep(15_000)

    var curY = center.y
    var bestDb = parseDbString(getAXString(slider, kAXValueDescriptionAttribute as String) ?? "")
    var bestDiff = abs(bestDb - targetDb)

    for _ in 0..<80 {
        let curDesc = getAXString(slider, kAXValueDescriptionAttribute as String) ?? ""
        let curDb = parseDbString(curDesc)
        let diff = targetDb - curDb // positive means we need higher dB (drag UP = -y)

        if abs(diff) < bestDiff {
            bestDiff = abs(diff)
            bestDb = curDb
        }
        if abs(diff) <= 0.15 {
            break
        }

        let stepY: CGFloat
        if abs(diff) > 10.0 {
            stepY = (diff > 0 ? -12.0 : 12.0)
        } else if abs(diff) > 3.0 {
            stepY = (diff > 0 ? -4.0 : 4.0)
        } else if abs(diff) > 1.0 {
            stepY = (diff > 0 ? -1.5 : 1.5)
        } else {
            stepY = (diff > 0 ? -0.5 : 0.5)
        }

        curY += stepY
        let dragPt = CGPoint(x: center.x, y: curY)
        let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: dragPt, mouseButton: .left)
        drag?.post(tap: .cghidEventTap)
        usleep(6_000)
    }

    let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: CGPoint(x: center.x, y: curY), mouseButton: .left)
    up?.post(tap: .cghidEventTap)
    usleep(25_000)

    let finalDesc = getAXString(slider, kAXValueDescriptionAttribute as String) ?? ""
    let finalDb = parseDbString(finalDesc)
    return (abs(finalDb - targetDb) <= 0.5, finalDb)
}

// MARK: - Sprint 10 Helpers: Sidechain Header Routing

func findSidechainButton(in window: AXUIElement) -> AXUIElement? {
    func isSidechainElement(_ el: AXUIElement) -> Bool {
        let role = getAXString(el, kAXRoleAttribute as String) ?? ""
        guard role == "AXPopUpButton" || role == "AXMenuButton" else { return false }
        let help = (getAXString(el, kAXHelpAttribute as String) ?? "").lowercased()
        let desc = (getAXString(el, kAXDescriptionAttribute as String) ?? "").lowercased()
        let title = (getAXString(el, kAXTitleAttribute as String) ?? "").lowercased()
        let combined = "\(help) \(desc) \(title)"
        return combined.contains("side") && combined.contains("chain")
    }

    // 1. Direct children of window
    for c in getAXChildren(window) {
        if isSidechainElement(c) {
            return c
        }
    }

    // 2. Nested in window header groups (AXGroup / AXToolbar)
    for c in getAXChildren(window) {
        let r = getAXString(c, kAXRoleAttribute as String) ?? ""
        if r == "AXGroup" || r == "AXToolbar" {
            for gc in getAXChildren(c) {
                if isSidechainElement(gc) {
                    return gc
                }
                for ggc in getAXChildren(gc) {
                    if isSidechainElement(ggc) {
                        return ggc
                    }
                }
            }
        }
    }

    // 3. Fallback: Any AXPopUpButton where help/desc has "side"
    for c in getAXChildren(window) {
        let role = getAXString(c, kAXRoleAttribute as String) ?? ""
        if role == "AXPopUpButton" {
            let help = (getAXString(c, kAXHelpAttribute as String) ?? "").lowercased()
            let desc = (getAXString(c, kAXDescriptionAttribute as String) ?? "").lowercased()
            if help.contains("side") || desc.contains("side") {
                return c
            }
        }
    }

    return nil
}

func findSidechainMenu(appElement: AXUIElement, slotButton: AXUIElement) -> AXUIElement? {
    func isSidechainMenu(_ m: AXUIElement) -> Bool {
        let ch = getAXChildren(m)
        let titles = ch.compactMap { getAXString($0, kAXTitleAttribute as String) }
        return titles.contains("Intern") || titles.contains("Bus") || titles.contains("None") || titles.contains("Eingang") || titles.contains("Inst.")
    }

    // 1. Direct children of slotButton
    for c in getAXChildren(slotButton) {
        if (getAXString(c, kAXRoleAttribute as String) ?? "") == "AXMenu" && isSidechainMenu(c) {
            return c
        }
    }
    // 2. Direct children of appElement
    for c in getAXChildren(appElement) {
        let r = getAXString(c, kAXRoleAttribute as String) ?? ""
        if r == "AXMenu" && isSidechainMenu(c) {
            return c
        }
    }
    // 3. Search in windows
    for w in getLogicWindows(appElement) {
        if (getAXString(w, kAXRoleAttribute as String) ?? "") == "AXMenu" && isSidechainMenu(w) {
            return w
        }
        for c in getAXChildren(w) {
            if (getAXString(c, kAXRoleAttribute as String) ?? "") == "AXMenu" && isSidechainMenu(c) {
                return c
            }
        }
    }
    // 4. In appElement children (excluding AXMenuBar)
    for c in getAXChildren(appElement) {
        let r = getAXString(c, kAXRoleAttribute as String) ?? ""
        if r != "AXMenuBar" {
            if let menu = findElementDFS(root: c, roleFilter: "AXMenu", maxDepth: 4, predicate: { isSidechainMenu($0) }) {
                return menu
            }
        }
    }
    return nil
}

func activateLogicApp() {
    let bundleApps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.logic10")
    bundleApps.first?.activate()
}

func ensurePluginWindowOpen(appElement: AXUIElement, trackName: String, slotNum: Int) -> (window: AXUIElement, pluginName: String, stripTrackName: String)? {
    activateLogicApp()
    usleep(50_000)

    // 1. Find Channel Strip for track
    guard let strip = findChannelStripForTrack(appElement: appElement, trackName: trackName) else {
        return nil
    }

    // 2. Validate slotNum
    guard slotNum >= 1 && slotNum <= strip.pluginGroups.count else {
        return nil
    }
    let targetPlugin = strip.pluginGroups[slotNum - 1]

    // 3. Check if plugin window is already open
    let freshWins = getLogicWindows(appElement)
    for w in freshWins {
        let sr = getAXString(w, kAXSubroleAttribute as String) ?? ""
        let t = getAXString(w, kAXTitleAttribute as String) ?? ""
        if (sr == "AXDialog" || sr == "AXFloatingWindow") && !t.isEmpty {
            let pName = detectPluginName(in: w, windowTitle: t)
            if t.lowercased().contains(strip.trackName.lowercased()) || pName.lowercased() == targetPlugin.name.lowercased() {
                _ = AXUIElementPerformAction(w, "AXRaise" as CFString)
                return (w, targetPlugin.name, strip.trackName)
            }
        }
    }

    // 4. Open plugin via insert slot button
    var openBtn: AXUIElement? = nil
    for c in getAXChildren(targetPlugin.group) {
        let r = getAXString(c, kAXRoleAttribute as String) ?? ""
        if r == "AXButton" {
            openBtn = c
            break
        }
    }
    guard let btn = openBtn else { return nil }

    let pressErr = AXUIElementPerformAction(btn, kAXPressAction as CFString)
    guard pressErr == .success || pressErr == .cannotComplete else { return nil }

    // Wait up to 600ms for window to appear
    let deadline = Date().addingTimeInterval(0.6)
    while Date() < deadline {
        Thread.sleep(forTimeInterval: 0.05)
        let wins = getLogicWindows(appElement)
        for w in wins {
            let sr = getAXString(w, kAXSubroleAttribute as String) ?? ""
            let t = getAXString(w, kAXTitleAttribute as String) ?? ""
            if (sr == "AXDialog" || sr == "AXFloatingWindow") && !t.isEmpty {
                let pName = detectPluginName(in: w, windowTitle: t)
                if t.lowercased().contains(strip.trackName.lowercased()) || pName.lowercased() == targetPlugin.name.lowercased() {
                    return (w, targetPlugin.name, strip.trackName)
                }
            }
        }
    }

    return nil
}

// MARK: - CLI Argument Parser

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else {
    printJSON(["success": false, "error": "Missing command. Expected: scan-windows | dump-window | read-param | set-param | scan-tracks | list-channel-strips | set-fader | set-pan | open-insert | close-plugin-window | set-folder-expanded | select-track | load-plugin | list-insert-menu | set-send-bus | set-send-level | get-sidechain | set-sidechain"])
    exit(1)
}

func getArg(_ flag: String) -> String? {
    guard let idx = args.firstIndex(of: flag), idx + 1 < args.count else { return nil }
    return args[idx + 1]
}

guard let appElement = findLogicApplicationElement() else {
    if command == "scan-windows" || command == "scan-tracks" {
        printJSON([])
        exit(0)
    }
    printJSON(["success": false, "error": "Logic Pro is not running"])
    exit(0)
}

switch command {
case "scan-windows":
    let windows = getLogicWindows(appElement)
    var out: [[String: Any]] = []
    for w in windows {
        let title = getAXString(w, kAXTitleAttribute as String) ?? ""
        let subrole = getAXString(w, kAXSubroleAttribute as String) ?? ""
        let children = getAXChildren(w)
        let pluginName = detectPluginName(in: w, windowTitle: title)
        out.append([
            "title": title,
            "subrole": subrole,
            "elementCount": children.count,
            "pluginName": pluginName
        ])
    }
    printJSON(out)

case "dump-window":
    let winQuery = getArg("--window") ?? ""
    guard let targetWin = findTargetWindow(appElement, query: winQuery) else {
        printJSON(["success": false, "error": buildWindowError(appElement, query: winQuery)])
        exit(0)
    }
    let title = getAXString(targetWin, kAXTitleAttribute as String) ?? winQuery
    let pluginName = detectPluginName(in: targetWin, windowTitle: title)
    var controls: [[String: Any]] = []
    collectInteractiveControls(root: targetWin, into: &controls)
    printJSON([
        "success": true,
        "windowTitle": title,
        "pluginName": pluginName,
        "controls": controls
    ])

case "read-param":
    let winQuery = getArg("--window") ?? ""
    let identifier = getArg("--identifier")
    let description = getArg("--description") ?? getArg("--title")
    let helpPrefix = getArg("--help")
    let role = getArg("--role")

    guard let targetWin = findTargetWindow(appElement, query: winQuery) else {
        printJSON(["success": false, "error": buildWindowError(appElement, query: winQuery)])
        exit(0)
    }

    let criteria = SearchCriteria(
        role: role,
        identifier: identifier,
        description: description,
        helpPrefix: helpPrefix
    )

    guard let element = findTargetElement(in: targetWin, criteria: criteria) else {
        printJSON(["success": false, "error": "Element not found"])
        exit(0)
    }

    let rawVal = getAXDouble(element, kAXValueAttribute as String) ?? 0.0
    let valDesc = getAXString(element, kAXValueDescriptionAttribute as String) ?? ""
    printJSON([
        "success": true,
        "rawValue": rawVal,
        "valueDescription": valDesc
    ])

case "set-param":
    let winQuery = getArg("--window") ?? ""
    let identifier = getArg("--identifier")
    let description = getArg("--description") ?? getArg("--title")
    let helpPrefix = getArg("--help")
    let role = getArg("--role")
    let enableBand = getArg("--enable-band")
    guard let valStr = getArg("--value"),
          let targetValue = Double(valStr.replacingOccurrences(of: ",", with: ".")) else {
        printJSON(["success": false, "error": "Missing or invalid --value"])
        exit(0)
    }

    guard let targetWin = findTargetWindow(appElement, query: winQuery) else {
        printJSON(["success": false, "error": buildWindowError(appElement, query: winQuery)])
        exit(0)
    }

    // Optional: Auto-enable EQ band checkbox if requested (e.g. "Peak 3", "Low Cut", "Low Shelf")
    if let bandCheckboxName = enableBand, !bandCheckboxName.isEmpty {
        let bandCriteria = SearchCriteria(
            role: "AXCheckBox",
            identifier: nil,
            description: bandCheckboxName,
            helpPrefix: nil
        )
        if let checkboxEl = findTargetElement(in: targetWin, criteria: bandCriteria) {
            let currentBoxVal = getAXDouble(checkboxEl, kAXValueAttribute as String) ?? 0.0
            if currentBoxVal == 0.0 {
                AXUIElementPerformAction(checkboxEl, kAXPressAction as CFString)
            }
        }
    }

    let criteria = SearchCriteria(
        role: role,
        identifier: identifier,
        description: description,
        helpPrefix: helpPrefix
    )

    guard let element = findTargetElement(in: targetWin, criteria: criteria) else {
        printJSON(["success": false, "error": "Element not found"])
        exit(0)
    }

    let elRole = getAXString(element, kAXRoleAttribute as String) ?? ""
    var setOk = false

    if elRole == "AXButton" || elRole == "AXRadioButton" {
        let actErr = AXUIElementPerformAction(element, kAXPressAction as CFString)
        setOk = (actErr == .success)
    } else if elRole == "AXCheckBox" {
        let cur = getAXDouble(element, kAXValueAttribute as String) ?? 0.0
        let desired = targetValue != 0.0 ? 1.0 : 0.0
        if cur != desired {
            let actErr = AXUIElementPerformAction(element, kAXPressAction as CFString)
            setOk = (actErr == .success)
        } else {
            setOk = true
        }
    } else {
        var dbl = targetValue
        if let cfNum = CFNumberCreate(kCFAllocatorDefault, .doubleType, &dbl) {
            for _ in 0..<1500 {
                let cur = getAXDouble(element, kAXValueAttribute as String) ?? targetValue
                if abs(cur - targetValue) < 0.5 {
                    setOk = true
                    break
                }
                let err = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, cfNum)
                if err == .success {
                    setOk = true
                } else {
                    let nsNum = NSNumber(value: targetValue)
                    let nsErr = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, nsNum)
                    if nsErr == .success {
                        setOk = true
                    } else {
                        break
                    }
                }
                let nextVal = getAXDouble(element, kAXValueAttribute as String) ?? cur
                if nextVal == cur {
                    break
                }
            }
        }
    }

    let updatedVal = getAXDouble(element, kAXValueAttribute as String) ?? targetValue
    let valDesc = getAXString(element, kAXValueDescriptionAttribute as String) ?? ""
    printJSON(["success": setOk, "newValue": updatedVal, "valueDescription": valDesc])

case "toggle-bypass":
    let winQuery = getArg("--window") ?? ""
    guard let targetWin = findTargetWindow(appElement, query: winQuery) else {
        printJSON(["success": false, "error": buildWindowError(appElement, query: winQuery)])
        exit(0)
    }

    // 1. Search by description/title/help containing "Bypass" or "Plug-in"
    var bypassEl = findElementDFS(root: targetWin, roleFilter: nil, maxDepth: 4, predicate: { el in
        let r = getAXString(el, kAXRoleAttribute as String) ?? ""
        guard r == "AXCheckBox" || r == "AXButton" else { return false }
        let desc = (getAXString(el, kAXDescriptionAttribute as String) ?? "").lowercased()
        let title = (getAXString(el, kAXTitleAttribute as String) ?? "").lowercased()
        let help = (getAXString(el, kAXHelpAttribute as String) ?? "").lowercased()
        return desc.contains("bypass") || title.contains("bypass") || help.contains("bypass") ||
               help.contains("plug-in") || desc.contains("plug-in")
    })

    // 2. Fallback: Logic Pro plugin windows place the blue Power/Bypass AXCheckBox directly in the window header
    if bypassEl == nil {
        for child in getAXChildren(targetWin) {
            let r = getAXString(child, kAXRoleAttribute as String) ?? ""
            if r == "AXCheckBox" {
                bypassEl = child
                break
            }
        }
    }

    guard let element = bypassEl else {
        printJSON(["success": false, "error": "Bypass control not found in window"])
        exit(0)
    }

    let actErr = AXUIElementPerformAction(element, kAXPressAction as CFString)
    let updatedVal = getAXDouble(element, kAXValueAttribute as String) ?? 0.0
    printJSON(["success": actErr == .success, "newValue": updatedVal])

case "scan-tracks":
    let windows = getLogicWindows(appElement)
    var trackNames: [String] = []

    for w in windows {
        let subrole = getAXString(w, kAXSubroleAttribute as String) ?? ""
        let title = (getAXString(w, kAXTitleAttribute as String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if (subrole == "AXDialog" || subrole == "AXFloatingWindow") && !title.isEmpty {
            if !trackNames.contains(where: { $0.lowercased() == title.lowercased() }) {
                trackNames.append(title)
            }
        }
    }
    printJSON(trackNames)

case "profile-plugin":
    let winQuery = getArg("--window") ?? ""
    var targetWindow: AXUIElement? = nil

    if !winQuery.isEmpty {
        targetWindow = findTargetWindow(appElement, query: winQuery)
    } else {
        // Find frontmost floating plugin window (AXDialog / AXFloatingWindow, excluding main window)
        let windows = getLogicWindows(appElement)
        for w in windows {
            let subrole = getAXString(w, kAXSubroleAttribute as String) ?? ""
            let title = (getAXString(w, kAXTitleAttribute as String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if (subrole == "AXDialog" || subrole == "AXFloatingWindow") && !title.isEmpty {
                targetWindow = w
                break
            }
        }
    }

    guard let pluginWindow = targetWindow else {
        printJSON(["success": false, "error": buildWindowError(appElement, query: winQuery.isEmpty ? "Aktives Plugin-Fenster" : winQuery)])
        exit(0)
    }

    let windowTitle = getAXString(pluginWindow, kAXTitleAttribute as String) ?? winQuery
    let pluginName = detectPluginName(in: pluginWindow, windowTitle: windowTitle)

    var rawControls: [[String: Any]] = []
    collectInteractiveControls(root: pluginWindow, maxDepth: 10, into: &rawControls)

    func makeSlug(_ input: String) -> String {
        let lower = input.lowercased()
        let allowed = lower.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : Character("_") }
        let joined = String(allowed)
        let collapsed = joined.replacingOccurrences(of: "_+", with: "_", options: .regularExpression)
        return collapsed.trimmingCharacters(in: CharacterSet(charactersIn: "_"))
    }

    func inferUnitAndRange(label: String, valueDesc: String, rawMin: Double, rawMax: Double) -> (String, Double, Double) {
        let l = (label + " " + valueDesc).lowercased()
        if l.contains("hz") || l.contains("freq") || l.contains("cut") {
            return ("Hz", 20.0, 20000.0)
        }
        if l.contains("db") || l.contains("gain") || l.contains("threshold") || l.contains("output") || l.contains("drive") || l.contains("make up") {
            return ("dB", -24.0, 24.0)
        }
        if l.contains("ms") || l.contains("attack") || l.contains("release") || l.contains("delay") {
            return ("ms", 0.1, 2000.0)
        }
        if l.contains("ratio") || l.contains(":1") {
            return (":1", 1.0, 30.0)
        }
        if l.contains("%") || l.contains("mix") || l.contains("wet") || l.contains("dry") {
            return ("%", 0.0, 100.0)
        }
        if l.contains(" q") || l.hasSuffix("_q") || l.contains("resonance") {
            return ("Q", 0.1, 10.0)
        }
        return ("", rawMin, rawMax > rawMin ? rawMax : 1.0)
    }

    var parameters: [[String: Any]] = []
    var seenIds: Set<String> = []
    var eqScore = 0
    var compScore = 0
    var satScore = 0

    for (idx, ctrl) in rawControls.enumerated() {
        let role = ctrl["role"] as? String ?? "AXSlider"
        guard role == "AXSlider" || role == "AXCheckBox" || role == "AXButton" || role == "AXPopUpButton" else {
            continue
        }

        let identifier = ctrl["identifier"] as? String ?? ""
        let desc = ctrl["description"] as? String ?? ""
        let title = ctrl["title"] as? String ?? ""
        let help = ctrl["help"] as? String ?? ""
        let valDesc = ctrl["valueDescription"] as? String ?? ""

        let displayName = !desc.isEmpty ? desc : (!title.isEmpty ? title : (!help.isEmpty ? help : (!identifier.isEmpty ? identifier : "Param \(idx + 1)")))

        // Skip generic window chrome buttons (Compare, Undo, Redo, Copy, Paste, Bypass header)
        let lowerName = displayName.lowercased()
        if role == "AXButton" && (lowerName == "compare" || lowerName == "vergleichen" || lowerName == "copy" || lowerName == "kopieren" || lowerName == "paste" || lowerName == "einfügen" || lowerName == "undo" || lowerName == "widerrufen" || lowerName == "redo" || lowerName == "wiederholen") {
            continue
        }

        if lowerName.contains("freq") || lowerName.contains("shelf") || lowerName.contains("peak") || lowerName.contains("cut") || lowerName.contains("hz") || lowerName.contains("q") {
            eqScore += 1
        }
        if lowerName.contains("threshold") || lowerName.contains("ratio") || lowerName.contains("attack") || lowerName.contains("release") || lowerName.contains("knee") {
            compScore += 1
        }
        if lowerName.contains("drive") || lowerName.contains("punish") || lowerName.contains("tone") || lowerName.contains("saturat") || lowerName.contains("mix") {
            satScore += 1
        }

        var slug = makeSlug(!desc.isEmpty ? desc : (!title.isEmpty ? title : identifier))
        if slug.isEmpty {
            slug = "param_\(idx + 1)"
        }
        if seenIds.contains(slug) {
            slug = "\(slug)_\(idx + 1)"
        }
        seenIds.insert(slug)

        let rawMin = ctrl["minValue"] as? Double ?? 0.0
        let rawMax = ctrl["maxValue"] as? Double ?? (role == "AXSlider" ? 100.0 : 1.0)
        let currentVal = ctrl["value"] as? Double ?? 0.0
        let (unit, dispMin, dispMax) = inferUnitAndRange(label: displayName, valueDesc: valDesc, rawMin: rawMin, rawMax: rawMax)

        var paramObj: [String: Any] = [
            "id": slug,
            "name": displayName,
            "role": role,
            "identifier": identifier,
            "description": !desc.isEmpty ? desc : displayName,
            "rawMin": rawMin,
            "rawMax": rawMax,
            "displayMin": dispMin,
            "displayMax": dispMax,
            "currentRawValue": currentVal,
            "valueDescription": valDesc,
            "unit": unit
        ]
        if !help.isEmpty {
            paramObj["help"] = help
        }
        parameters.append(paramObj)
    }

    // --- Extended category + tag inference ---
    // Collect all param label text for keyword matching
    let allParamText = parameters
        .compactMap { $0["name"] as? String }
        .joined(separator: " ")
        .lowercased()

    let lowerPlugin = pluginName.lowercased()

    // Score helpers (extending existing eqScore / compScore / satScore)
    var delayScore  = 0
    var reverbScore = 0
    var modScore    = 0
    var limiterScore = 0

    for (_, ctrl) in rawControls.enumerated() {
        let desc  = (ctrl["description"] as? String ?? "").lowercased()
        let title = (ctrl["title"]       as? String ?? "").lowercased()
        let label = desc.isEmpty ? title : desc

        if label.contains("delay") || label.contains("echo") || label.contains("feedback") ||
           label.contains("ping pong") || label.contains("bpm") || label.contains("time sync") { delayScore += 1 }

        if label.contains("reverb") || label.contains("decay") || label.contains("predelay") ||
           label.contains("room") || label.contains("hall") || label.contains("plate") ||
           label.contains("damping") || label.contains("early reflections") { reverbScore += 1 }

        if label.contains("chorus") || label.contains("flanger") || label.contains("phaser") ||
           label.contains("tremolo") || label.contains("vibrato") || label.contains("lfo") { modScore += 1 }

        if label.contains("limit") || label.contains("ceiling") || label.contains("lookahead") ||
           label.contains("out ceiling") || label.contains("true peak") { limiterScore += 1 }
    }

    // Primary category
    var category = "utility"
    var tags: [String] = []

    // EQ
    if lowerPlugin.contains("eq") || lowerPlugin.contains("pro-q") || eqScore >= 3 {
        category = "eq"
        tags.append("EQ")
    }
    // Saturation / Color (before dynamics to catch e.g. "ChromaGlow" correctly)
    else if lowerPlugin.contains("glow") || lowerPlugin.contains("chroma") ||
            lowerPlugin.contains("sat") || lowerPlugin.contains("tube") ||
            lowerPlugin.contains("tape") || lowerPlugin.contains("distort") ||
            lowerPlugin.contains("warmth") || lowerPlugin.contains("overdrive") ||
            lowerPlugin.contains("preamp") || lowerPlugin.contains("decapitator") ||
            lowerPlugin.contains("color") || lowerPlugin.contains("harmonics") ||
            satScore >= 2 ||
            allParamText.contains("drive") || allParamText.contains("glow") ||
            allParamText.contains("saturat") || allParamText.contains("warmth") {
        category = "saturation"
        tags.append("SATURATION")
        if lowerPlugin.contains("glow") || lowerPlugin.contains("chroma") || allParamText.contains("glow") {
            tags.append("COLOR")
        }
    }
    // Limiter (before generic dynamics)
    else if lowerPlugin.contains("limit") || limiterScore >= 2 ||
            allParamText.contains("ceiling") || allParamText.contains("lookahead") {
        category = "dynamics"
        tags.append("DYNAMICS")
        tags.append("LIMITER")
    }
    // Generic Dynamics / Compressor
    else if lowerPlugin.contains("comp") || lowerPlugin.contains("1176") ||
            lowerPlugin.contains("la-2a") || compScore >= 2 {
        category = "dynamics"
        tags.append("DYNAMICS")
        tags.append("COMPRESSOR")
    }
    // Reverb
    else if lowerPlugin.contains("reverb") || lowerPlugin.contains("room") ||
            lowerPlugin.contains("hall") || lowerPlugin.contains("verb") || reverbScore >= 2 {
        category = "reverb"
        tags.append("REVERB")
    }
    // Delay / Echo
    else if lowerPlugin.contains("delay") || lowerPlugin.contains("echo") || delayScore >= 2 {
        category = "delay"
        tags.append("DELAY")
    }
    // Modulation
    else if lowerPlugin.contains("chorus") || lowerPlugin.contains("flanger") ||
            lowerPlugin.contains("phaser") || lowerPlugin.contains("tremolo") ||
            lowerPlugin.contains("modulation") || modScore >= 2 {
        category = "modulation"
        tags.append("MODULATION")
    }
    else {
        tags.append("UTILITY")
    }

    printJSON(["success": true, "schemaVersion": "1.0", "pluginName": pluginName, "windowTitle": windowTitle, "category": category, "tags": tags, "parameters": parameters])

// ─── NEW COMMANDS ──────────────────────────────────────────────────────────────


case "list-channel-strips":
    let allWindows = getLogicWindows(appElement)
    let stripElements = findAllChannelStripElements(allWindows)
    
    var channelStrips: [[String: Any]] = []
    for el in stripElements {
        let parsed = parseChannelStripElement(el)
        channelStrips.append([
            "trackName": parsed.trackName,
            "faderDb": parsed.faderDb,
            "pan": parsed.pan,
            "mute": parsed.mute,
            "solo": parsed.solo,
            "inserts": parsed.inserts,
            "sends": parsed.sends
        ])
    }
    printJSON(["success": true, "channelStrips": channelStrips])

case "set-fader":
    let trackQuery = getArg("--track") ?? ""
    guard let dbStr = getArg("--db"), let targetDb = Double(dbStr.replacingOccurrences(of: ",", with: ".")) else {
        printJSON(["success": false, "error": "Missing or invalid --db value"])
        exit(0)
    }
    let allWins = getLogicWindows(appElement)
    let stripElements = findAllChannelStripElements(allWins)
    
    var targetStrip: ParsedChannelStrip? = nil
    for el in stripElements {
        let parsed = parseChannelStripElement(el)
        if matchesTrackName(parsed.trackName, query: trackQuery) {
            targetStrip = parsed
            break
        }
    }
    if targetStrip == nil {
        let digits = trackQuery.filter { $0.isNumber }
        if let idx = Int(digits), idx >= 1 && idx <= stripElements.count {
            targetStrip = parseChannelStripElement(stripElements[idx - 1])
        }
    }
    
    guard let strip = targetStrip else {
        if stripElements.isEmpty {
            printJSON(["success": false, "error": "Logic Pro Mixer ist nicht geöffnet oder enthält keine sichtbaren Kanalzüge. Bitte öffne den Mixer in Logic Pro (Taste X) und versuche es erneut."])
            exit(0)
        }
        let known = stripElements.map { parseChannelStripElement($0).trackName }.joined(separator: ", ")
        printJSON(["success": false, "error": "Kanal für Spur '\(trackQuery)' nicht gefunden. Verfügbar: [\(known)]"])
        exit(0)
    }
    
    // 1. Schreibe den Fader-Wert in dB direkt in das AXTextField unter dem Fader
    if let tf = strip.faderTextField {
        let formattedComma = String(format: "%.1f", targetDb).replacingOccurrences(of: ".", with: ",")
        let formattedDot = String(format: "%.1f", targetDb)
        
        _ = AXUIElementSetAttributeValue(tf, kAXValueAttribute as CFString, formattedComma as CFString)
        _ = AXUIElementPerformAction(tf, kAXConfirmAction as CFString)
        _ = AXUIElementSetAttributeValue(tf, kAXValueAttribute as CFString, formattedDot as CFString)
        _ = AXUIElementPerformAction(tf, kAXConfirmAction as CFString)
    }
    
    // 2. Fader-Slider mit Kennlinie und Stepping auf exakten dB-Wert fahren
    if let slider = strip.faderSlider {
        let res = stepFaderToTargetDb(slider: slider, targetDb: targetDb)
        let newDesc = getAXString(slider, kAXValueDescriptionAttribute as String) ?? "\(res.finalDb) dB"
        let sliderValActual = getAXDouble(slider, kAXValueAttribute as String) ?? 0.0
        printJSON(["success": res.success, "track": strip.trackName, "newDb": parseDbString(newDesc), "sliderValue": sliderValActual])
    } else {
        printJSON(["success": true, "track": strip.trackName, "newDb": targetDb])
    }

case "set-pan":
    let trackQuery = getArg("--track") ?? ""
    guard let panStr = getArg("--pan"), let panVal = Double(panStr.replacingOccurrences(of: ",", with: ".")) else {
        printJSON(["success": false, "error": "Missing or invalid --pan value"])
        exit(0)
    }
    let allWins = getLogicWindows(appElement)
    let stripElements = findAllChannelStripElements(allWins)
    
    var targetStrip: ParsedChannelStrip? = nil
    for el in stripElements {
        let parsed = parseChannelStripElement(el)
        if matchesTrackName(parsed.trackName, query: trackQuery) {
            targetStrip = parsed
            break
        }
    }
    if targetStrip == nil {
        let digits = trackQuery.filter { $0.isNumber }
        if let idx = Int(digits), idx >= 1 && idx <= stripElements.count {
            targetStrip = parseChannelStripElement(stripElements[idx - 1])
        }
    }
    
    guard let strip = targetStrip else {
        if stripElements.isEmpty {
            printJSON(["success": false, "error": "Logic Pro Mixer ist nicht geöffnet oder enthält keine sichtbaren Kanalzüge. Bitte öffne den Mixer in Logic Pro (Taste X) und versuche es erneut."])
            exit(0)
        }
        let known = stripElements.map { parseChannelStripElement($0).trackName }.joined(separator: ", ")
        printJSON(["success": false, "error": "Kanal für Spur '\(trackQuery)' nicht gefunden. Verfügbar: [\(known)]"])
        exit(0)
    }
    
    guard let knob = strip.balanceSlider else {
        printJSON(["success": false, "error": "Pan/Balance-Regler für Spur '\(strip.trackName)' nicht gefunden"])
        exit(0)
    }
    
    // 1. Berechne:
    let currentPan = getAXDouble(knob, kAXValueAttribute as String) ?? 0.0
    let targetPan = max(-64.0, min(63.0, panVal))
    let delta = targetPan - currentPan
    
    // 2. Ausführung 2-Stufen-Logik:
    if abs(delta) >= 0.5 {
        let action = delta > 0 ? "AXIncrement" : "AXDecrement"
        // Grobschritte (10er)
        let coarse = Int(abs(delta)) / 10
        for _ in 0..<coarse {
            AXUIElementPerformAction(knob, action as CFString)
        }
        
        // Feinschritte (1er)
        let fine = Int(round(abs(delta))) % 10
        var fineVal: Double = delta > 0 ? 100.0 : -100.0
        if let cfFine = CFNumberCreate(kCFAllocatorDefault, .doubleType, &fineVal) {
            for _ in 0..<fine {
                AXUIElementSetAttributeValue(knob, kAXValueAttribute as CFString, cfFine)
            }
        }
        
        // Nachjustierung bei minimaler Abweichung
        let after = getAXDouble(knob, kAXValueAttribute as String) ?? currentPan
        let remaining = Int(round(targetPan - after))
        if remaining != 0 {
            var nudgeVal: Double = remaining > 0 ? 100.0 : -100.0
            if let cfNudge = CFNumberCreate(kCFAllocatorDefault, .doubleType, &nudgeVal) {
                for _ in 0..<abs(remaining) {
                    AXUIElementSetAttributeValue(knob, kAXValueAttribute as CFString, cfNudge)
                }
            }
        }
    }
    
    let readBack = getAXDouble(knob, kAXValueAttribute as String) ?? targetPan
    let readDesc = getAXString(knob, kAXValueDescriptionAttribute as String) ?? "\(Int(readBack))"
    printJSON(["success": true, "track": strip.trackName, "newPan": readBack, "panDescription": readDesc])

case "open-insert":
    let trackQuery = getArg("--track") ?? ""
    let slotStr = getArg("--slot") ?? "1"
    let slotNum = Int(slotStr) ?? 1
    let allWins = getLogicWindows(appElement)
    let stripElements = findAllChannelStripElements(allWins)
    
    var targetStrip: ParsedChannelStrip? = nil
    for el in stripElements {
        let parsed = parseChannelStripElement(el)
        if matchesTrackName(parsed.trackName, query: trackQuery) {
            targetStrip = parsed
            break
        }
    }
    if targetStrip == nil {
        let digits = trackQuery.filter { $0.isNumber }
        if let idx = Int(digits), idx >= 1 && idx <= stripElements.count {
            targetStrip = parseChannelStripElement(stripElements[idx - 1])
        }
    }
    
    guard let strip = targetStrip else {
        let known = stripElements.map { parseChannelStripElement($0).trackName }.joined(separator: ", ")
        printJSON(["success": false, "error": "Kanal für Spur '\(trackQuery)' nicht gefunden. Verfügbar: [\(known)]"])
        exit(0)
    }
    
    guard slotNum >= 1 && slotNum <= strip.pluginGroups.count else {
        printJSON(["success": false, "error": "Slot \(slotNum) existiert nicht auf Spur '\(strip.trackName)'. Belegt: \(strip.pluginGroups.count) Inserts"])
        exit(0)
    }
    
    var targetPlugin = strip.pluginGroups[slotNum - 1]
    let pluginQuery = (getArg("--plugin") ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

    func clickBtn(_ g: AXUIElement) -> Bool {
        for c in getAXChildren(g) where getAXString(c, kAXRoleAttribute as String) == "AXButton" {
            return AXUIElementPerformAction(c, kAXPressAction as CFString) == .success
        }
        return false
    }

    guard clickBtn(targetPlugin.group) else {
        printJSON(["success": false, "error": "Öffnen-Button für Plugin '\(targetPlugin.name)' nicht gefunden"])
        exit(0)
    }

    // Warte mindestens 200 ms, damit macOS WindowServer das Fenster im AX-Baum registriert
    usleep(200_000)

    var openedWin: AXUIElement? = nil
    var openedTitle = targetPlugin.name
    let deadline = Date().addingTimeInterval(0.6)
    while Date() < deadline {
        Thread.sleep(forTimeInterval: 0.05)
        for w in getLogicWindows(appElement) {
            let sr = getAXString(w, kAXSubroleAttribute as String) ?? ""
            let t = getAXString(w, kAXTitleAttribute as String) ?? ""
            if (sr == "AXDialog" || sr == "AXFloatingWindow") && !t.isEmpty {
                if t.lowercased().contains(targetPlugin.name.lowercased()) || t.lowercased().contains(strip.trackName.lowercased()) {
                    openedWin = w; openedTitle = t; break
                }
            }
        }
        if openedWin != nil { break }
    }

    printJSON(["success": true, "track": strip.trackName, "pluginName": targetPlugin.name, "openedWindow": openedTitle])

case "close-plugin-window":
    let winQuery = getArg("--window") ?? ""
    guard let targetWin = findTargetWindow(appElement, query: winQuery) else {
        printJSON(["success": false, "error": buildWindowError(appElement, query: winQuery)])
        exit(0)
    }
    var closed = false
    for child in getAXChildren(targetWin) {
        let role = getAXString(child, kAXRoleAttribute as String) ?? ""
        let sr   = getAXString(child, kAXSubroleAttribute as String) ?? ""
        if role == "AXButton" && sr == "AXCloseButton" {
            let err = AXUIElementPerformAction(child, kAXPressAction as CFString)
            closed = (err == .success)
            break
        }
    }
    if !closed {
        let err = AXUIElementPerformAction(targetWin, "AXRaise" as CFString)
        closed = (err == .success)
    }
    printJSON(["success": closed])

// MARK: - SPRINT 7: Arranger Navigation – Folder Expansion & Track Selection

case "set-folder-expanded":
    // Finds a Track Stack / Folder header in Logic Pro's arrangement view and
    // toggles its disclosure triangle to the desired expanded state.
    guard let trackName = getArg("--track"), !trackName.isEmpty else {
        printJSON(["success": false, "error": "Missing --track argument"])
        exit(0)
    }
    let wantExpanded: Bool = {
        let raw = (getArg("--expanded") ?? "true").lowercased()
        return raw == "true" || raw == "1" || raw == "yes"
    }()

    var found = false
    var resultExpanded = false

    let allWindows = getLogicWindows(appElement)
    for w in allWindows {
        let subrole = getAXString(w, kAXSubroleAttribute as String) ?? ""
        guard subrole == "AXStandardWindow" else { continue }

        // The arrangement track list is typically an AXScrollArea → AXList of track rows.
        // Each row is either AXGroup or AXRow with children for track header elements.
        // We use a broad DFS to find any element whose AXTitle or AXDescription matches
        // the target track name and is adjacent to an AXDisclosureTriangle.

        // Strategy: find the AXDisclosureTriangle whose parent row title matches trackName
        if let triangle = findElementDFS(root: w, roleFilter: "AXDisclosureTriangle", predicate: { el in
            // Check the parent group / row for the track name
            guard let parentVal = getAXAttribute(el, kAXParentAttribute as String) else { return false }
            let p = parentVal as! AXUIElement
            let parentTitle = (getAXString(p, kAXTitleAttribute as String) ?? "").lowercased()
            let parentDesc  = (getAXString(p, kAXDescriptionAttribute as String) ?? "").lowercased()
            let target = trackName.lowercased()
            return parentTitle.contains(target) || parentDesc.contains(target)
        }) {
            // Read current AXValue (0 = collapsed, 1 = expanded)
            let rawVal = getAXAttribute(triangle, kAXValueAttribute as String)
            let isExpanded: Bool = {
                if let n = rawVal as? NSNumber { return n.boolValue }
                if let b = rawVal as? Bool { return b }
                return false
            }()

            if isExpanded != wantExpanded {
                AXUIElementPerformAction(triangle, kAXPressAction as CFString)
            }
            found = true
            resultExpanded = wantExpanded
            break
        }

        if found { break }

        // Fallback: find any AXButton (chevron) near a row whose title matches trackName
        if let chevron = findElementDFS(root: w, roleFilter: "AXButton", predicate: { el in
            let desc  = (getAXString(el, kAXDescriptionAttribute as String) ?? "").lowercased()
            let title = (getAXString(el, kAXTitleAttribute as String) ?? "").lowercased()
            let help  = (getAXString(el, kAXHelpAttribute as String) ?? "").lowercased()
            let target = trackName.lowercased()
            // Chevron buttons often have "open" / "close" / "expand" / "folder" in description
            let isChevron = desc.contains("expand") || desc.contains("collapse") ||
                            desc.contains("öffnen") || desc.contains("schließen") ||
                            desc.contains("folder") || desc.contains("ordner") ||
                            help.contains("expand") || help.contains("collapse")
            guard isChevron else { return false }
            // Parent or sibling should contain the track name
            guard let parentVal = getAXAttribute(el, kAXParentAttribute as String) else { return false }
            let p = parentVal as! AXUIElement
            let parentTitle = (getAXString(p, kAXTitleAttribute as String) ?? "").lowercased()
            let parentDesc  = (getAXString(p, kAXDescriptionAttribute as String) ?? "").lowercased()
            return parentTitle.contains(target) || parentDesc.contains(target) ||
                   title.contains(target) || desc.contains(target)
        }) {
            let err = AXUIElementPerformAction(chevron, kAXPressAction as CFString)
            found = (err == .success || err == .cannotComplete)
            resultExpanded = wantExpanded
        }

        if found { break }
    }

    guard found else {
        printJSON(["success": false, "error": "Track Stack '\(trackName)' not found in Logic Pro arrangement. Ensure the track is visible in the main window."])
        exit(0)
    }

    printJSON(["success": true, "track": trackName, "isExpanded": resultExpanded])

case "select-track":
    // Selects a track in Logic Pro's arrangement/track list, causing the
    // left Inspector to switch to that track's channel strip.
    guard let trackName = getArg("--track"), !trackName.isEmpty else {
        printJSON(["success": false, "error": "Missing --track argument"])
        exit(0)
    }

    var selected = false
    let target = trackName.lowercased()

    let allWindows = getLogicWindows(appElement)
    for w in allWindows {
        let title = (getAXString(w, kAXTitleAttribute as String) ?? "").lowercased()
        let subrole = getAXString(w, kAXSubroleAttribute as String) ?? ""
        guard subrole == "AXStandardWindow" || title.contains("spuren") || title.contains("tracks") else { continue }

        // Find arrangement track header element (AXLayoutItem, AXButton, AXRow, AXOutline, AXGroup)
        if let trackEl = findElementDFS(root: w, roleFilter: nil, predicate: { el in
            let desc = (getAXString(el, kAXDescriptionAttribute as String) ?? "").lowercased()
            let t = (getAXString(el, kAXTitleAttribute as String) ?? "").lowercased()
            let val = (getAXString(el, kAXValueAttribute as String) ?? "").lowercased()
            let role = getAXString(el, kAXRoleAttribute as String) ?? ""

            guard ["AXLayoutItem", "AXButton", "AXRow", "AXOutline", "AXTable", "AXGroup"].contains(role) else { return false }
            return matchesTrackName(desc, query: trackName) ||
                   matchesTrackName(t, query: trackName) ||
                   matchesTrackName(val, query: trackName) ||
                   desc.contains(target) || t.contains(target)
        }) {
            // 1. Try AXPress
            let pressErr = AXUIElementPerformAction(trackEl, kAXPressAction as CFString)
            if pressErr == .success || pressErr == .cannotComplete {
                selected = true
            }

            // 2. Try kAXSelectedAttribute
            let _ = AXUIElementSetAttributeValue(trackEl, kAXSelectedAttribute as CFString, true as CFTypeRef)

            // 3. Robust mouse click directly into the track header in arrangement
            var posVal: AnyObject?
            var sizeVal: AnyObject?
            AXUIElementCopyAttributeValue(trackEl, kAXPositionAttribute as CFString, &posVal)
            AXUIElementCopyAttributeValue(trackEl, kAXSizeAttribute as CFString, &sizeVal)
            var pt = CGPoint.zero
            var sz = CGSize.zero
            if let p = posVal { AXValueGetValue(p as! AXValue, .cgPoint, &pt) }
            if let s = sizeVal { AXValueGetValue(s as! AXValue, .cgSize, &sz) }
            if sz.width > 5 && sz.height > 5 {
                let clickPoint = CGPoint(x: pt.x + min(sz.width * 0.25, 80.0), y: pt.y + sz.height * 0.5)
                clickAtPoint(point: clickPoint)
                selected = true
            }

            if selected { break }
        }
    }

    // Mixer fallback: check if channel strip exists in Mixer
    if !selected {
        if let strip = findChannelStripForTrack(appElement: appElement, trackName: trackName) {
            let pressErr = AXUIElementPerformAction(strip.element, kAXPressAction as CFString)
            selected = (pressErr == .success || pressErr == .cannotComplete)
        }
    }

    guard selected else {
        printJSON(["success": false, "error": "Track '\(trackName)' not found in Logic Pro arrangement. Ensure Logic Pro's main window is open and the track is visible."])
        exit(0)
    }

    printJSON(["success": true, "selectedTrack": trackName])

// MARK: - SPRINT 8: Dynamic Plugin Loading via Logic Menus (Audio FX Slots)

case "load-plugin":
    guard let trackName = getArg("--track"), !trackName.isEmpty else {
        printJSON(["success": false, "error": "Missing --track argument"])
        exit(0)
    }
    let slotStr = getArg("--slot") ?? "1"
    guard let slotNum = Int(slotStr), slotNum >= 1 && slotNum <= 15 else {
        printJSON(["success": false, "error": "Invalid or missing --slot (expected 1 to 15)"])
        exit(0)
    }
    guard let pluginPath = getArg("--plugin-path"), !pluginPath.isEmpty else {
        printJSON(["success": false, "error": "Missing --plugin-path argument"])
        exit(0)
    }

    // 1. Find Channel Strip for track
    guard let strip = findChannelStripForTrack(appElement: appElement, trackName: trackName) else {
        printJSON(["success": false, "error": "Channel strip for track '\(trackName)' not found in Logic Pro. Ensure track is visible or mixer is open."])
        exit(0)
    }

    // 2. Find Audio FX Slot Button
    guard let slotButton = findAudioFXSlotButton(strip: strip, slotNum: slotNum) else {
        printJSON(["success": false, "error": "Audio FX slot \(slotNum) button not found on track '\(strip.trackName)'."])
        exit(0)
    }

    // 3. Click slot button to open native AXMenu
    let pressErr = AXUIElementPerformAction(slotButton, kAXPressAction as CFString)
    guard pressErr == .success || pressErr == .cannotComplete else {
        printJSON(["success": false, "error": "Failed to click Audio FX slot \(slotNum) button (AXError: \(pressErr.rawValue))."])
        exit(0)
    }

    // Wait up to 500ms for AXMenu to appear
    var activeMenu: AXUIElement? = nil
    for _ in 0..<10 {
        usleep(50_000)
        if let m = findActiveMenu(appElement: appElement, slotButton: slotButton) {
            activeMenu = m
            break
        }
    }

    guard let rootMenu = activeMenu else {
        printJSON(["success": false, "error": "Logic Pro insert menu did not appear after clicking slot \(slotNum)."])
        exit(0)
    }

    // 4. Menu Navigation
    let segments = pluginPath.components(separatedBy: ">").map {
        $0.trimmingCharacters(in: .whitespacesAndNewlines)
    }.filter { !$0.isEmpty }

    var currentMenu = rootMenu
    var targetItem: AXUIElement? = nil

    for (idx, seg) in segments.enumerated() {
        let isFinal = (idx == segments.count - 1)
        if let item = findMenuItem(menu: currentMenu, query: seg) {
            if isFinal {
                targetItem = item
                break
            } else {
                guard let nextMenu = getSubmenu(of: item, appElement: appElement) else {
                    closeMenu(rootMenu)
                    printJSON(["success": false, "error": "Submenu '\(seg)' could not be opened in insert menu."])
                    exit(0)
                }
                currentMenu = nextMenu
            }
        } else {
            // Fallback for single segment query: recursively check submenus
            if segments.count == 1 {
                let items = getAXChildren(currentMenu).filter {
                    (getAXString($0, kAXRoleAttribute as String) ?? "") == "AXMenuItem"
                }
                for it in items {
                    if let sub = getSubmenu(of: it, appElement: appElement) {
                        if let found = findMenuItem(menu: sub, query: seg) {
                            targetItem = found
                            break
                        }
                    }
                }
                if targetItem != nil { break }
            }

            closeMenu(rootMenu)
            printJSON(["success": false, "error": "Menu item '\(seg)' not found in insert menu."])
            exit(0)
        }
    }

    guard let finalItem = targetItem else {
        closeMenu(rootMenu)
        printJSON(["success": false, "error": "Plugin '\(pluginPath)' not found in insert menu."])
        exit(0)
    }

    let selectErr = AXUIElementPerformAction(finalItem, kAXPressAction as CFString)
    guard selectErr == .success || selectErr == .cannotComplete else {
        closeMenu(rootMenu)
        printJSON(["success": false, "error": "Failed to select plugin item '\(pluginPath)' (AXError: \(selectErr.rawValue))."])
        exit(0)
    }

    // Wait up to 400ms for menu to close and plugin to instantiate
    usleep(400_000)
    printJSON(["success": true, "track": strip.trackName, "slot": slotNum, "plugin": pluginPath])

case "list-insert-menu":
    guard let trackName = getArg("--track"), !trackName.isEmpty else {
        printJSON(["success": false, "error": "Missing --track argument"])
        exit(0)
    }
    let slotStr = getArg("--slot") ?? "1"
    let slotNum = Int(slotStr) ?? 1

    guard let strip = findChannelStripForTrack(appElement: appElement, trackName: trackName) else {
        printJSON(["success": false, "error": "Channel strip for track '\(trackName)' not found in Logic Pro."])
        exit(0)
    }

    guard let slotButton = findAudioFXSlotButton(strip: strip, slotNum: slotNum) else {
        printJSON(["success": false, "error": "Audio FX slot \(slotNum) button not found on track '\(strip.trackName)'."])
        exit(0)
    }

    _ = AXUIElementPerformAction(slotButton, kAXPressAction as CFString)
    var activeMenu: AXUIElement? = nil
    for _ in 0..<10 {
        usleep(50_000)
        if let m = findActiveMenu(appElement: appElement, slotButton: slotButton) {
            activeMenu = m
            break
        }
    }

    guard let rootMenu = activeMenu else {
        printJSON(["success": false, "error": "Logic Pro insert menu did not appear after clicking slot \(slotNum)."])
        exit(0)
    }

    let items = getAXChildren(rootMenu).filter {
        (getAXString($0, kAXRoleAttribute as String) ?? "") == "AXMenuItem"
    }
    let names = items.compactMap { getAXString($0, kAXTitleAttribute as String) }.filter { !$0.isEmpty }

    closeMenu(rootMenu)
    printJSON(["success": true, "track": strip.trackName, "slot": slotNum, "menuItems": names])

// MARK: - SPRINT 6: Transport Control Commands

case "transport-play":
    var played = false

    // 1. Try native AXUIElement in Steuerungsleiste (AXCheckBox/AXButton desc="Wiedergabe" / "Play")
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

    // 2. Fallback / Verification: Check if Logic is playing; if not, send Spacebar with 150ms delay
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

case "transport-stop":
    var stopped = false

    let allWindows = getLogicWindows(appElement)
    for w in allWindows {
        // Try Stoppen button in Steuerungsleiste
        if let stopBtn = findElementDFS(root: w, roleFilter: nil, maxDepth: 12, predicate: { el in
            let desc = (getAXString(el, kAXDescriptionAttribute as String) ?? "").lowercased()
            let t = (getAXString(el, kAXTitleAttribute as String) ?? "").lowercased()
            return desc.contains("stopp") || desc.contains("stop") || t.contains("stopp") || t.contains("stop")
        }) {
            let err = AXUIElementPerformAction(stopBtn, kAXPressAction as CFString)
            stopped = (err == .success || err == .cannotComplete)
            if stopped { break }
        }

        // Check if Wiedergabe checkbox is active (value == 1) and toggle it
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

case "cycle-off", "ensure-cycle-off":
    let success = ensureCycleOff(appElement: appElement)
    printJSON(["success": success, "action": "cycle-off"])

case "set-cycle-region":
    guard let startStr = getArg("--start"), let startNum = Int(startStr), startNum >= 1 else {
        printJSON(["success": false, "error": "Missing or invalid --start argument"])
        exit(0)
    }
    let endNum = Int(getArg("--end") ?? "") ?? (startNum + 4)
    if let app = getLogicRunningApp() { app.activate(options: [.activateAllWindows, .activateIgnoringOtherApps]) }
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

case "transport-locate":
    guard let barStr = getArg("--bar"), let barNum = Int(barStr), barNum >= 1 else {
        printJSON(["success": false, "error": "Missing or invalid --bar argument (must be >= 1)"])
        exit(0)
    }
    let keepCycle = (getArg("--keep-cycle") ?? "false") == "true"
    if !keepCycle { _ = ensureCycleOff(appElement: appElement) }
    let res = performTransportLocate(appElement: appElement, barNum: barNum)
    printJSON(["success": true, "action": "locate", "bar": barNum, "dialogOpened": res.dialogOpened, "windowFound": res.windowFound, "pid": res.pid, "isTrusted": AXIsProcessTrusted()])

// MARK: - SPRINT 9: Bus Sends, Routing & Send Level Control

case "set-send-bus":
    guard let trackName = getArg("--track"), !trackName.isEmpty else {
        printJSON(["success": false, "error": "Missing --track argument"])
        exit(0)
    }
    guard let slotStr = getArg("--slot"), let slotNum = Int(slotStr), slotNum >= 1 && slotNum <= 8 else {
        printJSON(["success": false, "error": "Missing or invalid --slot argument (expected 1 to 8)"])
        exit(0)
    }
    guard let busStr = getArg("--bus"), let busNum = Int(busStr), busNum >= 1 else {
        printJSON(["success": false, "error": "Missing or invalid --bus argument (expected integer >= 1)"])
        exit(0)
    }

    // 1. Find Channel Strip
    guard let strip = findChannelStripForTrack(appElement: appElement, trackName: trackName) else {
        printJSON(["success": false, "error": "Channel strip for track '\(trackName)' not found in Logic Pro."])
        exit(0)
    }

    // 2. Find Send Slot Button
    guard let slotButton = findSendSlotButton(strip: strip, slotNum: slotNum) else {
        printJSON(["success": false, "error": "Send slot \(slotNum) button not found on track '\(strip.trackName)'."])
        exit(0)
    }

    // 3. Click slot button to open native AXMenu
    let pressErr = AXUIElementPerformAction(slotButton, kAXPressAction as CFString)
    guard pressErr == .success || pressErr == .cannotComplete else {
        printJSON(["success": false, "error": "Failed to click Send slot \(slotNum) button (AXError: \(pressErr.rawValue))."])
        exit(0)
    }

    // Wait up to 500ms for AXMenu to appear
    var activeMenu: AXUIElement? = nil
    for _ in 0..<10 {
        usleep(50_000)
        if let m = findSendMenu(appElement: appElement) {
            activeMenu = m
            break
        }
    }

    guard let rootMenu = activeMenu else {
        printJSON(["success": false, "error": "Logic Pro Send menu did not appear after clicking slot \(slotNum)."])
        exit(0)
    }

    // 4. Menu Navigation: Find "Bus" item
    guard let busMenuItem = findMenuItem(menu: rootMenu, query: "Bus") else {
        closeMenu(rootMenu)
        printJSON(["success": false, "error": "Menu item 'Bus' not found in Send menu."])
        exit(0)
    }

    // 5. Open "Bus" Submenu
    guard let busSubmenu = getSubmenu(of: busMenuItem, appElement: appElement) else {
        closeMenu(rootMenu)
        printJSON(["success": false, "error": "Bus submenu could not be opened in Send menu."])
        exit(0)
    }

    // 6. Find target "Bus <busNum>" (e.g. "Bus 1" or "Bus 1 (Reverb)")
    let targetBusQuery = "Bus \(busNum)"
    let items = getAXChildren(busSubmenu).filter {
        (getAXString($0, kAXRoleAttribute as String) ?? "") == "AXMenuItem"
    }
    let targetItem = items.first { el in
        let title = getAXString(el, kAXTitleAttribute as String) ?? ""
        return title == targetBusQuery ||
               title.starts(with: targetBusQuery + " ") ||
               title.starts(with: targetBusQuery + "(")
    }

    guard let finalItem = targetItem else {
        closeMenu(rootMenu)
        printJSON(["success": false, "error": "Target Bus '\(targetBusQuery)' not found in Bus submenu."])
        exit(0)
    }

    let selectErr = AXUIElementPerformAction(finalItem, kAXPressAction as CFString)
    guard selectErr == .success || selectErr == .cannotComplete else {
        closeMenu(rootMenu)
        printJSON(["success": false, "error": "Failed to select Bus item '\(targetBusQuery)' (AXError: \(selectErr.rawValue))."])
        exit(0)
    }

    usleep(300_000)
    printJSON(["success": true, "track": strip.trackName, "slot": slotNum, "bus": busNum])

case "set-send-level":
    guard let trackName = getArg("--track"), !trackName.isEmpty else {
        printJSON(["success": false, "error": "Missing --track argument"])
        exit(0)
    }
    guard let slotStr = getArg("--slot"), let slotNum = Int(slotStr), slotNum >= 1 && slotNum <= 8 else {
        printJSON(["success": false, "error": "Missing or invalid --slot argument (expected 1 to 8)"])
        exit(0)
    }
    guard let dbStr = getArg("--db"), let targetDb = Double(dbStr.replacingOccurrences(of: ",", with: ".")) else {
        printJSON(["success": false, "error": "Missing or invalid --db value"])
        exit(0)
    }

    // 1. Find Channel Strip
    guard let strip = findChannelStripForTrack(appElement: appElement, trackName: trackName) else {
        printJSON(["success": false, "error": "Channel strip for track '\(trackName)' not found in Logic Pro."])
        exit(0)
    }

    // 2. Validate slot index against assigned send slots
    guard slotNum >= 1 && slotNum <= strip.sendSlots.count else {
        printJSON(["success": false, "error": "Send slot \(slotNum) is not assigned on track '\(strip.trackName)'. Assigned sends: \(strip.sendSlots.count)."])
        exit(0)
    }

    let targetSend = strip.sendSlots[slotNum - 1]
    guard let slider = targetSend.slider else {
        printJSON(["success": false, "error": "Send level knob not found for slot \(slotNum) on track '\(strip.trackName)'."])
        exit(0)
    }

    // 3. Drag knob to target dB
    let res = dragSendKnobToDb(slider: slider, targetDb: targetDb)
    printJSON(["success": res.success, "track": strip.trackName, "slot": slotNum, "db": res.finalDb])

// MARK: - SPRINT 10: Sidechain Routing in Plugin Header

case "get-sidechain":
    guard let trackName = getArg("--track"), !trackName.isEmpty else {
        printJSON(["success": false, "error": "Missing --track argument"])
        exit(0)
    }
    let slotStr = getArg("--slot") ?? "1"
    let slotNum = Int(slotStr) ?? 1

    guard let target = ensurePluginWindowOpen(appElement: appElement, trackName: trackName, slotNum: slotNum) else {
        printJSON(["success": false, "error": "Could not open or find plugin window for track '\(trackName)' slot \(slotNum)"])
        exit(0)
    }

    guard let scBtn = findSidechainButton(in: target.window) else {
        printJSON(["success": false, "error": "Sidechain pop-up button not found in plugin '\(target.pluginName)' header."])
        exit(0)
    }

    let val = getAXString(scBtn, kAXValueAttribute as String)
        ?? getAXString(scBtn, kAXValueDescriptionAttribute as String)
        ?? getAXString(scBtn, kAXTitleAttribute as String)
        ?? ""

    printJSON(["success": true, "track": target.stripTrackName, "slot": slotNum, "pluginName": target.pluginName, "sidechain": val])


case "set-sidechain":
    guard let trackName = getArg("--track"), !trackName.isEmpty else {
        printJSON(["success": false, "error": "Missing --track argument"])
        exit(0)
    }
    let slotStr = getArg("--slot") ?? "1"
    let slotNum = Int(slotStr) ?? 1
    guard let sourceStr = getArg("--source"), !sourceStr.isEmpty else {
        printJSON(["success": false, "error": "Missing --source argument"])
        exit(0)
    }

    guard let target = ensurePluginWindowOpen(appElement: appElement, trackName: trackName, slotNum: slotNum) else {
        printJSON(["success": false, "error": "Could not open or find plugin window for track '\(trackName)' slot \(slotNum)"])
        exit(0)
    }

    guard let scBtn = findSidechainButton(in: target.window) else {
        printJSON(["success": false, "error": "Sidechain pop-up button not found in plugin '\(target.pluginName)' header."])
        exit(0)
    }

    // Click Sidechain button to open menu
    var activeMenu: AXUIElement? = nil
    for attempt in 0..<2 {
        if attempt == 0 {
            _ = AXUIElementPerformAction(scBtn, kAXPressAction as CFString)
        } else {
            // Fallback: Click center of scBtn
            var pVal: AnyObject?
            var sVal: AnyObject?
            AXUIElementCopyAttributeValue(scBtn, kAXPositionAttribute as CFString, &pVal)
            AXUIElementCopyAttributeValue(scBtn, kAXSizeAttribute as CFString, &sVal)
            if let pv = pVal, let sv = sVal {
                var p = CGPoint.zero
                var s = CGSize.zero
                AXValueGetValue(pv as! AXValue, .cgPoint, &p)
                AXValueGetValue(sv as! AXValue, .cgSize, &s)
                let center = CGPoint(x: p.x + s.width / 2.0, y: p.y + s.height / 2.0)
                let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: center, mouseButton: .left)
                let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: center, mouseButton: .left)
                down?.post(tap: .cghidEventTap)
                usleep(15_000)
                up?.post(tap: .cghidEventTap)
            }
        }

        for _ in 0..<10 {
            usleep(50_000)
            if let m = findSidechainMenu(appElement: appElement, slotButton: scBtn) {
                activeMenu = m
                break
            }
        }
        if activeMenu != nil { break }
    }

    guard let rootMenu = activeMenu else {
        printJSON(["success": false, "error": "Sidechain menu did not appear after clicking Sidechain button."])
        exit(0)
    }

    let segments = sourceStr.components(separatedBy: ">").map {
        $0.trimmingCharacters(in: .whitespacesAndNewlines)
    }.filter { !$0.isEmpty }

    let leafSegment = segments.last ?? sourceStr
    let leafLower = leafSegment.lowercased()
    let isNoneQuery = (leafLower == "none" || leafLower == "keine" || leafLower == "off" || leafLower == "intern" || leafLower == "ohne")

    func isVisibleItem(_ it: AXUIElement) -> Bool {
        var sVal: AnyObject?
        AXUIElementCopyAttributeValue(it, kAXSizeAttribute as CFString, &sVal)
        if let sv = sVal {
            var sz = CGSize.zero
            AXValueGetValue(sv as! AXValue, .cgSize, &sz)
            return sz.width > 0 && sz.height > 0
        }
        return false
    }

    var targetItem: AXUIElement? = nil

    let rootItems = getAXChildren(rootMenu).filter {
        (getAXString($0, kAXRoleAttribute as String) ?? "") == "AXMenuItem" && isVisibleItem($0)
    }

    // Fast-path: Check if leaf item exists directly in rootMenu (e.g. "Intern", or active bus "Bus 1 ← ...")
    if isNoneQuery {
        targetItem = rootItems.first {
            let t = (getAXString($0, kAXTitleAttribute as String) ?? "").lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            return (t == "intern" || t == "keine" || t == "none" || t == "ohne" || t == "off")
        }
        if targetItem == nil {
            targetItem = rootItems.first {
                let t = (getAXString($0, kAXTitleAttribute as String) ?? "").lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
                return !t.hasPrefix("!") && (t.contains("keine") || t.contains("none") || t.contains("intern") || t.contains("ohne"))
            }
        }
    } else if leafLower != "bus" && leafLower != "audio" && leafLower != "inst." && leafLower != "eingang" {
        targetItem = rootItems.first {
            let t = (getAXString($0, kAXTitleAttribute as String) ?? "").lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            return !t.hasPrefix("!") && (t == leafLower || t.contains(leafLower))
        }
    }

    // If not found in rootMenu, traverse hierarchically
    if targetItem == nil {
        var currentMenu = rootMenu
        for (idx, seg) in segments.enumerated() {
            let isFinal = (idx == segments.count - 1)

            let items = getAXChildren(currentMenu).filter {
                (getAXString($0, kAXRoleAttribute as String) ?? "") == "AXMenuItem" && isVisibleItem($0)
            }

            if let item = findMenuItem(menu: currentMenu, query: seg) {
                if isFinal {
                    targetItem = item
                    break
                } else {
                    guard let nextMenu = getSubmenu(of: item, appElement: appElement) else {
                        closeMenu(rootMenu)
                        printJSON(["success": false, "error": "Submenu '\(seg)' could not be opened in Sidechain menu."])
                        exit(0)
                    }
                    currentMenu = nextMenu
                }
            } else {
                // Fallback for single segment: recursively check submenus
                if segments.count == 1 {
                    for it in items {
                        if let sub = getSubmenu(of: it, appElement: appElement) {
                            if let found = findMenuItem(menu: sub, query: seg) {
                                targetItem = found
                                break
                            }
                        }
                    }
                    if targetItem != nil { break }
                }

                closeMenu(rootMenu)
                printJSON(["success": false, "error": "Sidechain source '\(seg)' not found in menu."])
                exit(0)
            }
        }
    }

    guard let finalItem = targetItem else {
        closeMenu(rootMenu)
        printJSON(["success": false, "error": "Sidechain source '\(sourceStr)' could not be resolved."])
        exit(0)
    }

    var pVal: AnyObject?
    var sVal: AnyObject?
    AXUIElementCopyAttributeValue(finalItem, kAXPositionAttribute as CFString, &pVal)
    AXUIElementCopyAttributeValue(finalItem, kAXSizeAttribute as CFString, &sVal)
    var p = CGPoint.zero
    var s = CGSize.zero
    if let pv = pVal { AXValueGetValue(pv as! AXValue, .cgPoint, &p) }
    if let sv = sVal { AXValueGetValue(sv as! AXValue, .cgSize, &s) }

    if s.width > 0 && s.height > 0 {
        let center = CGPoint(x: p.x + s.width / 2.0, y: p.y + s.height / 2.0)
        let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: center, mouseButton: .left)
        let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: center, mouseButton: .left)
        down?.post(tap: .cghidEventTap)
        usleep(20_000)
        up?.post(tap: .cghidEventTap)
    } else {
        _ = AXUIElementPerformAction(finalItem, kAXPressAction as CFString)
    }

    // Wait 300ms for UI update
    usleep(300_000)

    let newVal = getAXString(scBtn, kAXValueAttribute as String)
        ?? getAXString(scBtn, kAXValueDescriptionAttribute as String)
        ?? getAXString(scBtn, kAXTitleAttribute as String)
        ?? sourceStr

    printJSON([
        "success": true,
        "track": target.stripTrackName,
        "slot": slotNum,
        "pluginName": target.pluginName,
        "sidechain": newVal
    ])

default:
    printJSON(["success": false, "error": "Unknown command: \(command)"])
}
