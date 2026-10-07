# ROADMAP & UMSETZUNGSPLAN: TRACK-AWARENESS & MULTI-BUS ARCHITEKTUR

**Basierend auf:** `docs/konzept_target_scope_und_multi_bus_architektur.md`  
**Ziel:** Vollautomatische DAW-Spurerkennung, Beseitigung manueller Fehlkonfigurationen und Skalierung für komplexe Großprojekte (60+ Spuren).

---

## 1. Status Quo & Bereits erreichter Stand (Stufe 1 abgeschlossen)

* ✅ **Signal-Fokus Re-Labeling:** Der Begriff `Bus:` wurde durch `Signal-Fokus:` mit Tooltip ersetzt.
* ✅ **Ground-Truth im Swift-Mixer:** `list-channel-strips` scannt alle echten Kanalzüge und Inserts von Logic Pro.
* ✅ **Vermeidung von Scheinfehlern:** Fader, Pan und Channel-Strip-eigene Parameter sind vom Insert-Plugin-Check entkoppelt.

---

## 2. Die nächste Ausbaustufe: Stufe 2 (DAW Track-Awareness & Auto-Scope)

Aktuell muss der Musiker im Dropdown noch manuell auswählen, ob das ankommende Signal ein *Master Mix*, *Lead Vocal* oder *Drum Bus* ist. 
In **Stufe 2** erkennt das System dies **vollautomatisch über die DAW-Bridge**, ohne dass der Nutzer klicken muss.

### Architektur-Ablauf von Stufe 2:

```text
 ┌────────────────────────────────────────────────────────┐
 │   Swift Bridge: `list-channel-strips`                  │
 │   Scannt Mixer & findet Insert `MixingBuddyMeter`     │
 └──────────────────────────┬─────────────────────────────┘
                            │
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │   Rust Backend / Tauri State (`active_meter_track`)   │
 │   Identifiziert Spur: z. B. "Stereo Out" oder "Vocal"  │
 └──────────────────────────┬─────────────────────────────┘
                            │
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │   Desktop HUD (React Header)                           │
 │   1. Setzt `Signal-Fokus` automatisch                  │
 │   2. Aktualisiert Header-Status:                       │
 │      "🟢 Listening: Stereo Out (Master) · 44.1 kHz"    │
 └────────────────────────────────────────────────────────┘
```

### Konkrete Aufgabenpakete für Stufe 2:

#### Paket 2.1: Lokalisierung des Meter-Plugins im Mixer (`lib.rs` / Swift)
* **Mechanismus:** Beim Start und bei Session-Updates prüft `scan_logic_pro_tracks`, auf welcher Spur der Insert `MixingBuddyMeter` (oder `MixingBudd`) geladen ist.
* **Ergebnis:** Gibt das Feld `meterInstanceTrack: string` zurück (z. B. `"Stereo Out"`, `"Lead Vocal"`, `"Drums"`).

#### Paket 2.2: Heuristischer Scope-Resolver (`targetScopeResolver.ts`)
* Ermittelt anhand des Spurnamens automatisch den besten `targetScope`:
  * `"Stereo Out"`, `"Master"`, `"Mix"`, `"Print"` $\rightarrow$ `'mix_bus'`
  * `"Vocal"`, `"Vox"`, `"Lead"`, `"Adlib"` $\rightarrow$ `'lead_vocal'`
  * `"Drums"`, `"Kit"`, `"Beats"`, `"Perc"` $\rightarrow$ `'drum_bus'`
  * `"Bass"`, `"808"`, `"Sub"` $\rightarrow$ `'sub_bass'`
  * `"Keys"`, `"Piano"`, `"Synth"` $\rightarrow$ `'keys_synths'`
  * `"Git"`, `"Acoustic"`, `"Strings"` $\rightarrow$ `'acoustic'`
* **Nutzer-Kontrolle:** Der Musiker sieht die automatische Zuweisung mit einem kleinen Badge `[ ⚡ Auto ]`, kann sie aber bei Bedarf manuell überstimmen.

#### Paket 2.3: Header-Status Synchronisation (`App.tsx`)
* Ganz rechts im Header steht aktuell statisch `[ 🎧 Master Bus: Online (44.1 kHz) ]`.
* Neu: Zeigt dynamisch den tatsächlichen Abhörpunkt:
  * `[ 🟢 Stereo Out (Master) · 44.1 kHz ]` oder `[ 🟢 Lead Vocal · 44.1 kHz ]`.

#### Paket 2.4: Prompt-Schutz & Kontext-Sensitivität (`prompts.ts`)
* **Schutzregel im System-Prompt:**
  * Wenn `targetScope === 'mix_bus'` und der Benutzer fragt: *„Wie klingen Kick und Bass?“*, bewertet das Modell deren Balance **im Kontext des Gesamtmixes**.
  * Liegt der Fokus auf einem Einzelsignal (`lead_vocal`), bewertet das Modell **nur dieses isolierte Signal** (z. B. Resonanzen, Sprachverständlichkeit, De-Essing) und rügt **nicht** das Fehlen von Subbässen.

---

## 3. Die Ausbaustufe für Großprojekte: Stufe 3 (Multi-Instanz & Satelliten-Routing)

In professionellen Produktionen mit 40–80 Spuren reicht ein einziges Plugin oft nicht aus, um gleichzeitig Subgruppen und Master im Blick zu behalten.

### Architektur-Spezifikation für Stufe 3:

1. **JUCE Telemetrie-Streaming mit Instanz-ID:**
   * Jede Plugin-Instanz sendet beim Start ihren DAW-Spurnamen und eine eindeutige UUID:
     ```json
     {
       "type": "register_instance",
       "instanceId": "inst_master_01",
       "trackName": "Stereo Out",
       "sampleRate": 44100
     }
     ```
2. **Dynamischer Abhörpunkt-Selector im HUD:**
   * Das Dropdown im Header listet künftig alle aktiven Messpunkte:
     ```text
     [ 🎯 Abhörpunkt: Stereo Out (Master Mix) ▾ ]
       ├── 🟢 Stereo Out (Master Mix) [Aktiv]
       ├── 🟢 Drum Bus (Aux 1)
       └── 🟢 Lead Vocal (Spur 12)
     ```
3. **Umschaltung ohne Plugin-Wechsel:**
   * Klickt der Musiker im HUD auf `Drum Bus`, schaltet die RTA-Anzeige sofort auf die Telemetriedaten dieser Instanz um.
   * Prompts und ActionCards fokussieren sich ohne manuelle Eingriffe auf die gewählte Gruppe.

---

## 4. Priorisierter Fahrplan

| Meilenstein | Inhalt | Aufwand | Nutzen |
|---|---|---|---|
| **Phase 2A (Nächster Schritt)** | **Auto-Detection des Meter-Kanals:** Erkennen, auf welcher Spur `MixingBuddyMeter` liegt, dynamischer Header-Status & Auto-Scope | Gering (1 Sprint) | **Sofortiger Schutz vor Fehlbedienung** |
| **Phase 2B** | **Prompt-Safeguards:** Kontext-Schutzregeln für Mix Bus vs. Einzelsignale in `prompts.ts` | Sehr gering | **Präzisere KI-Kritik** |
| **Phase 3 (Multi-DAW / Sprint 13+)** | **Multi-Instanz WebSocket Manager:** Verwalten mehrerer Satelliten-Plugins in Großprojekten | Mittel (2 Sprints) | **High-End Studio Skalierbarkeit** |