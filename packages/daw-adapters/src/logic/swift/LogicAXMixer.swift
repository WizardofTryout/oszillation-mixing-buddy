import Foundation
import ApplicationServices
import Cocoa

// MARK: - LogicAXMixer
// Dedicated mixer module for Apple Logic Pro X.
// Handles Channel-Strips, Faders, Pan, Sends, and Batch Adjustments (Sprint 7).

/// Converts a decibel value into Logic Pro's non-linear fader slider coordinate (0.0 to 233.0).
/// Typical calibration curve from reverse-engineering:
/// +6 dB = 233.0 (1.00)
/// 0 dB = 173.0 (~0.74)
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
            _ = AXUIElementPerformAction(slider, "AXDecrement" as CFString)
        } else if diff >= 1.2 {
            // Coarse step up
            _ = AXUIElementPerformAction(slider, "AXIncrement" as CFString)
        } else if diff < 0 {
            // Fine step down (-0.1 dB per micro-step)
            var low = -100.0
            if let cf = CFNumberCreate(kCFAllocatorDefault, .doubleType, &low) {
                _ = AXUIElementSetAttributeValue(slider, kAXValueAttribute as CFString, cf)
            }
        } else {
            // Fine step up (+0.1 dB per micro-step)
            var high = 300.0
            if let cf = CFNumberCreate(kCFAllocatorDefault, .doubleType, &high) {
                _ = AXUIElementSetAttributeValue(slider, kAXValueAttribute as CFString, cf)
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
            _ = AXUIElementPerformAction(knob, "AXIncrement" as CFString)
        } else if diff <= -10.0 {
            _ = AXUIElementPerformAction(knob, "AXDecrement" as CFString)
        } else if diff > 0 {
            var high = 100.0
            if let cf = CFNumberCreate(kCFAllocatorDefault, .doubleType, &high) {
                _ = AXUIElementSetAttributeValue(knob, kAXValueAttribute as CFString, cf)
            }
        } else {
            var low = -100.0
            if let cf = CFNumberCreate(kCFAllocatorDefault, .doubleType, &low) {
                _ = AXUIElementSetAttributeValue(knob, kAXValueAttribute as CFString, cf)
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
    
    let minInsertY = insertBtnYs.min() ?? -1
    let audioPluginGroups = rawPluginGroups.filter { g in
        if minInsertY > 0 && g.y < minInsertY - 5.0 {
            return false
        }
        return true
    }
    
    let sortedGroups = audioPluginGroups.sorted { $0.y < $1.y }
    let pluginGroups = sortedGroups.map { (name: $0.name, group: $0.group) }
    
    for (i, pg) in pluginGroups.enumerated() {
        inserts.append([
            "slot": i + 1,
            "name": pg.name
        ])
    }

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

    if targetDb <= -70.0 {
        for _ in 0..<20 {
            _ = AXUIElementPerformAction(slider, "AXDecrement" as CFString)
            let desc = getAXString(slider, kAXValueDescriptionAttribute as String) ?? ""
            if parseDbString(desc) <= -70.0 {
                return (true, -100.0)
            }
        }
    }

    let initDesc = getAXString(slider, kAXValueDescriptionAttribute as String) ?? ""
    if parseDbString(initDesc) <= -70.0 && targetDb > -70.0 {
        _ = AXUIElementPerformAction(slider, "AXIncrement" as CFString)
        usleep(10_000)
    }

    let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: center, mouseButton: .left)
    InputShield.tagEvent(down)
    down?.post(tap: .cghidEventTap)
    usleep(15_000)

    var curY = center.y
    var bestDb = parseDbString(getAXString(slider, kAXValueDescriptionAttribute as String) ?? "")
    var bestDiff = abs(bestDb - targetDb)

    for _ in 0..<80 {
        let curDesc = getAXString(slider, kAXValueDescriptionAttribute as String) ?? ""
        let curDb = parseDbString(curDesc)
        let diff = targetDb - curDb

        if abs(diff) < bestDiff {
            bestDiff = abs(diff)
            bestDb = curDb
        }

        if abs(diff) <= 0.2 {
            break
        }

        let stepY: CGFloat = diff > 0 ? -2.0 : 2.0
        curY += stepY

        let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: CGPoint(x: center.x, y: curY), mouseButton: .left)
        InputShield.tagEvent(drag)
        drag?.post(tap: .cghidEventTap)
        usleep(8_000)
    }

    let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: CGPoint(x: center.x, y: curY), mouseButton: .left)
    InputShield.tagEvent(up)
    up?.post(tap: .cghidEventTap)
    usleep(20_000)

    let finalDesc = getAXString(slider, kAXValueDescriptionAttribute as String) ?? ""
    let finalDb = parseDbString(finalDesc)
    return (abs(finalDb - targetDb) <= 1.0, finalDb)
}

/// Applies a fader level in dB to a parsed channel strip.
func applyFaderDirectly(strip: ParsedChannelStrip, targetDb: Double) -> (success: Bool, finalDb: Double, sliderValue: Double) {
    if let tf = strip.faderTextField {
        let formattedComma = String(format: "%.1f", targetDb).replacingOccurrences(of: ".", with: ",")
        let formattedDot = String(format: "%.1f", targetDb)
        
        _ = AXUIElementSetAttributeValue(tf, kAXValueAttribute as CFString, formattedComma as CFString)
        _ = AXUIElementPerformAction(tf, kAXConfirmAction as CFString)
        _ = AXUIElementSetAttributeValue(tf, kAXValueAttribute as CFString, formattedDot as CFString)
        _ = AXUIElementPerformAction(tf, kAXConfirmAction as CFString)
    }
    
    if let slider = strip.faderSlider {
        let res = stepFaderToTargetDb(slider: slider, targetDb: targetDb)
        let newDesc = getAXString(slider, kAXValueDescriptionAttribute as String) ?? "\(res.finalDb) dB"
        let sliderValActual = getAXDouble(slider, kAXValueAttribute as String) ?? 0.0
        return (res.success, parseDbString(newDesc), sliderValActual)
    } else {
        return (true, targetDb, targetDb)
    }
}

/// Applies a pan value (-64 to +63) to a parsed channel strip.
func applyPanDirectly(strip: ParsedChannelStrip, targetPan: Double) -> (success: Bool, finalPan: Double) {
    if let knob = strip.balanceSlider {
        let res = stepPanToTarget(knob: knob, targetPan: targetPan)
        return (res.success, res.finalPan)
    }
    return (false, 0.0)
}

/// Batch executes multiple mixer adjustments (faders, pans) in a single fast pass (Sprint 7.2).
func applyBatchMixerAdjustments(appElement: AXUIElement, itemsJson: String) -> [[String: Any]] {
    guard let data = itemsJson.data(using: .utf8),
          let array = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
        return [["success": false, "error": "Invalid JSON input for batch-mixer"]]
    }
    
    let allWins = getLogicWindows(appElement)
    let stripElements = findAllChannelStripElements(allWins)
    let parsedStrips = stripElements.map { parseChannelStripElement($0) }
    
    var results: [[String: Any]] = []
    
    for item in array {
        let type = (item["type"] as? String ?? "").lowercased()
        let trackQuery = item["track"] as? String ?? ""
        let targetValue = item["value"] as? Double ?? 0.0
        
        guard let strip = parsedStrips.first(where: { matchesTrackName($0.trackName, query: trackQuery) }) else {
            results.append([
                "track": trackQuery,
                "type": type,
                "success": false,
                "error": "Track '\(trackQuery)' not found in mixer"
            ])
            continue
        }
        
        if type == "fader" || type == "volume" {
            let res = applyFaderDirectly(strip: strip, targetDb: targetValue)
            results.append([
                "track": strip.trackName,
                "type": "fader",
                "success": res.success,
                "finalDb": res.finalDb,
                "sliderValue": res.sliderValue
            ])
        } else if type == "pan" || type == "balance" {
            let res = applyPanDirectly(strip: strip, targetPan: targetValue)
            results.append([
                "track": strip.trackName,
                "type": "pan",
                "success": res.success,
                "finalPan": res.finalPan
            ])
        } else {
            results.append([
                "track": strip.trackName,
                "type": type,
                "success": false,
                "error": "Unsupported adjustment type: \(type)"
            ])
        }
    }
    
    return results
}
