# AGENTS.md — System- & Architektur-Richtlinien

### 🛑 NON-NEGOTIABLE LAW: ZERO-REGRESSION & CODE PRESERVATION

1. ABSOLUTES VERBOT VON SILENT STRIPPING & "KREATIVEN" REFAKTORISIERUNGEN:
   - Verändere NIEMALS bestehenden, funktionierenden Code in Nachbarfunktionen,
     wenn dies nicht explizit in der Aufgabenstellung gefordert wurde.
   - Entferne, vereinfache oder "optimiere" NIEMALS bestehende Sicherheitsprüfungen,
     UI-Attribut-Scans oder Puffer-Zeiten.

2. PHYSICAL GROUND-TRUTH VOR IN-MEMORY FLAGS:
   - Ersetze NIEMALS physische UI- und Betriebssystem-Prüfungen
     (wie das Abfragen von `AXCheckBox.value == 1` oder macOS-Fenstern)
     durch In-Memory-Variablen (wie `is_cycle_active.load()`), da In-Memory-Status
     beim App-Start uninitialisiert oder desynchronisiert sein können.
   - Wenn eine physische Prüfung in Swift oder Rust bereits funktionierte,
     ist sie GESCHÜTZT und darf NICHT durch naive Abkürzungen ersetzt werden!

3. MINIMALER DIFF & SCOPE-ISOLATION:
   - Jede Code-Änderung darf AUSSCHLIESSLICH den in der Direktive definierten Scope betreffen.
   - Vor jedem Speichern einer Datei muss der Diff (`git diff`) eigenständig geprüft werden:
     * Wurden Funktionen gelöscht oder verkürzt?
     * Wurden Guard-Bedingungen aufgeweicht?
     * Falls JA: Änderung sofort rückgängig machen!

4. PFLICHT ZUR REGRESSIONS-VERIFIKATION VOR DEM COMMIT:
   - Bevor ein Commit abgesetzt wird, MÜSSEN die bisherigen Basisfunktionen
     funktionieren:
     a) `transport-locate` & `cycle-off` müssen den Cycle physisch ausschalten.
     b) `list-channel-strips` muss echte Spuren liefern (kein 0-Spuren-Bruch).
     c) Build & LOC-Check (≤ 3000 Zeilen) müssen grün sein.

5. VERSTOSS-FOLGE (ROLLBACK-PFLICHT):
   - Wenn ein Commit eine zuvor bestandene Funktion beschädigt,
     muss der fehlerhafte Commit isoliert und die funktionierende Logik
     wiederhergestellt werden, statt neue Hilfsschichten darüber zu legen.

---

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Steinberg-Mixing-Buddy** (2484 symbols, 5130 relationships, 213 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
