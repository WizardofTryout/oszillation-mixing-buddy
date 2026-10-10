# Code Review Graph (CRG) – How-To & Integration in Steinberg-Mixing-Buddy

Dieses Dokument beschreibt, wie **Code Review Graph** als zweites Code-Intelligence-System neben **GitNexus** im Projekt *Oszillation Mixing Buddy* eingesetzt wird.

---

## 🌟 Synergie: GitNexus vs. Code Review Graph

| Eigenschaft | GitNexus | Code Review Graph |
| :--- | :--- | :--- |
| **Primärer Fokus** | Deep Call-Chains & Tracing | Architektur-Communities & Review-Kontext |
| **Visualisierung** | Interaktives Web-UI (:4173) | Markdown-Wikis & HTML-Graphen |
| **Kontext-Effizienz** | Symbol-Kontext (`context`) | `get_review_context_tool` (spart bis zu 98 % Kontext-Tokens) |
| **Architektur-Analyse** | Cluster & Ausführungspfade | Community-Cohesion & Cross-Community Kopplungswarnungen |
| **Status im Projekt** | Bereits integriert | Frisch indiziert (1.035 Nodes, 12.756 Edges, 14 Communities) |

---

## 🚀 Status im Projekt

- **Graph-Datenbank:** [`.code-review-graph/graph.db`](file:///Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/.code-review-graph/graph.db) (SQLite, versioniert & durch Git-Ignore geschützt)
- **Erfasste Sprachen:** Bash, C++, JavaScript, Rust, Swift, TSX, TypeScript
- **Knoten:** 1.035 (Dateien, Klassen, Funktionen, Tests)
- **Kanten:** 12.756 (Calls, Imports, References, Tested-by, Inherits)
- **Erkannte Communities:**
  - `src-skill` (Rust Backend & Tauri-Bridge)
  - `logic-plugin` (TypeScript Logic Pro Plugin)
  - `source-process` (C++ Audio & Process Engine)
  - `components-handle` (React / TSX UI Handles & Knobs)
  - `providers-agent` (TypeScript AI Integration)
  - `nuendo-track` (TypeScript Nuendo / Cubase Integration)

---

## 🛠️ CLI-Befehle (Docker)

Falls der Graph manuell oder in CI-Skripten aktualisiert werden soll:

### 1. Inkrementelles Update (nur geänderte Dateien)
```bash
docker run --rm \
  -v /Volumes/Spacestation/MCP/Antigravity-MCP-tools:/Volumes/Spacestation/MCP/Antigravity-MCP-tools \
  -w /Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy \
  code-review-graph-server:latest update
```

### 2. Vollständiger Rebuild
```bash
docker run --rm \
  -v /Volumes/Spacestation/MCP/Antigravity-MCP-tools:/Volumes/Spacestation/MCP/Antigravity-MCP-tools \
  -w /Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy \
  code-review-graph-server:latest build
```

### 3. Status & Graph-Statistiken prüfen
```bash
docker run --rm \
  -v /Volumes/Spacestation/MCP/Antigravity-MCP-tools:/Volumes/Spacestation/MCP/Antigravity-MCP-tools \
  -w /Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy \
  code-review-graph-server:latest status
```

### 4. Interaktive HTML-Visualisierung generieren
```bash
docker run --rm \
  -v /Volumes/Spacestation/MCP/Antigravity-MCP-tools:/Volumes/Spacestation/MCP/Antigravity-MCP-tools \
  -w /Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy \
  code-review-graph-server:latest visualize
```

---

## 💬 Prompts für Antigravity-Agenten

Da der MCP-Server `code-review-graph` in Antigravity integriert ist, kannst du den Agenten mit folgenden Prompts direkt anweisen:

### 1. Vor Refactorings oder Änderungen: Blast-Radius & Risikoprüfung
> *"Prüfe mit dem Code Review Graph Tool `get_impact_radius_tool` die Auswirkungen, wenn wir die Methode `connect_daw` in `Steinberg-Mixing-Buddy` anpassen. Welche Communities und Upstream-Knoten sind betroffen?"*

### 2. Vor dem Review oder Commit: Minimalen Review-Kontext abrufen
> *"Nutze das Code Review Graph Tool `get_review_context_tool` für meine letzten Änderungen in `Steinberg-Mixing-Buddy`. Zeige mir die betroffenen Nodes, Risiken und Quellcode-Ausschnitte token-effizient an."*

### 3. Architektur & Community-Kopplung untersuchen
> *"Führe mit `get_architecture_overview_tool` eine Architekturanalyse für `Steinberg-Mixing-Buddy` durch. Welche Communities weisen eine ungesund hohe Kopplung (High Coupling Warnings) auf?"*

### 4. Nach Feature-Abschluss: Graph aktualisieren
> *"Aktualisiere den Code Review Graph für `Steinberg-Mixing-Buddy` mit `build_or_update_graph_tool` (oder führe `code-review-graph update` im Docker-Container aus)."*
