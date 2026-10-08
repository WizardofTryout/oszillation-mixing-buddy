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
if find . -maxdepth 3 -name ".env*" -not -path "*/node_modules/*" | grep -q ".env"; then
  echo "❌ ACHTUNG: Lokale .env Datei gefunden! Bitte vor dem Export prüfen!"
  exit 1
fi

# 4. Sauberen Orphan-Export-Branch anlegen (Verhindert Leak alter Git-Commits)
echo "📦 Erstelle sauberen Export-Branch: ${RELEASE_BRANCH}..."
git checkout --orphan "${RELEASE_BRANCH}"

# 5. Index vor selektivem Hinzufügen leeren (stellt sicher, dass keine ungewollten Dateien aus main mitgenommen werden)
git rm -rf --cached . 2>/dev/null || true

# 6. Interne Verzeichnisse für das Public Release entfernen (Safety Net)
echo "🧹 Bereinige vertrauliche interne Dokumente..."
git rm -rf --cached docs/chat_history 2>/dev/null || true
git rm -rf --cached docs/internal 2>/dev/null || true
git rm -rf --cached research-features 2>/dev/null || true
git rm -rf --cached .github/workflows/internal* 2>/dev/null || true

# 7. Alle relevanten Produktiv-Dateien dem Release hinzufügen
echo "📦 Sammle Produktiv-Dateien für das Public Release..."
ITEMS_TO_ADD=(
  apps
  packages
  plugins
  LICENSE
  README.md
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  Cargo.toml
  Cargo.lock
  CMakeLists.txt
  AGENTS.md
  .gitignore
  docs
)

for item in "${ITEMS_TO_ADD[@]}"; do
  if [[ -e "$item" ]]; then
    if ! git check-ignore -q "$item"; then
      git add "$item"
    fi
  fi
done

# Nochmals prüfen, ob versehentlich unerwünschte Verzeichnisse gestaged wurden
git rm -rf --cached docs/chat_history docs/internal docs/studio_buddy* research-features .github/workflows/internal* 2>/dev/null || true

# 8. Initialer Release-Commit
COMMIT_MSG="Release ${VERSION}: Oszillation Mixing Buddy (Universal AI Co-Producer)"
git commit -m "${COMMIT_MSG}"

# 9. Push auf das öffentliche Repository (public main)
echo "🚀 Pushe sauberes Release auf ${PUBLIC_REMOTE}/${PUBLIC_BRANCH}..."
git push "${PUBLIC_REMOTE}" "${RELEASE_BRANCH}:${PUBLIC_BRANCH}" --force

# 10. Aufräumen: Zurück zum Entwicklungs-Branch und Export-Branch löschen
git checkout -f "${CURRENT_BRANCH}"
git branch -D "${RELEASE_BRANCH}"

echo "============================================================"
echo "✅ Release ${VERSION} erfolgreich auf ${PUBLIC_REMOTE} veröffentlicht!"
echo "============================================================"
