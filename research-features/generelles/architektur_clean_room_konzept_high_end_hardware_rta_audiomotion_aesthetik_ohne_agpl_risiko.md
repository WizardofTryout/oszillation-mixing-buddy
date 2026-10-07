# ARCHITEKTUR- & CLEAN-ROOM-KONZEPT: HIGH-END HARDWARE-RTA (VFD/LED & SMOOTH SPLINE)

## 1. Rechtliche Einordnung: Warum AGPL v3 für uns tabu ist

Deine Einschätzung bezüglich der Lizenz von `audioMotion-analyzer` ist **vollkommen richtig und extrem weitsichtig**:

* **Die Lizenz-Falle (GNU AGPL v3):**
  * Die AGPL ist die strengste „Copyleft“-Lizenz der Open-Source-Welt.
  * Wenn fremder AGPL-Code (sei es als npm-Paket oder durch Copy-Paste) in ein Projekt eingebunden wird, greift der sogenannte **„Viruseffekt“**: Das **gesamte eigene Projekt** (Desktop-App, Rust-Backend, AI-Engine) müsste unter Androhung von Lizenzverstößen zwingend als Open-Source unter AGPL v3 offengelegt werden.
  * Für ein proprietäres, kommerziell verwertbares Studio-Produkt wie *Oszillation Mixing Buddy* ist das ein **striktes No-Go**.

* **Die gute Nachricht (Clean-Room Implementation):**
  * **Ideen, visuelle Ästhetik und physikalische Prinzipien sind nicht urheberrechtlich geschützt.**
  * Was AudioMotion so attraktiv macht, sind standardmäßige mathematische und grafische Rendertechniken auf dem HTML5 `<canvas>`.
  * Wir schreiben diese Rendering-Routinen in `SpectrumAnalyzer.tsx` **vollständig selbst in sauberem TypeScript**.
  * **Ergebnis:** 100 % unser eigenes geistiges Eigentum, 0 externe Abhängigkeiten, 0 Lizenzrisiko und perfekte Abstimmung auf unsere 30-fps-Telemetrie!

---

## 2. Visuelle Dekonstruktion: Warum AudioMotion so gut aussieht

Das Demo-Bild zeigt drei klassische High-End-Darstellungsformen der Studio-Messtechnik:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ DIE 3 VISUELLEN GEHEIMNISSE DER AUDIOMOTION-ÄSTHETIK                             │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  [ 1. DIE SEGMENTIERTE LED-/VFD-MATRIX ] (Linkes großes Fenster)                │
│   • Keine starren Farbblöcke, sondern gestapelte Einzel-LEDs (z. B. 2px Höhe)   │
│   • 1px schwarzer Zwischenraum (Rasterung / "Segment Gap")                       │
│   • UNBELEUCHTETE SEGMENTE: Dunkelgraue Geister-LEDs im Hintergrund             │
│   • PEAK-HOLD NEEDLES: Einzelne schwebende LED-Kappen mit Gravitations-Fall     │
│   • BODEN-REFLEXION: Feines, halbtransparentes Spiegelbild an der Grundlinie    │
│                                                                                  │
│  [ 2. DIE GLATTE FABFILTER-SPLINE-KURVE ] (Rechtes oberes Fenster)               │
│   • Kontinuierliche Bezier-/Catmull-Rom-Kurve statt eckiger Balken               │
│   • Transparenter Gradienten-Fill unter der Kurve (Flächen-Schattierung)        │
│   • Vergleich zweier Kurven (Live-Signal vs. Referenz-Track oder Soll-Envelope) │
│                                                                                  │
│  [ 3. FLUORESZIERENDER GLOW & PHOSPHOR ]                                         │
│   • Subtile Canvas-Schatten (`shadowBlur: 8`, `shadowColor`) für Röhren-Look    │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Die mathematische Clean-Room-Umsetzung in `SpectrumAnalyzer.tsx`

Die Umsetzung dieser Techniken auf einem Standard-HTML5-Canvas (`CanvasRenderingContext2D`) erfordert nur wenige, hochperformante Schleifen:

### A. Segmentierte LED-Balken mit inaktivem Hintergrund-Raster

Statt eines einfachen `ctx.fillRect(x, y, w, h)` unterteilen wir die vertikale Höhe $H$ in diskrete Segmente:

$$\text{segmentHeight} = 3\text{ px}, \quad \text{gap} = 1\text{ px}, \quad \text{step} = 4\text{ px}$$

```typescript
// Diskretes LED-Segment-Rendering
const totalSegments = Math.floor(canvasHeight / 4);
const activeSegments = Math.round((currentDb - minDb) / (maxDb - minDb) * totalSegments);

for (let s = 0; s < totalSegments; s++) {
  const y = canvasHeight - (s + 1) * 4;
  
  if (s < activeSegments) {
    // Aktive LED: Farbe nach Pegel / Heatmap
    ctx.fillStyle = getLedColor(s / totalSegments, isMasked);
    ctx.fillRect(x, y, barWidth, 3);
  } else {
    // Inaktive Geister-LED (Das Hardware-VFD-Gefühl!)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.fillRect(x, y, barWidth, 3);
  }
}
```

### B. Schwebende Peak-Hold Nadeln (Gravity Decay)

Jedes der 32 Frequenzbänder hält im React-State bzw. im Render-Loop zwei Werte:
1. `currentDb`: Der aktuelle Momentanwert (folgt schnell der Musik).
2. `peakDb`: Der Spitzenwert, der kurz stehen bleibt und dann mit konstanter Fallbeschleunigung absinkt:

```typescript
if (currentDb > band.peakDb) {
  band.peakDb = currentDb;
  band.peakHoldFrames = 15; // 0.5s bei 30 fps halten
} else if (band.peakHoldFrames > 0) {
  band.peakHoldFrames--;
} else {
  band.peakDb -= 1.2; // Sanfter Zerfall / Fallbeschleunigung (dB pro Frame)
}

// Zeichne schwebendes Peak-Segment:
const peakY = dbToY(band.peakDb);
ctx.fillStyle = isOverTarget ? '#f43f5e' : '#f59e0b'; // Rot bei Clipping/Überhöhung, sonst Bernstein
ctx.fillRect(x, peakY, barWidth, 3);
```

### C. Zarter Boden-Spiegeleffekt (Floor Reflection)

Ein optischer Trick professioneller UI-Analyzer:
* Unterhalb der $0\text{-Hz}$-Basislinie wird der untere Teil der Balken invertiert mit einem Transparenz-Gradienten gezeichnet:
  ```typescript
  // Reflektion nach unten
  const reflectGradient = ctx.createLinearGradient(0, baselineY, 0, baselineY + 25);
  reflectGradient.addColorStop(0, 'rgba(6, 182, 212, 0.25)'); // Türkis
  reflectGradient.addColorStop(1, 'rgba(6, 182, 212, 0.0)');  // Ausblenden ins Nichts
  ```

### D. Glatte Soll- und Referenzkurven (Bezier Spline)

Für die Sollkurve (`targetProfile`) und den Referenz-Track verbinden wir die 32 Frequenzstützpunkte mit quadratischen Bezier-Kurven:

```typescript
ctx.beginPath();
ctx.moveTo(points[0].x, points[0].y);
for (let i = 1; i < points.length - 1; i++) {
  const xc = (points[i].x + points[i + 1].x) / 2;
  const yc = (points[i].y + points[i + 1].y) / 2;
  ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
}
ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
ctx.lineWidth = 1.5;
ctx.shadowColor = '#38bdf8';
ctx.shadowBlur = 6; // Edler Neon-Glow
ctx.stroke();
```

---

## 4. Die neue RTA-Header-Leiste im HUD

Im Analyzer-Header geben wir dem Musiker die volle optische Wahlfreiheit über dezente Umschalter:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ REAL-TIME SPECTRUM (RTA — 32 BANDS)  [30 FPS LIVE]                                     │
│                                                                                        │
│ Ansicht: [ ▦ LED-Rack ] [ 〰 Spline ]  │  Overlays: [ 🎯 Soll-Kurve ] [ 📊 Referenz ]  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **`[ ▦ LED-Rack ]`:** Das Hardware-Retro-Design mit diskreten Blöcken, Geister-Segmenten und schwebenden Peak-Hold-Kappen.
2. **`[ 〰 Spline ]`:** Die ultra-moderne, weiche Studio-Kurve à la FabFilter Pro-Q mit transparenter Flächenfüllung.
3. **`[ 🎯 Soll-Kurve ]`:** Die mathematische Korridor-Kurve unseres Tonmischmeisters.
4. **`[ 📊 Referenz ]`:** Die Spektrallinie des geladenen Referenz-Tracks.