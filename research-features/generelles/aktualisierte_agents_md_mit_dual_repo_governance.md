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

## 🌐 DUAL-REPOSITORY GOVERNANCE & PUBLIC RELEASE WORKFLOW (CRITICAL)

Das Projekt wird strikt in einer **Dual-Repository-Architektur** geführt. Ein Vermischen der beiden Repositories ist strengstens untersagt.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ PRIVATES UPSTREAM (origin)                                                      │
│ URL: https://github.com/WizardofTryout/Steinberg-Mixing-Buddy.git               │
│ • Täglicher Entwicklungs-Workspace (Sprints, Experimente, unzensierter Code)   │
│ • Interne Dokumentation, Research, Prompt-Architektur, Test-Logs               │
│ • Regelmäßiges Committen: git push origin main                                  │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                        [ FILTER- & ORPHAN-EXPORT ]
                        ./scripts/publish-public-release.sh <VERSION>
                        • Strenges Zero-Leak Protokoll
                        • Bereinigung interner Docs & Secrets
                        • Orphan-Branch (Keine historische Git-Historie)
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ ÖFFENTLICHES SHOWCASE (public)                                                  │
│ URL: https://github.com/WizardofTryout/oszillation-mixing-buddy.git             │
│ • Repräsentatives Aushängeschild der Marke Oszillation Mixing Buddy             │
│ • Vollständiger, kompilierbarer Produktiv-Quellcode (Rust, Swift, JUCE, React) │
│ • High-End Showroom README mit Screenshots & PolyForm Noncommercial 1.0.0      │
│ • STRIKT VERBOTEN: Manuelle Direkt-Pushes ohne Export-Skript!                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1. Wann wird auf das private Repo (`origin`) gepusht?
- **Immer und fortlaufend:** Jede abgeschlossene Teilaufgabe, jeder Bugfix und jeder Sprint-Schritt wird wie gewohnt auf `origin/main` committet und gepusht (`git add -A && git commit ... && git push origin main`).

### 2. Wann wird auf das öffentliche Repo (`public`) synchronisiert?
- **Ausschließlich bei stabilen Meilensteinen:**
  - Eine Synchronisation mit `public` erfolgt **nur dann**, wenn ein vollwertiger Versionssprung (z. B. `v0.7.0`, `v0.8.0`, `v0.9.0`, `v1.0.0`) erreicht ist.
  - **Checkliste vor der Veröffentlichung:**
    1. Monorepo Build (`pnpm -r run build`) und LOC-Prüfung (`./scripts/lint-loc.sh`) sind fehlerfrei grün.
    2. Desktop App ist kompiliert, im macOS-Bundle getestet und stabil mit `MixingBuddyDev` signiert.
    3. Alle Änderungen sind im privaten Zweig committet (`git status` ist sauber).
    4. Der User hat die Veröffentlichung im Chat ausdrücklich beauftragt.

### 3. Wie wird veröffentlicht? (Verbindlicher Export-Befehl)
- Es ist **STRIKT VERBOTEN**, jemals einen direkten `git push public ...` aus einem Entwicklungs-Branch auszuführen!
- Die Veröffentlichung erfolgt **ausschließlich** über das automatisierte Release-Skript:
  ```bash
  ./scripts/publish-public-release.sh <VERSION>
  # Beispiel: ./scripts/publish-public-release.sh v0.8.0
  ```
- **Das Skript garantiert:**
  - Erstellung eines sauberen Orphan-Branches ohne alte Commits oder gelöschte Dateien aus Sprint 1–4.
  - Ausschluss aller vertraulichen Verzeichnisse (`docs/chat_history/`, `research-features/`, `.env*`, lokale Logs).
  - Saubere Einbindung aller Produktiv-Assets (Code, `screenshots/`, `README.md`, `LICENSE`).

---

## 🏛️ Die 4 System-Säulen & Architektur-Integrität (CRITICAL)

Das Monorepo ruht strikt auf vier voneinander getrennten Schichten:

1. **Säule 1: Audio-Telemetrie („The Ear“)** (`plugins/meter-audio/`)
   - JUCE 8, C++20, CMake, ITU-R BS.1770-4 / EBU R128 Dual-Gate.
   - Streamt alle 33 ms (30 fps) Frames an Port 48123.
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
   - Exponiert die Kern-Tools (`propose_mix_adjustment`, `execute_mix_adjustment`, etc.).
   - Verwaltet den persistenten Plugin Vault (`~/.mixing-buddy/plugins/`).

---

## 📏 Modulare Code-Hygiene, OOP-Architektur & 3.000 LOC-Regel (CRITICAL)

Die Regel `≤ 3.000 Zeilen Code pro Datei` (`./scripts/lint-loc.sh`) dient **ausschließlich der Lesbarkeit und Modularisierung**.

1. **Absolutes Verbot von Code- und Formatierungs-Quetschen:**
   - Es ist **STRIKT VERBOTEN**, Skripte auszuführen, die Leerzeilen entfernen, Kommentare löschen oder Guards streichen, um krampfhaft unter 3.000 Zeilen zu landen.
2. **Objektorientiertes Splitten statt God-Objects (Single Responsibility Principle):**
   - Sobald eine Datei ca. **2.800–2.900 Zeilen** erreicht, MUSS sie modular in spezialisierte Klassen aufgeteilt werden:
     * In Swift: `LogicAXTransport.swift`, `LogicAXMixer.swift`, `LogicAXPlugins.swift`.
     * In Rust & TypeScript: Saubere Submodule (`mod transport;`, `import { ... }`).
3. **Erhaltungs-Garantie:**
   - Jede funktionierende Funktion, jede Sicherheitsabfrage und jede Fehlerbehandlung bleibt beim modularen Splitten zu 100 % erhalten.

---

## 🧠 GitNexus Code Intelligence & Guardrails (CRITICAL)

Das Projekt ist durch GitNexus indiziert (Container `gitnexus-server` auf Docker Desktop).

1. **Impact-Analyse vor Modifikationen:**
   - Vor der Bearbeitung von geteilten Funktionen:
     `docker exec gitnexus-server gitnexus impact --repo Steinberg-Mixing-Buddy <SymbolName>`
2. **`detect_changes` vor Commits:**
   - Vor jedem Git-Commit prüfen, ob die Diffs exakt den erwarteten Symbolen entsprechen:
     `docker exec gitnexus-server gitnexus detect-changes --repo Steinberg-Mixing-Buddy`
3. **Re-Indizierung nach Meilensteinen:**
   - Nach erfolgreichen Code-Änderungen wird der Graph aktualisiert:
     `docker exec gitnexus-server gitnexus analyze /workspace/Steinberg-Mixing-Buddy`

---

## 🛡️ Acoustic Shock Shield & Gehörschutz-Regeln (CRITICAL)

1. **Asymmetrischer Lautstärke-Schutz (`safety_guard.rs`):**
   - **Pegelreduktion (Delta $\le 0.0$ dB):** Jede Absenkung ist IMMER zulässig und darf niemals beschnitten werden.
   - **Pegelanhebung (Delta $> 0.0$ dB):** Ist auf maximal **+3.0 dB pro Schritt** gedeckelt.
   - **A/B-Restore Garantie:** Die Rückkehr auf den ursprünglichen Ausgangswert vor dem Vorhören (`isRestore: true` bzw. Pegel $\le 0.0$ dB) darf **NIEMALS** blockiert werden.
2. **DAW-Automation-Integrität:**
   - Keine blinden MCU-Fallbacks für Logic Pro, da diese die DAW-Automation ungewollt verstellen.

---

## 🔑 AI-Engine Resilience, Round-Robin & Quota-Management (CRITICAL)

1. **Proaktives Multi-Key Round-Robin:**
   - Jeder ausgehende Request wechselt automatisch auf den nächsten Key im Pool (`(currentIndex + 1) % keys.length`).
   - Jeder Key wird bei maximal 80 % seines Free-Tier-Limits gedeckelt.
2. **Pacing:**
   - Mindestabstand von 1.200 ms zwischen aufeinanderfolgenden API-Calls.
3. **Automatischer 503-Modell-Shift:**
   - Meldet Google einen `503 ServiceUnavailable`, schaltet die Session automatisch auf `gemini-3.5-flash-lite` (oder `gemini-3.5-flash`) um. Legacy-Modelle (2.5) sind verboten.

---

## 🔏 macOS TCC Permission & Permanente Signatur (Mandatory for Desktop Builds)

* **Permanentes Entwickler-Zertifikat:**
  Die Desktop-App MUSS nach jedem Build zwingend mit dem lokalen Zertifikat `MixingBuddyDev` signiert werden, damit macOS TCC-Rechte (Bedienungshilfen) nicht verliert:
  ```bash
  codesign --force --deep -s "MixingBuddyDev" "/Applications/Oszillation Mixing Buddy.app"
  ```
* **Build-Kette:**
  `pnpm --filter desktop tauri build --bundles app --no-sign && rm -rf "/Applications/Oszillation Mixing Buddy.app" && cp -R "target/release/bundle/macos/Oszillation Mixing Buddy.app" /Applications/ && mkdir -p "/Applications/Oszillation Mixing Buddy.app/Contents/Resources" && cp packages/daw-adapters/bin/logic-ax-bridge "/Applications/Oszillation Mixing Buddy.app/Contents/Resources/" && codesign --force --deep -s "MixingBuddyDev" "/Applications/Oszillation Mixing Buddy.app"`

---

## 🚫 Absolutes Verbot von Mocks & Scheindaten (CRITICAL)

1. **Echte Hardware- & DAW-Werte:**
   - Wenn Logic Pro oder Nuendo nicht läuft, liefert das System ein leeres Array (`[]`) oder einen echten Fehler. Niemals Scheindaten simulieren.
2. **Keine Scheinerfolge:**
   - Wenn eine Bridge-Aktion fehlschlägt, darf der IPC-Server nicht stillschweigend `success: true` zurückgeben. Echte Fehler müssen transparent ins HUD gemeldet werden.