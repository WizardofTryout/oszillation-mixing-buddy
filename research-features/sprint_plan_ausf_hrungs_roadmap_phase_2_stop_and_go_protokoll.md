# SPRINT-PLAN PHASE 2: OSZILLATION MIXING BUDDY
## Verbindliches Ausführungs- & Stop-and-Go-Protokoll für Antigravity

**Dokument-Status:** Verbindliche Ausführungs-Roadmap  
**Zielsystem:** Antigravity (Autonomous Senior Software Engineer)  
**Leitprinzip:** Strikte Iteration in Einzelschritten. **Nach jedem Sprint MUSS angehalten werden!**

---

## 🛑 DAS VERBINDLICHE STOP-AND-GO-PROTOKOLL

```
┌────────────────────────────────────────────────────────────────────────┐
│                    DER SPRINT-ZYKLUS FÜR JEDE PHASE                    │
└────────────────────────────────────────────────────────────────────────┘

1. SPRINT IMPLEMENTIEREN:
   Ausschließlich die in diesem Sprint definierten Aufgaben bearbeiten.
   Keine Vorgriffe auf spätere Sprints!

2. LOKALE VERIFIKATION:
   • ./scripts/lint-loc.sh (Strikte <= 3.000 LOC Grenze einhalten)
   • Monorepo Build & Unit-Tests ausführen (`pnpm -r run build`)
   • Desktop App Bundle bauen und testen

3. GIT-SICHERHEIT & COMMIT:
   • git status -s
   • git add -A
   • git commit -m "feat(<scope>): prägnante Beschreibung"
   • git push origin main

4. 🛑 ABSOLUTER STOPP (HALT):
   • Terminal- und Chat-Aktivitäten sofort beenden!
   • Zusammenfassung der erreichten Punkte im Chat ausgeben.
   • Warten auf das explizite "Go" des Nutzers für den nächsten Sprint!
```

---

## ✅ Sprint 0: Mechanische Verifikation & Baseline-Commit
*Status: ABGESCHLOSSEN & COMMITTET*
- [x] Pan- & Fader-Abschluss: Asymmetrischer Safety-Guard aktiv, A/B-Restore freigegeben.
- [x] Bundle-Hygiene: Sidecar-Binary eingebettet, App in `/Applications` lauffähig.
- [x] Git-Sicherung auf `main` durchgeführt.

---

## ✅ Sprint 1: Plugin Vault – Auto-Tagging, Editierbare Tags & Elastische Suche
*Status: ABGESCHLOSSEN & LIVE IM BETRIEB*
- [x] Auto-Tagging für Kategorien (EQ, Dynamics, Saturation, Reverb, Limiter etc.).
- [x] Persistente Mutation (`~/.mixing-buddy/plugins/*.json`).
- [x] UI-Suche, Filter-Chips, Inline-Tag-Editor (`[+ Tag]`) und Format-Badges (`[ AU ]`) im Vault-Modal aktiv.

---

## ✅ Sprint 2: HUD-Chat – Echte AI-Engine & Live-ActionCard Generierung
*Status: ABGESCHLOSSEN & LIVE IM BETRIEB*
- [x] Live-Anbindung der AI-Engine (Gemini Multi-Key & Fallback-Kette aktiv).
- [x] Prompts in der HUD-Chatzeile erzeugen unmittelbar echte, musikalisch begründete ActionCards mit `[A/B Listen]`, `[Verwerfen]` und `[Anwenden]`.
- [x] Multi-Parameter-Batching (Fader, Pan und EQ in einer einzigen ActionCard vereint).

---

## 🚀 Sprint 3: Genre- & Kanal-Targets, Crossover-Logik & DAW-Projekt-Persistenz
*Ziel: Dem System musikalische Leitplanken geben, Crossover-Genres erlauben und Einstellungen direkt im DAW-Projektfile (`.logicx`, `.cpr`) über das JUCE-Plugin speichern.*

### Warum ist das nötig?
1. **Musikalische Flexibilität:** Künstler lassen sich selten in starre Schubladen stecken. Bei Crossover-Projekten (z. B. Drum & Bass + Heavy Metal) muss die KI ein individuelles Zielprofil erlauben oder das Genre automatisch vorschlagen. Weichen Messwerte drastisch vom gewählten Genre ab, fragt die KI höflich nach, statt stur falsche Ratschläge zu erteilen.
2. **Session-Persistenz im Song:** Einstellungen gehören nicht isoliert in ein globales Desktop-Cache, sondern **in das DAW-Projekt selbst**. Speichert der Produzent sein Logic-Projekt (`Cmd + S`), speichert das JUCE-Master-Plugin den Zustand (`getStateInformation`) ab. Beim erneuten Öffnen der Session lädt das Plugin den Zustand (`setStateInformation`) und synchronisiert das HUD automatisch.

### Unter-Sprints & Aufgaben:

#### 3.1 Datenmodell & Crossover-Erweiterung (`packages/ai-engine/src/types/targets.ts` & JSON)
- **Datei:** `packages/ai-engine/src/types/targets.ts` und `packages/ai-engine/src/data/TargetProfiles.json`
- **Signal-Typen (`targetScope`):**
  - `mix_bus` (Master / Mix Bus)
  - `lead_vocal` (Lead Vocals)
  - `drum_bus` (Drums / Rhythmusgruppe)
  - `sub_bass` (Sub Bass / 808)
  - `keys_synths` (Synths / Keyboards)
  - `acoustic` (Akustische Instrumente / Gitarren)
- **Genre-Profile (`genreProfile`):**
  - `auto_detect`: KI analysiert Frequenz- und Dynamik-Fingerprint und wählt/schlägt das passendste Profil vor.
  - Standard-Profile: `hiphop_trap`, `pop_radio`, `rock_metal`, `edm_club`, `acoustic_jazz`.
  - `custom_crossover`: Individuelles Profil. Erlaubt die Kombination zweier Welten (z. B. Sub-Bass von Trap + Mitten von Rock/Metal) plus Notizenfeld für spezifische Absichten.
- **TypeScript-Typen:**
  ```typescript
  export interface TargetProfile {
    id: string;
    targetScope: string;
    genreProfile: string;
    isCustom?: boolean;
    customNotes?: string;
    targetIntegratedLufs: number;
    toleranceLufs: number;
    crestFactorRange: { min: number; max: number };
    maxTruePeakDb: number;
    recommendedHeadroomDb: number;
    spectralTargets: {
      subBassDb: number;   // 20-60 Hz
      bassDb: number;      // 60-250 Hz
      lowMidDb: number;    // 250-1000 Hz
      highMidDb: number;   // 1-5 kHz
      airDb: number;       // 5-20 kHz
    };
  }
  ```

#### 3.2 JUCE Plugin Session-Persistenz (`plugins/meter-audio/src/PluginProcessor.cpp`)
- **Plugin-Zustandsspeicherung im DAW-Projekt:**
  - In `PluginProcessor::getStateInformation`:
    - Serialisiere die aktiven Ziel-Einstellungen (`targetScope`, `genreProfile`, `customNotes`, `customTargets`) in den XML-/Binary-Chunk des Audio-Plugins.
    - Speichert der Musiker sein Logic- oder Nuendo-Projekt, sind die Mixing-Targets untrennbar mit dem Projekt verknüpft!
  - In `PluginProcessor::setStateInformation`:
    - Deserialisiere den Zustand beim Laden des Projekts.
    - Sende ein Begrüßungs-/Sync-Frame an den WebSocket-Port `48123`:
      ```json
      {
        "type": "project_context_sync",
        "targetScope": "mix_bus",
        "genreProfile": "custom_crossover",
        "customNotes": "Drum & Bass Low End mit Metal Gitarren-Mitten"
      }
      ```
- **Zwei-Wege-Sync:** Änderungen am Genre-Dropdown im Desktop-HUD senden einen Befehl an das Plugin, damit der State vor dem nächsten DAW-Speichern aktuell ist.

#### 3.3 UI: Dropdowns, Crossover-Modal & Auto-Detect (`apps/desktop/src/`)
- **Toolbar-Elemente im Desktop-HUD:**
  - Dropdown 1: `[ 🎯 Bus: Mix Bus ▼ ]` (Mix Bus, Lead Vocal, Drum Bus, Sub Bass, Synths, Acoustic)
  - Dropdown 2: `[ 🎵 Genre: Pop / Radio ▼ ]`
    - Optionen: `✨ Auto-Detect (KI)`, `Hip-Hop / Trap`, `Pop / Radio`, `Rock / Metal`, `EDM / Club`, `Acoustic / Jazz`, `⚙️ Individuell / Crossover...`
- **Modal für „Individuell / Crossover“:**
  - Ermöglicht dem Künstler, Low-End und High-End aus verschiedenen Profilen zu mischen oder Freitext einzugeben (z. B. *„Aggressive DnB Drums mit 90er Grunge Gitarren“*).
  - Speichert das Profil sofort in den Plugin-State.

#### 3.4 Intelligente KI-Plausibilitätsprüfung & Prompt-Injection (`packages/ai-engine/`)
- Dynamische Voranalyse vor jedem Prompt:
  - **Plausibilitäts-Check:** Wenn der Nutzer `Acoustic / Jazz` gewählt hat, das Signal aber bei $-8\text{ LUFS}$ und $7\text{ dB}$ Crest liegt, fragt die KI im Chat proaktiv nach:
    > *„Hinweis: Deine Messwerte zeigen extreme Verdichtung ($-8\text{ LUFS}$), was eher für Club/EDM als für Jazz spricht. Mischt du einen Crossover-Track oder möchtest du das Genre anpassen?“*
  - **Delta-Berechnung:** Das Prompt-Template vergleicht Ist- mit Soll-Werten des Profils und begründet alle ActionCards anhand dieses Zielkorridors.

### Abnahmekriterien Sprint 3:
- [ ] Dropdowns für Bus und Genre sind im Desktop-HUD aktiv und bieten `Auto-Detect` sowie `Individuell / Crossover`.
- [ ] Einstellungen werden im JUCE-Plugin serialisiert und beim Speichern/Laden des DAW-Projekts verlässlich wiederhergestellt.
- [ ] Die KI bezieht sich in ActionCards auf das gewählte Genre und fragt bei groben Messwert-Diskrepanzen höflich nach.
- [ ] `./scripts/lint-loc.sh` und `pnpm -r run build` laufen fehlerfrei durch.
- [ ] Git Commit & Push auf `main`.
- **🛑 STOPP & WARTEN AUF USER-FREIGABE!**

---

## 🚀 Sprint 4: AI Spectral Compare & Referenz-Audio Profiler
*Ziel: Visueller und psychoakustischer A/B-Vergleich des eigenen Mixes mit einem Referenztrack (wie in EchoJay).*

### Warum ist das nötig?
Ein Toningenieur mischt nie im Vakuum – er vergleicht seinen Mix stets mit einem hochklassigen kommerziellen Referenzsong. Der Buddy soll die Kurve des Referenzsongs visualisieren und Frequenzkonflikte automatisch als ActionCard vorschlagen.

### Unter-Sprints & Aufgaben:

#### 4.1 Audio Dropzone & Offline-WebAudio Profiler (`apps/desktop/src/components/ReferenceTrackModal.tsx`)
- **UI-Element:** Button `[📊 Referenz-Track]` in der HUD-Toolbar.
- **Modal mit Drag & Drop Zone:**
  - Akzeptiert Audiofiles (`.wav`, `.mp3`, `.aiff`).
  - WebAudio `OfflineAudioContext` decodiert die Datei im Browser/Tauri.
- **Metrologie-Berechnung:**
  - Berechnet Integrated LUFS (BS.1770-4), Peak und Crest Factor.
  - Berechnet 32-Band FFT gemittelt über den lautesten Song-Abschnitt (Chorus-Detektion via RMS-Peak-Fenster).

#### 4.2 Persistenz in der Benutzer-Bibliothek (`~/.mixing-buddy/references/*.json`)
- **Tauri Command / Rust Backend:**
  - Speichern des berechneten Fingerprints unter `~/.mixing-buddy/references/<TrackTitle>.json`.
  - Bereitstellung von `list_reference_tracks()` und `load_reference_track(id)`.
  - Ermöglicht das Wiederverwenden von Referenzen über verschiedene Sessions hinweg.

#### 4.3 Dual-Graph RTA-Rendering im HUD (`apps/desktop/src/components/RtaGraph.tsx` oder `App.tsx`)
- Erweiterung des bestehenden 32-Band RTA-Graphen:
  - **Kurve 1 (Türkis / Balken):** Das Live-Signal aus unserem JUCE-Plugin (30 fps).
  - **Kurve 2 (Rosa gestrichelt / Linie):** Die gespeicherte 32-Band-Spektralhüllkurve der Referenz.
  - Dropdown im RTA-Header: `[Referenz: Drake - God's Plan ▼]`.

#### 4.4 Automatischer Spektral-Differenz-Vorschlag (`mcp__compare_with_reference`)
- Mathematische Differenz:
  $$\Delta(f) = \text{FFT}_{\text{Mix}}(f) - \text{FFT}_{\text{Ref}}(f)$$
- Wenn ein Frequenzband um $\vert{}\Delta(f)\vert{} \ge 2{,}5\text{ dB}$ abweicht:
  - Button im RTA: `[⚡ An Referenz anpassen]`.
  - Erzeugt automatisch eine ActionCard für den Channel EQ mit den Gegenmaßnahmen.

### Abnahmekriterien Sprint 4:
- [ ] Eine Audio-Datei kann per Drag & Drop geladen und als Referenz analysiert werden.
- [ ] Die rosa Referenzkurve wird über dem Live-RTA im HUD gerendert.
- [ ] Die Differenz-ActionCard passt den Mix an die Referenz an.
- [ ] Build, Lint & Git Push.
- **🛑 STOPP & WARTEN AUF USER-FREIGABE!**

---

## 🚀 Sprint 5: Custom Mixing Skill Editor & 5-Schritte-Synthese-Wizard
*Ziel: Übertragung des bewährten Legal-Studio-Frameworks auf das Audio-Engineering für maßgeschneiderte Engineer-Personas.*

### Warum ist das nötig?
Jeder Producer hat eigene Arbeitsweisen. Der Wizard führt den Nutzer durch 5 Schritte und generiert daraus ein valides Skill-Bundle (inklusive Dual-Mode: Schnellstart für Live-HUD & Werkstatt für Deep-Audits) mit Revisions-Historie.

### Unter-Sprints & Aufgaben:

#### 5.1 Skill-Datenmodell & Storage-IPC (`packages/ai-engine/src/types/skills.ts`)
- **Speicherort:** `~/.mixing-buddy/skills/<skill-id>.json`.
- **Datenstruktur:**
  ```typescript
  export interface MixingSkill {
    id: string;
    name: string;
    category: "vocal" | "drums" | "master" | "bass" | "general";
    isFavorite: boolean;
    version: string;
    revisionHistory: { version: string; timestamp: string; comment: string }[];
    metrologyTargets: {
      integratedLufs: number;
      toleranceLufs: number;
      crestFactor: { min: number; max: number };
      maxTruePeakDb: number;
      recommendedHeadroomDb: number;
    };
    preferredChain: {
      slotType: "utility" | "eq" | "dynamics" | "saturation" | "space";
      preferredPluginHint?: string;
      typicalRules: string[];
    }[];
    prompts: {
      quickstart: string;  // Kompakter Prompt für HUD ActionCards
      workshop: string;    // Ausführlicher Diagnose-Prompt
    };
  }
  ```
- **Tauri IPC Commands:** `save_mixing_skill`, `list_mixing_skills`, `delete_mixing_skill`.

#### 5.2 Skill-Management Modal („Meine Mixing-Skills & Workflows“)
- **UI:** Kachelsystem analog zum Legal Studio (`apps/desktop/src/components/SkillManagerModal.tsx`).
- Kacheln mit Badges: Version (`v1.0`), Modus-Tags (`[🚀 Schnellstart]`, `[🛠️ Werkstatt]`), Favoriten-Stern (`⭐`).
- Buttons: `[+ Neuen Skill erstellen]`, `[🚀 KI-Skill-Synthese Wizard starten]`.
- Revisions-Baum-Ansicht für Versionierung und Rollback.

#### 5.3 Der 5-Schritte-Synthese-Wizard UI (`apps/desktop/src/components/SkillWizardModal.tsx`)
- **Schritt 1: Disziplin & Audio-Fokus**
  - Auswahl: Mastering/Bus, Lead Vocals, Drum-Bus, Low-End (808/Bass), Akustik.
  - Genre-Kontext & Name (z. B. „Tonmischmeister“ oder „Aggressive Trap 808“).
- **Schritt 2: Metrologie-Targets & Grenzwerte (Tabelle)**
  - Eingabe von LUFS, Crest Factor Min/Max, True Peak Ceiling, Pre-Gain Staging (-18 dBFS).
- **Schritt 3: Tools & Klang-Ästhetik**
  - Stock vs. Vault-Plugins (z. B. Pro-Q 3, ChromaGlow).
  - Charakter: Neutral-Clean, Tape-Warmth, Vintage-Opto, Hard-Clipper.
- **Schritt 4: Prüfmethodik & Metrologie-Ampel**
  - Definition der Kriterien für 🟢 Optimal, 🟡 Aufmerksamkeit (Maskierung), 🔴 Kritisch (Clipping, Phase $<0{,}2$).
- **Schritt 5: KI-Synthese & Dual-Prompt Generierung**
  - Die AI-Engine synthetisiert die Antworten und generiert das fertige Markdown/JSON-Bundle mit Schnellstart- und Werkstatt-Prompts.

#### 5.4 Laufzeit-Injektion in HUD-Chat & MCP
- **HUD-Chat Toolbar:** Dropdown zur Auswahl des aktiven Experten-Skills (`[Skill: Tonmischmeister v1.1 ▼]`).
- Dynamische Injektion in `packages/ai-engine/src/prompts.ts`:
  - Der aktive Skill überschreibt die Basis-Leitplanken und steuert das musikalische Verhalten der ActionCards.

### Abnahmekriterien Sprint 5:
- [ ] Skills können per Wizard erstellt, versioniert und dauerhaft gespeichert werden.
- [ ] Der aktive Skill steuert spürbar die Parameter und Begründungen der generierten ActionCards.
- [ ] Build & Packaging der Desktop-App laufen fehlerfrei durch.
- [ ] Git Commit & Push auf `main`.
- **🛑 FINALE FREIGABE PHASE 2!**