# ARCHITEKTUR- & EVALUIERUNGS-ANALYSE: MEM0 VS. NATIVES GEDÄCHTNISSYSTEM (STUDIO MEMORY VAULT)

**Gegenstand:** Evaluierung von `mem0ai/mem0` als Speicher- und Kontextschicht für *Oszillation Mixing Buddy*.

**Fragestellung:** Macht der Einsatz von Mem0 (Python-Dienst / PostgreSQL + pgvector) für unser Projekt Sinn, oder ist eine native, schlanke Eigenentwicklung in Rust und TypeScript für den Tonstudiobetrieb überlegen?

---

## 1. Executive Summary: Das Urteil auf einen Blick

> **Ergebnis:** Das Konzept eines 3-Ebenen-Gedächtnisses (User, Session, Agent) ist genau das, was Oszillation Mixing Buddy jetzt braucht. **Mem0 als externe Softwarebibliothek oder Server-Dienst ist für unser Projekt jedoch architektonisch die falsche Wahl.**
>
> **Die Gründe:**
> 1. **Derselbe Showstopper wie bei OpenViking:** Mem0 erfordert eine Python-Laufzeitumgebung und eine externe Vektordatenbank (PostgreSQL mit `pgvector`, Qdrant etc.). Ein Musikproduzent akzeptiert während einer 96-kHz-Session im Studio keine Hintergrunddienste, die Gigabytes an RAM belegen und CPU-Interrupts verursachen.
> 2. **Semantische Vektorsuche ist ungeeignet für physikalische Parameter:** Wenn der Nutzer fragt *„Was haben wir vorhin an der Snare gemacht?“*, darf die KI nicht raten oder nach semantischer Textähnlichkeit suchen. Sie benötigt einen **deterministischen, exakten Zahlen- und Aktionsverlauf** (Parameter-Snapshot: Vorher, Nachher, Zeitstempel, Status).
> 3. **Die ideale Lösung:** Wir bauen die 3-Ebenen-Idee **nativ von Grund auf in unserem bestehenden Stack (Rust/SQLite & TypeScript)** nach: Zero-Dependencies, $< 0.1\text{ ms}$ Latenz, keine externen Server und 100 % passgenau für Audio-Sessions.

---

## 2. Warum das Problem aktuell auftritt (Diagnose)

Dass der Mixing Buddy aktuell Werte und Chat-Kontexte vergisst, hat zwei konkrete Ursachen in unserer bisherigen Architektur:

1. **Die strikte Token-Diät (Single-Pass Tool-Lock):**
   Um API-Kosten zu minimieren und Google-Rate-Limits (429/503) zu verhindern, haben wir den Session-Kontext bisher extrem aggressiv beschnitten (`compactStrips`). Wir haben dem Modell bisher **nur die aktuelle Sekunde** übergeben, aber keinen Verlauf der vorherigen Dialogrunden.
2. **Fehlendes Aktions-Journal im UI-State:**
   Zwar speichert die `ActionCard.tsx` temporär den `historyStack` für den Undo-Button, aber dieser Verlauf existiert nur flüchtig im Frontend-RAM. Er wird nicht als strukturierte Historie in den Prompt-Kontext zurückgeführt. Die KI weiß schlicht nicht, was vor zwei Minuten angewendet oder verworfen wurde.

---

## 3. Direkter Systemvergleich: Mem0 vs. Nativer Studio-Memory-Vault

| Kriterium | Mem0 (`mem0ai/mem0`) | Nativer Studio Memory Vault (Empfehlung) | Bewertung für OMB |
| :--- | :--- | :--- | :--- |
| **Technologie-Stack** | Python $\ge 3.10$, PostgreSQL / `pgvector` oder Cloud-API. | Rust (Tauri v2 / SQLite / JSON) + TypeScript. | **Nativ schlägt Python um Längen ⚡** |
| **Laufzeit-Overhead** | Mehrere Hintergrund-Prozesse, DB-Server, Port-Konflikte. | **Zero Dependencies:** Eine lokale Datei auf der Festplatte (`~/.mixing-buddy/memory.db`). | **OMB bleibt leichtgewichtig 🚀** |
| **Abfrage-Präzision** | Semantische Ähnlichkeit (Vektorsuche / Embeddings). Fuzzy und fehlertolerant, aber ungenau bei Zahlen. | **Deterministisches Journal:** Exakte Filterung nach Spur, Parameter, Delta und Zeitstempel. | **Exakte Ground-Truth 🎯** |
| **Kosten & Tokens** | Extra LLM-Calls für Fakten-Extraktion und Embedding-Generierung. | Lokale Auswertung in Rust/TS (0 zusätzliche API-Tokens). | **Spart massiv Token-Budget 💰** |
| **Audio-Stabilität** | Risiko von Puffer-Dropouts bei DB-Schreibvorgängen während Audio-Playback. | Asynchrones, blockierungsfreies Logging im Hintergrund ($< 1\text{ ms}$). | **Studiotauglich & Audio-Safe 🛡️** |

---

## 4. Die 3 Säulen unseres nativen Studio-Gedächtnisses

Statt Mem0 zu installieren, implementieren wir die drei Gedächtnisebenen direkt in unserer Architektur:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     OSZILLATION STUDIO MEMORY ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [ EBENE 1: SESSION ACTION & PARAMETER JOURNAL ] (Ground Truth)                │
│   • Speichert jede vorgeschlagene, angewendete oder zurückgenommene Aktion.     │
│   • Struktur: Track, Parameter, OldValue, NewValue, Timestamp, Status.          │
│   • Ermöglicht: "Kannst du das wiederherstellen?", "Was war vorhin eingestellt?"│
│                                                                                 │
│  [ EBENE 2: ROLLING DIALOGUE WORKING MEMORY ] (Kurzzeitgedächtnis)              │
│   • Hält die letzten 3–4 Dialogrunden (User-Befehl + kurze KI-Antwort).         │
│   • Ältere Dialoge werden nach 5 Runden in einen 2-Zeilen-Summary kondensiert.  │
│   • Token-schonend: Max. 400 Tokens Zusatzlast im Prompt.                       │
│                                                                                 │
│  [ EBENE 3: PERSISTENT USER & PROJECT VAULT ] (Langzeitgedächtnis)              │
│   • Gespeichert unter ~/.mixing-buddy/projects/<project_id>/memory.json         │
│   • Lernt dauerhaft: Track-Scopes (learnedTrackScopes), bevorzugte Target-LUFS, │
│     Klangästhetik des Produzenten, Plugin-Präferenzen.                          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Ebene 1: Das Action-Journal (Physikalische Ground Truth)
Jede Aktion im HUD wird in einer strukturierten Liste protokolliert:
```json
[
  {
    "id": "act_101",
    "timestamp": 1728345600,
    "track": "Studio Grand",
    "parameter": "Channel EQ > peak_2_gain",
    "oldValue": 0.0,
    "newValue": -1.5,
    "unit": "dB",
    "status": "applied",
    "rationale": "Resonanz bei 350 Hz bedämpft"
  }
]
```
Wenn der Nutzer schreibt: *„Stelle das Klavier wieder so ein wie am Anfang“*, liest der Agent aus diesem Journal sofort `oldValue: 0.0` und erzeugt die passende Wiederherstellungs-Karte – ganz ohne Vektordatenbank!

### Ebene 2: Das rollierende Dialog-Gedächtnis
Statt jedes Mal bei null anzufangen, übergeben wir im Turn 1:
- Die letzten 2–3 Turns als kompaktes Snippet:
  ```
  PREVIOUS_SESSION_CONTEXT:
  - Turn 1: User requested Kick & Bass clean-up. Applied -1.5 dB EQ cut on Motown Revisited Kit.
  - Turn 2: User asked if vocal sits well. Recommended 2.5 kHz boost.
  ```
Damit versteht die KI Bezüge wie: *„Das haben wir doch eben schon gemacht“* oder *„Mach das Gleiche noch auf der zweiten Gitarre“*.

### Ebene 3: Der persistente Vault
Wir erweitern unser bestehendes Spuren-Gedächtnis (`learnedTrackScopes`) um projektspezifische Metadaten, die auf der Festplatte in `~/.mixing-buddy/` liegen.

---

## 5. Strategische Empfehlung & Konkreter Fahrplan

1. **Kein externes Mem0 einbinden:**
   Keine Python-Server, kein PostgreSQL, keine Cloud-Abhängigkeiten. Das schützt unser System vor Lizenzproblemen, Software-Ballast und Audio-Dropouts.

2. **Natives Gedächtnis von Antigravity umsetzen lassen:**
   Wir lassen Antigravity ein schlankes, dreiteiliges Speichermodul (`SessionMemoryManager.ts` & Rust-Persistierung) bauen:
   - **Schritt 1:** Protokollierung aller ActionCard-Events (Apply, Undo, Audition) in einem `actionJournal`.
   - **Schritt 2:** Einbindung eines kompakten `sessionHistorySummary`-Blocks in den System-Prompt (`prompts.ts`).
   - **Schritt 3:** Bereitstellung des Befehls `restore_previous_action` für die KI, um frühere Werte auf Wunsch direkt wiederherzustellen.

3. **Ergebnis:**
   Ein blitzschnelles, deterministisches Studio-Gedächtnis, das exakte Dezibel-Werte erinnert, Chat-Bezüge versteht und das Token-Budget schont!