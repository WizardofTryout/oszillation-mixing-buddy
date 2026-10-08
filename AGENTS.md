---
trigger: always_on
---
# AGENTS.md - Workspace Rules: Oszillation Mixing Buddy

Verbindliche System-Richtlinien, Architektur-Regeln und Qualitätsschranken für das Projekt **Oszillation Mixing Buddy (Universal AI Co-Producer for DAWs)**.

---

## 🛑 NON-NEGOTIABLE LAW: ZERO-REGRESSION & CODE PRESERVATION (CRITICAL)

1. **Absolutes Verbot von Silent Stripping & Code-Zerstörung:**
   - Verändere oder vereinfache NIEMALS bestehenden, funktionierenden Code in Nachbarfunktionen, wenn dies nicht explizit in der Aufgabenstellung beauftragt wurde.
   - Entferne niemals funktionierende Sicherheitsprüfungen, Timeouts oder Guard-Klauseln.
2. **Physical Ground-Truth vor In-Memory-Flags:**
   - Ersetze NIEMALS physische UI- und Betriebssystem-Prüfungen (wie `AXCheckBox.value == 1` oder Menühaken-Abfragen) durch naive In-Memory-Variablen im RAM, da diese beim Start uninitialisiert oder asynchron sein können.
3. **Diff-Selbstkontrolle vor jedem Commit:**
   - Vor jedem Speichern und Committen MUSS `git diff` geprüft werden: Wurden Guards aufgeweicht, Logik gekürzt oder Nebenwirkungen erzeugt? Falls ja: Sofortiger Rollback!

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

## 📏 Modulare Code-Hygiene, OOP-Architektur & 3.000 LOC-Regel (CRITICAL)

Die Regel `≤ 3.000 Zeilen Code pro Datei` (`./scripts/lint-loc.sh`) dient **ausschließlich der Lesbarkeit, Wartbarkeit und sauberen Modularisierung**.

1. **Absolutes Verbot von Code- und Formatierungs-Quetschen:**
   - Es ist **STRIKT VERBOTEN**, Skripte (wie Python-Snippets) auszuführen, die Leerzeilen entfernen, Kommentare löschen, Fehlerbehandlungen eindampfen oder Guards streichen, um krampfhaft unter 3.000 Zeilen zu landen.
2. **Objektorientiertes Splitten statt God-Objects (Single Responsibility Principle):**
   - Sobald eine Datei bzw. ein Objekt ca. **2.800–2.900 Zeilen** erreicht oder zu viele Aufgaben bündelt, MUSS sie modular in spezialisierte Teil-Dateien und Klassen aufgeteilt werden:
     * **In Swift (`packages/daw-adapters/src/logic/swift/`):**
       - `LogicAXTransport.swift` (Play, Stop, Locate, Cycle- & Loop-Handling)
       - `LogicAXMixer.swift` (Fader, Pan, Channel-Strips, Inserts, Sends)
       - `LogicAXPlugins.swift` (Plugin-Scans, Parameter, Sidechain, Menü-Traversierung)
       *(Hinweis: Alle Swift-Dateien im selben Target/Modul teilen sich denselben Namespace und können direkt aufeinander zugreifen – keine Redundanz nötig!)*
     * **In Rust & TypeScript:**
       - Saubere Auslagerung in Submodule (`mod transport;`, `import { ... }`).
3. **Erhaltungs-Garantie:**
   - Jede funktionierende Funktion, jede Sicherheitsabfrage und jede Fehlerbehandlung bleibt beim modularen Splitten zu 100 % erhalten.

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

## 🔑 AI-Engine Resilience, Round-Robin & Quota-Management (CRITICAL)

1. **Proaktives Multi-Key Round-Robin:**
   - Jeder ausgehende Request wechselt automatisch auf den nächsten Key im Pool (`(currentIndex + 1) % keys.length`).
   - Jeder Key wird bei maximal 80 % seines Free-Tier-Limits (z. B. max. 4 Requests/Minute) gedeckelt.
2. **Pacing:**
   - Zwischen aufeinanderfolgenden API-Calls liegt ein Mindestabstand von 1.200 ms.
3. **Automatischer 503-Modell-Shift:**
   - Meldet Google einen `503 ServiceUnavailable` ("Model overloaded") für `gemini-3.8-flash`, schaltet die Session automatisch auf `gemini-3.5-flash-lite` (oder `gemini-3.5-flash`) um. Legacy-Modelle (2.5) sind strikt verboten!

---

## 🔏 macOS TCC Permission & Permanent Codesign Rule (Mandatory for Desktop Builds)

* **Problem:** Unsignierte Tauri-Bundles (`--no-sign`) oder flüchtige Ad-hoc-Signaturen verändern bei jedem Neubau ihren binären Hash. macOS TCC (Transparency, Consent, and Control) entzieht der App dadurch die Accessibility-Berechtigung (Bedienungshilfen) und fordert den Benutzer bei jedem Start erneut auf.
* **Regel:** Nach jedem Erstellen des Release-Bundles und dem Kopieren nach `/Applications/` **MUSS** die App zwingend mit dem permanenten Entwickler-Zertifikat `MixingBuddyDev` signiert werden:
  ```bash
  codesign --force --deep -s "MixingBuddyDev" "/Applications/Oszillation Mixing Buddy.app"
  ```
* **Build-Kette:**
  ```bash
  pnpm --filter desktop tauri build --bundles app --no-sign && rm -rf "/Applications/Oszillation Mixing Buddy.app" && cp -R "target/release/bundle/macos/Oszillation Mixing Buddy.app" /Applications/ && mkdir -p "/Applications/Oszillation Mixing Buddy.app/Contents/Resources" && cp packages/daw-adapters/bin/logic-ax-bridge "/Applications/Oszillation Mixing Buddy.app/Contents/Resources/" && codesign --force --deep -s "MixingBuddyDev" "/Applications/Oszillation Mixing Buddy.app"
  ```

---

## 🚫 Absolutes Verbot von Mocks & Scheindaten (CRITICAL)

1. **Echte Hardware- & DAW-Werte:**
   - Wenn Logic Pro oder Nuendo nicht läuft oder ein Channel-Strip/Plugin nicht geöffnet ist, liefert das System ein leeres Array (`[]`) oder einen echten Fehler.
   - Niemals Scheindaten (`"SoCal"`, `"Kick Drum"`, Mock-Frequenzen) in den Code schreiben oder per `curl` simulieren.
2. **Keine Scheinerfolge:**
   - Wenn eine Bridge-Aktion fehlschlägt, darf der IPC-Server nicht stillschweigend `success: true` zurückgeben. Der echte Fehlergrund muss im HUD sichtbar sein.

---

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Steinberg-Mixing-Buddy** (2735 symbols, 5623 relationships, 235 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Steinberg-Mixing-Buddy/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Steinberg-Mixing-Buddy/clusters` | All functional areas |
| `gitnexus://repo/Steinberg-Mixing-Buddy/processes` | All execution flows |
| `gitnexus://repo/Steinberg-Mixing-Buddy/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
