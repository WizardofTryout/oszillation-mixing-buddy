# DIREKTIVE: MULTI-DAW ERGÄNZUNGEN IN DOKUMENTATION.MD EINPFLEGEN

````
============================================================
AUFGABE: MULTI-DAW ARCHITEKTUR-DELTA IN DOKUMENTATION.MD EINPFLEGEN
============================================================

Bevor wir mit Phase 2.5 (Steinberg Nuendo / Cubase Integration) starten, schärfen wir 'Dokumentation.md' im Projektstamm um 3 architekturelle Eckpfeiler, die in 'docs/multidaw_documentation_delta.md' spezifiziert sind.

Datei:
- 'Dokumentation.md'

Pflege folgende drei Abschnitte strukturiert und präzise ein:

============================================================
1. SÄULE 3 (KAPITEL 3): POLYMORPHES DAWDRIVER-INTERFACE
============================================================
- Ergänze in Kapitel 3 unter "Säule 3: Native DAW-Bridges (The Hands)" die Definition des einheitlichen Treiber-Vertrags:
  ```typescript
  export interface DAWDriverAdapter {
    id: 'logic' | 'nuendo' | 'cubase' | 'ableton';
    getChannelStrips(): Promise<TrackDescriptor[]>;
    setFader(trackName: string, db: number): Promise<boolean>;
    setPan(trackName: string, pan: number): Promise<boolean>;
    setParameter(target: ParameterTarget): Promise<boolean>;
    openInsertSlot?(trackName: string, slotIndex: number): Promise<boolean>;
  }
````

* Erläutere kurz das Dispatcher-Prinzip: 'lib.rs' und der Desktop Companion sprechen künftig nicht mehr direkt mit Hardcoded-Weichen, sondern leiten Befehle polymorph an den Treiber weiter, der zur erkannten DAW passt (LogicAXBridge, Steinberg MIDI Remote Script, Ableton Remote).

# ============================================================ 2. KAPITEL 5.1 (ROUTING-TABELLE): STRUKTURIERTE SHIELD- & FEHLER-RÜCKMELDUNG

* Präzisiere in der Routing-Tabelle unter 5.1 die Antwort von 'POST /api/execute-action': Statt des einfachen `{ success: boolean, executedDeltas: number }` wird der strukturierte Rückgabewert dokumentiert:

  ```
  {
    "success": true,
    "executedDeltas": 3,
    "shieldInterventions": [
      {
        "parameter": "fader_db",
        "requested": 5.0,
        "clampedTo": 3.0,
        "reason": "ACOUSTIC_SHOCK_SHIELD_MAX_BOOST"
      }
    ],
    "errorCode": null
  }
  ```
* Ergänze eine kurze Erklärung, warum dies für das Frontend essenziell ist (visuelle Warnung bei Pegeldrosselung oder nicht gefundenen Spuren in Multi-DAW-Umgebungen).

# ============================================================ 3. KAPITEL 3 (SÄULE 1) & KAPITEL 4 (FEATURE 3): JUCE-HANDSHAKE & LIFECYCLE

* Ergänze eine prägnante 3-Schritt-Sequenz des Projekt-Lifecycles:

  1. DAW lädt Projekt (.logicx / .cpr) -> Audio-Plugin liest XML-Chunk via 'setStateInformation'.
  2. Plugin öffnet WebSocket-Verbindung zu 'ws://127.0.0.1:48123/meter' und sendet initial 'project_context_sync'.
  3. Desktop Companion aktualisiert seinen HUD-State (Target Scope, Genre, Custom Notes)
