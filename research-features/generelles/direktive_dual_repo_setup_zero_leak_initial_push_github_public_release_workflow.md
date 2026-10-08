# DIREKTIVE: DUAL-REPO SETUP, ZERO-LEAK INITIAL PUSH & PUBLIC RELEASE WORKFLOW

**Status:** Architektur-Direktive & Release-Standard

**Version:** v0.7.0 (Showcase Release)

**Ziel-Repository:** `https://github.com/WizardofTryout/oszillation-mixing-buddy` (Public)

**Entwicklungs-Repository:** `https://github.com/WizardofTryout/Steinberg-Mixing-Buddy` (Private Upstream)

## 1. Diagnose & Zielsetzung

Wir etablieren die **Dual-Repository-Architektur (Private Upstream / Public Showcase)**:

1. **Privates Repo (`origin`):**

   Hier findet die tägliche Entwicklung statt. Sämtliche internen Chat-Logs, Architektur-Roadmaps, Prompts, unfertigen Patentrecherchen und schnellen Experimente verbleiben dauerhaft hier.

2. **Öffentliches Repo (`public`):**

   Dient als sauberes, professionelles Aushängeschild der Marke **Oszillation Mixing Buddy**.

   * Startet mit einem **frischen, sauberen Commit** (keine geleakten Commits aus frühen Sprint-Tagen).

   * Enthält den vollständigen, lauffähigen Quellcode (Rust, Swift, JUCE, React).

   * Schließt interne Gesprächsprotokolle und sensible Konfigurationsdateien zuverlässig aus.

   * Geschützt durch eine eindeutige Lizenz (**Business Source License 1.1** oder **PolyForm Noncommercial 1.0.0**).

## 2. Das Zero-Leak-Protokoll: Was darf NICHT ins öffentliche Repo?

Vor jedem Push ins öffentliche Repository greift eine strikte Filter-Schranke:

### ❌ Strikt verboten im Public Repo:

* **Secrets & Credentials:** `.env`, `.env.local`, API-Tokens, Passwörter.

* **Interne Dokumentation & Transkripte:** `docs/chat_history/`, interne Sprint-Debatten, rohe Prompt-Brainstormings.

* **Persönliche System-Pfade:** Absolute Pfade mit Klarnamen (`/Users/xyz/...`).

* **Temporäre Entwicklungs-Dateien:** Lokale Test-Logs (`/tmp/*.log`, `mb_desktop.log`).

### ✅ Gehört ins Public Repo:

* **Gesamter Anwendungs-Quellcode:**

  * `apps/desktop/` (Tauri v2 + React HUD)

  * `packages/daw-adapters/` (Swift Mach-O Bridge, Logic-AX, MCU-Protokoll)

  * `packages/ai-engine/` (AgentRunner, Tools, Prompts)

  * `packages/shared-types/` (TypeScript-Typen)

  * `plugins/meter-audio/` (JUCE 8 / C++20 Satellit *The Ear*)

* **Öffentliche Dokumentation:**

  * `docs/architecture/` (Säulen 1–4, Signal-Telemetrie BS.1770-4, IPC-Protokoll)

  * `docs/guides/` (Setup & Quickstart)

* **Projekt-Wurzel:**

  * `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `Cargo.toml`, `CMakeLists.txt`

  * `README.md` (Öffentliche High-End Präsentation)

  * `LICENSE` (BSL 1.1 / PolyForm Noncommercial)

## 3. Zukünftiger Arbeitsablauf (Regeln für Antigravity & Entwickler)

1. **Tägliche Arbeit:**

   * Antigravity und du arbeitet wie bisher **zu 100 % im privaten Workspace**.

   * Commits und Zwischensprints gehen ganz normal via `git push origin main` in das private Repository.

2. Release-Synchronisation (z. B. v0.7.0, **v0.8.0):**

   * Nur wenn ein stabiler Meilenstein erreicht ist, führt Antigravity das Release-Skript aus:

     ```
     ./scripts/publish-public-release.sh v0.7.0
     
     ```

   * Das Skript baut einen sauberen Release-Stand ohne interne Notizen und synchronisiert diesen kontrolliert mit `public/main`.

3. **GitHub MCP Tools:**

   * Antigravity kann MCP-Tools zur Verifikation des Repository-Zustands, Issue-Trackings oder Release-Tag-Erstellung auf beiden Repositories einsetzen.

## 4. Kopiervorlage für Antigravity

````
============================================================
AUFGABE: DUAL-REPO SETUP, RELEASE-SKRIPT & INITIAL PUSH v0.7.0
============================================================

Dateien:
- 'scripts/publish-public-release.sh' (Neu erstellen)
- 'LICENSE' (Neu erstellen: PolyForm Noncommercial 1.0.0 oder BSL 1.1)
- '.gitignore' (Überprüfen und absichern)

Ziel:
Einrichtung des zweiten Remotes 'public' (https://github.com/WizardofTryout/oszillation-mixing-buddy.git)
und Durchführung des ersten, sauberen Release-Pushes für v0.7.0 ohne Leak von internen Chat-Logs oder Secrets.

============================================================
PUNKT 1: REMOTE 'public' HINZUFÜGEN & VERIFIZIEREN
============================================================
1. Prüfe bestehende Remotes:
   git remote -v

2. Füge das neue öffentliche Repository als Remote 'public' hinzu (falls noch nicht vorhanden):
   git remote add public https://github.com/WizardofTryout/oszillation-mixing-buddy.git || true

3. Bestätige die Konfiguration:
   git remote -v
   # origin -> https://github.com/WizardofTryout/Steinberg-Mixing-Buddy.git (Privat)
   # public -> https://github.com/WizardofTryout/oszillation-mixing-buddy.git (Öffentlich)

============================================================
PUNKT 2: LIZENZ-DATEI ERSTELLEN ('LICENSE')
============================================================
Erstelle im Projekt-Root die Datei 'LICENSE' mit der PolyForm Noncommercial License 1.0.0
(Schützt 100 % vor gewerblicher Ausbeutung, erlaubt aber Evaluation und Code-Beiträge):

```text
PolyForm Noncommercial License 1.0.0
<https://polyformproject.org/licenses/noncommercial/1.0.0>

Copyright 2026 WizardofTryout / Oszillation Studio

Permission is hereby granted to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software
without restriction, including without limitation the rights to use, copy,
modify, merge, publish, and distribute the Software, subject to the following
condition:

You may not use the Software for Commercial Purposes.

"Commercial Purposes" means any use of the Software by a for-profit entity,
or any use designed or intended to generate revenue, profit, or commercial
advantage, whether direct or indirect.

Evaluation and Noncommercial research or personal projects are permitted.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

````

# ============================================================ PUNKT 3: DAS AUTOMATISIERTE RELEASE-SYNC-SKRIPT ('scripts/publish-public-release.sh')

Erstelle die ausführbare Datei 'scripts/publish-public-release.sh':

```
#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-v0.7.0}"
PUBLIC_REMOTE="public"
PUBLIC_BRANCH="main"
RELEASE_BRANCH="release/public-export-${VERSION}"

echo "============================================================"
echo "🚀 Vorbereitung Public Release: ${VERSION}"
echo "============================================================"

# 1. Sicherstellen, dass der Workspace sauber ist
if [[ -n $(git status --porcelain) ]]; then
  echo "❌ Fehler: Uncommitted Changes im Workspace. Bitte vorher committen!"
  exit 1
fi

# 2. Aktuellen Branch merken
CURRENT_BRANCH=$(git branch --show-current)

# 3. Sicherheits-Check auf Secrets vor dem Export
echo "🔍 Prüfe Workspace auf versehentliche .env Dateien..."
if find . -maxdepth 3 -name ".env" -not -path "*/node_modules/*" | grep -q ".env"; then
  echo "❌ ACHTUNG: Lokale .env Datei gefunden! Bitte vor dem Export prüfen!"
  exit 1
fi

# 4. Sauberen Orphan-Export-Branch anlegen (Verhindert Leak alter Git-Commits)
echo "📦 Erstelle sauberen Export-Branch: ${RELEASE_BRANCH}..."
git checkout --orphan "${RELEASE_BRANCH}"

# 5. Interne Verzeichnisse für das Public Release entfernen
echo "🧹 Bereinige vertrauliche interne Dokumente..."
git rm -rf --cached docs/chat_history 2>/dev/null || true
git rm -rf --cached docs/internal 2>/dev/null || true
git rm -rf --cached .github/workflows/internal* 2>/dev/null || true

# 6. Alle relevanten Produktiv-Dateien dem Release hinzufügen
git add apps packages plugins LICENSE README.md package.json pnpm-workspace.yaml pnpm-lock.yaml Cargo.toml Cargo.lock CMakeLists.txt AGENTS.md .gitignore docs/architecture docs/guides 2>/dev/null || true

# 7. Initialer Release-Commit
COMMIT_MSG="Release ${VERSION}: Oszillation Mixing Buddy (Universal AI Co-Producer)"
git commit -m "${COMMIT_MSG}"

# 8. Push auf das öffentliche Repository (public main)
echo "🚀 Pushe sauberes Release auf ${PUBLIC_REMOTE}/${PUBLIC_BRANCH}..."
git push "${PUBLIC_REMOTE}" "${RELEASE_BRANCH}:${PUBLIC_BRANCH}" --force

# 9. Aufräumen: Zurück zum Entwicklungs-Branch und Export-Branch löschen
git checkout "${CURRENT_BRANCH}"
git branch -D "${RELEASE_BRANCH}"

echo "============================================================"
echo "✅ Release ${VERSION} erfolgreich auf ${PUBLIC_REMOTE} veröffentlicht!"
echo "============================================================"

```

Mache das Skript ausführbar: chmod +x scripts/publish-public-release.sh

# ============================================================ PUNKT 4: VERIFIKATION, DRY-RUN & INITIAL PUSH

1. Überprüfe die Remote-URL: git remote get-url public

   # Muss exakt 'https://github.com/WizardofTryout/oszillation-mixing-buddy.git' sein!

2. Führe den initialen Export durch: ./scripts/publish-public-release.sh v0.7.0

3. Verifiziere das Ergebnis im Browser oder per GitHub CLI / MCP:

   * Öffne https://github.com/WizardofTryout/oszillation-mixing-buddy

   * Bestätige:

     * Der Code ist auf