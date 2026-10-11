import Foundation
import ApplicationServices
import Cocoa

// MARK: - ControlsViewFallback for Logic Pro Plugins
// Allows switching any plugin window (AU, 3rd-party, or native) from Editor to Controls ("Regler")
// view where all audio DSP parameters are rendered as standard, accessible macOS sliders and tables.

public final class ControlsViewFallback {

    /// Finds the view switcher menu button in a plugin window header ("Ansicht" in German, "View" in English).
    public static func findAnsichtButton(in window: AXUIElement) -> AXUIElement? {
        for child in getAXChildren(window) {
            let role = getAXString(child, kAXRoleAttribute as String) ?? ""
            let desc = getAXString(child, kAXDescriptionAttribute as String) ?? ""
            if (role == "AXMenuButton" || role == "AXPopUpButton") && (desc == "Ansicht" || desc == "View" || desc.lowercased().contains("ansicht") || desc.lowercased().contains("view")) {
                return child
            }
        }
        // Fallback: look for any AXMenuButton or AXPopUpButton with title containing zoom or "Regler" / "Controls" / "Editor"
        for child in getAXChildren(window) {
            let role = getAXString(child, kAXRoleAttribute as String) ?? ""
            let title = getAXString(child, kAXTitleAttribute as String) ?? ""
            if (role == "AXMenuButton" || role == "AXPopUpButton") && (title.contains("%") || title == "Regler" || title == "Controls" || title == "Editor") {
                return child
            }
        }
        return nil
    }

    /// Determines the current view mode of the plugin window based on physical AXTable ground-truth.
    public static func currentViewMode(in window: AXUIElement) -> String {
        if findControlsTable(in: window) != nil {
            return "Controls"
        }
        return "Editor"
    }

    /// Switches the plugin window to the requested view ("Controls" / "Regler" or "Editor").
    @discardableResult
    public static func switchView(in window: AXUIElement, to target: String) -> Bool {
        guard let btn = findAnsichtButton(in: window) else { return false }
        let normalizedTarget = (target.lowercased() == "controls" || target.lowercased() == "regler") ? "Controls" : "Editor"
        let current = currentViewMode(in: window)

        if current == normalizedTarget {
            return true // Already in desired physical state
        }

        // Search for active menu or trigger menu via AXPressAction
        func findAnsichtMenu() -> AXUIElement? {
            for c in getAXChildren(btn) {
                if (getAXString(c, kAXRoleAttribute as String) ?? "") == "AXMenu" { return c }
            }
            for c in getAXChildren(window) {
                if (getAXString(c, kAXRoleAttribute as String) ?? "") == "AXMenu" { return c }
            }
            if let app = findLogicApplicationElement() {
                for c in getAXChildren(app) {
                    if (getAXString(c, kAXRoleAttribute as String) ?? "") == "AXMenu" { return c }
                }
            }
            return nil
        }

        var menu = findAnsichtMenu()
        if menu == nil {
            _ = AXUIElementPerformAction(btn, kAXPressAction as CFString)
            for _ in 0..<15 {
                usleep(40_000)
                if let m = findAnsichtMenu() {
                    menu = m
                    break
                }
            }
        }

        guard let targetMenu = menu else { return false }

        var targetFound = false
        let items = getAXChildren(targetMenu)
        for item in items {
            let itemTitle = (getAXString(item, kAXTitleAttribute as String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let matchesControls = (normalizedTarget == "Controls" && (itemTitle == "Regler" || itemTitle == "Controls"))
            let matchesEditor = (normalizedTarget == "Editor" && (itemTitle == "Editor"))

            if matchesControls || matchesEditor {
                var err = AXUIElementPerformAction(item, "AXPick" as CFString)
                if err != .success {
                    err = AXUIElementPerformAction(item, kAXPressAction as CFString)
                }
                if err == .success {
                    targetFound = true
                    break
                }
            }
        }

        if targetFound {
            // Schnelle 50ms Pause für macOS UI-Redraw ohne 1.5s Hänger
            usleep(50_000)
        }

        return targetFound
    }

    /// Finds the AXTable within the Controls view hierarchy.
    public static func findControlsTable(in window: AXUIElement) -> AXUIElement? {
        for child in getAXChildren(window) {
            let role = getAXString(child, kAXRoleAttribute as String) ?? ""
            if role == "AXScrollArea" {
                for sub in getAXChildren(child) {
                    if (getAXString(sub, kAXRoleAttribute as String) ?? "") == "AXTable" {
                        return sub
                    }
                }
            }
        }
        return nil
    }

    /// Harvests all accessible parameters from the generic Controls table.
    public static func harvestParameters(in window: AXUIElement) -> [[String: Any]] {
        guard let table = findControlsTable(in: window) else { return [] }
        var discovered: [[String: Any]] = []
        var seenIds: Set<String> = []

        func makeSlug(_ input: String) -> String {
            let lower = input.lowercased()
            let allowed = lower.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : Character("_") }
            let joined = String(allowed)
            let collapsed = joined.replacingOccurrences(of: "_+", with: "_", options: .regularExpression)
            return collapsed.trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        }

        func inferRange(label: String, valDesc: String, rawMin: Double, rawMax: Double) -> (String, Double, Double) {
            let l = (label + " " + valDesc).lowercased()
            if l.contains("hz") || l.contains("freq") { return ("Hz", 20.0, 20000.0) }
            if l.contains("db") || l.contains("gain") || l.contains("output") { return ("dB", -24.0, 24.0) }
            if l.contains("ms") || l.contains("predelay") || l.contains("attack") { return ("ms", 0.1, 2000.0) }
            if l.contains(" s") || l.hasSuffix("s") || l.contains("decay") { return ("s", 0.1, 30.0) }
            if l.contains("%") || l.contains("dry") || l.contains("wet") || l.contains("density") || l.contains("size") { return ("%", 0.0, 100.0) }
            return ("", rawMin, rawMax > rawMin ? rawMax : 100.0)
        }

        let rows = getAXChildren(table).filter { (getAXString($0, kAXRoleAttribute as String) ?? "") == "AXRow" }
        for (idx, row) in rows.enumerated() {
            var label = ""
            var valueDescription = ""
            var controlRole = "AXSlider"
            var rawMin = 0.0
            var rawMax = 100.0
            var currentRawVal = 0.0

            func scanCell(_ cell: AXUIElement) {
                for item in getAXChildren(cell) {
                    let r = getAXString(item, kAXRoleAttribute as String) ?? ""
                    if r == "AXStaticText" {
                        let text = (getAXString(item, kAXValueAttribute as String) ?? getAXString(item, kAXTitleAttribute as String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                        if !text.isEmpty && label.isEmpty {
                            label = text.trimmingCharacters(in: CharacterSet(charactersIn: ": "))
                        }
                    } else if r == "AXGroup" || r == "AXTextField" {
                        let desc = (getAXString(item, kAXValueAttribute as String) ?? getAXString(item, kAXTitleAttribute as String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                        if !desc.isEmpty && valueDescription.isEmpty {
                            valueDescription = desc
                        }
                    } else if r == "AXSlider" || r == "AXCheckBox" || r == "AXPopUpButton" {
                        controlRole = r
                        if let minV = getAXDouble(item, kAXMinValueAttribute as String) { rawMin = minV }
                        if let maxV = getAXDouble(item, kAXMaxValueAttribute as String) { rawMax = maxV }
                        if let curV = getAXDouble(item, kAXValueAttribute as String) { currentRawVal = curV }
                    }
                    scanCell(item)
                }
            }

            for cell in getAXChildren(row) {
                scanCell(cell)
            }

            if label.isEmpty {
                label = "Parameter \(idx + 1)"
            }

            var slug = makeSlug(label)
            if slug.isEmpty { slug = "param_\(idx + 1)" }
            if seenIds.contains(slug) { slug = "\(slug)_\(idx + 1)" }
            seenIds.insert(slug)

            let (unit, dispMin, dispMax) = inferRange(label: label, valDesc: valueDescription, rawMin: rawMin, rawMax: rawMax)

            let paramObj: [String: Any] = [
                "id": slug,
                "name": label,
                "role": controlRole,
                "identifier": slug,
                "description": label,
                "rawMin": rawMin,
                "rawMax": rawMax,
                "displayMin": dispMin,
                "displayMax": dispMax,
                "currentRawValue": currentRawVal,
                "valueDescription": valueDescription,
                "unit": unit
            ]
            discovered.append(paramObj)
        }

        return discovered
    }
}
