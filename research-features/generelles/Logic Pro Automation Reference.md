# **Technische Entwickler-Referenz: Programmatische Fernsteuerung von Apple Logic Pro**

Diese Spezifikation dient als Implementierungsgrundlage für Systemingenieure und Software-Architekten zur Automatisierung und Fernsteuerung von Apple Logic Pro (Fokus auf Logic Pro 10.x und Logic Pro 11). Sie deckt hardwarenahe Protokolle (Mackie Control Universal / CoreMIDI), Betriebssystem-Schnittstellen (macOS Accessibility API, CoreGraphics CGEvents) sowie native Plug-in- und Skript-Schnittstellen ab.

## **1\. MCU (Mackie Control Universal) MIDI-Protokoll-Matrix für Logic Pro**

Das Mackie Control Universal (MCU)-Protokoll basiert historisch auf einer engen Kooperation zwischen Emagic und Mackie1. Es adaptiert Standard-MIDI-1.0-Nachrichten für hochauflösende Steuerungs- und Feedback-Zwecke innerhalb digitaler Audio-Workstations2. Logic Pro unterstützt sowohl das historische Emagic Logic Control-Format (LC, Device ID 0x10) als auch das standardisierte Mackie Control Universal-Format (MCU, Device ID 0x14)3.

### **Status-Bytes und MIDI-Kanal-Architektur**

Die bidirektionale Kommunikation ist strikt auf definierte MIDI-Kanäle aufgeteilt3:

* **MIDI-Kanal 1 (Status 0x90 / 0x80 bzw. 0xB0):** Übertragung sämtlicher Taster als Note-On/Off-Events, Ansteuerung der korrespondierenden Taster-LEDs, Abfrage der V-Pot-Drehimpulse (CC 16–23) sowie Ansteuerung der 7-Segment-Displays (CC 64–75)3.  
* **MIDI-Kanäle 1 bis 8 (Status 0xE0 bis 0xE7):** Übertragung und Empfang der 14-Bit-Motorfader-Positionen für die Kanalzüge 1 bis 8 via Pitchbend-Nachrichten3.  
* **MIDI-Kanal 9 (Status 0xE8):** Übertragung und Empfang der 14-Bit-Pitchbend-Nachrichten für den Master-Fader3.  
* **MIDI-System-Exclusive (0xF0 ... 0xF7):** Initialisierungs-Handshake, LCD-Scribble-Strip-Text-Updates und globale Konfigurationsbefehle3.

Bei physikalischen Tastern sendet der Controller beim Drücken ein Note On mit Velocity 127 (0x7F) und beim Loslassen ein Note On mit Velocity 0 (0x00) oder ein Note Off (0x80)3. Logic Pro spiegelt den Zustand über denselben Notenwert an den Controller zurück, um LEDs anzusteuern: Velocity 0x7F aktiviert die LED dauerhaft, 0x00 schaltet sie ab, und bei spezifischen Funktionen signalisiert 0x01 ein Blinken3.

### **Tasten und Transport (MIDI Note-On/Off)**

Sämtliche Steuerungs- und Transporttaster operieren auf **MIDI-Kanal 1**3. Die folgende Tabelle führt alle Notenwerte auf, die von Logic Pro in der MCU-Belegung interpretiert werden3.

| Funktionsgruppe | Taste / Funktion | Dezimal | Hex | Notenname | Richtung |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **Transport** | Rewind | 91 | 0x5B | G6 | Bidirektional3 |
| **Transport** | Fast Forward | 92 | 0x5C | G\#6 | Bidirektional3 |
| **Transport** | Stop | 93 | 0x5D | A6 | Bidirektional3 |
| **Transport** | Play | 94 | 0x5E | A\#6 | Bidirektional3 |
| **Transport** | Record | 95 | 0x5F | B6 | Bidirektional3 |
| **Transport** | Cycle (Loop) | 86 | 0x56 | D6 | Bidirektional3 |
| **Cursor & Nav** | Cursor Up | 96 | 0x60 | C7 | Controller ![][image1] Host3 |
| **Cursor & Nav** | Cursor Down | 97 | 0x61 | C\#7 | Controller ![][image1] Host3 |
| **Cursor & Nav** | Cursor Left | 98 | 0x62 | D7 | Controller ![][image1] Host3 |
| **Cursor & Nav** | Cursor Right | 99 | 0x63 | D\#7 | Controller ![][image1] Host3 |
| **Cursor & Nav** | Zoom Toggle | 100 | 0x64 | E7 | Bidirektional3 |
| **Cursor & Nav** | Scrub | 101 | 0x65 | F7 | Bidirektional3 |
| **Zuweisung** | Track | 40 | 0x28 | E2 | Bidirektional3 |
| **Zuweisung** | Send | 41 | 0x29 | F2 | Bidirektional3 |
| **Zuweisung** | Pan / Surround | 42 | 0x2A | F\#2 | Bidirektional3 |
| **Zuweisung** | Plug-in | 43 | 0x2B | G2 | Bidirektional3 |
| **Zuweisung** | EQ | 44 | 0x2C | G\#2 | Bidirektional3 |
| **Zuweisung** | Instrument | 45 | 0x2D | A2 | Bidirektional3 |
| **Banking** | Fader Bank Left | 46 | 0x2E | A\#2 | Controller ![][image1] Host3 |
| **Banking** | Fader Bank Right | 47 | 0x2F | B2 | Controller ![][image1] Host3 |
| **Banking** | Channel Left | 48 | 0x30 | C3 | Controller ![][image1] Host3 |
| **Banking** | Channel Right | 49 | 0x31 | C\#3 | Controller ![][image1] Host3 |
| **Banking** | Flip (Fader ![][image2] V-Pot) | 50 | 0x32 | D3 | Bidirektional3 |
| **Banking** | Global View | 51 | 0x33 | D\#3 | Bidirektional3 |
| **Display-Modi** | Name / Value Display | 52 | 0x34 | E3 | Bidirektional3 |
| **Display-Modi** | SMPTE / Beats Display | 53 | 0x35 | F3 | Bidirektional3 |
| **Utilities** | Save | 80 | 0x50 | G\#5 | Bidirektional3 |
| **Utilities** | Undo | 81 | 0x51 | A5 | Bidirektional3 |
| **Utilities** | Cancel | 82 | 0x52 | A\#5 | Bidirektional3 |
| **Utilities** | Enter | 83 | 0x53 | B5 | Bidirektional3 |
| **Utilities** | Marker | 84 | 0x54 | C6 | Bidirektional3 |
| **Utilities** | Nudge | 85 | 0x55 | C\#6 | Bidirektional3 |
| **Utilities** | Drop (Autopunch) | 87 | 0x57 | D\#6 | Bidirektional3 |
| **Utilities** | Replace | 88 | 0x58 | E6 | Bidirektional3 |
| **Utilities** | Click (Metronom) | 89 | 0x59 | F6 | Bidirektional3 |
| **Utilities** | Solo Clear | 90 | 0x5A | F\#6 | Bidirektional3 |
| **Modifier** | Shift | 70 | 0x46 | A\#4 | Bidirektional3 |
| **Modifier** | Option | 71 | 0x47 | B4 | Bidirektional3 |
| **Modifier** | Control | 72 | 0x48 | C5 | Bidirektional3 |
| **Modifier** | Alt / Command | 73 | 0x49 | C\#5 | Bidirektional3 |
| **Automation** | Read / Off | 74 | 0x4A | D5 | Bidirektional3 |
| **Automation** | Write | 75 | 0x4B | D\#5 | Bidirektional3 |
| **Automation** | Trim | 76 | 0x4C | E5 | Bidirektional3 |
| **Automation** | Touch | 77 | 0x4D | F5 | Bidirektional3 |
| **Automation** | Latch | 78 | 0x4E | F\#5 | Bidirektional3 |
| **Automation** | Group | 79 | 0x4F | G5 | Bidirektional3 |
| **Function Keys** | F1 | 54 | 0x36 | F\#3 | Bidirektional3 |
| **Function Keys** | F2 | 55 | 0x37 | G3 | Bidirektional3 |
| **Function Keys** | F3 | 56 | 0x38 | G\#3 | Bidirektional3 |
| **Function Keys** | F4 | 57 | 0x39 | A3 | Bidirektional3 |
| **Function Keys** | F5 | 58 | 0x3A | A\#3 | Bidirektional3 |
| **Function Keys** | F6 | 59 | 0x3B | B3 | Bidirektional3 |
| **Function Keys** | F7 | 60 | 0x3C | C4 | Bidirektional3 |
| **Function Keys** | F8 | 61 | 0x3D | C\#4 | Bidirektional3 |

### **Kanalzug-Noten (Kanäle 1 bis 8\)**

Die elementaren Schaltfunktionen jedes Kanalzugs liegen gebündelt auf **MIDI-Kanal 1**3. Sie folgen einer lückenlosen chromatischen Staffelung3.

| Kanal | Rec Ready (Dez / Hex) | Solo (Dez / Hex) | Mute (Dez / Hex) | Select (Dez / Hex) | V-Pot Switch (Dez / Hex) |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **Kanal 1** | 0 / 0x00 (C-1) | 8 / 0x08 (G\#-1) | 16 / 0x10 (E0) | 24 / 0x18 (C1) | 32 / 0x20 (G\#1)3 |
| **Kanal 2** | 1 / 0x01 (C\#-1) | 9 / 0x09 (A-1) | 17 / 0x11 (F0) | 25 / 0x19 (C\#1) | 33 / 0x21 (A1)3 |
| **Kanal 3** | 2 / 0x02 (D-1) | 10 / 0x0A (A\#-1) | 18 / 0x12 (F\#0) | 26 / 0x1A (D1) | 34 / 0x22 (A\#1)3 |
| **Kanal 4** | 3 / 0x03 (D\#-1) | 11 / 0x0B (B-1) | 19 / 0x13 (G0) | 27 / 0x1B (D\#1) | 35 / 0x23 (B1)3 |
| **Kanal 5** | 4 / 0x04 (E-1) | 12 / 0x0C (C0) | 20 / 0x14 (G\#0) | 28 / 0x1C (E1) | 36 / 0x24 (C2)3 |
| **Kanal 6** | 5 / 0x05 (F-1) | 13 / 0x0D (C\#0) | 21 / 0x15 (A0) | 29 / 0x1D (F1) | 37 / 0x25 (C\#2)3 |
| **Kanal 7** | 6 / 0x06 (F\#-1) | 14 / 0x0E (D0) | 22 / 0x16 (A\#0) | 30 / 0x1E (F\#1) | 38 / 0x26 (D2)3 |
| **Kanal 8** | 7 / 0x07 (G-1) | 15 / 0x0F (D\#0) | 23 / 0x17 (B0) | 31 / 0x1F (G1) | 39 / 0x27 (D\#2)3 |

### **Fader-Spezifikation (14-Bit Pitchbend)**

Die Steuerung der Motorfader setzt auf hochauflösende MIDI-Pitchbend-Nachrichten (0xEn), um die für Audiofader erforderliche Genauigkeit bereitzustellen und Nebengeräusche durch Rastersprünge (Zipper-Noise) zu eliminieren3.  
Das Status-Byte definiert den Zielkanalzug: 0xE0 bis 0xE7 sprechen die Kanäle 1 bis 8 an, während 0xE8 für den Master-Fader reserviert ist3. Die 14-Bit-Nutzlast verteilt sich auf zwei 7-Bit-Daten-Bytes, wobei das Least Significant Byte (LSB) vor dem Most Significant Byte (MSB) übertragen wird:  
![][image3]  
Für die Zerlegung bei der Übertragung gilt:  
![][image4]

#### **Berührungserkennung (Fader Touch / Release)**

Echtzeit-Motorfader verfügen über kapazitive Berührungssensoren3. Um Reglerkonflikte und Regelschwingungen zwischen Nutzerhand und Motorsteuerung zu unterbinden, meldet der Controller das Berühren und Loslassen über dezidierte Notenwerte auf **MIDI-Kanal 1**3. Logic Pro friert bei eingehendem Touch-Signal die Automationsauslesung ein und schaltet in den Schreibmodus (abhängig vom Automationsstatus wie Touch oder Latch)3.

| Kanalzug | Touch Note-Nummer (Dez) | Touch Note-Nummer (Hex) | Notenname |
| :---- | :---- | :---- | :---- |
| **Kanal 1** | 104 | 0x68 | G\#7 |
| **Kanal 2** | 105 | 0x69 | A7 |
| **Kanal 3** | 106 | 0x6A | A\#7 |
| **Kanal 4** | 107 | 0x6B | B7 |
| **Kanal 5** | 108 | 0x6C | C8 |
| **Kanal 6** | 109 | 0x6D | C\#8 |
| **Kanal 7** | 110 | 0x6E | D8 |
| **Kanal 8** | 111 | 0x6F | D\#8 |
| **Master-Fader** | 112 | 0x70 | E8 |

Berührung entspricht Note On mit Velocity 127 (0x7F), Loslassen entspricht Note On mit Velocity 0 (0x00) oder Note Off (0x80)3.

#### **Fader-Kennlinie und dB-Umrechnung**

Die interne Skalierung in Logic Pro folgt einer logarithmisch-akustischen Kennlinie. Hardware-Controller operieren intern meist auf 10-Bit-Auflösung (1024 diskrete Schritte, Werte 0 bis 1023\)3. Der Unity-Gain-Punkt (![][image5]) liegt hardwareseitig bei Schritt 819 (bzw. 819,2; exakt 75 % des 1024er-Bereichs)3. Auf die 14-Bit-Ebene hochskaliert (![][image6]), entspricht Unity Gain exakt dem Wert **10240** (0x2800: LSB 0x00, MSB 0x50) bzw. **10239** (0x27FF: LSB 0x7F, MSB 0x4F)3.  
Die mathematische Abbildung zwischen Dezibel (![][image7]) und 14-Bit-MCU-Wert (![][image8]) gliedert sich in drei Abschnitte:

> 1. **Pegelanhebung (![][image5] bis ![][image9] für ![][image10]):**

**![][image11]**  
**![][image12]**

> 2. **Arbeitsbereich (![][image5] bis ![][image13] für ![][image14]):** In diesem Sektor verläuft die Kurve degressiv-gekrümmt:

![][image15]

> 3. **Abschwächung bis zur Stille (![][image13] bis ![][image16] für ![][image17]):** Der Fader fällt steil ab; ![][image18] repräsentiert ![][image16].

| Logic Pro Faderpegel (dB) | MCU 14-Bit Wert (V14​) | MSB (Hex / Dez) | LSB (Hex / Dez) | MIDI Pitchbend Sequenz |
| :---- | :---- | :---- | :---- | :---- |
| **\+6.0 dB (Max)** | 16383 | 0x7F / 127 | 0x7F / 127 | En 7F 7F |
| **\+3.0 dB** | 13311 | 0x67 / 103 | 0x7F / 127 | En 7F 67 |
| **0.0 dB (Unity Gain)** | **10240** | **0x50 / 80** | **0x00 / 0** | **En 00 50** |
| **\-3.0 dB** | 9180 | 0x47 / 71 | 0x5C / 92 | En 5C 47 |
| **\-6.0 dB** | 8192 | 0x40 / 64 | 0x00 / 0 | En 00 40 |
| **\-10.0 dB** | 6848 | 0x35 / 53 | 0x40 / 64 | En 40 35 |
| **\-15.0 dB** | 5450 | 0x2A / 42 | 0x4A / 74 | En 4A 2A |
| **\-20.0 dB** | 4352 | 0x22 / 34 | 0x00 / 0 | En 00 22 |
| **\-30.0 dB** | 2560 | 0x14 / 20 | 0x00 / 0 | En 00 14 |
| **\-40.0 dB** | 1280 | 0x0A / 10 | 0x00 / 0 | En 00 0A |
| **\-50.0 dB** | 576 | 0x04 / 4 | 0x40 / 64 | En 40 04 |
| **\-60.0 dB** | 320 | 0x02 / 2 | 0x40 / 64 | En 40 02 |
| ![][image19] **dB (Min)** | 0 | 0x00 / 0 | 0x00 / 0 | En 00 00 |

### **V-Pots (Drehregler für Pan / Sends / EQ)**

Endlosdrehgeber (V-Pots) generieren relative Änderungswerte über Control-Change-Nachrichten (0xB0) auf **MIDI-Kanal 1**3:

* **Kanalzüge 1 bis 8:** CC 16 bis CC 23 (0x10 bis 0x17)8.  
* **Scrub / Jog-Wheel:** CC 60 (0x3C)3.

#### **Drehwert-Kodierung**

Im Mackie-Control-Standard verarbeitet Logic Pro bevorzugt das **Sign-Magnitude-Verfahren** (Vorzeichen-Betrag-Darstellung)11:

* **Drehung im Uhrzeigersinn (Rechtsdrehung / Inkrement):** Bit 6 ist 0\. Die Bits 0 bis 5 definieren die Schrittweite (Geschwindigkeit). Der Wertbereich erstreckt sich von 0x01 bis 0x3F (![][image20] bis ![][image21]). Einzelschritte werden als 0x01 übertragen.  
* **Drehung gegen den Uhrzeigersinn (Linksdrehung / Dekrement):** Bit 6 ist 1 (0x40). Die Bits 0 bis 5 definieren den Betrag der negativen Änderung. Der Wertbereich erstreckt sich von 0x41 bis 0x7F. Einzelschritte werden als 0x41 (![][image22]) übertragen, schnellere Drehungen generieren Werte wie 0x42 (![][image23]) oder 0x43 (![][image24]).

Alternativ beherrschen manche Hardware-Controller das 7-Bit-Zweierkomplement (Relative Two's Complement)11. Hierbei entspricht die Rechtsdrehung den Werten 0x01 bis 0x3F, während die Linksdrehung bei 0x7F (![][image22]), 0x7E (![][image23]) etc. ansetzt11. Logic Pro unterstützt diese Modi über das Konfigurationsmenü für Bedienoberflächen.

#### **V-Pot LED-Ring Feedback**

Logic Pro spiegelt Parameterzustände über **CC 48 bis CC 55** (0x30 bis 0x37) auf **MIDI-Kanal 1** an die Hardware zurück9. Der 7-Bit-Datenwert kodiert Modus und Nadelposition des LED-Kranzes:

* **Bits 0–3 (Bereich 0 bis 11):** Position der leuchtenden LED von links nach rechts.  
* **Bits 4–5 (Darstellungsmodus):**  
  * 00 (![][image25]): **Single Dot** (Einzelleuchte, z. B. Panning).  
  * 01 (![][image26]): **Boost/Cut** (Mittenbezug, LED-Band wächst ab 12 Uhr nach links oder rechts; typisch für EQ Gain).  
  * 10 (![][image27]): **Wrap / Fill** (Pegelbalken, wächst kontinuierlich von ganz links; typisch für Send-Pegel).  
  * 11 (![][image28]): **Spread** (Symmetrisches Band von der Mitte nach außen; typisch für Stereobreite).  
* **Bit 6:** Status der Mitten-LED (1 \= Ein, 0 \= Aus).

### **7-Segment-Display & Timecode/Bars**

Die Display-Sektion der MCU besitzt 12 Siebensegment-Elemente: zwei Ziffern zur Modusanzeige (Assignment) und zehn Ziffern zur Locator- und Zeitanzeige (Timecode bzw. Bars/Beats)3.  
Logic Pro steuert diese Ziffern einzeln über **Control Change (0xB0)** auf **MIDI-Kanal 1** an3. Die Zuordnung erfolgt von rechts nach links über die CC-Nummern 64 bis 753.

| CC (Dez) | CC (Hex) | Display-Position | Funktion im BBT-Modus (Takte) | Funktion im SMPTE-Modus (Zeit) |
| :---- | :---- | :---- | :---- | :---- |
| **CC 64** | 0x40 | Ziffer 0 (Ganz rechts) | Ticks (1er-Stelle) | Subframes (1er-Stelle)3 |
| **CC 65** | 0x41 | Ziffer 1 | Ticks (10er-Stelle) | Subframes (10er-Stelle)3 |
| **CC 66** | 0x42 | Ziffer 2 | Ticks (100er-Stelle) | Frames (1er-Stelle)3 |
| **CC 67** | 0x43 | Ziffer 3 | Beat Division (1er) | Frames (10er-Stelle)3 |
| **CC 68** | 0x44 | Ziffer 4 | Beat Division (10er) | Sekunden (1er-Stelle)3 |
| **CC 69** | 0x45 | Ziffer 5 | Beat (1er-Stelle) | Sekunden (10er-Stelle)3 |
| **CC 70** | 0x46 | Ziffer 6 | Beat (10er-Stelle) | Minuten (1er-Stelle)3 |
| **CC 71** | 0x47 | Ziffer 7 | Bar / Takt (1er-Stelle) | Minuten (10er-Stelle)3 |
| **CC 72** | 0x48 | Ziffer 8 | Bar / Takt (10er-Stelle) | Stunden (1er-Stelle)3 |
| **CC 73** | 0x49 | Ziffer 9 | Bar / Takt (100er-Stelle) | Stunden (10er-Stelle)3 |
| **CC 74** | 0x4A | Assignment Rechts | Modus-Ziffer rechts | Modus-Ziffer rechts3 |
| **CC 75** | 0x4B | Assignment Links | Modus-Ziffer links | Modus-Ziffer links3 |

#### **Bit-Aufbau des Steuerbytes**

* **Bit 7:** Gemäß MIDI-Standard stets 03.  
* **Bit 6:** Dezimalpunkt / LED-Punkt des jeweiligen Segments (1 \= aktiv, 0 \= inaktiv)3.  
* **Bits 0–5:** Kodiert das darzustellende Zeichen über Standard-ASCII (0x30 bis 0x39 für die Ziffern 0 bis 9\)3. Da Bit 6 für den Punkt reserviert ist, filtert der Controller Bit 6 bei der Zeichenzuordnung aus3.

#### **SysEx-Display-Befehle**

Zur Aktualisierung ganzer Blöcke unterstützt das Protokoll zwei dedizierte SysEx-Befehle3:

* **Update TC/BBT Display (Cmd 0x10):**  
  F0 00 00 66 14 10 \[d9 d8 d7 d6 d5 d4 d3 d2 d1 d0\] F7  
  \[cite: 3\]  
  (Enthält 10 ASCII-Bytes für die Zeitanzeige von links nach rechts)3.  
* **Update Assignment Display (Cmd 0x11):**  
  F0 00 00 66 14 11 \[a1 a0\] F7  
  \[cite: 3\]  
  (Enthält 2 ASCII-Bytes für das Assignment-Feld)3.

### **LCD-Display (Scribble Strips)**

Die visuelle Beschriftung erfolgt über ein zweizeiliges Display mit je 56 Zeichen pro Zeile (Gesamtpuffer: 112 Zeichen)3. Jeder der acht physikalischen Kanalzüge beansprucht ein festes Feld von 7 Zeichen Breite pro Zeile3.

#### **SysEx-Header-Format**

F0 00 00 66 \<Model\_ID\> 12 \<ASCII-Daten...\> F7

* **0xF0:** System Exclusive Start-Byte3.  
* **0x00 0x00 0x66:** Herstellerkennung von Mackie Designs3.  
* **\<Model\_ID\>:** Zielgerät (0x10 \= Logic Control, 0x11 \= Logic Control XT, 0x14 \= MCU Pro, 0x15 \= MCU XT Pro)3.  
* **0x12:** Command-ID für LCD-Puffer-Updates3.  
* **\<Offset\>:** Schreibposition im internen Display-RAM (0x00 bis 0x6F)3:  
  * **Obere Zeile (Zeile 1):** Offset 0x00 bis 0x37 (Dezimal 0 bis 55; Länge: 56 Bytes)3.  
  * **Untere Zeile (Zeile 2):** Offset 0x38 bis 0x6F (Dezimal 56 bis 111; Länge: 56 Bytes)3.  
* **\<ASCII-Daten\>:** Folge von 7-Bit-ASCII-Zeichen (0x20 bis 0x7E)3. Logic Pro sendet entweder Teilaktualisierungen für spezifische Kanalblöcke oder den gesamten Block von bis zu 112 Zeichen in einem Übertragungszyklus3.  
* **0xF7:** End of Exclusive (EOX)3.

#### **Adressierung der Scribble-Strip-Kanalblöcke**

| Kanalzug | Obere Zeile (Offset Dez / Hex) | Untere Zeile (Offset Dez / Hex) | Blockgröße |
| :---- | :---- | :---- | :---- |
| **Kanal 1** | 0 – 6 (0x00 – 0x06) | 56 – 62 (0x38 – 0x3E) | 7 Zeichen |
| **Kanal 2** | 7 – 13 (0x07 – 0x0D) | 63 – 69 (0x3F – 0x45) | 7 Zeichen |
| **Kanal 3** | 14 – 20 (0x0E – 0x14) | 70 – 76 (0x46 – 0x4C) | 7 Zeichen |
| **Kanal 4** | 21 – 27 (0x15 – 0x1B) | 77 – 83 (0x4D – 0x53) | 7 Zeichen |
| **Kanal 5** | 28 – 34 (0x1C – 0x22) | 84 – 90 (0x54 – 0x5A) | 7 Zeichen |
| **Kanal 6** | 35 – 41 (0x23 – 0x29) | 91 – 97 (0x5B – 0x61) | 7 Zeichen |
| **Kanal 7** | 42 – 48 (0x2A – 0x30) | 98 – 104 (0x62 – 0x68) | 7 Zeichen |
| **Kanal 8** | 49 – 55 (0x31 – 0x37) | 105 – 111 (0x69 – 0x6F) | 7 Zeichen |

## **2\. Logic Pro Key-Command Default Referenz (Fernsteuerung via CGEvent)**

Für Automations-Tools, die außerhalb des MIDI-Layers agieren, stellt die synthetische Injektion von Tastaturereignissen über die CoreGraphics-Event-Pipeline (CGEventPost) eine performante Steuerungsoption dar. Diese Methode erfordert entsprechende Accessibility-Berechtigungen (TCC) im Betriebssystem.  
Die folgenden Shortcuts und nativer Virtual Key Codes basieren auf der HIToolbox-Header-Definition (Carbon.HIToolbox.Events.h) des macOS SDK13.

| Befehl in Logic Pro | Standard-Shortcut (US / DE) | HIToolbox Konstante | Keycode (Dez) | Keycode (Hex) | Modifikatoren |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **Gehe zu Position... (Locator)** | Keypad / | kVK\_ANSI\_KeypadDivide | 75 | 0x4B | Keine14 |
| **Gehe zu Position... (Alternative)** | Reguläre Taste / | kVK\_ANSI\_Slash | 44 | 0x2C | Keine |
| **Play / Stop Toggle** | Leertaste | kVK\_Space | 49 | 0x31 | Keine |
| **Stop** | Keypad 0 | kVK\_ANSI\_Keypad0 | 82 | 0x52 | Keine |
| **Play von Selektion / Pause** | Eingabetaste (Return) | kVK\_Return | 36 | 0x24 | Keine |
| **Aufnahme (Record)** | R | kVK\_ANSI\_R | 15 | 0x0F | Keine |
| **Aufnahme (Alternative)** | Keypad \* | kVK\_ANSI\_KeypadMultiply | 67 | 0x43 | Keine |
| **Cycle-Modus ein/aus** | C | kVK\_ANSI\_C | 8 | 0x08 | Keine |
| **Mixer-Fenster ein/aus** | X | kVK\_ANSI\_X | 7 | 0x07 | Keine |
| **Inspector ein/aus** | I | kVK\_ANSI\_I | 34 | 0x22 | Keine |
| **Spurauswahl: Vorherige Spur** | Pfeiltaste oben (![][image29]) | kVK\_UpArrow | 126 | 0x7E | Keine |
| **Spurauswahl: Nächste Spur** | Pfeiltaste unten (![][image30]) | kVK\_DownArrow | 125 | 0x7D | Keine |
| **Locator: Vorheriger Takt** | Keypad , | kVK\_ANSI\_KeypadDecimal | 65 | 0x41 | Keine |
| **Locator: Nächster Takt** | Keypad . | kVK\_ANSI\_KeypadClear | 71 | 0x47 | Keine |
| **Region: Vorherige Region** | Pfeiltaste links (![][image31]) | kVK\_LeftArrow | 123 | 0x7B | Keine |
| **Region: Nächste Region** | Pfeiltaste rechts (![][image1]) | kVK\_RightArrow | 124 | 0x7C | Keine |
| **Spur stummschalten (Mute)** | M | kVK\_ANSI\_M | 46 | 0x2E | Keine |
| **Spur Solo schalten** | S | kVK\_ANSI\_S | 1 | 0x01 | Keine |
| **Zoom Horizontal vergrößern** | Cmd \+ ![][image1] | kVK\_RightArrow | 124 | 0x7C | kCGEventFlagMaskCommand |
| **Zoom Horizontal verkleinern** | Cmd \+ ![][image31] | kVK\_LeftArrow | 123 | 0x7B | kCGEventFlagMaskCommand |
| **Zoom Vertikal vergrößern** | Cmd \+ ![][image30] | kVK\_DownArrow | 125 | 0x7D | kCGEventFlagMaskCommand |
| **Zoom Vertikal verkleinern** | Cmd \+ ![][image29] | kVK\_UpArrow | 126 | 0x7E | kCGEventFlagMaskCommand |

### **Programmatische Tasteninjektion (Swift-Implementierung)**

Zur Vermeidung von Race Conditions muss zwischen dem keyDown- und dem keyUp-Event eine künstliche Verzögerung von mindestens 10 bis 15 Millisekunden eingehalten werden, da der Message-Loop von Logic Pro Tastatureingaben sonst verwirft.

Swift  
import Cocoa  
import Carbon.HIToolbox

public enum LogicCommandInjector {  
    public static func postKey(code: CGKeyCode, flags: CGEventFlags \= \[\]) {  
        let source \= CGEventSource(stateID: .hidSystemState)  
          
        guard let keyDown \= CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),  
              let keyUp \= CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else {  
            return  
        }  
          
        keyDown.flags \= flags  
        keyUp.flags \= flags  
          
        keyDown.post(tap: .cghidEventTap)  
        usleep(15\_000) // 15 Millisekunden Haltezeit  
        keyUp.post(tap: .cghidEventTap)  
    }  
}

// Anwendungsbeispiel: "Gehe zu Position..."-Dialog aufrufen  
LogicCommandInjector.postKey(code: CGKeyCode(kVK\_ANSI\_KeypadDivide))

## **3\. macOS Accessibility (AXUIElement) Baum & Hierarchie in Logic Pro**

Die Accessibility-Architektur von macOS (ApplicationServices.HIServices) gestattet KI-Agenten und Test-Frameworks die programmatische Inspektion von internen UI-Elementen, die über standardisiertes MIDI nicht erreichbar sind.

### **Prozess-Identifikation und Fenster-Klassen**

* **Bundle Identifier:** com.apple.logic1017.  
* **Prozess-Auflösung:** Die Verbindung wird dynamisch über die Prozess-ID des laufenden Prozesses initialisiert:  
  Swift  
  let apps \= NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.logic10")  
  guard let logic \= apps.first else { fatalError("Logic Pro ist nicht aktiv") }  
  let logicElement \= AXUIElementCreateApplication(logic.processIdentifier)

* **Fenster-Klassen:**  
  * Hauptfenster (Arrangement): Rolle AXWindow, Subrolle AXStandardWindow.  
  * Schwebender Mixer / Plug-in-GUIs: Rolle AXWindow, Subrolle AXDialog.  
  * Kontextmenüs / Auswahllisten: Rolle AXMenu, Subrolle AXFloatingWindow.

### **UI-Element-Hierarchie der Kernkomponenten**

Die hierarchische Verschachtelung der Benutzeroberfläche gliedert sich vom Hauptfenster über Split-Container bis hin zu den individuellen Steuerkomponenten der Kanalzüge:

* **Hauptanwendung (AXApplication):** Enthält die Menüleiste (AXMenuBar) sowie das primäre Hauptfenster (AXWindow).  
* **Hauptfenster (AXWindow):** Beherbergt die globale Werkzeugleiste (AXToolbar) mit Transport- und Statusanzeigen sowie die zentrale Teilungsgruppe (AXSplitGroup).  
* **Zentrale Teilungsgruppe (AXSplitGroup):** Unterteilt den Arbeitsbereich in den oberen Spurenbereich (Arrangement) und den unteren Mixer-Bereich (AXLayoutArea).  
* **Mixer-Container (AXScrollArea):** Kapselt den scrollbaren Kanalzug-Bereich (AXList bzw. AXLayoutArea), der die einzelnen Kanalzüge bereithält.  
* **Kanalzug (AXGroup):** Repräsentiert einen Channel Strip und enthält Steuerelemente:  
  * Fader-Element (AXSlider): Moduliert Pegel und liefert formatierte Werte (kAXValueDescriptionAttribute).  
  * Schalter-Elemente (AXButton): Steuern Schaltzustände wie Mute, Solo und Record Ready.  
  * Zuweisungs-Menüs (AXPopUpButton): Verwalten Signalzuweisungen wie Input, Stereo-Pan und Output-Routing.  
  * Effekt-Einschleifweg (AXGroup für Audio FX): Enthält 15 vertikal gestaffelte Pop-up-Taster (AXPopUpButton) für Plug-in-Inserts18.  
  * Send-Einschleifweg (AXGroup für Sends): Kapselt Zuweisungstaster und Send-Pegel-Slider.

#### **Mixer Channel Strips**

Innerhalb der Mixer-Hierarchie existieren die Kanalzüge als Kindelemente (kAXChildrenAttribute) mit der Rolle AXGroup.

* **Fader:** Repräsentiert durch AXSlider. Das Attribut kAXValueAttribute liefert eine Fließkommazahl zwischen 0.0 und 1.0. Das Attribut kAXValueDescriptionAttribute enthält die Dezibel-Darstellung als String (z. B. "-4.5 dB" oder "0.0 dB").  
* **Taster (Mute, Solo, Rec):** Repräsentiert durch AXButton. Ihr Status lässt sich über kAXValueAttribute (0 oder 1\) abfragen und über die Aktion kAXPressAction umschalten.

#### **Plug-in-Insert-Slots (Audio FX Slots 1 bis 15\)**

Die Audio FX-Inserts liegen als vertikale Liste von bis zu 15 Elementen des Typs AXPopUpButton vor18:

* Ist ein Slot unbestückt, führt das Attribut kAXTitleAttribute den Leerwert "" oder "- Kein Effekt \-".  
* Ist ein Plug-in instantiiert, spiegelt kAXTitleAttribute den Plug-in-Namen wider (z. B. "Channel EQ" oder "Space Designer").  
* **Interaktionsmodi:**  
  * Ein Aufruf von AXUIElementPerformAction(slotElement, kAXPressAction as CFString) auf der Mitte des Slots öffnet das grafische Bedienfenster des Plug-ins.  
  * Ein Klick auf die rechte Dropdown-Zone öffnet das hierarchische Plug-in-Auswahlmenü (AXMenu), über das neue Effekte geladen werden können.

#### **Parameter-Inspektion in geöffneten Plug-in-Fenstern**

Geöffnete Plug-in-Oberflächen bilden eigenständige Fenster (AXWindow) innerhalb des Prozesses com.apple.logic1017:

* **Identifikation:** Fenstertitel entspricht dem Plug-in-Namen inklusive Spurkontext (z. B. "Kompressor (Spur 1: Lead Vocal)").  
* **Steuerobjekte:** Interne Algorithmusparameter werden als AXSlider (stufenlose Werte), AXCheckBox (Bypass/Phasenumkehr) oder AXTextField (Frequenzeingaben) abgebildet.  
* **Sidechain-Routing:** Am oberen Fensterrand befindet sich ein AXPopUpButton mit der Beschreibung "Sidechain". Das Attribut kAXValueAttribute gibt die aktuell zugewiesene Routing-Quelle aus. Das Umschalten erfolgt durch Auslösen von kAXPressAction, Traversieren des resultierenden Menübaums (AXMenu ![][image1] AXMenuItem) und Selektieren der gewünschten Bus- oder Audiospur.

### **Fallstricke und Eigenheiten der Accessibility API in Logic Pro**

Bei der Automatisierung über die macOS Accessibility API treten in Logic Pro spezifische architektonische Hürden auf, die robuste Kompensationsstrategien erfordern:

* **UI-Virtualisierung (Lazy Loading):** Logic Pro generiert Mixer-Kanalzüge im Accessibility-Baum nicht instanziiert für das gesamte Projekt, sondern instanziiert primär die im sichtbaren Bildausschnitt der AXScrollArea befindlichen Elemente. Ein AI-Agent, der auf Spur 45 zugreifen möchte, während nur die Spuren 1 bis 8 sichtbar sind, erhält ein Such-Timeout.  
  * *Lösungsansatz:* Das Steuerungstool muss den Scrollbalken (AXScrollBar) aktiv über AXUIElementSetAttributeValue modulieren oder Tastaturbefehle zur Spurnavigation senden, bis das Zielelement im Viewport materialisiert ist.  
* **Versteckte Hierarchien bei geschlossenen Fenstern:** Parameter eines Audio-Plug-ins existieren nicht im globalen UI-Baum, solange das zugehörige Plug-in-Fenster geschlossen ist. Soll ein interner Wert gelesen werden, muss das Skript das Plug-in-Fenster öffnen, die Werte extrahieren und das Fenster anschließend über die Schließen-Schaltfläche (AXCloseButton) schließen.  
* **Lokalisierungsdivergenz (L10n):** Logic Pro implementiert keine sprachneutralen Accessibility-Identifier für Core-Schaltflächen. Strings hängen strikt von der Spracheinstellung des ausführenden macOS-Systems ab:  
  * Deutsch: "Wiedergabe", "Stopp", "Stumm", "Solo", "Aufnahmebereit".  
  * Englisch: "Play", "Stop", "Mute", "Solo", "Record Enable".  
  * *Lösungsansatz:* AI-Agenten dürfen nicht auf hartkodierten Textabgleichen von kAXTitleAttribute basieren. Stattdessen sind relative Positionsstrukturen, hierarchische Indizes oder Mapping-Tabellen einzusetzen, die systemspezifische Lokalisierungen berücksichtigen.  
* **Thread-Blockaden und Timeouts (kAXErrorCannotComplete / \-25204):** Bei hoher Systemlast im Audio-Echtzeit-Thread priorisiert Logic Pro die Audioverarbeitung und setzt die Abfertigung von Accessibility-Anfragen im AppKit-UI-Thread aus. Direkte Aufrufe von AXUIElementCopyAttributeValue führen in diesen Intervallen zu Timeouts.  
  * *Lösungsansatz:* Sämtliche Accessibility-Abfragen müssen in asynchrone Worker-Threads ausgelagert und mit Exponential-Backoff-Wiederholungsroutinen versehen werden.

## **4\. Logic Pro Control Surface API & Luascript / OSC / EuCon (Überblick)**

Logic Pro bietet neben der reinen MCU-Emulation mehrere Schnittstellen zur Controller-Anbindung, die sich hinsichtlich Offenheit, Funktionsumfang und Echtzeittauglichkeit deutlich unterscheiden.

### **Native Schnittstellen und das C/C++ Plug-in SDK**

Ursprünglich wurden Controller-Anbindungen in Logic als dynamische Bundles (CFPlugins) realisiert, wie beispielsweise MackieControl.bundle oder Logic Control.bundle19.

* Die Basis bildet ein natives C/C++ SDK, das Zugriff auf die internen Core-Module (MACore.framework) bietet20.  
* Apple hält dieses SDK unter Verschluss; es wird ausschließlich ausgewählten Drittherstellern unter NDA zur Verfügung gestellt21. Ein öffentlicher Registrierungs- oder Download-Pfad für freie Entwickler existiert nicht21.

### **Die Lua-Skripting-Engine (MIDI Device Scripts)**

Seit Version 10.x verfügt Logic Pro über eine integrierte Lua-Laufzeitumgebung (Lua 5.x), über die moderne Hardware direkt angebunden werden kann22.

* **Systempfad:** /Applications/Logic Pro.app/Contents/Frameworks/MACore.framework/Versions/A/Resources/MIDI Device Scripts/25.  
* **Benutzerpfade:** /Library/Audio/MIDI Device Scripts/ oder \~/Music/Audio Music Apps/MIDI Device Scripts/27.  
* **Struktur:** Skripte werden als .device-Pakete strukturiert, die primär aus einer config.lua sowie Metadaten bestehen25.  
* **Funktionsweise:** Die Engine fängt eingehende CoreMIDI-Streams über Callback-Funktionen ab, übersetzt sie in Smart-Control- und Mixer-Aktionen und synchronisiert Feedback-LEDs25. Lua-Zuweisungen agieren innerhalb einer modalitätsfreien Zone ("modeless zone") in Logic Pro29.  
* **Entwickler-Status:** Obwohl extrem flexibel, existiert keine offizielle Dokumentation oder Schnittstellendefinition von Apple22. Die Funktionssignatures müssen durch Analyse bestehender Hersteller-Skripte im System-Bundle rekonstruiert werden20.

### **OSC (Open Sound Control)**

Im Gegensatz zu DAWs wie Ardour oder Reaper besitzt Logic Pro **keine native, offene OSC-Netzwerkschnittstelle**30.

* Die einzige native Netzwerksteuerung erfolgt über die herstellereigene iOS-App *Logic Remote*, die ein proprietäres, verschlüsseltes Protokoll über Bonjour und WebSockets nutzt.  
* Eine programmatische OSC-Integration erfordert stets Translation-Bridges (z. B. OSCulator, TouchOSC Bridge), die UDP-OSC-Pakete empfangen und auf lokaler Ebene in standardisierte CoreMIDI- oder MCU-Pitchbend- und CC-Befehle konvertieren.

### **Avid EuCon Protokoll**

Logic Pro integriert die native Unterstützung für Avids EuCon-Architektur (EuCon.bundle)31.

* **Eigenschaften:** Ein hochperformantes Ethernet-Protokoll, das signifikant schnellere Reaktionszeiten und höhere Bandbreiten als herkömmliches MIDI 1.0 bietet.  
* **Auflösung:** Ermöglicht Parametersteuerungen in nativer 32-Bit-Floating-Point-Präzision.  
* **Funktionsumfang:** Bidirektionale Übertragung von Kanal-Farbwerten, hochauflösenden Pegelmetern, EQ-Kurven sowie dynamischen Plug-in-Parameterbäumen (Knobsets)31.  
* **Einschränkung:** Die Implementierung erfordert lizenzpflichtige Schnittstellen-Libraries von Avid sowie die Ausführung der EuControl-Hintergrunddienste.

### **Technische Restriktionen von AppleScript im Audio-Echtzeit-Mixing**

AppleScript (Open Scripting Architecture / OSA) eignet sich für Makro- und Batch-Aufgaben wie das Exportieren oder Speichern, versagt jedoch bei der kontinuierlichen Audiofernsteuerung:

* **Inakzeptabler IPC-Overhead:** Jeder AppleScript-Aufruf erfordert die Serialisierung und Übertragung von NSAppleEventDescriptor-Paketen zwischen den Prozessen. Die Ausführungszeit eines einzelnen Kommandos schwankt zwischen **15 und 50 Millisekunden**. Für Faderbewegungen und flüssige Parameterfahrten ist eine Regelfrequenz von mindestens 60 bis 100 Hz (Intervall ![][image32]) erforderlich; AppleScript erzeugt hierbei Aussetzer und unkontrollierbare Pufferstaus.  
* **Rudimentäres Scripting-Dictionary (Logic Pro.sdef):** Das offizielle Scripting-Dictionary von Logic Pro stellt fast ausschließlich Dokumentenoperationen bereit (open, save, close, bounce). Es bietet keinerlei programmatische Schnittstellen zu Kanalzügen, Faderständen, Plug-in-Parametern oder Send-Bussen.  
* **Blockierende GUI-Skripte:** Der Umweg über AppleScript GUI-Scripting (tell application "System Events" ...) blockiert den Haupt-Thread, verlangt Fensterfokus, bricht bei modalen Dialogen ab und liefert keinerlei Determinismus.

## **5\. Offizielle Dokumentations-Quellen & GitHub-Referenzen**

Die nachfolgende Aufstellung enthält die verifizierten Referenzen, Spezifikationen und Entwickler-Repositories zur Realisierung von Logic-Pro-Fernsteuerungen.

### **Offizielle Dokumentationen von Apple**

* **Apple Logic Pro Control Surfaces Support Guide:**  
  Offizielle Referenz zu Bedienoberflächen, MCU-Tastenbelegungen und Betriebsmodi31.  
  https\://support.apple.com/guide/logicpro-css/welcome/mac31  
* **Apple Logic Pro User Guide (Control Surface Groups & Mappings):**  
  Dokumentation zur Zonenarchitektur und Integration von Steuergeräten29.  
  https\://support.apple.com/guide/logicpro/welcome/mac29  
* **Apple Developer Accessibility (AXUIElement API):**  
  Offizielle API-Referenz zur programmatischen UI-Inspektion unter macOS.  
  https\://developer.apple.com/documentation/applicationservices/axuielement\_h  
* **Carbon HIToolbox Virtual Key Codes (Events.h):**  
  Referenzdokumentation für native macOS Tastatur-Codes (kVK\_\*)13.  
  https\://github.com/phracker/MacOSX-SDKs/blob/master/MacOSX10.6.sdk/System/Library/Frameworks/Carbon.framework/Versions/A/Frameworks/HIToolbox.framework/Versions/A/Headers/Events.h15

### **MIDI-Standards und Reverse-Engineering-Referenzen**

* **TouchMCU – Mackie Control Protocol Deep Dive:**  
  Umfassende Dokumentation aller MCU-Hex-Noten, SysEx-Befehle, LCD-Offsets und 7-Segment-Steuerungen3.  
  https\://github.com/NicoG60/TouchMCU/blob/main/doc/mackie\_control\_protocol.md3  
* **MIDIbox LC / MCU Protocol Mappings:**  
  Historische Dokumentation der Emagic Logic Control und Mackie Control Befehlssätze33.  
  https\://www\.midibox.org/dokuwiki/doku.php?id=mc\_protocol\_mappings33  
* **Ardour Source Documentation – Mackie Control Implementation:**  
  Referenzimplementierung für Fader-Kurven, 14-Bit-Pitchbend-Interpolation und V-Pot-Logik35.  
  https\://manual.ardour.org/using-control-surfaces/devices-using-mackielogic-control-protocol/35  
* **MIDI Association (MMA) – MIDI 1.0 Specification:**  
  Offizieller technischer Standard für Continuous Controller, Pitchbend und SysEx3.  
  https\://midi.org/specifications

### **Open-Source-Implementierungen und Audio-Tools**

* **LogicPro-LuaScript (Community Repository):**  
  Sammlung und Analyse nativer Logic Pro MIDI-Device-Skripte37.  
  https\://github.com/eroccowaruico/LogicPro-LuaScript37  
* **TouchMCU Repository:**  
  Vollständige Implementierung eines browserbasierten Mackie-Control-Clients über WebMIDI / CoreMIDI3.  
  https\://github.com/NicoG60/TouchMCU3  
* **python-rtmidi:**  
  Echtzeitfähiges Python-Framework zur CoreMIDI-Kommunikation auf macOS.  
  https\://github.com/SpotlightKid/python-rtmidi  
* **mido (MIDI Objects for Python):**  
  Python-Bibliothek zur Kapselung von MIDI-Nachrichten und SysEx-Streams.  
  https\://github.com/mido/mido  
* **AXSwift:**  
  Typsichere Swift-Bibliothek zur Vereinfachung von AXUIElement-Zugriffen unter macOS.  
  https\://github.com/tmandry/AXSwift

#### **Referenzen**

> 1. Mackie Control \- Sound On Sound, [https\://www\.soundonsound.com/reviews/mackie-control-universal](https://www.soundonsound.com/reviews/mackie-control-universal)  
> 2. The Mackie Control Protocol – MIDI Software – MIDI.org Forum, [https\://midi.org/community/midi-software/the-mackie-control-protocol](https://midi.org/community/midi-software/the-mackie-control-protocol)  
> 3. TouchMCU/doc/mackie\_control\_protocol.md at main \- GitHub, [https\://github.com/NicoG60/TouchMCU/blob/main/doc/mackie\_control\_protocol.md](https://github.com/NicoG60/TouchMCU/blob/main/doc/mackie_control_protocol.md)  
> 4. MIDI SysEx Implementation and Assignment to External MIDI Devices, [https\://forum.keyboardmaestro.com/t/midi-sysex-implementation-and-assignment-to-external-midi-devices/31390?page=3](https://forum.keyboardmaestro.com/t/midi-sysex-implementation-and-assignment-to-external-midi-devices/31390?page=3)  
> 5. User manual, [https\://www\.samodelka.ru/pictures/data/icon\_qcon\_pro\_x.pdf](https://www.samodelka.ru/pictures/data/icon_qcon_pro_x.pdf)  
> 6. aws 924-948 owner's manual \- Solid State Logic Japan, [https\://www\.solid-state-logic.co.jp/docs/AWS\_Owners\_Manual.pdf](https://www.solid-state-logic.co.jp/docs/AWS_Owners_Manual.pdf)  
> 7. Duality Fuse \- Solid State Logic, [https\://www\.solidstatelogic.com/assets/uploads/downloads/Duality\_Fuse\_Operator\_s\_Manual.pdf](https://www.solidstatelogic.com/assets/uploads/downloads/Duality_Fuse_Operator_s_Manual.pdf)  
> 8. Convert 7 bit cc to 14bit \- Bome Forum, [https\://forum.bome.com/t/convert-7-bit-cc-to-14bit/6394](https://forum.bome.com/t/convert-7-bit-cc-to-14bit/6394)  
> 9. Mackie C4 and Cubase. How to make the encoders work?, [https\://www\.bome.com/forums/21/38107/mackie-c4-and-cubase-how-to-make-the-encoders-work/](https://www.bome.com/forums/21/38107/mackie-c4-and-cubase-how-to-make-the-encoders-work/)  
> 10. Matrix Owner's Manual \- Solid State Logic Japan, [https\://solid-state-logic.co.jp/docs/Matrix\_Owners\_Manual.pdf](https://solid-state-logic.co.jp/docs/Matrix_Owners_Manual.pdf)  
> 11. first contact with MIDI, I used an SMC-Mixer from M-VaVe and it, [https\://www\.facebook.com/groups/blackoutapp/posts/2076119129580612/](https://www.facebook.com/groups/blackoutapp/posts/2076119129580612/)  
> 12. BC MIDI Implementation 1.2.9 | PDF \- Scribd, [https\://www\.scribd.com/document/555598515/BC-MIDI-Implementation-1-2-9](https://www.scribd.com/document/555598515/BC-MIDI-Implementation-1-2-9)  
> 13. Where are all the Cocoa keycodes? \- Stack Overflow, [https\://stackoverflow.com/questions/36900825/where-are-all-the-cocoa-keycodes](https://stackoverflow.com/questions/36900825/where-are-all-the-cocoa-keycodes)  
> 14. Where can I find a list of Mac virtual key codes? \- Stack Overflow, [https\://stackoverflow.com/questions/3202629/where-can-i-find-a-list-of-mac-virtual-key-codes](https://stackoverflow.com/questions/3202629/where-can-i-find-a-list-of-mac-virtual-key-codes)  
> 15. Events.h \- GitHub, [https\://github.com/phracker/MacOSX-SDKs/blob/master/MacOSX10.6.sdk/System/Library/Frameworks/Carbon.framework/Versions/A/Frameworks/HIToolbox.framework/Versions/A/Headers/Events.h](https://github.com/phracker/MacOSX-SDKs/blob/master/MacOSX10.6.sdk/System/Library/Frameworks/Carbon.framework/Versions/A/Frameworks/HIToolbox.framework/Versions/A/Headers/Events.h)  
> 16. NSEvent keyCode list? \- MacRumors Forums, [https\://forums.macrumors.com/threads/nsevent-keycode-list.780577/](https://forums.macrumors.com/threads/nsevent-keycode-list.780577/)  
> 17. Alt Tab sometimes shows duplicate windows, or doesn't ... \- GitHub, [https\://github.com/lwouis/alt-tab-macos/issues/4924](https://github.com/lwouis/alt-tab-macos/issues/4924)  
> 18. Setting up the Auriteq controller with Logic Pro, [https\://auriteq.com/de/blogs/help-center/setting-up-the-auriteq-controller-with-logic-pro](https://auriteq.com/de/blogs/help-center/setting-up-the-auriteq-controller-with-logic-pro)  
> 19. Allen & Heath MIDI Control Help, [https\://support.allen-heath.com/hc/en-gb/articles/41264039501969-Allen-Heath-MIDI-Control-Help](https://support.allen-heath.com/hc/en-gb/articles/41264039501969-Allen-Heath-MIDI-Control-Help)  
> 20. Logic Pro Control Surface Setup, [https\://www\.logicprohelp.com/forums/topic/142328-logic-pro-control-surface-setup/](https://www.logicprohelp.com/forums/topic/142328-logic-pro-control-surface-setup/)  
> 21. Logic Pro to Python: Sending MIDI Feedback to Update Virtual, [https\://www\.reddit.com/r/Logic\_Studio/comments/1ero0qv/logic\_pro\_to\_python\_sending\_midi\_feedback\_to/](https://www.reddit.com/r/Logic_Studio/comments/1ero0qv/logic_pro_to_python_sending_midi_feedback_to/)  
> 22. Lua script for my custom made MIDI controller \- Logic Pro Help, [https\://www\.logicprohelp.com/forums/topic/153314-lua-script-for-my-custom-made-midi-controller/](https://www.logicprohelp.com/forums/topic/153314-lua-script-for-my-custom-made-midi-controller/)  
> 23. Lua Scripting \- MIDI FX Plug-In Scripts \- Logic Pro Help, [https\://www\.logicprohelp.com/forums/topic/124276-lua-scripting/](https://www.logicprohelp.com/forums/topic/124276-lua-scripting/)  
> 24. Creating Logic Pro X Controller Assignments \- jimamsden, [https\://jimamsden.wordpress.com/2017/12/28/creating-logic-pro-x-controller-assignments/comment-page-1/](https://jimamsden.wordpress.com/2017/12/28/creating-logic-pro-x-controller-assignments/comment-page-1/)  
> 25. Whip 'em MIDI controllers gud ? \- Tips and Tricks \- Logic Pro Help, [https\://www\.logicprohelp.com/forums/topic/118805-whip-em-midi-controllers-gud/](https://www.logicprohelp.com/forums/topic/118805-whip-em-midi-controllers-gud/)  
> 26. Logic Pro X v10.2.1 \- MIDI keyboard issues \!\! \[SOLVED\], [https\://www\.logicprohelp.com/forums/topic/106572-logic-pro-x-v1021-midi-keyboard-issues-solved/](https://www.logicprohelp.com/forums/topic/106572-logic-pro-x-v1021-midi-keyboard-issues-solved/)  
> 27. Control surfaces supported by Logic Pro for Mac \- 官方 Apple 支持, [https\://support.apple.com/zh-hans/guide/logicpro/ctls718dd5b2/mac](https://support.apple.com/zh-hans/guide/logicpro/ctls718dd5b2/mac)  
> 28. midi | Michael Kuron's Blog, [https\://blog.michael.kuron-germany.de/tag/midi/](https://blog.michael.kuron-germany.de/tag/midi/)  
> 29. Create control surface groups in Logic Pro for Mac \- Apple Support, [https\://support.apple.com/zh-hans/guide/logicpro/ctls718ddd90/mac](https://support.apple.com/zh-hans/guide/logicpro/ctls718ddd90/mac)  
> 30. Basics \- The Ardour Manual, [https\://manual.ardour.org/using-control-surfaces/controlling-ardour-with-osc/osc-control/](https://manual.ardour.org/using-control-surfaces/controlling-ardour-with-osc/osc-control/)  
> 31. Overview of the Mackie Control in Logic Pro \- Apple Support, [https\://support.apple.com/guide/logicpro-css/mackie-control-overview-ctls7222820e/mac](https://support.apple.com/guide/logicpro-css/mackie-control-overview-ctls7222820e/mac)  
> 32. Up Series User Manual \- HOME丨MIDIPLUS, [https\://web-file.midiplus.com/upload/202403/13/Up\_Series\_User\_Manual\_v1.1.pdf](https://web-file.midiplus.com/upload/202403/13/Up_Series_User_Manual_v1.1.pdf)  
> 33. Mackie Control Protocol Software Mappings \- midibox.org, [https\://www\.midibox.org/dokuwiki/doku.php?id=mc\_protocol\_mappings](https://www.midibox.org/dokuwiki/doku.php?id=mc_protocol_mappings)  
> 34. Mackie Control Protocol Software Mappings, [https\://htlab.net/computer/protocol/mackie-control/mackie\_control\_protocol\_software\_mappings.pdf](https://htlab.net/computer/protocol/mackie-control/mackie_control_protocol_software_mappings.pdf)  
> 35. Devices Using Mackie/Logic Control Protocol \- The Ardour Manual, [https\://manual.ardour.org/using-control-surfaces/devices-using-mackielogic-control-protocol/](https://manual.ardour.org/using-control-surfaces/devices-using-mackielogic-control-protocol/)  
> 36. Behringer Devices in Mackie/Logic Control Mode \- The Ardour Manual, [https\://manual.ardour.org/using-control-surfaces/mackie-control-protocol/behringer-devices-in-mackielogic-control-mode/](https://manual.ardour.org/using-control-surfaces/mackie-control-protocol/behringer-devices-in-mackielogic-control-mode/)  
> 37. eroccowaruico/LogicPro-LuaScript \- GitHub, [https\://github.com/eroccowaruico/LogicPro-LuaScript](https://github.com/eroccowaruico/LogicPro-LuaScript)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAYCAYAAAAVibZIAAAAU0lEQVR4XmNgGAWjYFCAvegC1AD/0AWoAWyAuAxdkBrgHBCbowsiAxMy8S0g3sdAZfAXiBnRBSkB/9EFKAUTgJgdXZBS8BtdgBrAAF1gFIwCGgIAYTgLotElupAAAAAASUVORK5CYII=>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAAWCAYAAADNX8xBAAAAjElEQVR4XmNgGAWjAAWwAPEkdEE0sBddABtYhS6ABXxDF0AHjED8DF0QC1AH4jJ0QWTwF10AD1gKxObogglA/B+ITUjE14B4HwMSqGSAGORHIgYZBMKgCEIBf9AF8ICJQOyNLggDIJPvogtiAYpA3IkuiA62oAtgAZ/QBbABNiDuRxdEA4fRBUYBHQEAgJgY5S2XIqwAAAAASUVORK5CYII=>

[image3]: <data:image/png;base64,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>

[image4]: <data:image/png;base64,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>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADkAAAAZCAYAAACLtIazAAACUElEQVR4Xu2WPeiOURjGL/ItCQNRCiEDYZGSwmIwICzSf/OxSSZk0H+wSCmDwSjZlDIYjBYWoiz6WwhRIuWb++qc23O6up/zvl7G86urt3Pd9/Nxv+ec+zlAo9H4B5aZJqn5v5htumP6ZbqPv3vQNtNTpGuvSWxYXiNdT03L3lrT+8KnPpjemj7m8VfTypxfZQnSBTPzeEEeT/6T0c8J089ifBTp2lHw53qRzq7sHxefvEGKrdOA8sl0Q7wHps/iRfABawLvvHjDMAv1Io+JTxajm+UqTDgg3qns19iNOOcLYn8QXEm1Io+IT+ZiiCK3IiVsEX8s+/PFL7mL+OYTiH2F24HL+yrS80cp8h5SbIcGSrjOmbRR/P3Z3yR+iTcF5Qliv8RXAZsWYZP5lr2+Is+YViA1Gua/M/0wre9SY84h3UA37p7sHxS/hPGomIeI/RLGz4q3Ovt9RV40bUeatZ3o3n28S405jJSo/8a+7NeWwUvExTxG7DsXEMdXoV5ktFznIMVeaaDE9+Rm8Q9ln5+XPvr25DPEvvMCcdyLnC5+rUjCGLVUAw5vyIRRuutpxDmDuusjxHEvcob4XiSbVIQXuVcDJUy4JN7t7JewGS0UjznagendEq+E+585y8X3Ivm9LKl9J4kXWSWaNf1neMyLbsa9MFGMFyHlTC28iOem7+L5/cfE55g+T1cl85COdYyxWw/kOlI75i8vio5QN00n1UQ6S/Ls6bOvM9THZXSF8YTlM0lxyW8oxi6+IwvjKY2fkCumKWg0Go1GozESvwGWJLeD9ZH5hgAAAABJRU5ErkJggg==>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAE0AAAAZCAYAAAB0FqNRAAAClElEQVR4Xu2Xy8tOURTGH9eJgVJymQolJV/IgAyQiYGSiQkDkTISZWRgqJTLVBnwL3yZyMxAURQlt9f9Wq6FlMt6rL2/d+/1rbPPOX31ifavVufsZ+2z3/U+Z5+z9wEqlUrl/2SOxAuJXxIPJWbn6YzpEt+tmLBA4hZ0rLMm9ze4ZgXDVInr0HqfQv9fKzOhhkWmQAdYmWjkTtBjeOyD5lgI2SPxc5ieNK6ivVYyAs3PC+3tod3KBysIyyV+WDHwCf7ANIr6KaNTO2O0yeIg/FpJnByrEq3N5DHYab/RVgTdo8m0HVB9p9G7FnLICoY4G/pQMu0Rxud442cYzeU99OJLicbZtz5ppzSZdg6qbzM6H0+vv2Ud9F3osUTiuRU7UDItvZnLJOYnuVamYTgAg4ZtzXrkNJm2CxObaWSjxF2jLZV4abSutJn2WOINdCE8ELRZaacSC5EbdztPZzSZRqifdrSm/h6bJO6Fcxr2Ksn1pck0rvBeXQNHc9ki8TWcb8BwsJtjPXJKph1BnhuV+Ga0LkTjOAsmQpNpnE2eaUeDxptVxF5InsDXSck0wq0Kl/wr0GnvFdfGCHSGDWyiJ02mEercl6XE/oeNnhFXPA/qa62IdtMsXnElaFh8h62RuJ/k+tJm2muj0Szqe42ewVlRGtSjZBp1rsYRLt/Uum4XaFi60SY0zi4OXSmZFr+AUk4GjXu4Iux0zGhs3zBa5AvG/1iE+iBpv4M+ql3ghpqrmcdq6BdJX45Da5prExi+1/gKibB9OWkX+Qi9IH4qXcjTf/gMfWz4qDG4b6Ipi5I+u6HXPwjHPt+eJ6xgWGyFAvw25jvxGbRWHt9KnE87CZuhdfK/8HgxT1cqlUqlUqlU/hV+A2Cnx/yotMooAAAAAElFTkSuQmCC>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAZCAYAAAAv3j5gAAABN0lEQVR4Xu2UvUoDURCFj8RGsEhKC7UQC/EtIvgHWtqkswlY+A7prfICqRINQRCxtrCz9CXEQiyMWEhE5zBz3buT7CYLsdsPTnHPmeTcTDYBSv6JVVHVm/PkWvRj2o38t8inhqJX0XvkHfxNF8AXkWXzb5xPHqBZ0wfTyCvqOz8QPlkh8oounR+Yqagh6omO7Vy06AKatXwQ2IIOnNmZT1u4WVbRnWhDtCnaFj2Zf5KMjsOBe28iv4jzddGOaB96SfpXyWiaI+jAig+QXzRpdYTZyJukCw0nQX/PedOKnqE5v+8UbQvWfAD1uZaYUJS1okdozvdNUbHg1AdQ/9B5s/6OlnxAbjG+vg/zOs5fN5+viVkUvVjGxzyTcyS34Z4XonO4RHymvkVfok/o/+BAVLPZkpKSOfML+Rdjh606ymYAAAAASUVORK5CYII=>

[image8]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABsAAAAaCAYAAABGiCfwAAABJElEQVR4Xu2VsUoDQRRFbyBV+hSBYBNIL+YDkk4/IL3gZyiKnT+gbb4hjVWwsjIkWPkDok1M1EICAdH3eJnkecmGIZnCwB64zM59b/eyw+wskLOLFEQfoh+n8Z8O4xvLul5vRQf2oCb5Hq0n4Rj2sFPyA13RAZubUoOF3XJBKIle2dwWDftkU5ixkYKwATwnojPykrAqjOfJ4LAnUdnNA/uiBzYdIzZWMcUyTDfMvasFzkXXyA5rI3I1erDGvfmYxSWyw66w/t4FF7DGZ9ER1TxZYS/zMSqsBWt85wKhYX3yDmHfoxIVVoQ16nm5Dg0bkHfjrqPCYtGwoZs3RHdOGqZj1fVsjIY9sulI9mZfoonoDXa06dIHKrDfldZ0rLtaTs4/4hdsLUfDwPmabQAAAABJRU5ErkJggg==>

[image9]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEkAAAAZCAYAAAB9/QMrAAACgElEQVR4Xu2XzUtWQRTGj5DSIiMjop2LoIxauoosKEHctGnRprXgH+DClVFBFkVgkCBEUZAfi7KN4KJ1kK7caLQRo6+FYopI352nmcHzHs/cd+6FQmJ+8PAyz5m5597zzp2ZS5TJZDKlaWId1+ZO4yRrjfWLdUfFirjN+spaZp1SsVQ2yOWFAo+V/421yloR/iKrwff/67xkfRLteVa/aMf4zLom2pusQdEuw12qLVJglmwf6MKWppHVp02Dq1Sb6IBvTwnP4hxtv8H9hpfKTbLHFhVphFzsng6kspvSioQk95XXptoWeMWsm4d3SZsJ3CD7ekVFwrKA2JgOpLKH6hepi1ySC759XsTqgXFYJzTw57RpcJB1hXWd3OytUiT4UOV1qZnqF2mctv75y6wW1lvWB9EnBsZhodfAx9pUxHPWT3J/JOglV3CrGKFIh72Osk577z1r11bX8qQU6TW5ZNgxJPCwkBZhjQPh343RQS6+T/mj3teEIp316mR1s6a9j+sl0W7oDGvI8KHADLlEPcID9R4UII4tWQMfsyRG7NpPyPaLXjdMAsRu6YAF1hKti6yHhi/XnQfkkmAaS2IPIkH8izbJ+W+0KYhdu0qRQOx6SaS8bpi2SHBM+SmJY33gDWtTEBu3Y4sEkEBv2fD0KzOg2jib6JvDLgMPZ7QYT2n7OFClSEfoHxXpEeuHaGPHQdJDwpv03oTwADz5vfWK7B1Pg3HYWQPIFR4W33CSBe/rbR6LeBiDM2ElUosEnpFLhi0Vvydqw3+OBu9Ye5XfSq7/C9YSuT6pYN0KD4lTf5hJED6JcEwI7aDv5NbBddZHSn++KGWKlMlkMplMJvO/8Rshzc4hPWVSbQAAAABJRU5ErkJggg==>

[image10]: <data:image/png;base64,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>

[image11]: <data:image/png;base64,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>

[image12]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmwAAABQCAYAAACksinaAAALVklEQVR4Xu3dB4z0RhnG8aF30UQJKARBABFKaKHDR+8gSuiISKCILmoAEUGASPTeS0RCLwKE6AFBvlBD7yA+Sj5aAiE00TvzyB7u3WdnvN673St7/580up13xr712mvP2uNxSgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMv1VQ8AA47K6WAPAgCA5flvTmfxoDlvTod6ELvamR4AAADL8RsPNKhRp+Sxc4T85/sYdg/WNwAAS3bnnK7iwYYvpumDs+dlX6rHsbq+4gEAALA48zSsvpCm63tevpbqcawurW81/gEAwILpIHukB43q/KH/O6bBdlwfO7vFsdrOlqa3BQAAsAD/8YDxA/DplZjyt+jT7XL6dk7/mqiB3eLNOd3FgwAAYP325nRfDxpvnJ1WiXlePpRotO1Wte0BAACs05gDq9cZ22CTVhyrTev9+h4EAADrM6ZB5XXGNtg0zEctjtWn9f5NDwLAbnaABzboNh7AyrpGGtegen9ODw95TePTef7BfewFFl+WK3oAS6FtZox3peltAgB2BN1Zpz49H06TYxXpLMSXczopdeNbzUPzu4kHe/vT5A7zGyHp0UOn5HRyToeFOsXvPbBk62l0niunc3rQPM8DvfN4YMU8KNUbVU43Brzagw262/M+qXsKwv1y2pPT+SZqbJ2PemCES3mgdxEPBOf2QKD56Q7JraKnT7RczgMVT/TAgH94oOLANHv7A4BtSzswNc6cDn7raSTt94DxHeZPKzHlP2gxea4HlkAHQDUY/D3JETm9Iqc35fQnK/tRTu/I6e99avH5njWn36W1sz+r7Iw0exlVfmMP7jC1gVq1XWmbOcQLUtew0TZzbJr+fJR/auqe+PASKzs+dT8ATszpn1am+k/I6X05/dnKFuXaqb1Mv8rpgTn9NafXWlnZ5+hv62yn9j/fstjQ9+/Jlm/xzxcAdgztwGoNjH97YISPeaDCd5hlx+0Ue1Ulthmulab/lx9M75TTc/rX18vpsaFM9WoPK9dQFT7fWfmWsfW2EzUuZr3vWeU7Qe37JFq2WuMmLnN8/UnL6/Xb+9e6JHzlUCblzlqd5fXpHhLyi1RbJsUeFvLx7JfKLmD5mp+kyQbb0PevaM0rUp31nD0HgC2nHZjv6HRmbT2Di/p8arzOUINNZ52il+V0fostQ63BprwuIXtMbhBei84C+PTl7rQY/4HlxfMtY+ttJzpDOvS+t9MNAbdN9cuJs0bMf1RON/VgT8vmjRudXdU0LRcOrzX9XfvXf+zzhfpxxYbQ3cNr1btkyC9SbZkUi5f4353TW0PZ80OZ8o8JedGPxUemyQab6rW+fzGv9TZEdVrdEgBgW9MOzHd8r7P8WD6fQnE1zHRw8jq1BpvOUHzaYnKZnF7kwSVoNdjUP89jNTqY+sCv5YxlnKb22Xu+ZWy9ovyvS6TuTrk4/fE5fTynU9PkmUF/f628zliURz4dHsrlL6lbn1r+F6bh963nhg6Vbza9l/jwePmU5d13PRBofrXGzQ37v0qthtWzcjoz5PektWl0SbX1uS27Edxapug1Of3CYoXqHhTyWk59HrUG26zv349T/cx2pGlq3S0AYNvzRlTrcs4YvgPVzQce83xpsGk0+lvldPvUNXZaNy7oUknL61M3onlMb8zphJze0JffsVQe0GqwvbcSq/F4bLzFMr32up5vGVsvUt8qNSh0EP9IH9N8Yid/HXw/E/L+f2r52PE9lmu5LxTyupzn00c6ezVUvhWekrrPS2esPmtlNUPvX2X+MHvFfmv56OKp67um+EWtTJ972YbiPIqX5/S91PX9WpbWMkUvrcTknmn6h83N+r+1Btus758ahh5zv87pOx4EgJ1A/cTKTk4dhePB95V92R1CrKjtGHWHX1QOJh6LamfYpDat1GKL1mqwfaAScx6LfdsklteW0fNFqTuUZvlSmn48j6bzO1v9PUbz5L3sbZVYpDs+h8oLX+6NpDHUUNCZyTGG5qmyq1Vi+qES828J+Uhl+/rXullHDRQpN6y0xhhTmX681Pjn4UnbzJDWMkXax+iHYaT+Z/7jME5Xa7DN+v6p35zHnBpr+z0IADuBhkMoOzkdUJ3KvMF2TB93fldp2el7LJq3wbYZjxVqNdj8Mq3X0Xs7tH99cP9XdXQWQR2vdYBSXn91pu+MPh95vmVsvUgHX1+Xmo8PGxHn7f9nnryXzWqw3S0Nl28VrXetQ2/Y1gy9f5WV7SPGdKk/5nV5WrwfqcrK/P3/lLNtNboc3SrbqNYyxf5/Wu+fC3n5ZXhd+ulpOn2H9P3QX33mpVGnslnfP11O9ZjTmcjvexAAdgLtWLWTU1+jGpX5QV5qO0aP6cyExzw/b4NtzJ2oG1VrsOlSYoxdN03+4lf/mcinL2Jc/ZW8nudbxtaL9Fnf2mKaz+NDXgfPOG//P/PkvWxWg+1Gabh8s2nsuNhIeGia7tPmht6/yq5pMQ0F84CQV53Lhtd7/1/S5cv8a/8nlvl6qNVfhNoyKRZvetAQHPFz07iL0cUsL9pW4hm2Wd8/0dh3rf1YoXl4ww8AdgztxFoDt6pMt9AXnwhxV4up39iJqWsEaawy1dEYURqCoAxboPT11P0KL53Xj9XERp3WL+3BBdPOvJyRUAdzHVALjXWlgVl1gInLqn5OZTlKOiGUi8YWOzV1ZTq7oDtL5dlp7bKpLnO11oOrfdZD1C9N0+iMhcbmihTXJain96+jn6XuzkQtdxkz7299mS6hK68D8J7UXRJX3vvAaVmPTms3O/jZlsKHo9hK6kNZG5RWlx+HqLys20I/XLRdadl01shvXFBc/+sKaXJ8MY2/9szUDQysOxtjY0Q/ojSdBmu+Tpochkc/wk7rX18+Lecz1TKV9allKvsF0RnD8j9fnKb7cHpymlcpOyXEW9+/QrH7e9CoTrxLFQB2FDWSWrSDK0MZvCeno1LXwFB8qH9WdFBa6+dyr9SdQdBBaF7e52UrqOP841I34O2iPC11g4Hq4DpW67NeLzVQruTB3s3TWj8r3RSihsU8tP2oMXbLPl1wsnjCepZL29cYB3pgSfQ9mZcaJu/0YOouE+vMkQ+aK7pkqptHnpGmhyDRzR4npe5xTFtB32/9INP6XqSh79+YbUd19ngQAFaBdnBl7KeotnPU2aFlDdApYx4/s1v4AXpVaLvS2dgxVPfI8LpFl+PKGSd9brU7Khdp6L1gOXTmLV6GbWHdAEBPwwh4J+RFON0DWEm6i0+X0Gf5YZocJNWHh4j8IO35ZShPJMDmGPNjrox3BwDo+S38G6X+bPfwIFbSMWncQXVMncLrKj/vZd15aWiOq3oQS+E30rQcl6a3BQAAsE5jDqqqo7sINWjr3pzuPVG6Ro9s8vkp/ySLYfVpvfu2AAAA1mnMQdXrKK8bWlztMpjy8ekO2B203nW3NgAAWAAdWPVIpiG1RtjPLSYaFLhW99EWw+rz7QAAAGzQrCda+MFX+XInqKvVPcBiWG0np+7ZpQAAYIHUqCqPLKqpNcKO6F9rENpHhLI4qKz4tFh9rHMAAJbg8DT7IKsnLmjUew06rAGdCz3T1qcteY3x1npIOlaTntm7z4MAAGAxdOfnYR4E5qAnLmhsPwAAsER+pgyYh57bCwAANkHrYfHAED2/+BAPAgCA5dBlLT2KChjr6Jyu7kEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALCD/Q9P2iDbblEZuAAAAABJRU5ErkJggg==>

[image13]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFQAAAAZCAYAAACvrQlzAAAC80lEQVR4Xu2YS6hNYRTHlzAgA/LITRzlHQPpmnikkFcxoEwYGRADycBNSWSq5DkRp5RXiCQDyYABMmJAxuRRMvAayGv9z/rW3eus8+199pF9uun71b+71399+3zfWXt/j3OJEolE4r9mImukNwciC1ifWL9ZR1xOuUKSf84a7nJFTGU9Jrn3rsuV5RrJ/dAK4380PvSZ9YGy7wKt7m/dJR6y3pv4BWuviYeSDGxSiAeHuKe/RT5LSNoqc13cKb6gYETwbzgf3CfJbfOJqjhEzV9wTIhvG+8B67WJwWEqVxi02e6876xHzitLUUEvO1/RN7UroKMzzpvpYrQ55TwsEe0GOY6kDf5a7gT/bygq6EXnK10r6EqSjjaEeJ3JKTq99zm/Fvz1zrfsp/gXqVPcj7GJdYGysXVaUJ1JB32iCjBF0Nlm1gHWKNYr1lvTRte83cYDY4Pf53wL1rRY4U5S3LfMImmzI8TY3REXFfQWawprGms262nwN2ZNq+UlSYfYKS3wjofrpSHemaUboPjwTzvfohuC5yiJP8EnDMjf8yYVFxTtMd5lrFUkDwP+paxpOUazektqRrgHPCHpcKvxgL4JYHq43pWlG+jmhU0tD0zVWEFPkPhDfCKwliQfO0UUFTQ25QFyP7xZRI1kjSmjxeEeUCfpDNPEYgs6KFzbYxTQKYg1Lo+8NRSbYMxXzlN+Hj7Wfku7gr6h9mP9J+DAi46wXllsQTXO2+Vjb5GykKRNp7v8MZK8nnst8DGdLVrQvKmtPyrwuZWDjrApee+XiX+ynpkY7KHWosxnzXMe2viTwBdqXbcterLY4hMk/hrnlT2HDvOJKjhHUjBFBzfeeIuCZ4k9cR24BW+jXb90CZlsvBg3qfWz8CDg1Z1fCz7usWCNfhdyOD51jesknepaM6c53UDfSLwF+KVztjndAMchyIPjy1fWVZLPWN6czgUnC31IGJs+DPvgbAzh5cD4vpHMAvz/ASeSRCKRSCQSiURiwPIH+KvmaEt4DUQAAAAASUVORK5CYII=>

[image14]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKUAAAAaCAYAAADWt5x6AAAFE0lEQVR4Xu2aWchVVRTHV5ZalBJFAzQJpS9FRdAAJhlFkxllWinVgwUV9dJAD0JWRAXZTPXQjIWgiWhmUkQfFU1EUDQQ+lCU2UADzTa3/q2z+9b9373vPfuc+/lp7B8s7t3/tc9w915n77X3uSKFQqFQKBQKhcLgOETta7W/1V5T27nT/R/PitX5Vm0++QIHqL0uVu858m1ODlX7Sew+gn3VUcPw/k3k21LZTu03Fh11+yDU2ah2DPlizBKrH+NBMd/HavuSL5uL1e525cfFTn6Y0wC0sdX3uVX5y2H3v+CH+ZtGYKR+RBOuETvf4ezowYdix6AjU/zBwhbKB9L5EMWo0wfj1H535VvF6rzstBip6/6ldoIro85JrpxN7EKsrVVb6cpgjVid05yG8iWuDPBEY/Rtw/1qf4o1cC6Pit3XVNIDG9QmsLiZOZCFPnwv3X0WqNMHP6rd7srgC7FjdyU98Ll0xwW4IaKdGtGyQKfwCfjiGElQnu00NCQ0/Biwe1XGpydM+U1A4KMB92JHBheIXf9qdigHi11jNMCs867auup7DqmgrNsHoX93c9qllbbUaYGZapdLd1wAlN8nDUDfh8WmLBA74SlOQ1AsdmUwXazem1V5YVVmHpG4nmJbtbfE8pxBjGBTxK7/JDsk774GBUYi5LYvsSODVFDW7QOkZotcGVwnVuc20kHItVNBGctbofu0sDGni53sLnZEeEas7kFVGdM73zC4V+I6s5Pap2rviAXmIMH1sZDzPKY2jbSRZLLarxIfiXJJBWWbPvhGrM540j+S4Xw8FZSpBx5pXyuQ7D4hlrsdRz4GQYOLvuG0FyuNQYBD7zcFI+dB3jKRHQOAGxMNH1uJjwTIZXHtO9jRglRQNu0DrJbhv490PLTXujK345iqvMJpAejrWWwKbhwnfIodjl9keNoOLJF4g9wjpvda/XpWiW3l7M2OFnBjYjraxpUDSNBvYdGBVWZdwvZJLJdtSyoom/YBfA+zKJ0rdMDtGDReBAPobVKULmIXD7yntoxFSeczD0lc7weeWoza2ENti/8989Rucj6wi9oVYvt2qaDE/eT8jovE6p/LjgGQCsomffCD2pUsiqVR25MWiwuUkcox0B9gsS7oeD44XPxo0per3UjaJ9VnmKb6rfxyCQuvk9mRAbZEwj30upcXJB6UO4rtu/U6NsUZYsddxY4WpIIytw+w8sfK2oNcG2CUYwtxge+XVfVQTq2+z2axDmfK8IU8QfMLDkxDvP+1h1gSHcAxmLY82NJBEt2W88XOfx47ajAkdiweoD3J50kFJbbNALdTDkeKTf+x1W0uqaAEdftgtdpRpM2pLEUsVhCQrB0R0bLAwX7Fhb07aE87DQufcENsJ7p6eCL92xHkbagzyWltOVZs7zGH68Xu4xV2EAhK3iq52X1v1dAV+6n9LJb/NQXHp+6lTh+EN2Mx28HVY0IdD1IfaH6qR0rAa44scFI8wTgxVqT49KMf4Bv3hhWY522xhQqmeviP73SPCtOluzFjICj9SIZN7bNcuc456oJdBuzFDrGjB+jsz8RGfBi20DAC7u8rSf8+4D70FgNbWf66eGHi2wnnx7FYpOJ/Ea86X6ElCEr/+u1CteedoeHxOUgwkqVegRZGGUzLM2oaRveRAEF5J4uO1EhS+J+CP1tgMVDHBvH6kcHiAW99kMJgmvScIzYtwfcd+QqFQqFQKBQKhUKhUCgUtiL+AUV8qGMVm12qAAAAAElFTkSuQmCC>

[image15]: <data:image/png;base64,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>

[image16]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEQAAAAZCAYAAACIA4ibAAAB60lEQVR4Xu2Xuy9EQRTGjwLxCgnRKBCCeBUoKCi8ChK0SgVRikpEqfYXqEg0WoXQa5VCIaEiEoJ4P8+3M2PPntzZXcluImt+yZfc+b6ZO3PunTvJJQoEAv+AclaPNv8rH6wvK8cV6034j6xr1g3r1Xo7P71zEP1AHD6/noz/ooNcwVe4zwcuq9ZBLuAr3OcDl7XoIFssszZYozoQjLC2WHM6SAEO0HXWgm37Cvf5+WT8Tx1kC0x2yDq119CAyBush4dRwxqm9BeHgxH3BXmsA/IX7nzMB2E3zFpvT/TLKrqwIoovrJtVaq+rZCfLszYU+5S8cI3zB62wW8dZl6x7MmtJi0oy2zIdNdsxAG97XrQdBRRfHNSWGP+wpg0Fxh5rk1I/kCguyGSNOoiiljWRpvrtGDDDKhFtSS8lXyAYYtVpU4Cxu9ok/319Pmgik73rIJN0sTq0aSmk+ALPVeZYIXMu+MBYd35IfIX7fFBMyfOMcaQNCybGd+y26nZiHCPV4nwF/NYHm2SyqB2XUZZY06KNwxMT4+077qx3Rua8amU9sMZEnyjQF+M6hbdovajCff4qGT+rn4tkkuKLwT9EWWIcA+eP/A9pT4y9VJApxI3rE9eueNl2wpgn1i3rhDVl+wYCgUAgEAj8Sb4BJfqjKSuVElQAAAAASUVORK5CYII=>

[image17]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHsAAAAaCAYAAACXbyOAAAADjUlEQVR4Xu2ZWahOURiGP4SkCBlKmQrJEDJEErlwIUSGTJ1C4kJcIBluSAo3CMmNUGYpGS8IF8pw6Ubq/BJFhlyYx/Web61z1v+evf9pL7+js5562/96v7X3Xmt9++y19joikUgkEolE/jfaG90w+m30wKhFfjgIpVwzJ9oGp+9G6/wKhu025nQ/P9zk6GpUK9rWJ0YD8sP1uPF/b7SUYo7MeeopenI7W+5iyy3ra2SjRvR6CzlQAJfINHaIJr2pM8LolldeLtqv1Z4H4LW2vxfY8uuGcB1B8vTR6DR5D42+kFcum0UbM4MDJVAs2T/ZqDI92EgBY+gnCHDfrhpd9MrgsjQeuyB5wkXnkbfJ+pVwyOiX0SgOlAEPiE/OqAObVWKyaLu2cSCFU9K4H9y3H7Y8x/MGW++V52XO00TRyhPIr7F+Z/ILccnok1EvDlTAS0nuBAbhGptVAHMo2rOSA2UyXvQ6uzwPr+djXhlMEq33yJaD5GmtaOWR5M+1/ljyGcwXaBCewI4Uy8JZ0fsPJT/pAfibbBW9ZyVTETNG9Fq3OZDAddG6Q2w5a57qwOsIlYeRP8v6i8hnjht9NupDflbWiN5/lecdFX2NVoODkn0q8tktOlboE/4aC9FKtB5W246seapjhWjl4eRj/oA/hfw09osOzmgOVAgGGfc/YcttjN42hPPAYiaNbkb32CzABdGHtzcHAoEVN/qVI98H93evb0eQPLm5YBz5S6yP+aQcNoqeN50DFYDrPLO/sRbgb8o9RjNF66WBWDnJviv6yRNySmLQJmggBwyPjc6wKYHy1Fa0cqZVXgKLRc/PsqBxg4Lvzp0U80lrJ1bCmOvKSbbjvIRZbOJziTd93Op7C/nnRPcPfJ7bY7A8ofI+8q5YPyuTJLljpeCSXawdSfFOoivfSpPt2Cv6Tc8Lo1Jwmx7cPucN8rwNkr8+Ad2NDnjlIHlKejpQnk1eFrBFeITNIrhBKbaBwW0HT+0xa7Id60XvM40DRcA5fb0y9gfg1Xoe5lvXV9ZUr16wPJ0UfYJxxAUwSP8a7IvfYTMBHgCspB2hku2YL3q/ZRxIAStrLLhwTs4esWPmwwn2xVuhTTFPVYWTfdPTC6MP9ndIsLnT7MB3H15tpai/PSc0nGyfwxL2L7tZ009096YUlfR5UAbYZcK/A98YvRN97ft8sz70lWKRSCQSiUQikUgkUiX+AD8ME9Q7ZdFSAAAAAElFTkSuQmCC>

[image18]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEEAAAAaCAYAAADovjFxAAABu0lEQVR4Xu2XPS8FQRSGj0R1o5WQiEaiF34AHVHrhZ+gJEQnKg0NIT4KhUajIRoqQlQK0Qm38F2IRHydN7Obe/bsmXVvuDd7ZZ7kzcy852xm5uxmM0MUCAQCSRpYT6wvoftEhuODSnH0884Iq8h6Z82omJcVchvsVb4E8Xpgi3UjxhusBzH2Mkxuk+PKj9lmdWszp2AfjYbXr7wUHeQSd3SAKVCysnlmjuwvFt6lNi2Q+KxN5k0bOQZr9RXB8lNYiaOsCeXlGWsPwOensBL1+K9Z92iNtUruh73MWmItRs9kYe0B+PwUOvGc1SzGMV2sI20KbrVRQ/QeYnx+ilcqJeJHeShiMZOsefIXYYjKnKxK4FxgzV92EfbIJbZHrY9p8hcBB5OsZzWzFeondsmeH96nNi2myCVfsQZUTOIrwnXUWouoFS1kzw9vTJsWfeSSH3VAgSIcKw8HkULUtxZRS/DGN8V4kCpYE05ZSMZ9IgsU4UR5C6Jf9oRVBOeFC9YBufU0JcO/B0U4FeMe1r4QJkXbJnL+HSjCmTYFefgSqsoLuRvZHbkjtryotJK7liOGtlPEAoFAIBCoI74B5rCCH62y63AAAAAASUVORK5CYII=>

[image19]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACUAAAAZCAYAAAC2JufVAAAA/0lEQVR4XmNgGAWjYBSMgpEDqoB4ERC7oUsgAVcgXgbEaegStAD/gfg8EN+DskHYDkleGSoGcpA0ELsA8T8keaoDdMM5GRAOMwZiHihbBFkRFPxAF0AGwkBsQiRWh+oBAZCvM5D4MMDGgHAYCGujSsNBH7oAMpAHYj8isS1UDwgkAjE3Eh8ZWDAgHIULOAOxArogpcAIiHXRBaGAnQHhqEdocjBQA8SM6ILUANfRBaAA5BgnIH4BZa9GlQYDfKFIEagA4kgkPihBgywDhQIMfIKKPWSApF8tIP4KxF5IaqgO/BkQUfUOiHlRpcEAlB7/MiDU6aBKj4JRMApGwdABAB+8M9Wufvi6AAAAAElFTkSuQmCC>

[image20]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAZCAYAAAAv3j5gAAAAf0lEQVR4XmNgGAUjDZxBF6AmOAnE/5EwyYAViEvRBfGAIgYyLeJgoJNFPAx0soiXYShbZIIF2wPxJCziIIwNEGWRHxYcDsQLsIiDMDZAlEXYAE2CDhsYtBZ1MUAsEkWXIASItegXEL8A4idA/BhKvwbixciK8AFiLRoFo2CkAwAtOCUn2On9ZQAAAABJRU5ErkJggg==>

[image21]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACUAAAAZCAYAAAC2JufVAAABeUlEQVR4Xu2UvyuFYRTHT0lRKKGsUn6URclgMcpiMVjUXWQzGpRB2RgUs4iFycYok+IPEMu9pchiUGLw63w7z1vnPfftfQ5RhudT3957vud5zvO99z73EiUS/5cx1hPrk7VheqCLVSXp37D68u3f55z1oOor1pKqh1mnqp4jCbegPBeNrEVrFrBKckBGZ6iPlfcavGblodb7XDSRLxQGbxtvwNQHVB/gR6FaKB5qgmTwdKinVK8M3D/sW7ONGK0UD3VIMnyWtcJqZ92y7tUayyjJnjPb8OAJdU1ywKPx4W0ZD6yz9kn6FdOrY6RA46zNAh/KuCQ5YF55IHZf8CNCv2b8HLgLVjOs3QJf35sdkuG9ygOxUCBb028bZXi+vkmSwYPGt6GeWReqBm8ka5aNX4onFMBgXHTrfYTXHaG2n1zm2TdUijfUHutd1fgrwWHdykPdo+q24FWV58IbChyRHHIXnkP5NjWwXkKvFp4neoGX74RKJBKJv+ILVoVeLDPlZdcAAAAASUVORK5CYII=>

[image22]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAZCAYAAAAv3j5gAAAAYUlEQVR4XmNgGAUjDZxBF6AmOAnE/5EwzUERw6hFZILBZZEwEJsQidWhetABURbJA7EfkdgWqgcdEGURNcDws6iLAWKRKLoEtcAvIH4BxE+A+DGUfg3Ei5EVjYJRMAooBwCZZh7vPiWQwAAAAABJRU5ErkJggg==>

[image23]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAZCAYAAAAv3j5gAAAArElEQVR4XmNgGAUjBXQA8W8g/gPEC9HkqAY+ArERlC0MxP+hmKrAHIhfAjEvkpgpA8Sic0hiFANQkIEMvYImThNfrQZiPjQxmliEDiwZIJaAHEBTALLkH7ogDIBSiwmRWB2qBxtYC8R/0QWRgTwQ+xGJbaF60EE6EH9AF6Q2sADiB2hiVE8MEkB8EV2QgcoWsTAgkjI6Po6kjmIwmwHTAhiuRFI3CkbBKKACAACWmS7xcyXh3wAAAABJRU5ErkJggg==>

[image24]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABoAAAAZCAYAAAAv3j5gAAAAuklEQVR4XmNgGAUjBZQB8T8g/g/EC1ClqAduArEtEv8rA8RCqgOQocgG50P5y5HEqAJAhoJ8AQPlULFeJDGagI8MEIsY0SWoCboYIJbooktQC4gB8QQgPgzET4BYGFUaAUASJkRidageXKCFAeIrO3QJEJAHYj8iMXJSxgZAcYOeEikGlgwQA83QxKlu0WUGiIEH0MSpbpEREP9GE1vEALHEHU2cYhDKADH4CxD/hbIdUVSMglEwCqgCAGNfLS++fcq9AAAAAElFTkSuQmCC>

[image25]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAaCAYAAACO5M0mAAAApElEQVR4XmNgGJpAHl0AHZwA4qtA7AbEj4H4AIosFMwF4r9oYv+BuBRNDKvgDKg4HEhDBTyRBYEgByoOBwlQAVNkQSCIgIqrwgQqoQL6MAEoCIaKw22qggqgKwyCioejCxjDBKAgDCoON8AOKmAJE4CCWKg4yLNgwA4VAJmADGBOQgEggUloYtug4igAm24QH+R+DLCcARKNIBqkqABVehRQAwAA4fYow14SzbMAAAAASUVORK5CYII=>

[image26]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAaCAYAAACO5M0mAAAAZklEQVR4XmNgGLqAGV0AGYAka4D4PxBnocnBwQ0gXgfEfgwEFCKDoaIwB10QGwApzEUXxAZACvPQBbEBkMICdEFsAKSwEF0QHYgwQBT2oEvAwGogfg3ET4D4MZR+CcS/kBWNAsoBAO7yGbPFo+KDAAAAAElFTkSuQmCC>

[image27]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAaCAYAAACO5M0mAAAAgElEQVR4XmNgGJpAFF0AGbAD8T8g3gXEz4D4PxBfRlEBBSAJZOAIFbuGJg4W/IlFDN0AsMAPLGIYCrEBohQ6MUAULUKXQAcgRTfRBdHBCyDejy6IDgQZIKaBwhUnYGLAdPxiND4YgGIGHWCI/WJABAc6hgNpLJIw/B1J3SigAgAAyDUppOz176QAAAAASUVORK5CYII=>

[image28]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAaCAYAAACO5M0mAAAAkklEQVR4XmNgGHqACYiF0AXRwW8gngLE5UD8H4jvo0pDwE8g3ozEl2SAKN6DJAYGIEEQJiTGwAXEVkh8RQaIogtIYljBSwYspiGDVwwQBWfQJXCB2wwQDSzoEtgAVs9gA1gV/gXi2WhiMIU2MIFgJEFkABNjRhdkR+LrQcW2IYmBASgh/GOASL6B0lNRVIwCqgAAElInvH8xK7IAAAAASUVORK5CYII=>

[image29]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAkAAAAWCAYAAAASEbZeAAAARklEQVR4XmNgGHAgji6ADfxHF0AHigwQRcLoEsjgHwNEEVbTVBgQEsi0BJQN5kyEcaB8GMhF48MBVkF0MKqI3ork0QWIAgCfKReOAp23owAAAABJRU5ErkJggg==>

[image30]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAkAAAAWCAYAAAASEbZeAAAASklEQVR4XmNgGHAggi6ADfxHF8AGRhXRWhFI0AONDwMNyHwbIP4DZcMEQbQOlI0CvjNAJLFaCQO6DBAFMugS6ACvKTCggS5AFAAAEtcXlcVzqQMAAAAASUVORK5CYII=>

[image31]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABIAAAAWCAYAAADNX8xBAAAAWElEQVR4XmNgGAWjAAWwAPEkdEFywCp0AXIAIxA/QxckB/xFFyAVJADxfyA2IRNzMUBBJQPEID8ysRADGviDLkAuAEX9XXRBcsEWdAFyARsQ96MLjoJBBADzXhBaSxaSBAAAAABJRU5ErkJggg==>

[image32]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEkAAAAZCAYAAAB9/QMrAAACU0lEQVR4Xu2XTUhVQRTHTx+LVlFSkbiJdNOuTRhFZVKroEWWizBatBCtVrVpkxtpE4JCLYqiTbQKapsIghCpC8GNCAYVKqJFkB9REen5c87UvPNm9L7rg96D+cGfd+d35t537zB33jyiRCKRqG62WLEB2zm/rPRo4IxwVjkDplZ1nCZ5kG5biDBJ0t8lxCkqrB027arhCsmN37CFjCxS/MHhO4zDrBs2rmK5Q/IQF2yhRGKDtI/E49OnX31F84Dzh3PUFnISG6S7FPbPKOwdJzi3OI84uzhbOdc4vZydXr9OzgtOk+ccuMZbkrWwlTNVWI7zivODc9AWNklskF5T2D+ksHe0ccZI+jRzHqs/r24/54O6vep6tA3uc5577cu0/vf95SZJx2O2UAZigzREYd9H4utswYA+nwLOXvOncThu99rOZeY2yQkttrAJYoOEVyHk8brDY+uwHuhzNeAmjPum3vFO2x+peLBKwk3B67aQg9ggxdakpxT2FvTBemLdqHFf1Pu8V+fSVVgujZMkF7lnCyUQG6TjJD7vrxv62F9eOCzGPgvqHbXecQ0V13ODXTHe7Se2kIHYIIHQgy5zvhoXAudeDDg7kz6rd4TuBW6blXnZzRm0cgO+U/jGAGbNb6+Nvzzoe8BzIXaQ9LMbUTi8Sj4r6h04fuO1nfsvLHHmONOaWZIZUu93YsZJHuQlyc2eKSwXgZnirotr4txLnHl1M/RvJmI9Qhser9URku84q58Izsd+K1EOsCc5lzHl2olXHXs4jRlzSM9JJBKJRKIyWQO46a5eHBlSrgAAAABJRU5ErkJggg==>