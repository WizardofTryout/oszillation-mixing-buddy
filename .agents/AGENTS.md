---
trigger: always_on
---

# AGENTS.md - Workspace Rules: Oszillation Mixing Buddy

Verbindliche System-Richtlinien, Architektur-Regeln und Qualitätsschranken für das Projekt **Oszillation Mixing Buddy (Universal AI Co-Producer for DAWs)**.

---

## 🏛️ Die 4 System-Säulen & Architektur-Integrität (CRITICAL)

Das Monorepo ruht strikt auf vier voneinander getrennten Schichten. Code und Logik dürfen niemals willkürlich vermischt werden:

1. **Säule 1: Audio-Telemetrie („The Ear“)** (`plugins/meter-audio/`)
   - JUCE 8, C++20, CMake, ITU-R BS.1770-4 / EBU R128 Dual-Gate.
   - Streamt alle 33 ms (30 fps) Binär-/JSON-Frames an Port 48123.
   - Bit-transparent, Latenz $\le 0.1$ ms.
2. **Säule 2: Desktop Companion & IPC Hub** (`apps/desktop/`)
   - Tauri v2, Rust Backend (`src-tauri/`) + React/Tailwind Musiker-HUD (`src/`).
   - Verwaltet den **Acoustic Shock Shield** (Gehörschutz).
   - WebSocket/TCP-Server auf Port 48123.
3. **Säule 3: Native DAW-Bridges („The Hands“)** (`packages/daw-adapters/`)
   - Native Swift Mach-O Binary (`packages/daw-adapters/bin/logic-ax-bridge`).
   - Direkter Speicherzugriff via macOS `ApplicationServices` / `AXUIElement`.
   - **Absolutes Verbot von osascript/AppleScript-Umwegen!** Latenz $< 0,1$ ms.
4. **Säule 4: MCP-Server & AI-Gateway („The Brain“)** (`packages/mcp-server/` & `packages/ai-engine/`)
   - Model Context Protocol (Spec 2026 / stdio & SSE Port 48124), Node.js/TS.
   - Exponiert die 7 Kern-Tools (`mcp__propose_mix_adjustment`, `mcp__execute_mix_adjustment`, etc.).
   - Verwaltet den persistenten Plugin Vault (`~/.mixing-buddy/plugins/`).

---

## 🧠 GitNexus Code Intelligence & Guardrails (CRITICAL)

Das Projekt ist durch GitNexus indiziert (Container `gitnexus-server` auf Docker Desktop).

1. **Impact-Analyse vor Modifikationen:**
   - Vor der Bearbeitung von geteilten Funktionen, Klassen oder Methoden MUSS eine Auswirkungsanalyse durchgeführt werden:
     `docker exec gitnexus-server gitnexus impact --repo Steinberg-Mixing-Buddy <SymbolName>`
   - Bei Einstufung **HIGH** oder **CRITICAL** ist zwingend vorab Rücksprache mit dem User zu halten.
2. **`detect_changes` vor Commits:**
   - Vor jedem Git-Commit prüfen, ob die Diffs exakt den erwarteten Symbolen und Ausführungspfaden entsprechen:
     `docker exec gitnexus-server gitnexus detect-changes --repo Steinberg-Mixing-Buddy`
3. **Striktes Verbot von blindem Find-and-Replace:**
   - Niemals Symbole über blindes Text-Ersetzen umbenennen; immer die Graph-Abhängigkeiten und Call-Chains berücksichtigen.
4. **Re-Indizierung nach Meilensteinen:**
   - Nach erfolgreichen Code-Änderungen und Commits wird der Graph aktualisiert:
     `docker exec gitnexus-server gitnexus analyze /workspace/Steinberg-Mixing-Buddy`

---

## 🛡️ Acoustic Shock Shield & Gehörschutz-Regeln (CRITICAL)

In Tonstudios arbeiten Nutzer mit hohen Abhörlautstärken. Falsche Pegelsprünge können Gehörschäden verursachen oder Monitore zerstören.

1. **Asymmetrischer Lautstärke-Schutz (`safety_guard.rs`):**
   - **Pegelreduktion (Delta $\le 0.0$ dB):** Jede Absenkung (Leiserstellen) ist IMMER zulässig und darf niemals beschnitten werden.
   - **Pegelanhebung (Delta $> 0.0$ dB):** Ist auf maximal **+3.0 dB pro Schritt** gedecodelt.
   - **A/B-Restore Garantie:** Die Rückkehr auf den ursprünglichen Ausgangswert vor dem Vorhören (`isRestore: true` bzw. Pegel $\le 0.0$ dB) darf **NIEMALS** blockiert werden.
2. **DAW-Automation-Integrität:**
   - **Keine blinden MCU-Fallbacks:** Für Logic Pro niemals blinde MIDI-Fader-Befehle (`apply_fader_delta_with_automation`) absetzen, da diese die DAW-Automation von *Read* auf *Touch* umstellen.
   - Echte Fehler müssen transparent an das HUD gemeldet werden.

---

## 🚫 Absolutes Verbot von Mocks & Scheindaten (CRITICAL)

1. **Echte Hardware- & DAW-Werte:**
   - Wenn Logic Pro oder Nuendo nicht läuft oder ein Channel-Strip/Plugin nicht geöffnet ist, liefert das System ein leeres Array (`[]`) oder einen echten Fehler.
   - **Niemals** Scheindaten (`"SoCal"`, `"Kick Drum"`, Mock-Frequenzen) in den Code schreiben oder per `curl` simulieren.
2. **Keine Scheinerfolge:**
   - Wenn eine Bridge-Aktion fehlschlägt, darf der IPC-Server nicht stillschweigend `success: true` zurückgeben. Der echte Fehlergrund muss im HUD sichtbar sein.

---

## 📏 Modulare Code-Hygiene & Strikte 3.000 LOC-Regel (CRITICAL)

1. **Strikte 3.000 LOC-Grenze:**
   - Keine Datei im gesamten Repository darf jemals $3.000$ Zeilen Code überschreiten.
   - Vor jedem Commit MUSS zwingend `./scripts/lint-loc.sh` ausgeführt werden.
2. **Atomare Commits & GitHub Push:**
   - Nach jedem gelösten Meilenstein wird sofort folgender Zyklus durchlaufen:
     ```bash
     ./scripts/lint-loc.sh
     git add -A
     git commit -m "feat(<scope>): prägnante Beschreibung" # bzw. fix(...)
     git push origin main
     ```
   - Niemals ungesicherte Arbeitsstände über mehrere Prompts hinweg liegen lassen.
3. **Workspace-Sauberkeit:**
   - Temporäre Shell-Skripte oder Scratch-Dateien müssen nach Abschluss sofort gelöscht werden (`git status -s` sauber halten).

---

## 📦 Build-, Packaging- & Release-Vorgaben (CRITICAL)

1. **Swift-Bridge Kompilierung:**
   - Bei Änderungen an `LogicAXBridge.swift` muss die native Mach-O-Binary neu gebaut werden:
     `pnpm --filter @mixing-buddy/daw-adapters run build:swift`
2. **Sidecar-Bundling:**
   - Die Swift-Binary muss im Bundle unter `Contents/Resources/` liegen und über `resolve_bridge_path()` robust referenziert werden.
3. **Tauri DMG & App Release:**
   - Desktop-App und DMG werden immer sauber über den Bundle-Befehl erzeugt:
     `pnpm --filter desktop tauri build --bundles app,dmg --no-sign`
   - Die gebaute App wird nach `/Applications/Oszillation Mixing Buddy.app` aktualisiert.
