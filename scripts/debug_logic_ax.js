#!/usr/bin/env node

/**
 * scripts/debug_logic_ax.js
 *
 * Minimal standalone diagnostics script to test whether macOS Accessibility
 * can inspect the tracks and UI elements of the currently open Apple Logic Pro project.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);

async function runAppleScript(script) {
  try {
    const { stdout, stderr } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      timeout: 8000
    });
    return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    return { success: false, error: error.message, code: error.code };
  }
}

async function main() {
  console.log('============================================================');
  console.log('🔍 LOGIC PRO ACCESSIBILITY (AX) DIAGNOSTICS');
  console.log('============================================================\n');

  // 1. Direct AppleScript (Does not require Accessibility permissions)
  console.log('STEP 1: Checking Logic Pro process & open windows...');
  const winRes = await runAppleScript(`
    tell application "Logic Pro"
      return name of every window
    end tell
  `);

  if (!winRes.success) {
    console.error('❌ Logic Pro is not running or not responding to Apple Events:');
    console.error(winRes.error);
    process.exit(1);
  }

  console.log('✅ Open Logic Pro Windows:', winRes.stdout || '(None)');
  const windowNames = winRes.stdout.split(',').map((s) => s.trim()).filter(Boolean);

  // Find the Arrange / Tracks window
  const trackWin = windowNames.find(
    (w) => w.toLowerCase().includes('spuren') || w.toLowerCase().includes('tracks')
  );

  if (trackWin) {
    console.log(`🎯 Found Main Tracks Window: "${trackWin}"\n`);
  } else {
    console.log('⚠️ No window containing "Spuren" or "Tracks" found in window list.');
    console.log('Available windows:', windowNames, '\n');
  }

  // 2. System Events Accessibility Test
  console.log('STEP 2: Testing macOS Accessibility (System Events)...');
  const axTestScript = `
    tell application "System Events"
      set pExists to exists (processes where name is "Logic Pro")
      return pExists
    end tell
  `;
  const axTestRes = await runAppleScript(axTestScript);

  if (!axTestRes.success) {
    console.log('❌ macOS Accessibility Permission Check Failed!');
    console.log('Error details:');
    console.log(axTestRes.error);

    if (axTestRes.error.includes('-1719') || axTestRes.error.includes('-25211') || axTestRes.error.includes('-1728')) {
      console.log('\n🔒 ROOT CAUSE: TCC / Accessibility permission denied.');
      console.log('To fix: Open System Settings -> Privacy & Security -> Accessibility (Bedienungshilfen)');
      console.log('and grant permission to Terminal, Node, or your IDE.\n');
    }
  } else {
    console.log('✅ System Events can access Logic Pro process!\n');
  }

  // 3. Extract Track Headers from Main Tracks Window
  console.log('STEP 3: Inspecting UI Elements in the Main Tracks Window...');
  const extractScript = `
    tell application "System Events"
      tell process "Logic Pro"
        set mainWin to first window whose name contains "Spuren" or name contains "Tracks"
        set rawList to {}
        tell mainWin
          set allElements to entire contents
          repeat with elem in allElements
            try
              set r to role of elem
              if r is "AXStaticText" or r is "AXTextField" then
                set v to value of elem
                if v is not missing value and length of v > 1 then
                  if v does not contain ":" and v does not contain "dB" and v does not contain "Takt" then
                    copy v to end of rawList
                  end if
                end if
              end if
            end try
          end repeat
        end tell
        return rawList
      end tell
    end tell
  `;

  const extractRes = await runAppleScript(extractScript);

  if (!extractRes.success) {
    console.log('❌ Failed to extract UI elements from main window:');
    console.log(extractRes.error, '\n');
  } else {
    console.log('✅ Raw extracted UI elements:');
    console.log(extractRes.stdout || '(Empty)');

    const items = extractRes.stdout.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    console.log(`\nFound ${items.length} candidate text elements.`);
    console.log(items);
  }

  console.log('\n============================================================');
  console.log('🏁 DIAGNOSTICS COMPLETED');
  console.log('============================================================');
}

main().catch(console.error);
