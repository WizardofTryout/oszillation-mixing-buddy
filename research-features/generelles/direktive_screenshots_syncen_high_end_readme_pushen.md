# DIREKTIVE: SCREENSHOT-SYNC & HIGH-END SHOWROOM README PUSH

**Status:** Showcase-Veredelung & Release-Synchronisation

**Ziel:** Übertragung der Screenshots in den Ordner `screenshots/` im Root-Verzeichnis, Aktualisierung von `README.md` und sauberer Sync auf das öffentliche Repository `https://github.com/WizardofTryout/oszillation-mixing-buddy`.

## 1. Übersicht der Screenshot-Zuordnung

Wir haben im Quellordner `/Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/screenshots/` folgende Screenshots abgelegt, die im Repository unter standardisierten Namen referenziert werden:

| Quell-Datei (in `screenshots/` oder Projekt-Root) | Neuer Zielname in `screenshots/` | Funktion in der README |
|---|---|---|
| `Bildschirmfoto 2026-10-08 um 02.58.57.png` | `hero_split_screen_logic_buddy.png` | Hero Studio Split-Screen (Logic Pro links, HUD rechts mit ActionCards) |
| `Bildschirmfoto 2026-10-08 um 02.40.09.png` | `hud_session_manager_satellites.png` | Session Manager, Live Mini-Peak-Meters, Fuzzy-Suche |
| `Bildschirmfoto 2026-10-08 um 03.00.01.png` | `plugin_auto_profiler.png` | Automatischer Plugin-Scan (Channel EQ 48 Parameter) |
| `Bildschirmfoto 2026-10-08 um 03.00.10.png` | `plugin_vault_library.png` | Plugin Vault Bibliothek (13 Plugins) |
| `Bildschirmfoto 2026-10-08 um 02.59.33.png` | `mixing_skill_vault.png` | Mixing Skill Vault & Manager (Tonmischmeister v1.0) |
| `Bildschirmfoto 2026-10-08 um 02.59.42.png` | `skill_synthesis_wizard.png` | 5-Schritte KI-Skill Synthese Wizard |
| `Bildschirmfoto 2026-10-08 um 03.00.52.png` | `reasoning_engine_backend.png` | Multi-Provider Engine & 7-Key Pool |
| `Bildschirmfoto 2026-10-08 um 03.01.05.png` | `token_quota_monitor.png` | Live Token- & Quota-Monitor Popover |

## 2. Kopiervorlage für Antigravity

```
============================================================
AUFGABE: SCREENSHOTS IN REPO ÜBERTRAGEN, README AKTUALISIEREN & PUBLIC RELEASE SYNCEN
============================================================

Dateien:
- 'screenshots/' (Verzeichnis im Projekt-Root)
- 'README.md' (Projekt-Root)
- 'scripts/publish-public-release.sh' (Sicherstellen, dass screenshots/ mit exportiert wird)

============================================================
PUNKT 1: SCREENSHOT-DATEIEN IM WORKSPACE STANDARDISIEREN
============================================================
1. Stelle sicher, dass der Ordner 'screenshots' im Root-Verzeichnis existiert:
   mkdir -p screenshots

2. Kopiere und benenne die vorhandenen Screenshots entsprechend der Tabelle um:
   cp "screenshots/Bildschirmfoto 2026-10-08 um 02.58.57.png" screenshots/hero_split_screen_logic_buddy.png 2>/dev/null || true
   cp "screenshots/Bildschirmfoto 2026-10-08 um 02.40.09.png" screenshots/hud_session_manager_satellites.png 2>/dev/null || true
   cp "screenshots/Bildschirmfoto 2026-10-08 um 03.00.01.png" screenshots/plugin_auto_profiler.png 2>/dev/null || true
   cp "screenshots/Bildschirmfoto 2026-10-08 um 03.00.10.png" screenshots/plugin_vault_library.png 2>/dev/null || true
   cp "screenshots/Bildschirmfoto 2026-10-08 um 02.59.33.png" screenshots/mixing_skill_vault.png 2>/dev/null || true
   cp "screenshots/Bildschirmfoto 2026-10-08 um 02.59.42.png" screenshots/skill_synthesis_wizard.png 2>/dev/null || true
   cp "screenshots/Bildschirmfoto 2026-10-08 um 03.00.52.png" screenshots/reasoning_engine_backend.png 2>/dev/null || true
   cp "screenshots/Bildschirmfoto 2026-10-08 um 03.01.05.png" screenshots/token_quota_monitor.png 2>/dev/null || true

3. Entferne unformatierte Roh-Dateinamen mit Umlauten/Leerzeichen aus dem Ordner 'screenshots/', sodass nur noch die sauberen englischen Namen verbleiben.

============================================================
PUNKT 2: RELEASE-SKRIPT AKTUALISIEREN ('scripts/publish-public-release.sh')
============================================================
Datei: 'scripts/publish-public-release.sh'

Stelle sicher, dass in Schritt 6 ('git add ...') der Ordner 'screenshots' explizit mit in das öffentliche Release-Bundle aufgenommen wird:

ALT:
git add apps packages plugins LICENSE README.md package.json pnpm-workspace.yaml pnpm-lock.yaml Cargo.toml Cargo.lock CMakeLists.txt AGENTS.md .gitignore docs/architecture docs/guides 2>/dev/null || true

NEU:
git add apps packages plugins screenshots LICENSE README.md package.json pnpm-workspace.yaml pnpm-lock.yaml Cargo.toml Cargo.lock CMakeLists.txt AGENTS.md .gitignore docs/architecture docs/guides 2>/dev/null || true

============================================================
PUNKT 3: README.MD AKTUALISIEREN
============================================================
Datei: 'README.md'
Aktualisiere die Datei 'README.md' im Projekt-Root mit dem neuen High-End-Showroom-Inhalt (Badges, Hero-Split-Screen, Feature-Deep-Dives, Tabellen-Layouts, Architekturdiagramm, Quickstart).

============================================================
PUNKT 4: COMMIT IM PRIVATEN REPO & SYNCHRONISATION MIT 'public'
============================================================
1. Committe alle Änderungen im privaten Arbeitszweig:
   git add -A && git commit -m "docs: upgrade showroom README with studio screenshots, feature matrices, and sync public release" && git push origin main

2. Führe das Veröffentlichungs-Skript für das öffentliche Showcase-Repo aus:
   ./scripts/publish-public-release.sh v0.7.0

3. Verifiziere das Ergebnis im Browser oder per GitHub CLI / MCP:
   https://github.com/WizardofTryout/oszillation-mixing-buddy
   Bestätige, dass alle Bilder und Badges fehlerfrei gerendert werden!

Melde Vollzug im Chat!
============================================================
```