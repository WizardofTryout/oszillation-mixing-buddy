# Feature-Blueprint: EchoJay-Konzepte für den Oszillation Mixing Buddy

**Dokument-Typ:** Research & Feature-Roadmap (Phase 2)  
**Status:** Geplant / Konzeptionell  
**Ablageort:** `research-Features/echojay_inspired_features_roadmap.md`  
**Inspiration:** EchoJay Studio (`echojay.ai`)

---

## 1. Executive Summary: Was wir adaptieren und warum

EchoJay beweist im Praxistest, wie wertvoll **zielgerichteter Kontext** für ein KI-Sprachmodell im Tonstudio ist. Eine KI kann nur dann präzise Ratschläge geben, wenn sie weiß:
1. **Was** sie gerade hört (z. B. eine *Lead Vocal*, ein *Drum Bus* oder der *Master / Mix Bus*).
2. **In welchem musikalischen Kontext** das Signal steht (z. B. *Hip-Hop*, *Modern Pop*, *Rock*, *Acoustic Jazz*).
3. **Womit** das Signal verglichen werden soll (Referenz-Track-Kurve).

Während EchoJay bei Text-Ratschlägen stehen bleibt, transformieren wir diese Konzepte in **ausführbare ActionCards mit automatischer DAW-Parametrisierung**.

---

## 2. Feature 1: Genre- & Kanal-Targets (Context Dropdowns)

### 2.1 UI-Integration im Desktop-HUD
Im Kopfbereich des HUDs (direkt neben dem DAW-Badge und der RTA-Anzeige) platzieren wir zwei kompakte Selektoren:

```
┌────────────────────────────────────────────────────────────────────────┐
│ [Target Bus: Mix Bus ▼]  [Genre: Hip-Hop / Trap ▼]  [Referenz: A/B ▼]  │
└────────────────────────────────────────────────────────────────────────┘
```

#### Selektor 1: Signal-Typ (`targetScope`)
* **Master / Mix Bus** (Standard)
* **Lead Vocal** / **Backing Vocals**
* **Kick Drum** / **Snare** / **Drum Bus**
* **Sub Bass** / **808** / **Bassline**
* **Synths** / **Keys** / **Guitars**
* **Acoustic Instruments**

#### Selektor 2: Genre-Target (`genreProfile`)
* **Hip-Hop / Trap / Drill:** Hohe Sub-Bass-Toleranz ($+3\text{ bis }+4\text{ dB}$ bei $35\text{–}65\text{ Hz}$), komprimierter Crest Factor ($8{,}0\text{–}10{,}5\text{ dB}$), Ziel: $-9\text{ bis }-7\text{ LUFS}$.
* **Pop / Modern Radio:** Ausgewogenes Low-End, hoher Glanz ($>10\text{ kHz}$), mittlerer Crest Factor ($10{,}5\text{–}13\text{ dB}$), Ziel: $-14\text{ bis }-10\text{ LUFS}$.
* **Rock / Metal:** Dichte Mitten ($800\text{–}3.500\text{ Hz}$), gezähmte Sub-Bässe ($<40\text{ Hz}$ Low Cut), Ziel: $-11\text{ bis }-9\text{ LUFS}$.
* **EDM / Club:** Hohe Stereobreite, harter Limiter-Einsatz, Ziel: $-7\text{ bis }-5\text{ LUFS}$.
* **Acoustic / Jazz / Classical:** Hohe Dynamik, Crest Factor $\ge 14\text{ dB}$, kein drastisches Brickwall-Limiting, Ziel: $-18\text{ bis }-14\text{ LUFS}$.

---

### 2.2 Datenmodell: `TargetProfiles.json`

```typescript
export interface MetrologyTarget {
  integratedLufsTarget: number;       // z. B. -14.0
  lufsToleranceDb: number;            // z. B. ±1.5 dB
  maxTruePeakDb: number;              // z. B. -1.0 dBTP
  targetCrestFactorDb: { min: number; max: number }; // z. B. 10.0 - 13.0 dB
  spectralEnvelope: {                 // 32-Band FFT Soll-Kurve
    subBassOffsetDb: number;          // 20 - 60 Hz Delta
    bassOffsetDb: number;             // 60 - 250 Hz Delta
    lowMidOffsetDb: number;           // 250 - 1000 Hz Delta
    highMidOffsetDb: number;          // 1 - 5 kHz Delta
    airOffsetDb: number;              // 5 - 20 kHz Delta
  };
  typicalRemedies: string[];          // Priorisierte Insert-Ketten
}
```

---

### 2.3 Prompt-Injection für die AI Engine

Wenn ein Prompt abgesendet wird, injiziert `packages/ai-engine/src/prompts.ts` das gewählte Profil als strikte Baseline:

```text
[MUSICAL CONTEXT & TARGET BASELINE]
- Kanal-Typ: Lead Vocal
- Musikalisches Genre: Pop / Radio
- Target Integrated LUFS: -14.0 LUFS (Ist: -18.2 LUFS -> Delta: -4.2 dB)
- Target Crest Factor: 11.5 dB (Ist: 15.0 dB -> Dynamik noch zu unkomprimiert)
- Spektrale Abweichung: 
  * 3.2 kHz Präsenz liegt -2.8 dB unter dem Genre-Mittelwert.
  * 250 Hz Grundtonbereich liegt +3.1 dB über dem Genre-Mittelwert (Boxy / Mulmig).

Leite aus diesen Abweichungen gezielte Korrekturen für den Channel EQ und 
den Kompressor ab. Formuliere die ActionCard so, dass die vorgeschlagene Änderung
die Messwerte an den Korridor des gewählten Genres heranführt.
```

---

## 3. Feature 2: AI Spectral Compare (Referenz-Track A/B)

### 3.1 Das Konzept
Wie im EchoJay-Screenshot zu sehen, zieht der Musiker einen fertigen Song (WAV/MP3/AIFF) in das HUD.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SPEKTRAL-VERGLEICH IM HUD                       │
├────────────────────────────────────────────────────────────────────────┤
│  0 dB ───────────────────────────────────────────────────────────────  │
│       Aktueller Mix (Türkis):      ─────/\───────/\───────────        │
│       Referenz-Track (Rosa/Pink):  ──/───\─────/───\──────────        │
│ -30 dB ─────────────────────────────────────────────────────────────── │
│        20 Hz       100 Hz       1 kHz        5 kHz        20 kHz       │
│                                                                        │
│  DIAGNOSE: Bereich 80–140 Hz hat +3.2 dB Überhang gegenüber Referenz. │
│  [ActionCard generieren: Low-End an Referenz anpassen]                │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Technische Umsetzung im Desktop-Companion
1. **Frontend Dropzone (`apps/desktop/src/components/ReferenceTrackModal.tsx`):**
   * Musiker zieht Referenz-Track per Drag & Drop in das HUD.
   * Ein Offline-WebAudio-Context berechnet einmalig:
     * Integrated LUFS nach EBU R128.
     * Crest Factor ($= \text{Peak}_{\text{dBFS}} - \text{RMS}_{\text{dBFS}}$).
     * Gemitteltes 32-Band FFT-Spektrum über den lautesten Song-Abschnitt (Chorus-Erkennung über RMS-Window).
2. **Speicherung in `~/.mixing-buddy/references/<SongTitle>.json`:**
   * Ermöglicht das Wiederverwenden von Referenzkurven über mehrere Projekte hinweg.
3. **Dual-Graph Rendering im RTA:**
   * Der RTA-Graph im HUD rendert zwei Pfade:
     * Pfad 1 (Türkis / Primär): Der 30 fps Live-FFT-Stream aus unserem JUCE-Plugin.
     * Pfad 2 (Rosa gestrichelt / Sekundär): Die FFT-Kurve des Referenzsongs.
4. **Automatischer Differenz-Vorschlag (`mcp__compare_with_reference`):**
   * Die KI subtrahiert beide Kurven:
     $$\Delta(f) = \text{FFT}_{\text{Mix}}(f) - \text{FFT}_{\text{Ref}}(f)$$
   * Bänder mit $|\Delta(f)| \ge 2{,}5\text{ dB}$ werden als ActionCard für den Summen-EQ oder Gruppen-EQ vorgeschlagen.

---

## 4. Feature 3: Plugin-Katalog-Wissen („1915 Plugins“) & Vault-Symbiose

EchoJay nutzt ein Verzeichnis von 1.915 Plugins als Prompt-Wissen. Wir verknüpfen dieses Konzept direkt mit unserem bestehenden **Plugin Vault**:

### 4.1 Die 2-Ebenen-Empfehlungs-Logik:
1. **Ebene A: Plugins, die du besitzt (Im Vault registriert):**
   * Die KI prüft zuerst: *„Liegt ein passendes Plugin im lokalen Vault (`~/.mixing-buddy/plugins/` beschlagwortet mit z. B. `SATURATION` oder `EQ`)?“*
   * Wenn ja: Die KI schlägt **dieses konkrete Plugin** vor und stellt die Parameter per `set-param` direkt ein!
2. **Ebene B: Enzyklopädisches Studio-Wissen (EchoJay-Methode):**
   * Falls auf dem Mac kein passendes Spezial-Plugin installiert ist (z. B. fehlt ein Röhren-Sättiger), greift die KI auf den Katalog zurück:
     > *„Für diesen Vocal-Stil eignet sich klassischerweise eine Manley VOXBOX oder ein UAD 1176LN mit 4:1 Ratio. Da du aktuell Stock-Plugins nutzt, emulieren wir diesen Klang über den Logic Compressor (Vintage Opto Modus) und ChromaGlow.“*

---

## 5. Implementierungs-Roadmap

| Phase | Modul | Aufwand | Abhängigkeiten |
| :--- | :--- | :---: | :--- |
| **Phase 2.1** | **Genre- & Kanal-Dropdowns im HUD** | Gering | React UI + System-Prompt Injection |
| **Phase 2.2** | **Target-Profile (JSON)** | Gering | Definierte LUFS/Crest Richtwerte |
| **Phase 2.3** | **Referenz-Audio Offline-Profiler** | Mittel | WebAudio API / Rust-Decoder |
| **Phase 2.4** | **Dual-RTA Graph im HUD** | Mittel | SVG/Canvas Layer in `App.tsx` |
| **Phase 2.5** | **Katalog-Enzyklopädie im MCP** | Gering | Markdown/JSON Knowledge Base |

---

## Fazit

EchoJay liefert die ideale Bestätigung für unsere UI-Evolution. Durch die Integration von **Genre-Targets** und dem **Referenz-Kurven-Vergleich** heben wir den Oszillation Mixing Buddy von einem reinen Werkzeug zu einem mitdenkenden, stilistisch treffsicheren Co-Producer.