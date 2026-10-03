/**
 * AI-Engine Skill Synthesis
 * Sprint 5 – Step 5.3: KI-Skill-Synthese & Prompt-Generierung
 */

import type {
  MixingSkill,
  SkillCategory,
  SlotType,
  SkillChainSlot,
  SkillMetrologyTargets
} from '@mixing-buddy/shared-types';
import { GeminiProvider } from './providers/GeminiProvider.js';

export type PluginPreference = 'stock_only' | 'vault_preferred' | 'hybrid';
export type SaturationCharacter =
  | 'clean_transparent'
  | 'warm_tape'
  | 'aggressive_tube'
  | 'vintage_console';

export interface SkillSynthesisAnswers {
  skillName: string;
  category: SkillCategory;
  intentDescription?: string;
  metrology: SkillMetrologyTargets;
  toolsAndAesthetics: {
    pluginPreference: PluginPreference;
    saturationCharacter: SaturationCharacter;
    customPluginNotes?: string;
  };
  auditMethodology: {
    greenOptimalCriteria: string[];
    yellowWarningCriteria: string[];
    redActionCriteria: string[];
    focusNotes?: string;
  };
}

export function buildSkillSynthesisSystemPrompt(): string {
  return `
You are the Master Sound Architect of Oszillation Mixing Buddy.
Your task is to synthesize a production-grade, highly specialized 'MixingSkill' profile based on a user's multi-step acoustic questionnaire.

The generated skill will guide AI co-producers in Logic Pro, Cubase, and Nuendo when analyzing metrology telemetry (LUFS, Crest, True Peak, FFT) and proposing channel strip adjustments.

Output must be STRICT, VALID JSON conforming to the following MixingSkill structure:
{
  "id": "slug-name",
  "name": "Skill Name",
  "category": "master" | "vocal" | "drums" | "bass" | "general",
  "isFavorite": false,
  "version": "v1.0",
  "revisionHistory": [
    {
      "version": "v1.0",
      "timestamp": "ISO-Date",
      "comment": "Synthesized via AI Mixing Wizard"
    }
  ],
  "metrologyTargets": {
    "integratedLufs": number,
    "toleranceLufs": number,
    "crestFactor": { "min": number, "max": number },
    "maxTruePeakDb": number,
    "recommendedHeadroomDb": number
  },
  "preferredChain": [
    {
      "slotType": "utility" | "eq" | "dynamics" | "saturation" | "space",
      "preferredPluginHint": "Plugin Name",
      "typicalRules": ["Rule 1", "Rule 2"]
    }
  ],
  "prompts": {
    "quickstart": "Concise 1-2 sentence directive for HUD ActionCard synthesis",
    "workshop": "Comprehensive acoustic diagnostic directive for in-depth chat and multi-stage analysis"
  }
}

Do not wrap in extra markdown if possible, or wrap strictly in \`\`\`json ... \`\`\`.
Ensure psychoacoustic rules match the selected category and saturation character with professional German studio terminology (e.g. 'Mumpf-Kompensation', 'Präsenz-Glanz', 'Transientenschärfung').
`.trim();
}

export function buildSkillSynthesisUserPrompt(answers: SkillSynthesisAnswers): string {
  return `
Synthesize a MixingSkill for the following specification:

1. Discipline & Identity:
- Name: "${answers.skillName}"
- Category: ${answers.category}
- Intent: "${answers.intentDescription || 'High-end studio fidelity & modern translation'}"

2. Metrology Targets:
- Target LUFS: ${answers.metrology.integratedLufs} LUFS (±${answers.metrology.toleranceLufs} LU)
- Crest Factor: ${answers.metrology.crestFactor.min} - ${answers.metrology.crestFactor.max} dB
- Max True Peak: ${answers.metrology.maxTruePeakDb} dBTP
- Headroom: ${answers.metrology.recommendedHeadroomDb} dB

3. Tools & Aesthetic Tone:
- Plugin Preference: ${answers.toolsAndAesthetics.pluginPreference}
- Saturation Character: ${answers.toolsAndAesthetics.saturationCharacter}
- Custom Plugin Notes: "${answers.toolsAndAesthetics.customPluginNotes || 'None'}"

4. Audit Criteria:
- 🟢 Optimal: ${answers.auditMethodology.greenOptimalCriteria.join('; ') || 'Targets met'}
- 🟡 Warning: ${answers.auditMethodology.yellowWarningCriteria.join('; ') || 'Mild masking'}
- 🔴 Immediate Action: ${answers.auditMethodology.redActionCriteria.join('; ') || 'Clipping or extreme phase cancellation'}
- Focus Notes: "${answers.auditMethodology.focusNotes || 'Standard'}"

Generate the complete JSON object now.
`.trim();
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `skill-${Date.now().toString().slice(-4)}`;
}

/**
 * Deterministic, offline-capable rule-based synthesizer.
 * Used when offline, in CI, or as a robust fallback for LLM calls.
 */
export function synthesizeMixingSkillRuleBased(answers: SkillSynthesisAnswers): MixingSkill {
  const id = slugify(answers.skillName);
  const now = Date.now();
  const dateIso = new Date(now).toISOString();

  // Determine chain based on category and aesthetic
  const chain: SkillChainSlot[] = [];

  // Slot 1: Utility / Filtering
  if (answers.category === 'master' || answers.category === 'bass') {
    chain.push({
      slotType: 'utility',
      preferredPluginHint: answers.toolsAndAesthetics.pluginPreference === 'stock_only' ? 'Gain / Direction Mixer' : 'Mono-Maker / Utility',
      typicalRules: [
        'Mono-Kompatibilität unterhalb von 90 Hz erzwingen (Bass Mono)',
        'Eingangs-Headroom auf -18 dBFS RMS kalibrieren'
      ]
    });
  }

  // Slot 2: EQ
  const eqHint =
    answers.toolsAndAesthetics.pluginPreference === 'vault_preferred'
      ? 'FabFilter Pro-Q 3'
      : answers.category === 'master'
      ? 'Linear Phase EQ'
      : 'Channel EQ';

  const eqRules: string[] = [];
  if (answers.category === 'vocal') {
    eqRules.push('High-Pass Filter bei 80-100 Hz (18 dB/Okt)');
    eqRules.push('Schmalbandiges Absenken von Resonanzen bei 450-700 Hz');
    eqRules.push('Sanfter Presence-Boost bei 3.5 kHz und Air-Shelf ab 12 kHz');
  } else if (answers.category === 'drums') {
    eqRules.push('High-Pass bei 25 Hz gegen unhörbaren Sub-Rumble');
    eqRules.push('Kompensation von Pappigkeit bei 300-500 Hz (-2 dB)');
    eqRules.push('Transienten-Klarheit im Bereich 3.5 - 6 kHz hervorheben');
  } else if (answers.category === 'bass') {
    eqRules.push('Sub-Bass Fokus zwischen 35 und 65 Hz');
    eqRules.push('Mittenmulm bei 200-350 Hz bereinigen für Kick-Transparenz');
    eqRules.push('Low-Pass / Shelf ab 5 kHz gegen Rauschen');
  } else {
    // Master / General
    eqRules.push('High-Pass Filter bei 25 Hz (18 dB/Okt)');
    eqRules.push('Chirurgische Bereinigung bei 280-450 Hz (-1.5 dB)');
    eqRules.push('Sanfter High-Shelf Glanz ab 10 kHz (+1.0 dB)');
  }

  chain.push({
    slotType: 'eq',
    preferredPluginHint: eqHint,
    typicalRules: eqRules
  });

  // Slot 3: Dynamics / Compression
  const compHint =
    answers.toolsAndAesthetics.pluginPreference === 'vault_preferred'
      ? 'FabFilter Pro-C 2'
      : answers.category === 'master'
      ? 'Multipressor / Glue Compressor'
      : 'Opto / VCA Compressor';

  const compRules: string[] = [];
  if (answers.category === 'master') {
    compRules.push('Transparente Glue-Kompression (Ratio 1.5:1 bis 2:1, max. 2 dB Gain Reduction)');
    compRules.push('Slow Attack (30 ms) zur Schonung von Drum-Transienten, Auto-Release');
  } else if (answers.category === 'vocal') {
    compRules.push('Schneller Opto- oder FET-Peak-Limiter gefolgt von sanftem Leveler');
    compRules.push('Max. 3-5 dB Gain Reduction auf Pegelspitzen');
  } else {
    compRules.push('Parallel-Kompression zur Anhebung von Raum- und Sustainanteilen');
    compRules.push('Attack so wählen, dass der initiale Transienten-Punch erhalten bleibt');
  }

  chain.push({
    slotType: 'dynamics',
    preferredPluginHint: compHint,
    typicalRules: compRules
  });

  // Slot 4: Saturation / Colour
  let satHint = 'Studio Tape Saturation';
  const satRules: string[] = [];
  switch (answers.toolsAndAesthetics.saturationCharacter) {
    case 'warm_tape':
      satHint = answers.toolsAndAesthetics.pluginPreference === 'vault_preferred' ? 'Saturn 2 / Tape' : 'Tape Delay / Overdrive';
      satRules.push('Subtile geradzahlige Harmonische für musikalische Wärme und Dichte');
      satRules.push('Sanftes Runden von Harschheiten in den oberen Höhen');
      break;
    case 'aggressive_tube':
      satHint = 'Tube Driver / Soft Clipper';
      satRules.push('Obertonanreicherung in den oberen Mitten für maximale Durchsetzungskraft');
      satRules.push('Clipper zur Bändigung von unkontrollierten Transienten vor dem Limiter');
      break;
    case 'vintage_console':
      satHint = 'Console / Channel Strip Saturator';
      satRules.push('Klassische Pult-Übersteuerung für räumliche Tiefe und analoge Textur');
      break;
    case 'clean_transparent':
    default:
      satHint = 'Linear Transparent Exciter';
      satRules.push('Ultra-geringe harmonische Verzerrung (THD < 0.05%)');
      satRules.push('Ausschließliche Beibehaltung der natürlichen Transienten');
      break;
  }

  chain.push({
    slotType: 'saturation',
    preferredPluginHint: satHint,
    typicalRules: satRules
  });

  // Slot 5: Space / Limiting
  if (answers.category === 'master') {
    chain.push({
      slotType: 'dynamics',
      preferredPluginHint: answers.toolsAndAesthetics.pluginPreference === 'vault_preferred' ? 'FabFilter Pro-L 2' : 'Adaptive Limiter',
      typicalRules: [
        `True Peak Ceiling strikt auf ${answers.metrology.maxTruePeakDb.toFixed(1)} dBTP begrenzen`,
        `Integrated Loudness auf ${answers.metrology.integratedLufs.toFixed(1)} LUFS aussteuern`,
        `Crest-Faktor im Korridor von ${answers.metrology.crestFactor.min}–${answers.metrology.crestFactor.max} dB wahren`
      ]
    });
  } else {
    chain.push({
      slotType: 'space',
      preferredPluginHint: answers.toolsAndAesthetics.pluginPreference === 'vault_preferred' ? 'Pro-R / Valhalla' : 'ChromaVerb',
      typicalRules: [
        'Pre-Delay auf Tempo synchronisieren (15-30 ms)',
        'Low-Cut im Hall-Return unterhalb von 250 Hz'
      ]
    });
  }

  // Prompts
  const quickstart = `Optimiere ${answers.category.toUpperCase()} "${answers.skillName}" auf ${answers.metrology.integratedLufs.toFixed(1)} LUFS (Crest: ${answers.metrology.crestFactor.min}–${answers.metrology.crestFactor.max} dB). Verwende bevorzugt ${answers.toolsAndAesthetics.pluginPreference === 'vault_preferred' ? 'Plugin Vault Specs' : 'Stock DAW Plug-ins'} mit ${answers.toolsAndAesthetics.saturationCharacter.replace('_', ' ')}-Charakter.`;

  const greenStr = answers.auditMethodology.greenOptimalCriteria.join(', ') || 'Metrology im Zielkorridor';
  const yellowStr = answers.auditMethodology.yellowWarningCriteria.join(', ') || 'Leichte Mittenmaskierung';
  const redStr = answers.auditMethodology.redActionCriteria.join(', ') || 'Intersample-Clipping oder Phasenprobleme';

  const workshop = `Analysiere ${answers.category.toUpperCase()} nach der Philosophie von "${answers.skillName}":
1. Metrologie-Abgleich: Ziel ist ${answers.metrology.integratedLufs.toFixed(1)} LUFS (±${answers.metrology.toleranceLufs} LU), True Peak maximal ${answers.metrology.maxTruePeakDb.toFixed(1)} dBTP.
2. Signalkette: Prüfe nacheinander die Kette [${chain.map((c) => c.slotType.toUpperCase()).join(' → ')}].
3. Audit-Ampel:
   - 🟢 Optimal: ${greenStr}
   - 🟡 Aufmerksamkeit: ${yellowStr}
   - 🔴 Dringender Eingriff: ${redStr}
Erstelle konkrete ActionCards mit dB- und Frequenzwerten.`;

  return {
    id,
    name: answers.skillName,
    category: answers.category,
    isFavorite: false,
    version: 'v1.0',
    revisionHistory: [
      {
        version: 'v1.0',
        timestamp: dateIso,
        comment: `Synthetisiert via KI-Skill-Synthese Wizard (${answers.toolsAndAesthetics.saturationCharacter})`
      }
    ],
    metrologyTargets: {
      integratedLufs: answers.metrology.integratedLufs,
      toleranceLufs: answers.metrology.toleranceLufs,
      crestFactor: {
        min: answers.metrology.crestFactor.min,
        max: answers.metrology.crestFactor.max
      },
      maxTruePeakDb: answers.metrology.maxTruePeakDb,
      recommendedHeadroomDb: answers.metrology.recommendedHeadroomDb
    },
    preferredChain: chain,
    prompts: {
      quickstart,
      workshop
    },
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Full AI-Synthesis Pipeline: Attempts real LLM inference if key/provider is available,
 * otherwise falls back seamlessly to rule-based synthesis.
 */
export async function synthesizeMixingSkill(
  answers: SkillSynthesisAnswers,
  options?: {
    apiKey?: string;
    modelName?: string;
  }
): Promise<MixingSkill> {
  const fallback = synthesizeMixingSkillRuleBased(answers);

  const key = options?.apiKey?.trim();
  if (!key || key.length < 6) {
    return fallback;
  }

  try {
    const keyList = key.split(/[\n,;]+/).map((k) => k.trim()).filter(Boolean);
    const gemini = new GeminiProvider({
      apiKey: keyList[0] || key,
      apiKeys: keyList,
      modelName: options?.modelName || 'gemini-3.8-flash'
    });

    const systemPrompt = buildSkillSynthesisSystemPrompt();
    const userPrompt = buildSkillSynthesisUserPrompt(answers);

    // Call Gemini API via fetch (Google AI endpoint)
    const activeKey = keyList[0] || key;
    const model = options?.modelName || 'gemini-3.8-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`;

    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json'
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      console.warn(`Gemini synthesis failed with HTTP ${res.status}, falling back to rule synthesizer.`);
      return fallback;
    }

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return fallback;
    }

    const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned) as MixingSkill;

    // Validate essential fields
    if (parsed.name && parsed.metrologyTargets && parsed.prompts?.quickstart) {
      return {
        ...fallback,
        ...parsed,
        id: slugify(parsed.name || answers.skillName),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }
  } catch (err) {
    console.warn('AI Skill synthesis error, using fallback:', err);
  }

  return fallback;
}
