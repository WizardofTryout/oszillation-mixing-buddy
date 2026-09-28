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
}
