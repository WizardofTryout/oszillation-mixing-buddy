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
    guard let val = getAXAttribute(element, attribute) else { return nil }
    if let str = val as? String {
        return str
    }
    return nil
}

func getAXDouble(_ element: AXUIElement, _ attribute: String) -> Double? {
    guard let val = getAXAttribute(element, attribute) else { return nil }
    if let num = val as? NSNumber {
        return num.doubleValue
    }
    if let str = val as? String {
        let normalized = str.replacingOccurrences(of: ",", with: ".")
        return Double(normalized)
    }
    return nil
}

func getAXChildren(_ element: AXUIElement) -> [AXUIElement] {
    guard let val = getAXAttribute(element, kAXChildrenAttribute as String) else { return [] }
    if let arr = val as? [AXUIElement] {
        return arr
    }
    return []
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

func getLogicWindows(_ appElement: AXUIElement) -> [AXUIElement] {
    guard let val = getAXAttribute(appElement, kAXWindowsAttribute as String) else { return [] }
    if let wins = val as? [AXUIElement] {
        return wins
    }
    return []
}

// Extract plugin name from a window's top-level static text elements or EQ group
func detectPluginName(in window: AXUIElement, windowTitle: String) -> String {
    let children = getAXChildren(window)
    var candidateName = ""
    var hasEQGroup = false

    for child in children {
        let role = getAXString(child, kAXRoleAttribute as String) ?? ""
        if role == "AXStaticText" {
            let val = getAXString(child, kAXValueAttribute as String)
                ?? getAXString(child, kAXTitleAttribute as String)
                ?? ""
            let trimmed = val.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty &&
               trimmed != "Ansicht:" &&
               trimmed != "View:" &&
               trimmed.lowercased() != windowTitle.lowercased() {
                candidateName = trimmed
            }
        } else if role == "AXGroup" {
            let desc = getAXString(child, kAXDescriptionAttribute as String) ?? ""
            if desc == "EQ" {
                hasEQGroup = true
            }
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

// Locate target plugin window by title, child static text, or dialog fallback
func findTargetWindow(_ appElement: AXUIElement, query: String) -> AXUIElement? {
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

func buildWindowError(_ appElement: AXUIElement, query: String) -> String {
    if !AXIsProcessTrusted() {
        return "AX_UNTRUSTED: Fehlende macOS Bedienungshilfen-Berechtigung für den aufrufenden Prozess"
    }
    let windows = getLogicWindows(appElement)
    if windows.isEmpty {
        return "AX_NO_WINDOWS: Keine zugänglichen Fenster in Logic Pro gefunden"
    }
    let names = windows.compactMap { w -> String? in
        let t = getAXString(w, kAXTitleAttribute as String) ?? ""
        let p = detectPluginName(in: w, windowTitle: t)
        return t.isEmpty ? nil : (p != t ? "\(t) (\(p))" : t)
    }
    return "Plugin-Fenster für '\(query)' ist in Logic Pro nicht geöffnet (offene Fenster: \(names.joined(separator: ", ")))"
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

func findTargetElement(in window: AXUIElement, criteria: SearchCriteria) -> AXUIElement? {
    // Priority 1: Exact NS-Identifier (e.g. "_NS:153", "_NS:313")
    if let targetId = criteria.identifier, !targetId.isEmpty {
        if let found = findElementDFS(root: window, roleFilter: criteria.role, predicate: { el in
            let elId = getAXString(el, "AXIdentifier") ?? ""
            return elId == targetId
        }) {
            return found
        }
    }

    // Priority 2: Visible Description or Title (e.g. "Peak 3 Gain", "Low Cut Frequency")
    if let targetDesc = criteria.description, !targetDesc.isEmpty {
        let lowerDesc = targetDesc.lowercased()
        if let found = findElementDFS(root: window, roleFilter: criteria.role, predicate: { el in
            let desc = (getAXString(el, kAXDescriptionAttribute as String) ?? "").lowercased()
            let title = (getAXString(el, kAXTitleAttribute as String) ?? "").lowercased()
            return desc == lowerDesc || title == lowerDesc
        }) {
            return found
        }
    }

    // Priority 3: Help Prefix (e.g. "Threshold knob")
    if let targetHelp = criteria.helpPrefix, !targetHelp.isEmpty {
        let lowerHelp = targetHelp.lowercased()
        if let found = findElementDFS(root: window, roleFilter: criteria.role, predicate: { el in
            let help = (getAXString(el, kAXHelpAttribute as String) ?? "").lowercased()
            return help.hasPrefix(lowerHelp)
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

// MARK: - CLI Argument Parser

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else {
    printJSON(["success": false, "error": "Missing command. Expected: scan-windows | dump-window | read-param | set-param | scan-tracks"])
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
    printJSON([
        "success": setOk,
        "newValue": updatedVal,
        "valueDescription": valDesc
    ])

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
    printJSON([
        "success": actErr == .success,
        "newValue": updatedVal
    ])

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

    printJSON([
        "success": true,
        "schemaVersion": "1.0",
        "pluginName": pluginName,
        "windowTitle": windowTitle,
        "category": category,
        "tags": tags,
        "parameters": parameters
    ])

default:
    printJSON(["success": false, "error": "Unknown command: \(command)"])
}
