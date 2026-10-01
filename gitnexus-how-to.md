# GitNexus How-To & Prompt-Beispiele

Dieses Dokument beschreibt, wie wir GitNexus in Antigravity nutzen, um Projekte, Strukturen und Entwicklungen zu analysieren und zu optimieren.

---

## 🚀 Grundlegende Docker-Befehle

### 1. Starten / Stoppen der Umgebung
Die Umgebung ist so konfiguriert, dass sie bei Bedarf gestoppt werden kann, um Systemressourcen zu sparen:

- **Umgebung stoppen:**
  ```bash
  docker compose -f /Volumes/Spacestation/MCP/Antigravity-MCP-tools/gitnexus/docker-compose.yaml stop
  ```
- **Umgebung starten:**
  ```bash
  docker compose -f /Volumes/Spacestation/MCP/Antigravity-MCP-tools/gitnexus/docker-compose.yaml start
  ```

### 2. Projekt indizieren
Um ein Projekt, das im Workspace-Ordner liegt, für GitNexus zu analysieren und zu indizieren:
```bash
docker exec -it gitnexus-server gitnexus analyze /workspace/<projekt-ordner-name>
```

- **Erzwungener vollständiger Rebuild:**
  ```bash
  docker exec -it gitnexus-server gitnexus analyze /workspace/<projekt-ordner-name> --force
  ```
- **FTS-Suchindex reparieren (schnell):**
  ```bash
  docker exec -it gitnexus-server gitnexus analyze /workspace/<projekt-ordner-name> --repair-fts
  ```

---

## 💬 Prompt-Beispiele für Antigravity

Da GitNexus als MCP-Server direkt in Antigravity integriert ist, kannst du mich (oder andere KI-Assistenten) direkt im Chat bitten, GitNexus-Tools zu nutzen. Hier sind einige typische Prompt-Vorlagen:

### 1. Auswirkungsanalyse (Blast Radius) vor Refactorings
Verwende dies, um zu prüfen, was bricht, wenn du eine Methode oder Klasse änderst:
> *"Führe eine Auswirkungsanalyse (impact analysis) für das Symbol `UserService.deleteUser` im Repository `mein-projekt` durch. Welche Upstream-Klassen oder Funktionen hängen davon ab?"*

### 2. Code-Pfade und Call-Chains zurückverfolgen
Verwende dies, um zu verstehen, wie zwei weit voneinander entfernte Teile des Codes miteinander kommunizieren:
> *"Zeige mir die kürzeste Aufrufkette (`trace`) zwischen der API-Route `POST /api/checkout` und der Methode `PaymentService.charge` im Repository `mein-projekt`."*

### 3. Kontextsuche & Verzeichnisse verstehen
Verwende dies für eine 360-Grad-Ansicht eines bestimmten Moduls oder Symbols:
> *"Nutze das GitNexus-Tool `context` für `OrderController` im Repository `mein-projekt` und gib mir eine Übersicht über alle eingehenden Referenzen und die beteiligten Prozesse."*

### 4. Änderungen prüfen (Vor dem Commit)
Verwende dies, um deine uncommitteten Änderungen auf Risiken zu prüfen:
> *"Prüfe meine aktuellen Änderungen (`detect_changes`) im Repository `mein-projekt`. Welche Prozesse und Systembereiche sind von diesem Diff betroffen?"*

---

## 🌐 Web-UI & Visualisierung
Die visuelle Benutzeroberfläche von GitNexus steht dir ebenfalls im Browser zur Verfügung:
- **URL:** [http://localhost:4173](http://localhost:4173)
- Hier kannst du die indizierten Repositories grafisch als interaktives Netzwerk/Graph erkunden, Abhängigkeiten filtern und direkt mit der Codebase chatten.
