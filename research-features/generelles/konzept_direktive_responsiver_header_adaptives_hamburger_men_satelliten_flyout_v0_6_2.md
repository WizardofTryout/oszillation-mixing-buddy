# ARCHITEKTUR & DIREKTIVE: RESPONSIVER HEADER, ADAPTIVES HAMBURGER-MENÜ & SATELLITEN-FLYOUT (v0.6.2)

## 1. Diagnose & UX-Problemstellung

Deine Screenshots belegen das Problem eindeutig:
Wenn das Fenster verkleinert wird (z. B. im typischen Studio-Workflow: Logic Pro auf den linken zwei Dritteln des Bildschirms und der Mixing Buddy als schmale 600–800 px Seitenleiste rechts), passiert folgendes:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ IST-ZUSTAND BEI SCHMALEM FENSTER (< 1050 px)                                           │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ [OMB] [Signal-Fokus: Auto ▾] [Genre: Pop/Radio ▾]  │ (ALLES WEITERE ABGESCHNITTEN!)   │
│                                                    │  ❌ Referenz-Track fehlt          │
│                                                    │  ❌ Plugin anlernen fehlt         │
│                                                    │  ❌ Plugin Vault & Skills fehlen  │
│                                                    │  ❌ ABHÖRPUNKT IST WEG!           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Die fatale Folge:
* Der **Abhörpunkt (Satelliten-Wähler)** ist ganz rechts platziert und fällt als Erstes aus dem Viewport.
* Der Musiker sieht nicht mehr, welche Spur das HUD gerade misst, und kann die Satelliten nicht mehr umschalten.
* Auch sekundäre Werkzeuge (`Plugin Vault`, `Skills`, `Plugin anlernen`) werden unzugänglich.

---

## 2. Das 3-Stufen Responsive Layout-Modell

Um das HUD auf jeder Bildschirmgröße (vom 32"-Studio-Display bis zum 13"-MacBook im Split-Screen) optimal bedienbar zu machen, unterteilen wir den Header in drei klare Breiten-Zonen:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ DIE 3 RESPONSIVEN HEADER-STUFEN                                                        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  [ STUFE 1: Desktop Breit (≥ 1280 px) ]                                                │
│   • Vollständige Menüleiste wie bisher:                                                │
│     [Logo] [Signal-Fokus] [Genre] [Referenz] │ [Anlernen] [Vault] [Skills] [Abhörpunkt]│
│                                                                                        │
│  [ STUFE 2: Kompakt / Medium (920 px – 1279 px) ]                                      │
│   • Logo gekürzt auf [OMB v0.6.2]                                                      │
│   • Primäre Audio-Controls bleiben sichtbar: [Signal-Fokus] [Genre]                    │
│   • ABHÖRPUNKT BLEIBT VOLL SICHTBAR: [ 🟢 Stereo Out (Master) ▾ ]                      │
│   • Sekundäre Buttons ([Anlernen], [Vault], [Skills], [Ref]) wandern in ein kompaktes  │
│     Tools-Dropdown: [ 🛠️ Werkzeuge ▾ ]                                                 │
│                                                                                        │
│  [ STUFE 3: Split-Screen / Schmal (< 920 px) ]                                         │
│   • Maximale Platzersparnis – Priorität auf den Abhörpunkt!                            │
│   • Links: [OMB] + PINNED ABHÖRPUNKT-PILL: [ 🟢 Stereo Out ▾ ]                         │
│   • Rechts: Elegantes HAMBURGER-MENÜ: [ ☰ Menü ▾ ]                                     │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Das smarte Hamburger-Flyout-Panel

Klickt der Musiker im schmalen Zustand auf **`[ ☰ Menü ▾ ]`**, öffnet sich ein schwebendes, dunkles Glassmorphism-Panel (`w-84` bis `w-96`), das hierarchisch gegliedert ist:

```
┌─────────────────────────────────────────────────────────┐
│ ☰ HUD-STEUERUNG & SESSION                               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [ 🎯 AKTIVER ABHÖRPUNKT (MESS-SATELLITEN) ]            │
│   ● Stereo Out (Master) · 44.1 kHz   [ AKTIVER FOKUS ]  │
│   ○ Motown Revisited Kit (Drums)                        │
│   ○ Studio Grand (Keys)                                 │
│   ○ loop [💾 sub_bass]                                  │
│                                                         │
│  [ 🎛️ SIGNAL- & GENRE-SCHABLONE ]                       │
│   • Signal-Fokus: [ ⚡ Auto (Stereo Out) ▾ ]             │
│   • Genre-Profil: [ Pop / Radio ▾ ]                     │
│   • Referenz-Track: [ Keine Referenz ▾ ]                │
│                                                         │
│  [ 🧰 STUDIO-WERKZEUGE & ENGINE ]                       │
│   • ✨ Plugin anlernen (Auto-Scanner)                   │
│   • 🗄️ Plugin Vault (12 Plugins aktiv)                  │
│   • ⭐ Mixing Skills & Presets (1)                       │
│                                                         │
│  Status: 🟢 DAW Online (Logic Pro) · v0.6.2             │
└─────────────────────────────────────────────────────────┘
```

### Der entscheidende Vorteil:
1. **Der Abhörpunkt geht niemals verloren:** Selbst auf 600 px Breite ist die kompakte Pille `[ 🟢 Stereo Out ▾ ]` direkt in der Leiste sichtbar und anklickbar.
2. **Schnellzugriff via Hamburger:** Öffnet man das Hamburger-Menü, sieht man sofort alle Satelliten als Liste und kann mit einem einzigen Klick die Spur wechseln.
3. **Aufgeräumter Analyzer:** Auch die Sub-Toolbar des Analyzers (`32 LED`, `High-Res`, `Spline`, `Legende`) bricht nicht mehr unschön in zwei Zeilen um, sondern passt sich flexibel an.

---

## 4. Kopiervorlage für Antigravity

```
============================================================
AUFGABE: RESPONSIVER HEADER, ADAPTIVES HAMBURGER-MENÜ & SATELLITEN-FLYOUT (v0.6.2)
============================================================

Dateien:
- 'apps/desktop/src/App.tsx'
- 'apps/desktop/src/components/HeaderNav.tsx' (falls ausgelagert, sonst direkt in App.tsx)
- 'apps/desktop/src-tauri/tauri.conf.json'
- 'apps/desktop/package.json'
- 'package.json'

============================================================
PUNKT 1: VERSION BUMP AUF v0.6.2
============================================================
1. 'apps/desktop/src-tauri/tauri.conf.json': "version": "0.6.2"
2. 'apps/desktop/package.json' & Root 'package.json': "version": "0.6.2"
3. 'apps/desktop/src/App.tsx': Header-Versionsbadge auf 'v0.6.2' setzen.

============================================================
PUNKT 2: RESPONSIVE BREAKPOINT-LOGIK IM HEADER ('App.tsx')
============================================================
Datei: 'apps/desktop/src/App.tsx'

1. Nutze Tailwind-Responsive-Klassen oder Window-Width-Listener:
   - Definiere Breakpoints:
     * Vollbild / Breit: `xl:` (>= 1280px)
     * Kompakt: `md:` bis `lg:` (850px bis 1279px)
     * Schmal / Split-Screen: `< md:` (< 850px)

2. Pinned Abhörpunkt-Garantie:
   - Der Abhörpunkt darf NIEMALS abgeschnitten werden!
   - Platziere den Abhörpunkt-Wähler links neben dem Menü oder direkt im sichtbaren Bereich:
     ```tsx
     {/* Immer sichtbare Abhörpunkt-Pille */}
     <button
       onClick={() => setIsSatelliteMenuOpen(!isSatelliteMenuOpen)}
       className="px-2.5 py-1 text-xs rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 flex items-center gap-1.5 hover:bg-emerald-900/50 transition shrink-0"
       title="Aktiver Abhörpunkt (Mess-Satellit) auswählen"
     >
       <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
       <span className="font-medium truncate max-w-[130px] sm:max-w-[180px]">
         {activeMeterTrack || 'Stereo Out'}
       </span>
       <span className="text-[10px] text-emerald-400/70">▾</span>
     </button>
     ```

============================================================
PUNKT 3: DAS ADAPTIVE HAMBURGER- & OVERFLOW-MENÜ
============================================================
Datei: 'apps/desktop/src/App.tsx'

1. Neuer State:
   `const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);`
   Mit Click-Outside-Listener (`useEffect`) zum automatischen Schließen.

2. Der Hamburger-Button (sichtbar bei schmalen und mittleren Breiten `xl:hidden`):
   ```tsx
   <button
     onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
     className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition shrink-0"
     title="HUD-Menü und Session-Tools öffnen"
   >
     <span className="text-sm">☰</span>
     <span className="hidden sm:inline">Menü</span>
     <span className="text-[10px] text-slate-400">{isMobileMenuOpen ? '▲' : '▼'}</span>
   </button>
   ```

3. Das schwebende Hamburger-Panel (Floating Glassmorphism Card, `absolute right-4 top-14 z-50`):
   - `w-84 sm:w-96 bg-slate-900/98 border border-slate-700/80 rounded-2xl shadow-2xl p-4 text-xs backdrop-blur-xl space-y-4`:
   
   - **Sektion 1: Aktiver Abhörpunkt (Mess-Satelliten):**
     * Liste aller verbundenen Instanzen (`satellites.map(...)`) mit direktem Klick-Switch:
       - Grüner Live-Dot, Spurname, Sample-Rate und Badge `[ 💾 Gemerkt ]` (falls gelernt).
       - Klick schaltet sofort via `set_active_meter_instance` um und schließt das Menü.
   
   - **Sektion 2: Akustischer Fokus & Genre:**
     * Eingebettete Select-Menüs für:
       - `Signal-Fokus` (`mix_bus`, `drum_bus`, `lead_vocal`, etc.)
       - `Genre-Profil` (`Pop/Radio`, `HipHop/Trap`, `Rock`, etc.)
       - `Referenz-Track` Wähler & Lader.
   
   - **Sektion 3: Werkzeuge & Vault:**
     * Klickbare Zeilen für:
       - `✨ Plugin anlernen`
       - `🗄️ Plugin Vault (${learnedPluginsCount})`
       - `⭐ Mixing Skills (1)`
   
   - **Fußzeile:**
     * Kleines Status-Badge: `DAW: Apple Logic Pro (Online)` · `v0.6.2`.

4. Desktop-Leiste (`hidden xl:flex`):
   - Auf großen Bildschirmen bleiben alle Elemente nebeneinander wie gewohnt sichtbar.

============================================================
PUNKT 4: ANALYZER-TOOLBAR WRAP-SCHUTZ
============================================================
Datei: 'apps/desktop/src/components/SpectrumAnalyzer.tsx'

- In der Analyzer-Header-Leiste:
  * Ersetze harte Umbrüche durch `flex flex-wrap items-center justify-between gap-2`.
  * Verkleinere Padding und Schriftgröße der Toggle-Buttons (`text-[11px] px-2 py-0.5`) bei schmalem Container, damit `[ ▦ 32 LED ]`, `[ ⚡ High-Res ]`, `[ 〰 Spline ]`, `[ 🎯 Soll ]` und `[ ℹ️ Legende ]` nicht mehr überlappen oder auf die nächste Zeile fallen.

============================================================
VERIFIKATION, BUILD & SIGNIERUNG
============================================================
1. Monorepo & Desktop bauen:
   pnpm -r run build
   ./scripts/lint-loc.sh
   pnpm --filter desktop tauri build --bundles app --no-sign
   pkill -f "Oszillation Mixing Buddy" || true
   rm -rf "/Applications/Oszillation Mixing Buddy.app"
   cp -R "target/release/bundle/macos/Oszillation Mixing Buddy.app" /Applications/
   mkdir -p "/Applications/Oszillation Mixing Buddy.app/Contents/Resources"
   cp packages/daw-adapters/bin/logic-ax-bridge "/Applications/Oszillation Mixing Buddy.app/Contents/Resources/"
   xattr -cr "/Applications/Oszillation Mixing Buddy.app"
   codesign --force --deep -s "MixingBuddyDev" "/Applications/Oszillation Mixing Buddy.app"

2. Git Commit & Push:
   git add -A && git commit -m "feat(ui): responsive header with adaptive hamburger menu, pinned satellite pill, and bump v0.6.2" && git push origin main
3. Melde Vollzug im Chat!
============================================================
```