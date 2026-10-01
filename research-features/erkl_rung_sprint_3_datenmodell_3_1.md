# Deep-Dive: Was ist das Ziel von Sprint 3 und was bedeutet Punkt 3.1?

## 1. Das übergeordnete Ziel von Sprint 3 (Das "Warum")

Bislang agiert der Mixing Buddy wie ein fähiger Assistent mit verbundenen Augen bezüglich der **Stilistik** und der **Session-Zukunft**:

1. **Bisherige Situation:**
   * Wenn du schreibst: *„Optimiere den Mix“*, peilt die KI meist stur Standard-Streaming-Werte an (z. B. $-14\text{ LUFS}$, moderate Dynamik).
   * Sie weiß nicht, ob das Projekt ein Club-lastiger Drum & Bass Track (der $-7\text{ LUFS}$ und massive Sub-Bässe verträgt), ein dynamisches Jazz-Trio oder ein Hybrid aus Trap und Metal ist.
   * Wenn du Logic schließt (`Cmd + Q`), sind deine Mixing-Ziele weg; beim nächsten Öffnen startet alles wieder bei null.

2. **Das Ziel von Sprint 3:**
   * **Musikalische Kontext-Sensitivität:** Das System erhält definierte Zielkorridore (Targets) für verschiedene Signalarten (Vocals, Drums, Mix Bus) und Musikstile.
   * **Crossover-Freiheit:** Künstler können Genres frei kombinieren oder der KI per Freitext mitteilen, was sie klanglich anstreben (z. B. *„Trockene 90er Boom-Bap Drums mit modernem Hyperpop-Vocal-Glanz“*).
   * **Projekt-Persistenz im Song:** Diese Einstellungen werden nicht in einem globalen Cache auf dem Mac vergraben, sondern **im DAW-Projekt selbst gespeichert** (über das JUCE-Plugin). Öffnest du den Song in zwei Wochen wieder, sind alle Zielwerte exakt wieder da.

---

## 2. Was genau bedeutet Punkt 3.1 („Datenmodell & Crossover-Erweiterung“)?

In der Softwareentwicklung ist das **Datenmodell** das Fundament: Es definiert die gemeinsame Sprache und die Schablone, auf die sich Frontend, KI und Plugin einigen. Bevor man ein Dropdown im HUD zeichnen oder Daten im Plugin speichern kann, muss der Code wissen: **Aus welchen Werten besteht ein Mixing-Ziel überhaupt?**

Punkt 3.1 baut genau diese Struktur in TypeScript und JSON auf:

### A. Die Signal-Typen (`targetScope`)
Die KI muss wissen, welchen Bus oder welches Instrument sie gerade bewertet. Ein Ziel für eine Lead-Vocal sieht völlig anders aus als für einen Mix-Bus:
* `mix_bus`: Der gesamte Master-Kanal (Summe).
* `lead_vocal`: Fokus auf Sprachverständlichkeit, De-Essing ($5\text{–}8\text{ kHz}$) und Intimität.
* `drum_bus`: Fokus auf Transienten-Punch, Crest-Factor und Kompression.
* `sub_bass`: Fokus auf Phasenstabilität und Mono-Kompatibilität ($< 80\text{ Hz}$).

### B. Die physikalischen & spektralen Ziel-Kennzahlen
Ein Genre-Profil ist kein Text-Geschwätz, sondern eine mathematische Schablone mit messbaren Toleranzfenstern:
* **Lautheit & Dynamik:** 
  * `targetIntegratedLufs`: z. B. $-8\text{ LUFS}$ für EDM vs. $-16\text{ LUFS}$ für Jazz.
  * `crestFactorRange`: Erlaubter Dynamik-Spielraum (z. B. $7\text{ bis }9\text{ dB}$ bei Trap vs. $> 14\text{ dB}$ bei Klassik).
  * `maxTruePeakDb`: Spitzenwert-Grenze (z. B. $-1{,}0\text{ dBTP}$).
* **32-Band FFT-Zielkurve (Die 5 Zonen):**
  * Sub-Bass ($20\text{–}60\text{ Hz}$)
  * Bass ($60\text{–}250\text{ Hz}$)
  * Low-Mid ($250\text{–}1.000\text{ Hz}$)
  * High-Mid ($1\text{–}5\text{ kHz}$)
  * Air ($5\text{–}20\text{ kHz}$)

### C. Das Crossover- & Notizen-Feature
Künstler lassen sich nicht in Schubladen stecken. In 3.1 wird deshalb das Datenfeld `customNotes` und die Crossover-Verknüpfung verankert:
* Der Nutzer wählt z. B. `custom_crossover` und gibt ein:  
  *„Sub-Bass von Trap (35–60 Hz dominant), aber Mittenbereich von 90er Grunge-Rock (raue Gitarren bei 1,5–3 kHz)“*.
* Dieses Profil wird strukturiert abgespeichert, sodass die KI beim Erstellen von ActionCards genau diese Vorgabe als Referenz heranzieht.

---

## 3. Wie die 4 Bausteine von Sprint 3 zusammenhängen

```
┌────────────────────────────────────────────────────────────────────────┐
│  3.1 DATENMODELL (Die Definition)                                      │
│  Legt fest: Welche Zahlen, Zonen und Freitext-Notizen gibt es?        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         ▼                                                   ▼
┌──────────────────────────────────┐    ┌────────────────────────────────┐
│  3.3 UI IM DESKTOP-HUD           │    │  3.2 JUCE-PLUGIN PERSISTENZ    │
│  Dropdowns für Bus & Genre        │    │  Speichert das gewählte Profil │
│  + Modal für individuelle Notizen│    │  beim Speichern im Song-File   │
│  und Crossover-Kombinationen.    │    │  (.logicx / .cpr).             │
└──────────────────────────────────┘    └────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│  3.4 KI-PLAUSIBILITÄT & PROMPT-INJEKTION                               │
│  Die KI vergleicht Ist-Messwerte mit dem Profil. Weichen sie extrem    │
│  ab, fragt sie nach („Mischt du Crossover?“). ActionCards zielen       │
│  präzise auf diesen Korridor ab.                                       │
└────────────────────────────────────────────────────────────────────────┘
```

## Fazit

* **Punkt 3.1** baut die Datengrundlage (die Schablonen für Frequenzen, Lautheit und Notizen).
* **Das Gesamtziel von Sprint 3** ist, dass der Oszillation Mixing Buddy deinen Song stilistisch versteht, Crossover-Wünsche respektiert und deine Einstellungen dauerhaft im DAW-Projekt gesichert bleiben.