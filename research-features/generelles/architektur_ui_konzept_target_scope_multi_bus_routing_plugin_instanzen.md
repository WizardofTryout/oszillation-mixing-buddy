# ARCHITEKTUR- & UI-KONZEPT: TARGET-SCOPE, MULTI-BUS & SATELITTEN-ROUTING

**Status:** System-Architektur & UI/UX Re-Design  
**Fokus:** Auflösung der „Bus vs. Signal-Rolle“-Verwirrung, Skalierbarkeit für Großprojekte und Zuständigkeit zwischen JUCE-Plugin (*The Ear*) und Desktop-Companion (HUD).

---

## 1. Das Kernproblem präzise auf den Punkt gebracht

Die aktuelle Header-Leiste birgt ein fundamentales Missverständnis:

1. **Die linguistische Falle („Bus“):**
   * Im HUD steht aktuell: `[ 🎯 Bus: Master / Mix Bus ▼ ]` (mit Optionen wie *Lead Vocal*, *Drum Bus*, *Sub Bass*).
   * In einer DAW (Logic Pro, Nuendo) ist ein **Bus** jedoch ein **physischer Routing-Kanal** (`Bus 1`, `Bus 2`, Aux-Spur `Drums`, Subgruppe `Gitarren`).
   * Im Mixing Buddy ist dieses Feld in Wahrheit aber der **`targetScope`** – also eine **mathematische Soll-Schablone** für Frequenz- und Dynamikkorridore.

2. **Die Gefahr von Fehlinterpretationen & falschen KI-Aktionen:**
   * **Das Szenario:** Ein Musiker hat das Plugin `MixingBuddyMeter` auf dem Master-Kanal liegen. Im Dropdown wählt er gutgläubig *„Lead Vocal“*, weil er gerade an den Vocals arbeiten will.
   * **Die fatale Folge:** Die KI und das Metering vergleichen das Signal des **Gesamtmixes** plötzlich mit der mathematischen Schablone einer **isolierten Gesangsspur**. Das System rügt fälschlicherweise, dass der Bassbereich unter 100 Hz „völlig überdimensioniert“ sei, und schlägt destruktive Cuts vor.
   * Umgekehrt: Liegt das Plugin auf einem realen Vocal-Bus, im HUD steht aber noch *„Master / Mix Bus“*, verlangt die KI auf der Gesangsspur $-12\text{ LUFS}$ und Subbass.

3. **Das Skalierungsproblem bei großen Projekten:**
   * Eine Pop-/Rock-Produktion hat oft 40–80 Spuren, 8 Subgruppen und 6 Effekt-Returns.
   * Eine statische Dropdown-Liste mit 6 pauschalen Begriffen bildet weder die reale DAW-Routing-Hierarchie ab, noch verhindert sie Fehlbedienungen.

---

## 2. Wo gehört die Einstellung hin: Plugin („The Ear“) oder Desktop-HUD?

Um zu entscheiden, wo welche Schalter platziert werden müssen, hilft der Vergleich zweier etablierter Industrie-Standards:

### Modell A: Der globale iZotope-Ansatz (Tonal Balance Control / Neutron)
* Das Mess-Plugin liegt auf verschiedenen Spuren (z. B. auf Kick, Bass, Vocals, Master).
* Im Hauptfenster wählt der Nutzer, **welche konkrete Instanz** er gerade fokussiert.

### Modell B: Das Studio-Buddy-Satelliten-Modell (Workflow-Trailer)
* Es gibt **einen zentralen Master-Companion** (unser HUD).
* Auf Spuren liegen schlanke „Satelliten-Plugins“ (*The Ear*), die anzeigen:
  `Connected to Master · Listening: Stereo Out`.

### Die logische Aufteilung:

| Parameter | Gehört primär in… | Begründung |
|---|---|---|
| **Kanal-Identität (Rolle/Typ)** | **Das JUCE-Plugin (`The Ear`)** | Das Plugin *weiß* oder *deklariert*, in welchem Signalpfad es physisch eingeschliffen ist. Eine Instanz auf dem Master *ist* ein Mix Bus; eine Instanz auf der Gesangsspur *ist* ein Vocal-Signal. |
| **Genre-Profil & Referenz-Track** | **Das Desktop-HUD** | Das Genre (z. B. *Pop / Radio* mit $-12\text{ LUFS}$) und der Referenz-Song gelten für die **gesamte Session**, nicht isoliert für ein einzelnes Plugin. |
| **KI-Prompts & ActionCards** | **Das Desktop-HUD** | Hier sitzt der Co-Producer, der DAW-Aktionen bündelt und vorschlägt. |

---

## 3. Das 3-Stufen-Lösungskonzept für maximale Klarheit

### Stufe 1: Sofortmaßnahme im HUD (Begriffe & visuelle Trennung)

Wir beenden die Verwirrung sofort durch präzise Beschriftung und optische Trennung:

1. **Umbenennung von `Bus:` auf `Fokus / Abhör-Rolle:`:**
   * Statt: `[ 🎯 Bus: Master / Mix Bus ▼ ]`
   * Neu: `[ 🎯 Signal-Fokus: Master Mix ▼ ]`
   * Tooltip beim Hovern:  
     *„Bestimmt die spektrale Zielschablone (Master, Vocal, Drums etc.) für die Analyse des ankommenden Meter-Signals.“*

2. **Kopplung an die reale Plugin-Verbindung:**
   * Ganz rechts im Header steht bereits: `[ 🎧 Master Bus: Online (44.1 kHz) ]`.
   * Dieser Status muss direkt widerspiegeln, wo das Plugin aktiv ist:
     * Wenn `The Ear` auf *Stereo Out* liegt: `🟢 Master Out (44.1 kHz)`.
     * Wenn `The Ear` auf Spur *Lead Vocal* liegt: `🟢 Lead Vocal (44.1 kHz)`.

---

### Stufe 2: Physische Spur-Erkennung (DAW Track-Awareness)

Anstatt den Musiker raten zu lassen, ermitteln wir die Spur **automatisch über die DAW**:

1. **Automatische Erkennung in Swift / Rust:**
   * Unsere Swift-Bridge (`list-channel-strips`) scannt den Mixer bereits vollständig ab.
   * Sie sieht exakt, auf welcher Spur das Plugin `MixingBuddyMeter` geladen ist (z. B. Spur `Stereo Out` oder Spur `Lead Vocal`).
2. **Auto-Zuweisung des Scopes:**
   * Wird das Plugin auf dem Kanal `Stereo Out` / `Master` erkannt $\rightarrow$ setzt das System den Signal-Fokus automatisch auf **`Master / Mix Bus`**.
   * Liegt das Plugin auf einer Spur namens `Vocal`, `Lead Vox` $\rightarrow$ setzt das System automatisch **`Lead Vocal`**.
   * Liegt das Plugin auf `Drums`, `Drum Kit` $\rightarrow$ setzt es automatisch **`Drum Bus`**.
   * Der Musiker muss **gar nichts mehr manuell umschalten**, es sei denn, er möchte eine Sonderkonfiguration erzwingen.

---

### Stufe 3: Großprojekt-Skalierung (Der Multi-Instanzen-Manager)

Für komplexe Arrangements (z. B. 60 Spuren mit mehreren Subgruppen):

1. **Mehrere Instanzen von `MixingBuddyMeter` erlauben:**
   * Der Producer kann `The Ear` auf den Master, auf die Drum-Gruppe und auf den Gesangskanal legen.
   * Jede Plugin-Instanz streamt ihren Kanalnamen über WebSocket:
     ```json
     {
       "type": "telemetry_frame",
       "instanceId": "inst_01",
       "trackName": "Stereo Out",
       "assignedRole": "mix_bus",
       "lufs": -14.2
     }
     ```

2. **Dynamisches Dropdown im HUD (Instanzen statt Fake-Busse):**
   * Das Dropdown im HUD zeigt künftig **die real existierenden Messpunkte**:
     ```text
     [ 🎯 Abhörpunkt: Stereo Out (Master) ▼ ]
       ├── 🟢 Stereo Out (Master Mix) [Aktiv]
       ├── 🟢 Bus 1 (Drum Group)
       └── 🟢 Track 4 (Lead Vocal)
     ```
   * Klickt der Musiker auf `Bus 1 (Drum Group)`:
     * Der RTA-Graph im HUD schaltet sofort auf das Frequenzbild der Drum-Gruppe um.
     * Die KI weiß unmissverständlich: *„Wir analysieren jetzt die Drums.“*
     * Keine Verwechslungsgefahr, keine erfundenen Busse, 100 % Realität!

---

## 4. Übersicht: Die neue Header-Struktur

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [OMB] OSZILLATION MIXING BUDDY v0.5.0                                                                            │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                  │
│  [ 🎯 Abhörpunkt: Stereo Out (Master) ▾ ]    [ 🎵 Genre: Pop / Radio ▾ ]    [ 📊 Referenz-Track ]                │
│   (Reale DAW-Instanz, Auto-Detected)          (Globale Ziel-Schablone)       (Spektraler Fingerabdruck)          │
│                                                                                                                  │
│  [ ✨ Plugin anlernen ]   [ 🗄️ Plugin Vault (12) ]   [ ⭐ Skills (1) ]   [ 🟢 DAW: Apple Logic Pro (Online) ]    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Konkrete Empfehlung für die Umsetzung

1. **Schritt 1 (Sofortiger Quick-Win):**
   * Im Desktop-HUD benennen wir das Label `Bus:` in **`Signal-Fokus:`** um.
   * Wir ergänzen einen dezenten Info-Badge/Tooltip, der klarstellt: *„Definiert die klangliche Zielschablone (Master vs. Einzelsignal) für RTA und KI.“*

2. **Schritt 2 (Prompt-Schutz):**
   * Im System-Prompt (`prompts.ts`) verankern wir:
     * Wenn `targetScope === 'mix_bus'` und der Benutzer nach Einzelsignalen (Kick/Bass) fragt, erklärt der Agent, wie diese im Kontext des Gesamtmixes harmonieren.
     * Liegt der Fokus auf einem Einzelsignal, bewertet er nur diesen Frequenzbereich.

3. **Schritt 3 (Multi-Instanz Feature für spätere Phase):**
   * Übergabe der realen Spurbezeichnung aus dem JUCE-Plugin via WebSocket an das HUD, um die Dropdowns zu 100 % dynamisch aus dem realen Projekt zu speisen.