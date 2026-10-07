# ARCHITEKTUR-KONZEPT: AKUSTISCHE SIGNAL-KLASSIFIKATION & CO-PRODUCER RÜCKFRAGEN

## 1. Ehrlicher Status Quo (Stand v0.5.3 / v0.5.4)

Im aktuellen Stand (Phase 2A / 2B) arbeitet der Resolver noch **primär textbasiert**:

1. **Der aktuelle Ablauf:**
   - Liegt das Plugin auf `Motown Revisited Kit` $\rightarrow$ Erkennt das Wort `Kit` $\rightarrow$ wählt `drum_bus`.
   - Liegt das Plugin auf `Studio Grand` $\rightarrow$ Erkennt das Wort `Grand` $\rightarrow$ wählt `keys_synths`.
   - Heißt die Spur jedoch `oeifjoeifjwe`, `Audio 1`, `Spur 12` oder hat nur eine Farbmarkierung $\rightarrow$ Der Code greift aktuell noch auf den sicheren Fallback **`mix_bus`** zurück.
2. **Die aktuelle Lücke:**
   - Die KI fragt in v0.5.4 bei unbekannten Namen noch **nicht** eigenständig nach, sondern nimmt konservativ an, dass sie auf dem Master-Bus hört.

Da DAWs vor allem Audio und Arbeitsfluss bedeuten und Musiker Spuren oft nicht ordentlich beschriften, muss hier eine **echte Audio-Intelligenz** greifen.

---

## 2. Die 3-Stufen-Erkennung für die Praxis

```
                      ┌────────────────────────────────────────┐
                      │   Spurname aus DAW-Bridge empfangen    │
                      └───────────────────┬────────────────────┘
                                          │
                        Ist der Name semantisch eindeutig?
                        (z. B. "Kit", "Vocal", "Bass", "Master")
                                 /                \
                             JA /                  \ NEIN (z. B. "Audio 1", "oeifjoeifjwe")
                               ▼                    ▼
                   ┌──────────────────────┐   ┌────────────────────────────────────────┐
                   │ Stufe 1: Auto-Scope  │   │ Stufe 2: Akustischer Fingerabdruck     │
                   │ (Text-Heuristik)     │   │ (FFT-Schwerpunkt, Crest, Transienten) │
                   └──────────────────────┘   └───────────────────┬────────────────────┘
                                                                  │
                                                Konfidenz der Audio-Klassifikation?
                                                         /                 \
                                              HOCH (≥ 80%) /                   \ UNKLAR (< 80%)
                                                          ▼                     ▼
                                            ┌──────────────────────┐   ┌──────────────────────┐
                                            │ Auto-Scope mit Badge │   │ Stufe 3: Co-Producer │
                                            │ "[ ⚡ Audio-Detect ]" │   │ Dialog-Rückfrage im  │
                                            │                      │   │ Chat an den Musiker  │
                                            └──────────────────────┘   └──────────────────────┘
```

---

## 3. Akustische Parameter zur Signalkennung (Stufe 2)

Wenn der Name unbrauchbar ist, liefert unsere 30-fps-Telemetrie eindeutige akustische Signaturen:

| Signal-Typ (`targetScope`) | Spektraler Schwerpunkt (FFT) | Crest-Faktor (Peak/RMS) | Typisches Transienten-Verhalten |
|---|---|---|---|
| **Drums / Percussion** | Energie in Subbass ($40\text{–}80\text{ Hz}$) und Höhen ($> 5\text{ kHz}$); Mitten dip | Sehr hoch ($12\text{–}18\text{ dB}$) | Extrem schnelle Attack-Spikes, steile Transienten |
| **Sub Bass / 808** | Fast die gesamte Energie unter $120\text{ Hz}$; steiler Abfall ab $300\text{ Hz}$ | Niedrig bis mittel ($6\text{–}10\text{ dB}$) | Gleichmäßige Hüllkurve, wenig Höhenanteile |
| **Lead Vocal** | Kaum Energie unter $80\text{ Hz}$; dominanter Kern bei $1\text{–}4\text{ kHz}$ | Dynamisch ($10\text{–}15\text{ dB}$) | Pausen zwischen Phrasen, Formant-Strukturen |
| **Keys / Synths** | Breitbandig, moderate Bässe, dichte Mitten ($300\text{–}2.500\text{ Hz}$) | Mittel ($8\text{–}12\text{ dB}$) | Breites Stereobild, komplexes Obertonspektrum |
| **Master / Mix Bus** | Vollständiges Spektrum von $20\text{ Hz}$ bis $20\text{ kHz}$ | Komprimiert ($8\text{–}12\text{ dB}$) | Höchste spektrale Dichte über alle 32 Bänder |

---

## 4. Die Co-Producer Rückfrage (Stufe 3)

Wenn das Audiosignal nicht mit mindestens 80 % Sicherheit klassifiziert werden kann, schlägt die KI keine voreiligen Schnitte vor, sondern fragt im Chat gezielt nach:

> **AI Co-Producer:**  
> *„Ich höre auf der Spur **'oeifjoeifjwe'** ein dynamisches Signal mit perkussiven Spitzen und Mittenenergie. Handelt es sich um eine Drum-Gruppe, Akustikgitarren oder einen Synth-Loop? Klicke kurz auf die passende Rolle, damit ich die richtigen EQ- und Dynamik-Maßstäbe anlege:“*  
>  
> `[ 🥁 Drums ]` `[ 🎸 Akustik / Git ]` `[ 🎹 Keys / Synth ]` `[ 🎧 Gesamtmix ]`

---

## 5. Fahrplan zur Umsetzung

1. **Phase 2B (Aktueller Build):** Schützt das System davor, auf bekannten Einzelspuren falsche Master-LUFS oder unpassende Frequenzen zu verlangen.
2. **Phase 2C (Nächster Schritt):**
   - Telemetrie-Klassifikator (`classifySignalAcoustically(telemetry)`).
   - Co-Producer Intent im System-Prompt: Bei unklarem Kanalnamen und unklarer Akustik den Musiker aktiv befragen, statt blind von `mix_bus` auszugehen.