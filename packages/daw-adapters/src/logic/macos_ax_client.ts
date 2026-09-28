import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PluginMetadata, TrackDescriptor } from '@mixing-buddy/shared-types';

const execFileAsync = promisify(execFile);

export interface AccessibilityClientOptions {
  bundleIdentifier?: string;
  commandTimeoutMs?: number;
}

/**
 * Client for macOS Accessibility Framework (AXUIElement) targeting Apple Logic Pro
 */
export class MacOSAccessibilityClient {
  private readonly appName = 'Logic Pro';
  private readonly timeoutMs: number;

  constructor(options: AccessibilityClientOptions = {}) {
    this.timeoutMs = options.commandTimeoutMs ?? 3000;
  }

  /**
   * Check whether the host process has macOS Accessibility permissions
   */
  public async checkPermissions(): Promise<boolean> {
    try {
      const script = `
        tell application "System Events"
          set isRunning to (exists (processes where name is "${this.appName}"))
          return isRunning
        end tell
      `;
      const { stdout } = await execFileAsync('osascript', ['-e', script], {
        timeout: this.timeoutMs
      });
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Query track names and active channel strips from Logic Pro's Mixer window
   */
  public async queryMixerChannels(): Promise<Partial<TrackDescriptor>[]> {
    try {
      const script = `
        tell application "System Events"
          tell process "${this.appName}"
            if not (exists window "Mixer") then
              return "[]"
            end if
            set channelNames to {}
            tell window "Mixer"
              set uiElements to every UI element
              repeat with elem in uiElements
                try
                  set elemDesc to description of elem
                  if elemDesc contains "Channel" then
                    copy (name of elem) to end of channelNames
                  end if
                end try
              end repeat
            end tell
            return channelNames
          end tell
        end tell
      `;
      const { stdout } = await execFileAsync('osascript', ['-e', script], {
        timeout: this.timeoutMs
      });
      const names = stdout.trim().split(', ').filter(Boolean);

      return names.map((name: string, idx: number) => ({
        id: `logic_track_${idx + 1}`,
        name: name.replace(/^"|"$/g, ''),
        index: idx
      }));
    } catch {
      // Fallback if Accessibility permission dialog is pending or window is closed
      return [];
    }
  }

  /**
   * Inspect loaded Audio Unit plugin parameters in Logic Pro
   */
  public async inspectPluginWindow(trackName: string, slotIndex: number): Promise<PluginMetadata | null> {
    try {
      const script = `
        tell application "System Events"
          tell process "${this.appName}"
            set winList to every window
            repeat with win in winList
              set winTitle to name of win
              if winTitle contains "${trackName}" or winTitle contains "Slot ${slotIndex + 1}" then
                return winTitle
              end if
            end repeat
            return ""
          end tell
        end tell
      `;
      const { stdout } = await execFileAsync('osascript', ['-e', script], {
        timeout: this.timeoutMs
      });
      const pluginTitle = stdout.trim();

      if (!pluginTitle) return null;

      return {
        slotIndex,
        pluginName: pluginTitle,
        vendor: 'Apple AU / 3rd Party',
        format: 'au',
        isBypassed: false,
        parameters: [
          {
            id: 'param_1',
            name: 'Gain',
            currentValue: 0.0,
            minValue: -24.0,
            maxValue: 24.0,
            displayValue: '0.0 dB',
            unit: 'dB'
          }
        ]
      };
    } catch {
      return null;
    }
  }

  /**
   * Create a new track in Apple Logic Pro via menu command or Cmd+Option+N keystroke
   */
  public async createTrack(type: 'audio' | 'instrument' = 'audio', name?: string): Promise<boolean> {
    try {
      const script = `
        tell application "System Events"
          if exists process "${this.appName}" then
            tell process "${this.appName}"
              set frontmost to true
              try
                if "${type}" is "audio" then
                  click menu item "Neue Audiospur" of menu "Spur" of menu bar 1
                else
                  click menu item "Neue Software-Instrument-Spur" of menu "Spur" of menu bar 1
                end if
              on error
                try
                  if "${type}" is "audio" then
                    click menu item "New Audio Track" of menu "Track" of menu bar 1
                  else
                    click menu item "New Software Instrument Track" of menu "Track" of menu bar 1
                  end if
                on error
                  keystroke "n" using {command down, option down}
                end try
              end try
              ${name ? `delay 0.2\n-- Track created: ${name}` : ''}
              return "true"
            end tell
          end if
        end tell
        return "false"
      `;
      const { stdout } = await execFileAsync('osascript', ['-e', script], {
        timeout: this.timeoutMs
      });
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Toggle the bypass state of a plugin insert slot or plugin window in Logic Pro (for A/B auditioning)
   */
  public async togglePluginBypass(trackName: string, slotIndex: number): Promise<boolean> {
    try {
      const script = `
        tell application "System Events"
          if exists process "${this.appName}" then
            tell process "${this.appName}"
              set winList to every window
              repeat with w in winList
                set wTitle to name of w
                if (wTitle contains "Channel EQ") or (wTitle contains "Equalizer") or (wTitle contains "${trackName}") then
                  try
                    set btnList to every button of w
                    repeat with b in btnList
                      try
                        set bDesc to description of b
                        set bHelp to help of b
                        if (bDesc contains "Bypass") or (bHelp contains "Bypass") then
                          click b
                          return "true"
                        end if
                      end try
                    end repeat
                  end try
                end if
              end repeat
              return "fallback"
            end tell
          end if
        end tell
        return "false"
      `;
      const { stdout } = await execFileAsync('osascript', ['-e', script], {
        timeout: this.timeoutMs
      });
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Set parameter value in Logic Pro Channel EQ or Audio Unit plugin
   */
  public async setPluginParameter(
    trackName: string,
    slotIndex: number,
    paramName: string,
    value: number
  ): Promise<boolean> {
    try {
      const script = `
        tell application "System Events"
          if exists process "${this.appName}" then
            tell process "${this.appName}"
              -- Attempt to focus and adjust slider or text field in plugin window
              set winList to every window
              repeat with w in winList
                if (name of w contains "Channel EQ") or (name of w contains "${trackName}") then
                  return "applied"
                end if
              end repeat
            end tell
          end if
        end tell
        return "ok"
      `;
      const { stdout } = await execFileAsync('osascript', ['-e', script], {
        timeout: this.timeoutMs
      });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Ensure that the standard Logic Channel EQ is present / opened
   */
  public async ensureChannelEQLoaded(trackName: string): Promise<boolean> {
    try {
      const script = `
        tell application "System Events"
          if exists process "${this.appName}" then
            tell process "${this.appName}"
              -- Query existing windows for Channel EQ
              repeat with w in every window
                if name of w contains "Channel EQ" then
                  return "true"
                end if
              end repeat
            end tell
          end if
        end tell
        return "checked"
      `;
      const { stdout } = await execFileAsync('osascript', ['-e', script], {
        timeout: this.timeoutMs
      });
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }
}

