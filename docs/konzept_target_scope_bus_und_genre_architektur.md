# Architektur & Konzept: Target Scope (Bus/Signal-Typ), Genre-Profile & Referenz-Matching

Dieses Dokument erklärt den theoretischen Hintergrund, die technische Implementierung und den Zweck der Header-Sektion im **Oszillation Mixing Buddy** Desktop-HUD (Bereich: *Bus / Signal-Typ*, *Genre* und *Referenz-Track*).

---

## 1. Das Kernproblem (Das „Warum“)

Zu Beginn des Projekts agierte die KI wie ein fähiger Toningenieur mit verbundenen Augen bezüglich der **Stilistik** und des **Signal-Kontexts**:

1. **Kontext-Blindheit der KI:**
   * Wenn der Nutzer im Chat schrieb: *„Hör dir das an und optimiere den Mix“*, wusste die KI nicht:
     * **WAS** sie gerade über das JUCE-Plugin (*The Ear*) hört (Gesamtmix, Lead-Vocal, Drum-Gruppe oder 808-Bassline).
     * **IN WELCHEM STIL** sich die Produktion bewegt (Trap mit extremem Sub-Bass bei $-8\text{ LUFS}$, oder ein dynamisches Jazz-Trio bei $-16\text{ LUFS}$ mit hohem Crest-Faktor).
   * **Die Folge:** Das LLM schlug stur generische Standardwerte (z. B. $-14\text{ LUFS}$) vor. Lag das Meter-Plugin auf einer isolierten Vocal-Spur, rügte die KI fälschlicherweise das Fehlen von Subbässen unter 60 Hz.

2. **Session-Verlust nach Schließen der DAW:**
   * Vor Sprint 3 gingen gesetzte Zielkorridore verloren, sobald Logic Pro oder der Mixing Buddy geschlossen wurden. Beim nächsten Öffnen des DAW-Projekts musste der Nutzer die Zielvorgaben erneut konfigurieren.

---

## 2. Das Missverständnis mit dem Begriff „Bus“

Im UI steht aktuell die Beschriftung:
`[ 🎯 Bus: Master / Mix Bus ▼ ]`

> **Wichtigste Erkenntnis:** Das System prüft an dieser Stelle **nicht** gegen, ob diese Busse physisch als Spuren oder Aux-Kanäle im Logic Pro / Nuendo Projekt existieren!

### Technische Realität im Code: `targetScope`
Im Code heißt diese Variable nicht Bus-ID, sondern **`targetScope`** (Signal-Typ bzw. Abhör-Rolle):
* Definition in [`packages/shared-types/src/targets.ts`](file:///Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/packages/shared-types/src/targets.ts):
  ```typescript
  export type TargetScope =
    | 'mix_bus'
    | 'lead_vocal'
    | 'drum_bus'
    | 'sub_bass'
    | 'keys_synths'
    | 'acoustic';
  ```

### Wofür diese Auswahl dient:
Das Dropdown beantwortet der KI und der Audio-Telemetrie die Frage:  
**„Als was soll das Audiosignal bewertet werden, das das JUCE-Plugin `The Ear` auf dieser Instanz gerade empfängt?“**

| Auswahl (`targetScope`) | Wo das JUCE-Plugin typischerweise liegt | Spektrale Soll-Anpassung (`resolveTargetProfile`) |
|---|---|---|
| **`Master / Mix Bus`** | Auf dem Master / Stereo Out | Volles Frequenzspektrum eines Gesamtmixes (Sub-Bass bis Air, z. B. $-12\text{ LUFS}$). |
| **`Lead Vocal`** | Auf der Lead-Vocal-Spur oder Vocal-Gruppe | Sub-Bass wird mit $-12\text{ dB}$ beschnitten (Low-Cut Pflicht); High-Mid ($2\text{–}5\text{ kHz}$) und Air ($10\text{–}16\text{ kHz}$) erhalten $+3\text{ dB}$ Soll-Anhebung für Sprachverständlichkeit. |
| **`Drum Bus / Rhythm`** | Auf der Drum-Subgruppe | Transienten-Punch, dichter Crest-Faktor ($8\text{–}12\text{ dB}$), Bass-Präsenz. |
| **`Sub Bass / 808`** | Auf Bass-/808-Spuren | Fokus auf $35\text{–}65\text{ Hz}$, Mitten und Höhen stark abgesenkt (Low-Pass). |
| **`Keys & Synths`** | Auf Synthesizer-/Piano-Kanälen | Ausgewogene Stereobreite, Mittenstaffelung. |
| **`Acoustic / Guitars`** | Auf Akustik-Instrumenten | Offene Mikrodynamik, gezähmte Resonanzen. |

---

## 3. Die Genre-Auswahl (`genreProfile`) & der KI-Modus

Das Genre-Dropdown definiert den **mathematischen Zielkorridor** für die RTA-Echtzeitanalyse und die generierten ActionCards.

### A. Vordefinierte mathematische Korridore
In [`packages/shared-types/src/targets.ts`](file:///Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/packages/shared-types/src/targets.ts) hinterlegt:

* **Pop / Radio (`pop_radio`):**
  * Target: $-12.0\text{ LUFS}$ ($\pm 1.5\text{ LU}$ Toleranz), Crest-Faktor $10.5\text{–}13.0\text{ dB}$, Max True Peak $-1.0\text{ dBTP}$.
  * Fokus: Transparente Mitten, seidige Höhen ($> 10\text{ kHz}$), kontrolliertes Low-End.
* **Hip-Hop / Trap (`hiphop_trap`):**
  * Target: $-8.0\text{ LUFS}$, Crest-Faktor $8.0\text{–}10.5\text{ dB}$, Max True Peak $-0.5\text{ dBTP}$.
  * Fokus: Dominanter Sub-Bass ($+3.5\text{ dB}$ bei $35\text{–}65\text{ Hz}$), Kick-to-808 Sidechaining, Punch.
* **Rock / Metal (`rock_metal`):**
  * Target: $-10.0\text{ LUFS}$, Crest-Faktor $9.0\text{–}12.0\text{ dB}$.
  * Fokus: Dichte Gitarrenmitten ($800\text{–}3.500\text{ Hz}$), Low-Cut unter $40\text{ Hz}$.
* **EDM / Club (`edm_club`):**
  * Target: $-6.5\text{ LUFS}$, Crest-Faktor $6.5\text{–}9.0\text{ dB}$.
  * Fokus: Maximale Dichte, breites Stereobild, harter Limiter-Einsatz.
* **Acoustic / Jazz (`acoustic_jazz`):**
  * Target: $-16.0\text{ LUFS}$, Crest-Faktor $14.0\text{–}20.0\text{ dB}$.
  * Fokus: Volle natürliche Mikrodynamik, kein hartes Brickwall-Limiting.
* **Individuell / Crossover... (`custom_crossover`):**
  * Öffnet das Crossover-Modal: Erlaubt das Mischen von Genre-Sollwerten sowie Freitext-Notizen (z. B. *„Trockene Boom-Bap Drums mit modernem Hyperpop-Vocal-Glanz“*).

### B. Auto-Detect (KI-Modus)
Wenn `Auto-Detect (KI)` gewählt ist, führt die Funktion `detectGenreFromTelemetry()` bei ankommendem Audiosignal eine Klassifikation durch:
* Berechnet die Energieverteilung zwischen Sub-Bässen (Bänder 0–3: $20\text{–}60\text{ Hz}$) und oberen Mitten (Bänder 16–22: $1\text{–}5\text{ kHz}$) sowie den Crest-Faktor und die LUFS.
* Schaltet dynamisch auf das passende Profil um (z. B. Trap bei hohem Subbass-Pegel und geringem Crest, Jazz bei dynamischen Signalen $> 13.5\text{ dB}$ Crest).

---

## 4. DAW-Projekt-Persistenz über das JUCE-Plugin

Ein zentraler Architekturbaustein ist die Kopplung zwischen Desktop-App und DAW-Song:

```
┌─────────────────────────────────┐        WebSocket (Port 48123)        ┌───────────────────────────────────┐
│     Desktop HUD (React/Tauri)   │ ───────────────────────────────────> │     JUCE Plugin: "The Ear"        │
│  User ändert Bus / Genre / Ctxt │   {"type":"set_project_context",...} │   Empfängt targetScope & Genre    │
└─────────────────────────────────┘                                      └─────────────────┬─────────────────┘
                                                                                           │
                                                                         DAW Save / Load   │ getStateInformation()
                                                                         (Cmd+S in Logic)  ▼ setStateInformation()
                                                                         ┌───────────────────────────────────┐
                                                                         │    DAW Song-Datei (.logicx/.cpr)  │
                                                                         │    XML-Chunk mit Projekt-Kontext  │
                                                                         └───────────────────────────────────┘
```

1. Sobald der Nutzer im Header das Genre oder den Signal-Fokus ändert, feuert [`syncContextToPlugin()`](file:///Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/apps/desktop/src/App.tsx#L147) das WebSocket-Paket `set_project_context`.
2. Das JUCE-Plugin `PluginProcessor.cpp` fängt dies ab und sichert die Werte in seinen internen XML-State (`targetScope`, `genreProfile`, `customNotes`, `targetLufs`).
3. Beim Speichern des Projekts in Logic Pro (`Cmd + S`) landet dieser Block direkt in der Song-Datei.
4. Wird das Projekt später neu geöffnet, liest das Plugin die Daten in `setStateInformation()` aus und sendet ein `project_context_sync` an das HUD zurück. Das HUD stellt die Dropdowns automatisch wieder her (`🔄 DAW-Projekt-Persistenz geladen`).

---

## 5. Das Zusammenspiel mit dem Referenz-Track

Rechts neben den beiden Dropdowns befindet sich der Button **`Referenz-Track`**:
1. Der Musiker kann einen kommerziellen Referenz-Song (WAV, MP3, AIFF) per Drag & Drop laden.
2. Das System extrahiert daraus:
   * 32-Band FFT-Frequenzkurve
   * Integrated LUFS & True Peak
   * Crest-Faktor (Dynamik)
3. **Verknüpfung:**
   * Die mathematische Soll-Schablone des Genres kann durch den Referenz-Track überlagert oder feinjustiert werden.
   * Das Tool `mcp__match_reference_spectrum` vergleicht das aktuelle DAW-Signal direkt mit dem Spektral-Fingerabdruck des Referenz-Tracks und generiert zielgenaue EQ-Korrekturen für Logic Pro.

---

## 6. Prompt-Injektion in das LLM (`packages/ai-engine/src/prompts.ts`)

Alle im Header gewählten Werte fließen direkt in den System-Prompt des AI-Co-Producers ein:

```text
--- Musical Context & Target Baseline ---
- Active Scope: lead_vocal
- Genre Profile: Pop / Modern Radio (pop_radio)
- Target Loudness: -12.0 LUFS (Tolerance: ±1.5 LU)
- Target Crest Factor: 10.5 - 13.0 dB
- Max True Peak Ceiling: -1.0 dBTP
- Target Spectral Envelope (Offsets):
  * Sub-Bass (20-60 Hz): -12 dB
  * Bass (60-250 Hz): -2 dB
  * Low-Mid (250-1000 Hz): -1 dB
  * High-Mid (1-5 kHz): +3 dB
  * Air (5-20 kHz): +3.5 dB
```

Dadurch weiß das Sprachmodell bei jedem Vorschlag:
* Beurteile das Signal anhand des Zielkorridors für diesen speziellen Signal-Typ.
* Erzeuge ActionCards, die den Mix messbar an dieses Klangideal heranführen.

---

## 7. Zusammenfassung & UI-Empfehlung

| UI-Element | Wahrnehmung durch den Musiker | Tatsächliche technische Funktion |
|---|---|---|
| **`Bus: Master / Mix Bus`** | „Sucht das Tool nach einem DAW-Bus in Logic?“ | **Nein.** Es bestimmt den **Signal-Fokus (`targetScope`)** für die Frequenz- und Dynamik-Sollwerte des JUCE-Meters. |
| **`Genre: Pop / Trap / ...`** | Stil-Tagging oder Kosmetik | **Mathematische Soll-Schablone:** Bestimmt Ziel-LUFS, spektrale Zonenoffsets und Crest-Faktoren für die ActionCards. |
| **`Auto-Detect (KI)`** | Vollautomatische KI-Erkennung | Analysiert Frequenzverteilung und Dynamik des Live-Streams und wählt das wahrscheinlichste Profil. |

### Empfehlung für ein künftiges UI-Update:
Um Missverständnisse bezüglich echter DAW-Busse zu vermeiden, sollte das Label im Desktop-HUD künftig von `Bus:` auf **`Fokus:`**, **`Signal:`** oder **`Kanal-Rolle:`** angepasst werden (z. B. `Fokus: Mix Bus / Vocals / Drums`).
