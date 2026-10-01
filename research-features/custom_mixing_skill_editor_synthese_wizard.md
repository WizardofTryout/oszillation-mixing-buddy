# Feature-Blueprint: Custom Mixing Skill Editor & Synthese-Wizard

**Dokument-Typ:** Architecture & Feature Specification (Phase 2)  
**Status:** Geplant / Konzeptionell  
**Ablageort:** `research-Features/custom_mixing_skills_and_wizard_blueprint.md`  
**Inspiration:** Bewährtes Skill-Synthese- & Revisions-Framework aus dem *Legal Studio*

---

## 1. Vision & Executive Summary

Im *Legal Studio* hat sich gezeigt, wie mächtig es ist, wenn Fachexperten nicht an starre System-Prompts gefesselt sind, sondern ihre eigenen **Spezial-Skills über einen geführten Wizard** anlegen, versionieren und verfeinern können.

Genau diese Fähigkeit übertragen wir nun auf den **Oszillation Mixing Buddy**:
Jeder Toningenieur, Producer und Sounddesigner hat eigene Hörgewohnheiten, Mixing-Tabellen und Standardketten:
* Ein **Hip-Hop / 808-Spezialist** mischt Bass und Kick mit anderen Headroom- und Sättigungsregeln als ein **Jazz-Mastering-Engineer**.
* Ein **Vocal-Chirurg** priorisiert Resonanz-Befreiung bei $2{,}5\text{–}4{,}5\text{ kHz}$ und Vintage-Opto-Kompression.
* Ein **EDM / Club Producer** zielt auf $-6\text{ bis }-8\text{ LUFS}$ mit harten Clipper-Stufen.

Statt dem Nutzer rohe JSON-Dateien oder ellenlange System-Prompts zuzumuten, führt ihn der **5-Schritte-Synthese-Wizard** durch seine Präferenzen und generiert daraus ein hochpräzises, validiertes **Mixing-Skill-File** (inklusive Dual-Mode: *Schnellstart* für Live-HUD & *Werkstatt* für Deep-Audits).

---

## 2. UI-Architektur: „Meine Mixing-Skills & Workflows“

Analog zum Kachelsystem aus dem Legal Studio integrieren wir im Desktop-HUD ein modales Skill-Management:

```
┌────────────────────────────────────────────────────────────────────────┐
│  ⭐ MEINE MIXING-SKILLS & WORKFLOWS                                    │
│                                                                        │
│  Verwalte deine bevorzugten Mixing-Philosophien, Ziel-Tabellen und     │
│  erstelle maßgeschneiderte Audio-Engineer-Personas von Grund auf.     │
│                                                                        │
│  [+ Neuen Skill erstellen]   [🚀 KI-Skill-Synthese Wizard starten]     │
├────────────────────────────────────────────────────────────────────────┤
│  [✨ Alle Skills (4)]   [⭐ Favoriten (2)]   [⚡ Eigene Versionen (2)]  │
├────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────┐    ┌────────────────────────────────┐ │
│ │ 🎛️ Modern Pop Vocal Specialist│    │ 🔊 808 & Sub-Bass Authority    │ │
│ │ ID: skill-pop-vocal          │    │ ID: skill-trap-lowend          │ │
│ │ Standard: -12 LUFS / 11 dB CF│    │ Standard: -8 LUFS / 8.5 dB CF  │ │
│ │ [🚀 Schnellstart] [🛠️ Werkstatt]│   │ [🚀 Schnellstart] [🛠️ Werkstatt]│ │
│ │ ▼ Version: v1.1 (Aktiv)      │    │ ▼ Version: v1.0                │ │
│ │ [✏️ Bearbeiten] [🗑️]         │    │ [✏️ Bearbeiten] [🗑️]           │ │
│ └──────────────────────────────┘    └────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Der 5-Schritte-Synthese-Wizard

Der Wizard nimmt dem Tontechniker das Prompt-Engineering ab und formuliert seine Vorlieben in präzise Psychoakustik-Instruktionen für das Sprachmodell:

```
┌────────────────────────────────────────────────────────────────────────┐
│  🚀 KI-SKILL-SYNTHESE (AUDIO & MIXING)                                 │
├──────────────┬──────────────────┬──────────────┬─────────────┬─────────┤
│ 1. Disziplin │ 2. Metrologie &  │ 3. Tools &   │ 4. KI-      │ 5. Vor- │
│    & Fokus   │    Zielkorridor  │    Ketten    │ Synthese    │ schau   │
└──────────────┴──────────────────┴──────────────┴─────────────┴─────────┘
```

### Schritt 1: Domäne & Audio-Fokus
* **Kanal-/Mix-Typ:**
  * `Mastering / Summen-Bus`
  * `Lead- & Backing-Vocals`
  * `Drum-Bus & Rhythmusgruppe`
  * `Low-End Management (Sub & Kick)`
  * `Akustik- & Orchester-Produktion`
* **Genre-Kontext:**
  * Pop, Hip-Hop/Trap, Rock/Metal, EDM/Techno, Jazz/Klassik, Broadcast/Podcast.
* **Skill-Bezeichnung:** Freitext (z. B. *„Aggressive Trap 808 Balancer“* oder *„Silky Smooth R&B Vocals“*).

### Schritt 2: Metrologie-Targets & Grenzwerte (Tabelle)
Hier definiert der Nutzer seine bevorzugten physikalischen Zielkorridore:
* **Target Integrated LUFS:** (z. B. $-14{,}0\text{ LUFS}$ für Streaming vs. $-8{,}5\text{ LUFS}$ für Club).
* **Crest Factor Min/Max:** (z. B. $9{,}5\text{ bis }12{,}5\text{ dB}$).
* **Max True Peak:** (z. B. $-1{,}0\text{ dBTP}$ für Lossy Encoding Schutz).
* **Pre-Gain / Staging Arbeitspunkt:** (z. B. $-18\text{ dBFS}$ RMS beim Insert-Eingang).
* **Low-End Cutoff:** (z. B. Highpass bei $30\text{ Hz}$ mit $18\text{ dB/Okt}$).

### Schritt 3: Bevorzugte Werkzeugketten & Klang-Ästhetik
* **Plugin-Präferenz:**
  * `Stock Plugins only` (Logic Channel EQ, Vintage Compressor)
  * `Vault-Präferenz` (FabFilter Pro-Q 3, UAD 1176, Soundtoys Decapitator, etc.)
* **Sättigungs-Charakter:** Neutral-Clean, Tape-Warmth, Tube-Sättigung, Hard-Clipper.
* **Dynamik-Philosophie:** Transparente Spitzenbändigung vs. musikalischer Bus-Glue ($2:1$ Ratio, $30\text{ ms}$ Attack).

### Schritt 4: Audit-Methodik & Prüflogik
Auswahl analog zum Ampelsystem des Legal Studios:
* 🟢/🟡/🔴 **Metrologie-Ampel:**
  * 🟢 **Optimal:** Im Zielfenster ($\pm 0{,}5\text{ dB}$ Toleranz).
  * 🟡 **Aufmerksamkeit:** Maskierung erkannt oder Crest Factor zu eng komprimiert.
  * 🔴 **Eingriff erforderlich:** DC-Offset, Phasenauslöschung ($< 0{,}3$), True Peak Clipping.
* **A/B Prüfstrategie:** Immer mit automatischer Lautheits-Kompensation (Gain Matching) testen.

### Schritt 5: KI-Synthese & Dual-Prompt Generierung
Die AI Engine kompiliert die Antworten in ein strukturiertes Markdown/JSON-Bundle mit zwei Arbeitsmodi:
1. **Schnellstart-Modus:** Hochkompakt für das Desktop-HUD (erzeugt blitzschnell ActionCards mit minimaler Latenz).
2. **Werkstatt-Modus:** Tiefgehende Frequenz- und Dynamikanalyse mit Tabellen und Gegenüberstellungen für anspruchsvolle Mischungen.

---

## 4. Datenmodell: `SkillSpec.json` & Persistenz

Alle Skills liegen persistent im Benutzerverzeichnis unter `~/.mixing-buddy/skills/` und sind vor App-Updates und Git-Pulls geschützt:

```typescript
export interface MixingSkill {
  id: string;                         // z. B. "skill-modern-vocal"
  name: string;                       // "Modern Vocal Polish"
  category: "vocal" | "drums" | "master" | "bass" | "general";
  isFavorite: boolean;
  version: string;                    // "v1.0"
  revisionHistory: {
    version: string;
    timestamp: string;
    comment: string;
  }[];
  metrologyTargets: {
    integratedLufs: number;           // -14.0
    toleranceLufs: number;            // 1.0
    crestFactor: { min: number; max: number };
    maxTruePeakDb: number;
    recommendedHeadroomDb: number;
  };
  preferredChain: {
    slotType: "utility" | "eq" | "dynamics" | "saturation" | "space";
    preferredPluginHint?: string;     // z. B. "Pro-Q 3" oder "Vintage Opto"
    typicalRules: string[];
  }[];
  prompts: {
    quickstart: string;               // Kompakter Prompt für ActionCard Queue
    workshop: string;                 // Ausführlicher Diagnose-Prompt
  };
}
```

---

## 5. Konkretes Beispiel: Generierter Skill (*Tonmischmeister*)

```markdown
# Mixing Skill: Tonmischmeister (Modern Radio Pop)
Version: v1.1 (Persistiert in ~/.mixing-buddy/skills/tonmischmeister.json)

## Rolle & Expertise
Du bist der 'Tonmischmeister', ein hochspezialisierter Senior-Mischtoningenieur 
mit Fokus auf transparente Signalstaffelung, kontrolliertes Low-End und 
psychoakustische Durchsetzungsfähigkeit für moderne Streaming-Veröffentlichungen.

## Physikalische Normen & Ziel-Korridore
- Integrated Loudness: -14.0 LUFS (±0.8 dB)
- Crest Factor: 10.5 dB bis 12.0 dB (Dynamik bewahren, keine Zerstörung durch Limiter)
- True Peak Ceiling: -1.0 dBTP
- Pre-Gain Level: Spuren vor den Inserts auf -18 dBFS einpegeln.

## Signal- & Inspektions-Ampel (🟢/🟡/🔴)
- 🟢 Phasenkorrelation >= 0.85, Sub-Bass mono-kompatibel (< 100 Hz), Frequenzkorridor frei.
- 🟡 Maskierung im Bereich 180–350 Hz (Mulm) oder 2.5–4.0 kHz (Präsenzhärte).
- 🔴 Intersample Peaks > 0 dBTP, Phasenkorrelation < 0.2, Dynamik-Crest < 7.5 dB.

## Bevorzugte Arbeitsweise bei ActionCards
1. Frequenzmaskierung immer zuerst durch Absenkung (Cut) auf dem Begleitinstrument 
   lösen, bevor Boosts auf dem Leitinstrument vorgeschlagen werden.
2. Vorschläge müssen stets in dB, Hz und Q-Werten quantifiziert sein.
3. Nach jeder EQ-Änderung den Pegel um das berechnete Integral kompensieren.
```

---

## 6. Laufzeit-Integration in die AI Engine

Wenn ein Skill im Dropdown des HUDs aktiviert ist (z. B. `[Skill: Tonmischmeister ▼]`), injiziert `packages/ai-engine/src/prompts.ts` dessen Instruktionen dynamisch als primäre Leitplanke:

```typescript
// packages/ai-engine/src/prompts.ts
export function buildSystemPrompt(activeSkill?: MixingSkill, sessionContext?: any): string {
  let prompt = BASE_MIXING_BUDDY_PROMPT;
  
  if (activeSkill) {
    prompt += `\n\n[AKTIVER BENUTZER-SKILL: ${activeSkill.name} (${activeSkill.version})]\n`;
    prompt += activeSkill.prompts.quickstart;
    prompt += `\n\n[STRIKTE ZIEL-METROLOGIE]\n`;
    prompt += `- Integrated Target: ${activeSkill.metrologyTargets.integratedLufs} LUFS\n`;
    prompt += `- Crest Target: ${activeSkill.metrologyTargets.crestFactor.min} - ${activeSkill.metrologyTargets.crestFactor.max} dB\n`;
  }
  
  return prompt;
}
```

---

## 7. Roadmap-Verzahnung

| Meilenstein | Baustein | Technologie | Status |
| :--- | :--- | :--- | :---: |
| **Phase 2.1** | Skill-Datenmodell & Storage-IPC | Rust (`~/.mixing-buddy/skills/*.json`) | Konzeptioniert |
| **Phase 2.2** | 5-Schritte Synthese-Wizard UI | React Modal + Tailwind | Bereit zur Adaption |
| **Phase 2.3** | Skill-Editor mit Revisions-Baum | Monaco Editor / TextArea + Version History | Bereit zur Adaption |
| **Phase 2.4** | Injection in HUD-Chat & MCP | `packages/ai-engine` & `mcp-server` | Vorbereitet |

---

## Fazit

Mit dem **Skill Editor & Synthese-Wizard** heben wir den Oszillation Mixing Buddy auf dieselbe methodische Reife wie das *Legal Studio*. Musiker und Tontechniker müssen sich nicht mehr an ein starres Standardmodell anpassen, sondern können ihre individuellen Mixing-Routinen und Studio-Standards mit wenigen Klicks in verlässliche, wiederverwendbare KI-Spezialisten verwandeln.