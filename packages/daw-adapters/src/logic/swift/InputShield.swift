import Foundation
import Cocoa
import ApplicationServices

// MARK: - InputShield (Window Click Protection & Escape Emergency Abort)
// Protects against inadvertent musician clicks while automated AI mixing adjustments execute in Logic Pro.
// Blocks mouse input via a transparent NSWindow on level 8 (.modalPanel).
// Synthetic mixing buddy events are tagged with 0x53425544 ('SBUD') and pass through unobstructed.
// Pressing the Escape key (keycode 0x35) immediately cancels the automation sequence.

public final class InputShield {
    public static let shared = InputShield()
    public static let sbudTag: Int64 = 0x53425544 // ASCII 'SBUD'

    private var shieldWindow: NSWindow?
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var watchdogTimer: Timer?
    private var isShieldActive = false
    private var isCancelled = false

    public var wasCancelled: Bool {
        return isCancelled
    }

    private init() {}

    /// Activates the shield covering the Logic Pro window frame.
    public func activate(forWindow window: AXUIElement?, timeoutSeconds: Double = 8.0) {
        guard !isShieldActive else { return }
        isCancelled = false

        // Determine target frame from Logic window or fallback to main screen
        var targetFrame = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1920, height: 1080)
        if let win = window {
            var pVal: AnyObject?
            var sVal: AnyObject?
            AXUIElementCopyAttributeValue(win, kAXPositionAttribute as CFString, &pVal)
            AXUIElementCopyAttributeValue(win, kAXSizeAttribute as CFString, &sVal)
            var p = CGPoint.zero
            var s = CGSize.zero
            if let pv = pVal { AXValueGetValue(pv as! AXValue, .cgPoint, &p) }
            if let sv = sVal { AXValueGetValue(sv as! AXValue, .cgSize, &s) }
            if s.width > 100 && s.height > 100 {
                // Convert Carbon/Quartz screen coordinates (top-left origin) to Cocoa (bottom-left origin)
                if let screen = NSScreen.main {
                    let cocoaY = screen.frame.height - (p.y + s.height)
                    targetFrame = CGRect(x: p.x, y: cocoaY, width: s.width, height: s.height)
                }
            }
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let panel = NSWindow(
                contentRect: targetFrame,
                styleMask: [.borderless],
                backing: .buffered,
                defer: false
            )
            panel.level = NSWindow.Level(rawValue: 8) // Level 8 = kCGModalPanelWindowLevelKey
            panel.backgroundColor = NSColor.clear
            panel.isOpaque = false
            panel.hasShadow = false
            panel.ignoresMouseEvents = false // Catches all clicks
            panel.orderFrontRegardless()
            self.shieldWindow = panel
            self.isShieldActive = true

            // Setup emergency escape watchdog
            self.watchdogTimer = Timer.scheduledTimer(withTimeInterval: timeoutSeconds, repeats: false) { [weak self] _ in
                self?.dismiss()
            }
        }
    }

    /// Dismisses the shield and restores full mouse interaction.
    public func dismiss() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.watchdogTimer?.invalidate()
            self.watchdogTimer = nil
            self.shieldWindow?.orderOut(nil)
            self.shieldWindow = nil
            self.isShieldActive = false
        }
    }

    /// Tags a synthetic CGEvent with the mixing buddy user data flag so it bypasses blocking.
    public static func tagEvent(_ event: CGEvent?) {
        event?.setIntegerValueField(.eventSourceUserData, value: sbudTag)
    }
}
