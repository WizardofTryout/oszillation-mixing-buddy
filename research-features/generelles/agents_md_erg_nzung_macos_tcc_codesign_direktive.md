### macOS TCC Permission & Ad-hoc Codesign Rule (Mandatory for Desktop Builds)

- **Problem:** Unsignierte Tauri-Bundles (`--no-sign`) verändern bei jedem Neubau ihren binären Hash. macOS TCC (Transparency, Consent, and Control) entzieht der App dadurch die Accessibility-Berechtigung (Bedienungshilfen) und fordert den Benutzer bei jedem Start erneut auf.
- **Regel:** Nach jedem Erstellen des Release-Bundles und dem Kopieren nach `/Applications/` **MUSS** die App zwingend ad-hoc signiert werden:
  ```bash
  codesign --force --deep -s - "/Applications/Oszillation Mixing Buddy.app"
  ```
- **Build-Kette:** `pnpm --filter desktop tauri build --bundles app --no-sign && rm -rf "/Applications/Oszillation Mixing Buddy.app" && cp -R "target/release/bundle/macos/Oszillation Mixing Buddy.app" /Applications/ && codesign --force --deep -s - "/Applications/Oszillation Mixing Buddy.app"`