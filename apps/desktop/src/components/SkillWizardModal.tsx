import React, { useState } from 'react';
import type {
  MixingSkill,
  SkillCategory,
  SlotType
} from '@mixing-buddy/shared-types';
import {
  synthesizeMixingSkill,
  type SkillSynthesisAnswers,
  type PluginPreference,
  type SaturationCharacter
} from '@mixing-buddy/ai-engine';
import { invoke } from '@tauri-apps/api/core';
import {
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Check,
  X,
  Layers,
  Wrench,
  Rocket,
  Plus,
  Trash2,
  FileCode,
  Eye,
  CheckCircle2,
  Flame,
  Radio,
  Mic,
  Disc3,
  Guitar
} from 'lucide-react';

interface SkillWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSkillCreatedAndActivated?: (skill: MixingSkill) => void;
  apiKey?: string;
  modelName?: string;
}

const CATEGORY_PRESETS: Record<
  SkillCategory,
  {
    name: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    defaultName: string;
    defaultIntent: string;
    lufs: number;
    tolerance: number;
    crestMin: number;
    crestMax: number;
    truePeak: number;
    headroom: number;
    greenCriteria: string[];
    yellowCriteria: string[];
    redCriteria: string[];
  }
> = {
  master: {
    name: 'Master / Mix Bus',
    description: 'Summenbearbeitung, EBU R128 Streaming-Compliance & finaler Studio-Glanz',
    icon: Radio,
    defaultName: 'Modern Broadcast & Streaming Master',
    defaultIntent: 'Transparente Lautheit, kontrollierte Dynamik und frequenzielle Ausgewogenheit ohne Artefakte.',
    lufs: -14.0,
    tolerance: 1.0,
    crestMin: 9.0,
    crestMax: 12.0,
    truePeak: -1.0,
    headroom: 1.5,
    greenCriteria: [
      'Integrated Loudness im Zielkorridor (-14 LUFS ± 1 LU)',
      'Crest-Faktor stabil zwischen 9.5 und 11.5 dB',
      'Phasenkorrelation über +0.7'
    ],
    yellowCriteria: [
      'Leichte Überbetonung im Low-Mid-Bereich (250-400 Hz)',
      'Crest-Faktor sinkt unter 8.5 dB bei lauten Passagen',
      'High-Frequency Harshness im Bereich 3-5 kHz'
    ],
    redCriteria: [
      'True Peak Intersample-Clipping (> -0.5 dBTP)',
      'Phasenauslöschungen im Subbass-Bereich unter 90 Hz',
      'Plattkompression mit Crest < 7.0 dB'
    ]
  },
  vocal: {
    name: 'Lead Vocals & Rap',
    description: 'Präsenz, Sprachverständlichkeit, De-Essing & intime Dynamikkontrolle',
    icon: Mic,
    defaultName: 'In-Your-Face Modern Lead Vocal',
    defaultIntent: 'Kristallklare Höhen, durchsetzungsstarke Mitten und makellose Sibilanzenkontrolle.',
    lufs: -18.0,
    tolerance: 1.5,
    crestMin: 12.0,
    crestMax: 16.0,
    truePeak: -2.0,
    headroom: 3.0,
    greenCriteria: [
      'Präsenz im Bereich 3.5 kHz sorgt für exzellente Sprachverständlichkeit',
      'Keine störenden Raumresonanzen unter 200 Hz',
      'Gleichmäßige Pegel durch 2-Stufen-Kompression'
    ],
    yellowCriteria: [
      'Schärfe / Zischeln bei 6-8 kHz (De-Esser nötig)',
      'Kompression erzeugt Pumpen (> 6 dB Gain Reduction)',
      'Proximity-Effekt maskiert Fundament'
    ],
    redCriteria: [
      'Digitales Übersteuern auf Vokalkonsonant-Peaks',
      'Starke Raummoden und Rumpeln unter 80 Hz',
      'Vocal geht im Playback völlig unter (-6 dB zu leise)'
    ]
  },
  drums: {
    name: 'Drum Bus & Rhythmus',
    description: 'Knackige Transienten, Punch, Punch/Low-End-Verhältnis & Klebstoff',
    icon: Disc3,
    defaultName: 'Punchy Analog Glue Drum Bus',
    defaultIntent: 'Druckvoller Transienten-Punch mit warmem Bandsättigungs-Sustain.',
    lufs: -16.0,
    tolerance: 1.5,
    crestMin: 11.0,
    crestMax: 15.0,
    truePeak: -1.5,
    headroom: 2.5,
    greenCriteria: [
      'Kick und Snare haben messerscharfe Transienten',
      'Pappigkeit bei 300-500 Hz ist sauber abgesenkt',
      'Becken klingen seidig ohne Phasen-Flanging'
    ],
    yellowCriteria: [
      'Overheads übertönen Snare-Fundament',
      'Sub-Rumpeln der Kick stiehlt Headroom',
      'Attack-Zeit der Kompression plättet Trommelanschläge'
    ],
    redCriteria: [
      'Kick- und Snare-Transienten clippen den Bus',
      'Auslöschung zwischen Kick und Bass bei 60-90 Hz',
      'Breitbandige Phasenverzerrung in Overhead-Paaren'
    ]
  },
  bass: {
    name: '808 / Bassline',
    description: 'Monokompatibilität, Tiefbasskontrolle & Sättigung für Handylautsprecher',
    icon: Flame,
    defaultName: 'Tight Sub-Bass & 808 Foundation',
    defaultIntent: 'Solide Monofundierung, kontrollierte Auslenkung und harmonische Hörbarkeit auf kleinen Speakern.',
    lufs: -15.0,
    tolerance: 1.0,
    crestMin: 8.0,
    crestMax: 11.0,
    truePeak: -1.5,
    headroom: 2.0,
    greenCriteria: [
      'Strikte Monokompatibilität unter 100 Hz',
      'Harmonische Obertöne bei 700 Hz sorgen für Präsenz',
      'Sub-Frequenzen bei 40 Hz sind definiert'
    ],
    yellowCriteria: [
      'Resonanz-Peaks bei Raummoden (120 Hz Dröhnen)',
      'Bass maskiert Kick-Schlag (Sidechain anpassen)',
      'Subharmonische Anteile unter 25 Hz belasten Wandler'
    ],
    redCriteria: [
      'Stereo-Verbreiterung im Bass unterhalb 80 Hz aktiv',
      'Dauersättigung führt zu unharmonischem Schmutz',
      'DC-Offset oder unkontrolliertes Clipping'
    ]
  },
  general: {
    name: 'Akustik & Instrumente',
    description: 'Akustische Gitarren, Pianos, Streicher & vielseitige Instrumentenspuren',
    icon: Guitar,
    defaultName: 'Natural Acoustic Warmth & Dimension',
    defaultIntent: 'Natürliche Dynamik, reiche Räumlichkeit und warmer, unverfälschter Grundton.',
    lufs: -18.0,
    tolerance: 2.0,
    crestMin: 12.0,
    crestMax: 17.0,
    truePeak: -2.0,
    headroom: 3.5,
    greenCriteria: [
      'Natürliche Ausklingphase ohne Kompressionsartefakte',
      'Frequenzüberhang bei 200 Hz behutsam entzerrt',
      'Schöne stereofone Breitenwirkung'
    ],
    yellowCriteria: [
      'Pick-Geräusche / Plektrum-Klicks bei 2.5 kHz zu dominant',
      'Raumhall wirkt verwaschen und undifferenziert',
      'Kammfiltereffekt durch fehlerhafte Mikrofonierung'
    ],
    redCriteria: [
      'Körperschall-Rumpeln der Gitarre übersteuert Preamp',
      'Vollständige Phasenauslöschung bei Monosumme',
      'Verzerrung in dynamischen Fortissimo-Passagen'
    ]
  }
};

const SLOT_BADGES: Record<SlotType, string> = {
  utility: 'bg-slate-800 text-slate-300 border-slate-700',
  eq: 'bg-blue-950/80 text-blue-300 border-blue-600/40',
  dynamics: 'bg-amber-950/80 text-amber-300 border-amber-600/40',
  saturation: 'bg-rose-950/80 text-rose-300 border-rose-600/40',
  space: 'bg-purple-950/80 text-purple-300 border-purple-600/40'
};

export const SkillWizardModal: React.FC<SkillWizardModalProps> = ({
  isOpen,
  onClose,
  onSkillCreatedAndActivated,
  apiKey,
  modelName
}) => {
  // Wizard Step (1 to 5)
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Step 1: Discipline & Identity
  const [category, setCategory] = useState<SkillCategory>('master');
  const [skillName, setSkillName] = useState<string>(CATEGORY_PRESETS.master.defaultName);
  const [intentDescription, setIntentDescription] = useState<string>(
    CATEGORY_PRESETS.master.defaultIntent
  );

  // Step 2: Metrology Targets
  const [integratedLufs, setIntegratedLufs] = useState<number>(CATEGORY_PRESETS.master.lufs);
  const [toleranceLufs, setToleranceLufs] = useState<number>(CATEGORY_PRESETS.master.tolerance);
  const [crestMin, setCrestMin] = useState<number>(CATEGORY_PRESETS.master.crestMin);
  const [crestMax, setCrestMax] = useState<number>(CATEGORY_PRESETS.master.crestMax);
  const [maxTruePeakDb, setMaxTruePeakDb] = useState<number>(CATEGORY_PRESETS.master.truePeak);
  const [recommendedHeadroomDb, setRecommendedHeadroomDb] = useState<number>(
    CATEGORY_PRESETS.master.headroom
  );

  // Step 3: Tools & Aesthetics
  const [pluginPreference, setPluginPreference] = useState<PluginPreference>('hybrid');
  const [saturationCharacter, setSaturationCharacter] =
    useState<SaturationCharacter>('warm_tape');
  const [customPluginNotes, setCustomPluginNotes] = useState<string>('');

  // Step 4: Audit Methodology (Traffic Light)
  const [greenOptimalCriteria, setGreenOptimalCriteria] = useState<string[]>([
    ...CATEGORY_PRESETS.master.greenCriteria
  ]);
  const [yellowWarningCriteria, setYellowWarningCriteria] = useState<string[]>([
    ...CATEGORY_PRESETS.master.yellowCriteria
  ]);
  const [redActionCriteria, setRedActionCriteria] = useState<string[]>([
    ...CATEGORY_PRESETS.master.redCriteria
  ]);
  const [focusNotes, setFocusNotes] = useState<string>('');

  // Temporary input states for adding custom criteria
  const [newGreenItem, setNewGreenItem] = useState('');
  const [newYellowItem, setNewYellowItem] = useState('');
  const [newRedItem, setNewRedItem] = useState('');

  // Step 5: Synthesis Result & Preview
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [synthesizedSkill, setSynthesizedSkill] = useState<MixingSkill | null>(null);
  const [previewMode, setPreviewMode] = useState<'card' | 'markdown' | 'json'>('card');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Switch Category & update defaults automatically
  const handleSelectCategory = (cat: SkillCategory) => {
    setCategory(cat);
    const p = CATEGORY_PRESETS[cat];
    setSkillName(p.defaultName);
    setIntentDescription(p.defaultIntent);
    setIntegratedLufs(p.lufs);
    setToleranceLufs(p.tolerance);
    setCrestMin(p.crestMin);
    setCrestMax(p.crestMax);
    setMaxTruePeakDb(p.truePeak);
    setRecommendedHeadroomDb(p.headroom);
    setGreenOptimalCriteria([...p.greenCriteria]);
    setYellowWarningCriteria([...p.yellowCriteria]);
    setRedActionCriteria([...p.redCriteria]);
  };

  // Step 4 Helpers
  const addCriterion = (type: 'green' | 'yellow' | 'red') => {
    if (type === 'green' && newGreenItem.trim()) {
      setGreenOptimalCriteria((prev) => [...prev, newGreenItem.trim()]);
      setNewGreenItem('');
    } else if (type === 'yellow' && newYellowItem.trim()) {
      setYellowWarningCriteria((prev) => [...prev, newYellowItem.trim()]);
      setNewYellowItem('');
    } else if (type === 'red' && newRedItem.trim()) {
      setRedActionCriteria((prev) => [...prev, newRedItem.trim()]);
      setNewRedItem('');
    }
  };

  const removeCriterion = (type: 'green' | 'yellow' | 'red', index: number) => {
    if (type === 'green') {
      setGreenOptimalCriteria((prev) => prev.filter((_, i) => i !== index));
    } else if (type === 'yellow') {
      setYellowWarningCriteria((prev) => prev.filter((_, i) => i !== index));
    } else if (type === 'red') {
      setRedActionCriteria((prev) => prev.filter((_, i) => i !== index));
    }
  };

  // Run AI Synthesis
  const runSynthesis = async () => {
    setIsSynthesizing(true);
    setSynthesizedSkill(null);

    const answers: SkillSynthesisAnswers = {
      skillName: skillName.trim() || 'Neuer Custom Mixing Skill',
      category,
      intentDescription: intentDescription.trim(),
      metrology: {
        integratedLufs,
        toleranceLufs,
        crestFactor: { min: crestMin, max: crestMax },
        maxTruePeakDb,
        recommendedHeadroomDb
      },
      toolsAndAesthetics: {
        pluginPreference,
        saturationCharacter,
        customPluginNotes: customPluginNotes.trim()
      },
      auditMethodology: {
        greenOptimalCriteria,
        yellowWarningCriteria,
        redActionCriteria,
        focusNotes: focusNotes.trim()
      }
    };

    try {
      const result = await synthesizeMixingSkill(answers, {
        apiKey,
        modelName
      });
      setSynthesizedSkill(result);
    } catch (err) {
      console.error('Synthesis error:', err);
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleNextStep = () => {
    if (currentStep === 4) {
      setCurrentStep(5);
      runSynthesis();
    } else if (currentStep < 5) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handlePrevStep = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  // Save to Rust Vault & Activate
  const handleSaveAndActivate = async () => {
    if (!synthesizedSkill) return;
    setIsSaving(true);
    try {
      // 1. Invoke Tauri save_mixing_skill
      try {
        await invoke('save_mixing_skill', { skill: synthesizedSkill });
      } catch {
        // Fallback to HTTP endpoint
        const res = await fetch('http://127.0.0.1:48123/api/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(synthesizedSkill)
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      }

      setSaveSuccess(true);
      if (onSkillCreatedAndActivated) {
        onSkillCreatedAndActivated(synthesizedSkill);
      }

      setTimeout(() => {
        setIsSaving(false);
        onClose();
      }, 1200);
    } catch (err) {
      console.error('Failed to save synthesized skill', err);
      alert(`Fehler beim Speichern des Skills: ${err}`);
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-[#12151b] border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl max-h-[92vh] overflow-hidden">
        {/* Header Toolbar */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#151922]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/40 text-amber-300">
              <Sparkles className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100 tracking-wide uppercase">
                  KI-Skill-Synthese Wizard
                </h2>
                <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-mono font-semibold">
                  5-Schritte Co-Producer Engine
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Erschaffe maßgeschneiderte Mixing-Philosophien aus Klang-Intentionen und psychoakustischen Regeln
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Steps Stepper Bar */}
        <div className="px-6 py-3 border-b border-slate-800/80 bg-[#13161e] flex items-center justify-between">
          {[
            { step: 1, label: 'Disziplin & Fokus' },
            { step: 2, label: 'Metrologie-Targets' },
            { step: 3, label: 'Tools & Ästhetik' },
            { step: 4, label: 'Audit-Ampel' },
            { step: 5, label: 'KI-Synthese & Vorschau' }
          ].map((item, idx) => {
            const isActive = currentStep === item.step;
            const isDone = currentStep > item.step;
            return (
              <React.Fragment key={item.step}>
                <div
                  className={`flex items-center gap-2 text-xs font-medium cursor-pointer transition-all ${
                    isActive
                      ? 'text-amber-300'
                      : isDone
                      ? 'text-slate-300 hover:text-slate-100'
                      : 'text-slate-500'
                  }`}
                  onClick={() => {
                    if (item.step < currentStep) setCurrentStep(item.step);
                  }}
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-[11px] font-bold border transition-all ${
                      isActive
                        ? 'bg-amber-500 text-black border-amber-400 shadow-md shadow-amber-500/30'
                        : isDone
                        ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/50'
                        : 'bg-slate-800 text-slate-500 border-slate-700'
                    }`}
                  >
                    {isDone ? <Check className="w-3.5 h-3.5" /> : item.step}
                  </div>
                  <span className="hidden sm:inline">{item.label}</span>
                </div>
                {idx < 4 && <div className="h-px flex-1 mx-2 bg-slate-800" />}
              </React.Fragment>
            );
          })}
        </div>

        {/* Wizard Content Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#0f1217]">
          {/* STEP 1: Discipline & Focus */}
          {currentStep === 1 && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-150">
              <div>
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider mb-1">
                  Schritt 1: Disziplin & Audio-Fokus wählen
                </h3>
                <p className="text-xs text-slate-400">
                  Für welches Instrument, welchen Stem oder Mix-Bus möchtest du deinen Skill optimieren?
                </p>
              </div>

              {/* Category Tile Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {(Object.keys(CATEGORY_PRESETS) as SkillCategory[]).map((cat) => {
                  const item = CATEGORY_PRESETS[cat];
                  const Icon = item.icon;
                  const isSelected = category === cat;
                  return (
                    <div
                      key={cat}
                      onClick={() => handleSelectCategory(cat)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500/60 shadow-lg shadow-amber-500/10'
                          : 'bg-[#151922] border-slate-800 hover:border-slate-700 hover:bg-[#181d28]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div
                          className={`p-2 rounded-lg ${
                            isSelected
                              ? 'bg-amber-500 text-black'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-amber-400" />}
                      </div>
                      <h4 className="text-xs font-bold text-slate-100">{item.name}</h4>
                      <p className="text-[11px] text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Name & Intent Inputs */}
              <div className="bg-[#151922] border border-slate-800 rounded-xl p-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Name des Skills
                  </label>
                  <input
                    type="text"
                    value={skillName}
                    onChange={(e) => setSkillName(e.target.value)}
                    placeholder="z. B. Modern Radio Master"
                    className="w-full bg-[#10131a] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Klangliche Intention & Zielcharakter
                  </label>
                  <textarea
                    rows={2}
                    value={intentDescription}
                    onChange={(e) => setIntentDescription(e.target.value)}
                    placeholder="Beschreibe, was der Mix erreichen soll..."
                    className="w-full bg-[#10131a] border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Metrology Targets */}
          {currentStep === 2 && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-150">
              <div>
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider mb-1">
                  Schritt 2: Metrologie-Targets & Grenzwerte festlegen
                </h3>
                <p className="text-xs text-slate-400">
                  Definiere die metrologischen Schranken für EBU R128 Loudness, Crest-Faktor und True Peak Ceiling.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Integrated LUFS & Tolerance */}
                <div className="bg-[#151922] border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">Integrated Loudness (LUFS)</span>
                    <span className="text-xs font-mono font-bold text-teal-300">
                      {integratedLufs.toFixed(1)} LUFS (±{toleranceLufs.toFixed(1)} LU)
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-24"
                    max="-6"
                    step="0.5"
                    value={integratedLufs}
                    onChange={(e) => setIntegratedLufs(parseFloat(e.target.value))}
                    className="w-full accent-teal-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>-24.0 LUFS (Film)</span>
                    <span>-14.0 LUFS (Streaming)</span>
                    <span>-8.0 LUFS (Club/EDM)</span>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80">
                    <label className="text-[11px] text-slate-400 block mb-1">Toleranzfenster (± LU)</label>
                    <input
                      type="number"
                      min="0.2"
                      max="3.0"
                      step="0.1"
                      value={toleranceLufs}
                      onChange={(e) => setToleranceLufs(parseFloat(e.target.value) || 1.0)}
                      className="w-24 bg-[#10131a] border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                    />
                  </div>
                </div>

                {/* Crest Factor Range */}
                <div className="bg-[#151922] border border-slate-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">Crest-Faktor Korridor (dB)</span>
                    <span className="text-xs font-mono font-bold text-amber-300">
                      {crestMin.toFixed(1)} – {crestMax.toFixed(1)} dB
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Min (Kompakt)</label>
                      <input
                        type="number"
                        min="4"
                        max="16"
                        step="0.5"
                        value={crestMin}
                        onChange={(e) => setCrestMin(parseFloat(e.target.value) || 8.0)}
                        className="w-full bg-[#10131a] border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-0.5">Max (Dynamisch)</label>
                      <input
                        type="number"
                        min="6"
                        max="22"
                        step="0.5"
                        value={crestMax}
                        onChange={(e) => setCrestMax(parseFloat(e.target.value) || 12.0)}
                        className="w-full bg-[#10131a] border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 italic mt-1">
                    Hoher Crest-Faktor bewahrt Punch; niedriger Crest sorgt für dichte Lautheit.
                  </p>
                </div>

                {/* Max True Peak */}
                <div className="bg-[#151922] border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">Max True Peak Ceiling</span>
                    <span className="text-xs font-mono font-bold text-rose-300">
                      {maxTruePeakDb.toFixed(1)} dBTP
                    </span>
                  </div>
                  <input
                    type="range"
                    min="-3.0"
                    max="0.0"
                    step="0.1"
                    value={maxTruePeakDb}
                    onChange={(e) => setMaxTruePeakDb(parseFloat(e.target.value))}
                    className="w-full accent-rose-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>-3.0 dBTP</span>
                    <span>-1.0 dBTP (EBU R128)</span>
                    <span>0.0 dBTP (Max)</span>
                  </div>
                </div>

                {/* Recommended Headroom */}
                <div className="bg-[#151922] border border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">Sicherheits-Headroom</span>
                    <span className="text-xs font-mono font-bold text-indigo-300">
                      {recommendedHeadroomDb.toFixed(1)} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="6.0"
                    step="0.5"
                    value={recommendedHeadroomDb}
                    onChange={(e) => setRecommendedHeadroomDb(parseFloat(e.target.value))}
                    className="w-full accent-indigo-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>0.5 dB</span>
                    <span>1.5 dB (Empfohlen)</span>
                    <span>6.0 dB</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Tools & Aesthetics */}
          {currentStep === 3 && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-150">
              <div>
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider mb-1">
                  Schritt 3: Tools & Klang-Ästhetik
                </h3>
                <p className="text-xs text-slate-400">
                  Wähle deine bevorzugten Plug-ins und die harmonische Farbsignatur für diesen Skill.
                </p>
              </div>

              {/* Plugin Preferences */}
              <div className="bg-[#151922] border border-slate-800 rounded-xl p-4 space-y-3">
                <label className="block text-xs font-bold text-slate-200">
                  Plug-in Präferenz in der Signalkette
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {[
                    {
                      id: 'stock_only' as PluginPreference,
                      label: 'Stock Plug-ins only',
                      desc: 'Ausschließliche Nutzung nativer DAW-Plug-ins (Logic Channel EQ, Cubase StudioEQ etc.)'
                    },
                    {
                      id: 'vault_preferred' as PluginPreference,
                      label: 'Vault Plug-ins bevorzugen',
                      desc: 'Priorisiert angelernte High-End Plug-ins aus deinem Plugin Vault (FabFilter, UAD, Waves)'
                    },
                    {
                      id: 'hybrid' as PluginPreference,
                      label: 'Hybrider Mix',
                      desc: 'Stock-Tools für Utility & Filter, Vault-Plug-ins für Charakter & Kompression'
                    }
                  ].map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setPluginPreference(item.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        pluginPreference === item.id
                          ? 'bg-amber-500/10 border-amber-500/50 text-amber-300'
                          : 'bg-[#10131a] border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-bold text-xs">{item.label}</div>
                      <div className="text-[10px] text-slate-400 mt-1 leading-snug">{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Saturation Character */}
              <div className="bg-[#151922] border border-slate-800 rounded-xl p-4 space-y-3">
                <label className="block text-xs font-bold text-slate-200">
                  Harmonischer Sättigungs-Charakter
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    {
                      id: 'clean_transparent' as SaturationCharacter,
                      title: 'Clean & Transparent',
                      desc: 'Lineare Signalpfade, minimale Verzerrung (THD < 0.05%), maximale Transientenreinheit.'
                    },
                    {
                      id: 'warm_tape' as SaturationCharacter,
                      title: 'Warmes Tape & Röhre',
                      desc: 'Geradzahlige Obertöne, weicher Höhen-Roll-off und reicher, warmer Grundton.'
                    },
                    {
                      id: 'aggressive_tube' as SaturationCharacter,
                      title: 'Aggressiver Tube / Clipper',
                      desc: 'Dichte Obertöne, Härte für Handyspeaker und punchige Spitzenbegrenzung.'
                    },
                    {
                      id: 'vintage_console' as SaturationCharacter,
                      title: 'Vintage Console (Neve / SSL)',
                      desc: 'Subtile analoge Pultfärbung, plastische Räumlichkeit und seidige Mittenpräsenz.'
                    }
                  ].map((sat) => (
                    <div
                      key={sat.id}
                      onClick={() => setSaturationCharacter(sat.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        saturationCharacter === sat.id
                          ? 'bg-rose-500/10 border-rose-500/50 text-rose-300'
                          : 'bg-[#10131a] border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-bold text-xs">{sat.title}</div>
                      <div className="text-[10px] text-slate-400 mt-1 leading-snug">{sat.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Custom Plugin Notes */}
              <div className="bg-[#151922] border border-slate-800 rounded-xl p-4">
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Spezifische Plug-in Vorlieben oder Kettennotizen (optional)
                </label>
                <input
                  type="text"
                  value={customPluginNotes}
                  onChange={(e) => setCustomPluginNotes(e.target.value)}
                  placeholder="z. B. Bevorzugt Pro-Q 3 für Notch-Filter, Shadow Hills für Glue"
                  className="w-full bg-[#10131a] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          )}

          {/* STEP 4: Audit Methodology (Traffic Light) */}
          {currentStep === 4 && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-150">
              <div>
                <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider mb-1">
                  Schritt 4: Audit-Methodik & Prüf-Ampel
                </h3>
                <p className="text-xs text-slate-400">
                  Lege fest, wann dieser Skill eine Situation als optimal einstuft, warnen oder direkt eingreifen soll.
                </p>
              </div>

              {/* 🟢 Optimal List */}
              <div className="bg-[#131b17] border border-emerald-500/30 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>🟢 Optimal (Zielzustand)</span>
                  </div>
                  <span className="text-[10px] text-emerald-500 font-mono">
                    {greenOptimalCriteria.length} Kriterien
                  </span>
                </div>

                <div className="space-y-1.5 pt-1">
                  {greenOptimalCriteria.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-black/40 px-2.5 py-1 rounded border border-emerald-500/20 text-xs text-emerald-200"
                    >
                      <span>• {item}</span>
                      <button
                        type="button"
                        onClick={() => removeCriterion('green', i)}
                        className="text-emerald-500 hover:text-emerald-300 p-0.5"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={newGreenItem}
                    onChange={(e) => setNewGreenItem(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCriterion('green')}
                    placeholder="+ Weiteres Optimal-Kriterium hinzufügen..."
                    className="flex-1 bg-black/60 border border-emerald-500/30 rounded px-2.5 py-1 text-xs text-emerald-100 placeholder:text-emerald-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => addCriterion('green')}
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 🟡 Warning List */}
              <div className="bg-[#1d1b13] border border-amber-500/30 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span>🟡 Aufmerksamkeit (Warnbereich)</span>
                  </div>
                  <span className="text-[10px] text-amber-500 font-mono">
                    {yellowWarningCriteria.length} Kriterien
                  </span>
                </div>

                <div className="space-y-1.5 pt-1">
                  {yellowWarningCriteria.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-black/40 px-2.5 py-1 rounded border border-amber-500/20 text-xs text-amber-200"
                    >
                      <span>• {item}</span>
                      <button
                        type="button"
                        onClick={() => removeCriterion('yellow', i)}
                        className="text-amber-500 hover:text-amber-300 p-0.5"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={newYellowItem}
                    onChange={(e) => setNewYellowItem(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCriterion('yellow')}
                    placeholder="+ Weiteres Warn-Kriterium hinzufügen..."
                    className="flex-1 bg-black/60 border border-amber-500/30 rounded px-2.5 py-1 text-xs text-amber-100 placeholder:text-amber-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => addCriterion('yellow')}
                    className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-black font-semibold rounded text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 🔴 Immediate Action List */}
              <div className="bg-[#1c1315] border border-rose-500/30 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-rose-400 font-bold text-xs">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                    <span>🔴 Dringender Eingriff (Schwellenüberschreitung)</span>
                  </div>
                  <span className="text-[10px] text-rose-500 font-mono">
                    {redActionCriteria.length} Kriterien
                  </span>
                </div>

                <div className="space-y-1.5 pt-1">
                  {redActionCriteria.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-black/40 px-2.5 py-1 rounded border border-rose-500/20 text-xs text-rose-200"
                    >
                      <span>• {item}</span>
                      <button
                        type="button"
                        onClick={() => removeCriterion('red', i)}
                        className="text-rose-500 hover:text-rose-300 p-0.5"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={newRedItem}
                    onChange={(e) => setNewRedItem(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCriterion('red')}
                    placeholder="+ Weiteres Eingriffs-Kriterium hinzufügen..."
                    className="flex-1 bg-black/60 border border-rose-500/30 rounded px-2.5 py-1 text-xs text-rose-100 placeholder:text-rose-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => addCriterion('red')}
                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Additional Audit Notes */}
              <div className="bg-[#151922] border border-slate-800 rounded-xl p-4">
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Zusätzliche psychoakustische Audit-Notizen (optional)
                </label>
                <input
                  type="text"
                  value={focusNotes}
                  onChange={(e) => setFocusNotes(e.target.value)}
                  placeholder="z. B. Besondere Beachtung von Transienten im Seitenkanal und Mono-Bass"
                  className="w-full bg-[#10131a] border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          )}

          {/* STEP 5: AI Synthesis & Preview */}
          {currentStep === 5 && (
            <div className="max-w-4xl mx-auto space-y-5 animate-in fade-in duration-150">
              {isSynthesizing ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center animate-spin text-2xl mb-4">
                    ✨
                  </div>
                  <h3 className="text-sm font-bold text-slate-200">
                    KI-Skill-Synthese wird ausgeführt...
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    Die AI-Engine berechnet die psychoakustische Signalkette, kalibriert Metrologie-Ziele und formuliert Schnellstart- und Werkstatt-Prompts.
                  </p>
                </div>
              ) : synthesizedSkill ? (
                <div className="space-y-4">
                  {/* Synthesis Success Banner */}
                  <div className="bg-gradient-to-r from-emerald-950/60 to-slate-900 border border-emerald-500/40 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
                        <CheckCircle2 className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-emerald-300 uppercase tracking-wide">
                          Synthese erfolgreich abgeschlossen
                        </div>
                        <div className="text-sm font-bold text-slate-100 mt-0.5">
                          {synthesizedSkill.name} ({synthesizedSkill.category.toUpperCase()})
                        </div>
                      </div>
                    </div>

                    {/* Preview View Mode Switcher */}
                    <div className="flex items-center bg-black/50 p-1 rounded-lg border border-slate-800 text-xs">
                      <button
                        type="button"
                        onClick={() => setPreviewMode('card')}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded transition-all ${
                          previewMode === 'card'
                            ? 'bg-amber-500/20 text-amber-300 font-bold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Eye className="w-3 h-3" />
                        <span>Kachel</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMode('markdown')}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded transition-all ${
                          previewMode === 'markdown'
                            ? 'bg-amber-500/20 text-amber-300 font-bold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <FileCode className="w-3 h-3" />
                        <span>Markdown</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMode('json')}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded transition-all ${
                          previewMode === 'json'
                            ? 'bg-amber-500/20 text-amber-300 font-bold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <span>JSON</span>
                      </button>
                    </div>
                  </div>

                  {/* Card Preview */}
                  {previewMode === 'card' && (
                    <div className="bg-[#151922] border border-slate-800 rounded-2xl p-5 space-y-4">
                      {/* Metrology Row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="bg-[#10131a] border border-slate-800 rounded p-2 text-center">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Target LUFS</span>
                          <span className="text-xs font-mono font-bold text-teal-300">
                            {synthesizedSkill.metrologyTargets.integratedLufs.toFixed(1)} LUFS
                          </span>
                        </div>
                        <div className="bg-[#10131a] border border-slate-800 rounded p-2 text-center">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Crest Factor</span>
                          <span className="text-xs font-mono font-bold text-amber-300">
                            {synthesizedSkill.metrologyTargets.crestFactor.min}–{synthesizedSkill.metrologyTargets.crestFactor.max} dB
                          </span>
                        </div>
                        <div className="bg-[#10131a] border border-slate-800 rounded p-2 text-center">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Max True Peak</span>
                          <span className="text-xs font-mono font-bold text-rose-300">
                            {synthesizedSkill.metrologyTargets.maxTruePeakDb.toFixed(1)} dBTP
                          </span>
                        </div>
                        <div className="bg-[#10131a] border border-slate-800 rounded p-2 text-center">
                          <span className="text-[10px] uppercase font-bold text-slate-500 block">Headroom</span>
                          <span className="text-xs font-mono font-bold text-indigo-300">
                            {synthesizedSkill.metrologyTargets.recommendedHeadroomDb.toFixed(1)} dB
                          </span>
                        </div>
                      </div>

                      {/* Chain Slots */}
                      <div>
                        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-slate-500" />
                          <span>Synthetisierte Signalkette ({synthesizedSkill.preferredChain.length} Slots)</span>
                        </div>
                        <div className="space-y-2">
                          {synthesizedSkill.preferredChain.map((slot, sIdx) => {
                            const badge = SLOT_BADGES[slot.slotType] || SLOT_BADGES.utility;
                            return (
                              <div
                                key={sIdx}
                                className="bg-[#0f1218] border border-slate-800 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-bold ${badge}`}>
                                    Slot {sIdx + 1}: {slot.slotType}
                                  </span>
                                  <span className="text-xs font-semibold text-slate-200">
                                    {slot.preferredPluginHint || 'Standard DAW Plugin'}
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-400">
                                  {slot.typicalRules.join(' • ')}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Prompts Preview */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                        <div className="bg-[#0f1218] border border-slate-800 rounded-lg p-3">
                          <div className="text-[10px] font-bold uppercase text-amber-400 flex items-center gap-1 mb-1">
                            <Rocket className="w-3 h-3" />
                            <span>🚀 Schnellstart Direct Prompt</span>
                          </div>
                          <p className="text-xs text-slate-300 italic leading-relaxed">
                            "{synthesizedSkill.prompts.quickstart}"
                          </p>
                        </div>

                        <div className="bg-[#0f1218] border border-slate-800 rounded-lg p-3">
                          <div className="text-[10px] font-bold uppercase text-indigo-400 flex items-center gap-1 mb-1">
                            <Wrench className="w-3 h-3" />
                            <span>🛠️ Werkstatt Audit Prompt</span>
                          </div>
                          <p className="text-xs text-slate-300 italic line-clamp-3 leading-relaxed">
                            "{synthesizedSkill.prompts.workshop}"
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Markdown Preview */}
                  {previewMode === 'markdown' && (
                    <div className="bg-[#0b0e14] border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-300 whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed">
                      {`# Mixing Skill: ${synthesizedSkill.name} (${synthesizedSkill.version})
Kategorie: ${synthesizedSkill.category.toUpperCase()} | ID: ${synthesizedSkill.id}

## 🎯 Metrologie-Targets
- Integrated Loudness: ${synthesizedSkill.metrologyTargets.integratedLufs.toFixed(1)} LUFS (±${synthesizedSkill.metrologyTargets.toleranceLufs} LU)
- Crest-Faktor: ${synthesizedSkill.metrologyTargets.crestFactor.min} – ${synthesizedSkill.metrologyTargets.crestFactor.max} dB
- Max True Peak: ${synthesizedSkill.metrologyTargets.maxTruePeakDb.toFixed(1)} dBTP
- Headroom: ${synthesizedSkill.metrologyTargets.recommendedHeadroomDb.toFixed(1)} dB

## 🎛️ Signalkette
${synthesizedSkill.preferredChain
  .map(
    (slot, i) =>
      `${i + 1}. [${slot.slotType.toUpperCase()}] ${slot.preferredPluginHint}\n   Regeln: ${slot.typicalRules.join(', ')}`
  )
  .join('\n')}

## 🚀 Prompts
### Schnellstart
"${synthesizedSkill.prompts.quickstart}"

### Werkstatt
"${synthesizedSkill.prompts.workshop}"
`}
                    </div>
                  )}

                  {/* JSON Preview */}
                  {previewMode === 'json' && (
                    <div className="bg-[#0b0e14] border border-slate-800 rounded-xl p-4 font-mono text-[11px] text-teal-300 whitespace-pre-wrap max-h-96 overflow-y-auto">
                      {JSON.stringify(synthesizedSkill, null, 2)}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <p className="text-xs">Kein Synthese-Ergebnis vorhanden.</p>
                  <button
                    type="button"
                    onClick={runSynthesis}
                    className="mt-3 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-black font-semibold rounded text-xs"
                  >
                    Synthese erneut ausführen
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-4 bg-[#13161e] border-t border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={handlePrevStep}
            disabled={currentStep === 1 || isSynthesizing || isSaving}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Zurück</span>
          </button>

          <div className="flex items-center gap-3">
            {currentStep < 4 && (
              <button
                type="button"
                onClick={handleNextStep}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-black bg-amber-400 hover:bg-amber-300 transition-all shadow cursor-pointer active:scale-95"
              >
                <span>Weiter zu Schritt {currentStep + 1}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {currentStep === 4 && (
              <button
                type="button"
                onClick={handleNextStep}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 transition-all shadow cursor-pointer active:scale-95"
              >
                <Sparkles className="w-4 h-4 text-amber-300" />
                <span>🚀 Jetzt KI-Synthese starten</span>
              </button>
            )}

            {currentStep === 5 && synthesizedSkill && (
              <button
                type="button"
                onClick={handleSaveAndActivate}
                disabled={isSaving || saveSuccess}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 transition-all shadow-lg active:scale-95 cursor-pointer disabled:opacity-60"
              >
                {saveSuccess ? (
                  <>
                    <Check className="w-4 h-4 text-white" />
                    <span>Skill gespeichert & aktiviert!</span>
                  </>
                ) : isSaving ? (
                  <>
                    <span className="animate-spin text-sm">⏳</span>
                    <span>Speichern...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>💾 Neuen Skill speichern & aktivieren</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
