# Strategiepapier: Vollständige Session- & Routing-Autonomie in Logic Pro (Phase 3)

**Titel:** The Master Engineer — Vom Parameter-Regler zum vollautonomen Studio-Assistenten  
**Referenz-Analyse:** Studio Buddy Trailer & Workflow-Dekonstruktion (Screenshots 1–4)  
**Ziel:** 100 % Autonomie in Apple Logic Pro (Ordner aufklappen, Plugins aus Menüs laden, Bus-Routing, Sidechaining & Transport-Audits)

---

## 1. Executive Summary & Screenshot-Dekonstruktion

Deine Screenshots liefern den unumstößlichen Beweis für den Workflow, der Studio Buddy so mächtig wirken lässt. Schauen wir uns die vier Screenshots chronologisch an:

### Screenshot 1 (Bild 13.15.44): Die autonome Tool-Chain im Chat
Der Musiker tippt lediglich:
> *„The snare sounds too harsh, too snappy, why?“*

Rechts im Chatfenster sieht man, welche Werkzeuge das System nacheinander autonom ausführt:
1. `Set Folder Expanded: Drums` $\rightarrow$ Die Drum-Gruppe (Track Stack) im Arrangement wird automatisch aufgeklappt.
2. `List Tracks` $\rightarrow$ Das System liest die Unterspuren aus (`Snare 1`, `Snare 2`, `Kick 1`, etc.).
3. `Get Arrangement` $\rightarrow$ Ermittelt Taktpositionen (Takt 21 bis 29).
4. `Listen to Playback full mix · 8s` $\rightarrow$ Setzt den Cycle-Bereich auf Takt 21–29, startet die Wiedergabe für exakt 8 Sekunden und misst den Mix.
5. `Get Track Details` $\rightarrow$ Selektiert `Snare 2` und analysiert den linken Inspector.

### Screenshots 2 & 3 (Bild 13.14.20 & 13.13.18): Dynamisches Plugin-Laden aus Menüs
Das ist der entscheidende visuelle Beweis:
- Studio Buddy verstellt nicht nur bereits geladene Plugins, sondern **klickt auf einen leeren Audio-FX-Slot**.
- Es öffnet sich das native macOS-Kontextmenü (`AXMenu`) von Logic Pro:
  `No Plug-in`, `Recent`, `Studio Buddy`, `Channel EQ`, `Compressor`, `Amps and Pedals`, `Audio Units > ...`
- Das System navigiert durch dieses Menü, wählt z. B. den `Channel EQ` oder `Compressor` aus und **lädt das Plugin selbstständig in die Spur**.

### Screenshot 4 (Bild 13.12.19): Satellit auf Einzelspuren
Auf der Zielspur `Snare 1` öffnet sich das Plugin-Fenster mit dem Status `Connected`.

---

## 2. Die 5 fehlenden „Griffe“, die wir den Händen beibringen

Damit unser *Oszillation Mixing Buddy* genau diesen Workflow meistert, rüsten wir die native Swift-Bridge (`logic-ax-bridge`) und den MCP-Server um folgende 5 Fähigkeiten auf:

```
┌────────────────────────────────────────────────────────────────────────┐
│               DIE 5 NEUEN HANDGRIFFE FÜR APPLE LOGIC PRO               │
└────────────────────────────────────────────────────────────────────────┘

1. TRANSPORT & CYCLE-AUDITS (Wiedergabe & Takte)
   • Cycle-Bereich auf Takt X bis Y setzen (z. B. Takt 21–29 Chorus)
   • Playback starten, 8 Sekunden Audio messen, Playback stoppen
   • Solo-Sweep: Einzelspur für 3s isolieren, dann im Kontext hören

2. TRACK-AUSWAHL & FOLDER EXPANSION (Arranger & Inspector)
   • Track Stacks / Ordner per UI auf- und zuklappen (Drums ▼)
   • Zielspur im Arrangement anklicken -> Inspector links schaltet um

3. DYNAMISCHES PLUGIN-LADEN (Audio FX Slot-Menü)
   • Klick auf freien Audio-FX-Slot -> AXMenu öffnet sich
   • Pfad auswählen: z. B. [EQ -> Channel EQ] oder [Dynamics -> Compressor]
   • Plugin wird in Sekundenschnelle geladen und steht sofort bereit

4. BUS-ROUTING & SUBMIXE (Sends & Aux-Wege)
   • Klick auf "Sends"-Slot -> Menü "Bus" -> "Bus 1 (Drums)"
   • Aux-Kanal erzeugen oder Fader der Subgruppe auspegeln

5. SIDECHAIN-SCHLEIFEN (Ducking & Freistellung)
   • Kompressor auf Zielspur öffnen (z. B. Bass)
   • Dropdown "Sidechain" im Plugin-Header öffnen -> Audio 1 (Kick) zuweisen
   • Threshold & Ratio für rhythmisches Ducking justieren
```

---

## 3. Architektur-Übersicht: Wie die Komponenten zusammenspielen

```
               [ BENUTZER PROMPT IM HUD / CHAT ]
             „Die Snare beißt im Chorus und die Kick
              maskiert den Basslauf. Bitte beheben.“
                               │
                               ▼
               [ THE BRAIN: AI-ENGINE & MCP ]
             Erkennt: Benötigt Chorus-Abhörung,
             EQ auf Snare 2 und Sidechain auf Bass.
                               │
       ┌───────────────────────┼───────────────────────┐
       ▼                       ▼                       ▼
 [ 1. TRANSPORT ]        [ 2. TRACK & SLOT ]     [ 3. ROUTING & PARAMS ]
 • mcp__audition_region  • mcp__select_track     • mcp__load_plugin
 • Play Takt 21..29      • mcp__set_folder_state • mcp__route_sidechain
 • 8s Live-Messung       • Inspector fokussiert  • set-param via Swift
       │                       │                       │
       └───────────────────────┼───────────────────────┘
                               │
                               ▼
             [ DIE HÄNDE: NATIVE SWIFT-BRIDGE ]
         AXUIElement C-API • CoreMIDI Virtual Port
                               │
                               ▼
                     [ APPLE LOGIC PRO ]
```

---

## 4. Phasen-Roadmap (Übersicht)

- **Sprint 6:** Transport-Automation & 8-Sekunden Audition-Loop (Wiedergabe, Takt-Marker, Solo-Audit).
- **Sprint 7:** Arranger-Navigation, Spur-Fokus & Folder-Expansion (Track Stacks auf-/zuklappen).
- **Sprint 8:** Dynamisches Laden von Plugins via Logic-Kontextmenüs (`AXMenu` / Audio FX).
- **Sprint 9:** Bus-Sends, Submixe & Aux-Kanal-Verdrahtung.
- **Sprint 10:** Sidechain-Routing & Ducking-Automationen (Kick $\rightarrow$ Bass, Vocals $\rightarrow$ Reverb).