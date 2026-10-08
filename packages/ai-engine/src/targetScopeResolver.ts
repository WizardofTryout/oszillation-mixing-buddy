import { TargetScope, resolveScopeFromTrackName } from '@mixing-buddy/shared-types';

export { resolveScopeFromTrackName };
export type { TargetScope };

export interface AcousticTelemetrySnapshot {
  spectrum32Bands?: number[]; // FFT Pegel (-90 bis 0 dB)
  crestFactorDb?: number;     // Peak minus RMS
  integratedLufs?: number;
  momentaryLufs?: number;
}

export interface ScopeResolutionResult {
  scope: TargetScope;
  source: 'text_heuristic' | 'acoustic_detection' | 'fallback_ambiguous';
  confidence: number; // 0.0 bis 1.0
  reasoning: string;
}

export function isAmbiguousTrackName(trackName: string): boolean {
  const lower = trackName.trim().toLowerCase();
  // Typische generische oder unklare Spurnamen
  const genericPatterns = [
    /^audio\s*\d*$/i,
    /^spur\s*\d*$/i,
    /^track\s*\d*$/i,
    /^inst\s*\d*$/i,
    /^rec\s*\d*$/i,
    /^take\s*\d*$/i,
    /^loop\s*\d*$/i,
    /^[a-z0-9]{1,3}$/i,
  ];
  return genericPatterns.some((pattern) => pattern.test(lower)) || lower.length < 3;
}

export function classifySignalAcoustically(
  telemetry: AcousticTelemetrySnapshot,
  trackName: string
): ScopeResolutionResult {
  const bands = telemetry.spectrum32Bands || [];
  const crest = telemetry.crestFactorDb ?? 10.0;
  
  // Wenn kein Audio läuft (Stille), kann akustisch nicht klassifiziert werden
  if ((telemetry.momentaryLufs ?? -100) < -60) {
    return {
      scope: 'mix_bus',
      source: 'fallback_ambiguous',
      confidence: 0.3,
      reasoning: 'Signalpegel zu niedrig für akustische Erkennung.'
    };
  }

  // Energie-Summen in Schlüsselbereichen (Bänder 0..31):
  // Bänder 0-3: Subbass (20-60 Hz)
  // Bänder 4-7: Bass (60-250 Hz)
  // Bänder 8-15: Mitten (250-2000 Hz)
  // Bänder 16-23: Hochmitten / Präsenz (2-8 kHz)
  // Bänder 24-31: Höhen / Air (8-20 kHz)
  const avgSub = bands.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
  const avgMids = bands.slice(8, 16).reduce((a, b) => a + b, 0) / 8;
  const avgAir = bands.slice(24, 32).reduce((a, b) => a + b, 0) / 8;

  // 1. Drums / Percussion: Hoher Crest-Faktor + Energie in Bässen und Höhen
  if (crest >= 13.0 && avgAir > -45 && avgSub > -40) {
    return {
      scope: 'drum_bus',
      source: 'acoustic_detection',
      confidence: 0.85,
      reasoning: `Hoher Crest-Faktor (${crest.toFixed(1)} dB) und ausgeprägte Transienten deuten auf Drums/Percussion hin.`
    };
  }

  // 2. Sub-Bass / 808: Fast alle Energie im Sub-Bereich, kaum Mitten/Höhen
  if (avgSub > -30 && avgMids < -55 && avgAir < -65) {
    return {
      scope: 'sub_bass',
      source: 'acoustic_detection',
      confidence: 0.88,
      reasoning: 'Dominanter Subbass-Fokus mit steilem Höhenabfall.'
    };
  }

  // 3. Vocals: Ausgeprägte Mitten/Präsenz, aber kaum Subbass unter 80 Hz
  if (avgSub < -50 && avgMids > -35 && crest >= 10.0 && crest <= 16.0) {
    return {
      scope: 'lead_vocal',
      source: 'acoustic_detection',
      confidence: 0.80,
      reasoning: 'Formant-Präsenz in den Mitten ohne Subbass-Fundament.'
    };
  }

  // 4. Keys / Synths: Dichte Mitten, moderater Crest-Faktor
  if (avgMids > -32 && avgSub > -45 && crest >= 8.0 && crest <= 12.0) {
    return {
      scope: 'keys_synths',
      source: 'acoustic_detection',
      confidence: 0.78,
      reasoning: 'Gleichmäßige Mitten- und Obertonverteilung typisch für Harmonieinstrumente.'
    };
  }

  // Unklares Signal -> Fallback
  return {
    scope: 'mix_bus',
    source: 'fallback_ambiguous',
    confidence: 0.5,
    reasoning: 'Akustischer Fingerabdruck lässt sich nicht eindeutig einem Einzelinstrument zuordnen.'
  };
}
