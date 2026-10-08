# DIREKTIVE: DUAL-REPO GOVERNANCE & RELEASE-WORKFLOW IN AGENTS.MD VERANKERN

**Status:** Verbindliche Systemrichtlinie für alle zukünftigen Meilensteine

**Ziel:** Dauerhafte Verankerung der Regeln für das private Arbeits-Repository (`origin`) und das öffentliche Release-Repository (`public`) in `AGENTS.md`.

## Kopiervorlage für Antigravity

```
============================================================
AUFGABE: 'AGENTS.MD' AKTUALISIEREN – DUAL-REPO GOVERNANCE VERANKERN
============================================================

Dateien:
- 'AGENTS.md' (Projekt-Root)

Ziel:
Verankere den neuen Abschnitt "DUAL-REPOSITORY GOVERNANCE & PUBLIC RELEASE WORKFLOW (CRITICAL)"
verbindlich in der Arbeitsordnung von 'AGENTS.md', damit ab sofort für jeden Agenten glasklar ist:
1. Wo die tägliche Entwicklung committet wird (origin/main).
2. Wann ein Public Release synchronisiert wird (nur bei Meilensteinen).
3. Wie das Public Release ausgeführt werden darf (ausschließlich via ./scripts/publish-public-release.sh).

============================================================
SCHRITT 1: 'AGENTS.MD' AKTUALISIEREN
============================================================
Aktualisiere 'AGENTS.md' mit dem vollständigen, erweiterten Inhalt inklusive
des neuen Abschnitts "🌐 DUAL-REPOSITORY GOVERNANCE & PUBLIC RELEASE WORKFLOW (CRITICAL)".

============================================================
SCHRITT 2: GIT COMMIT & PUSH IM PRIVATEN REPO
============================================================
1. Committe die aktualisierte Richtlinie im privaten Workspace:
   git add AGENTS.md && git commit -m "docs(agents): integrate dual-repository governance and public release protocol" && git push origin main

2. GitNexus Wissensgraph aktualisieren:
   docker exec gitnexus-server gitnexus analyze /workspace/Steinberg-Mixing-Buddy 2>/dev/null || true

Melde Vollzug im Chat!
============================================================
```