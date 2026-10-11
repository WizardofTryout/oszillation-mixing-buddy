import React, { useState } from 'react';
import type { TargetProfile, TargetScope } from '@mixing-buddy/shared-types';

interface CrossoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProfile: TargetProfile;
  currentScope: TargetScope;
  onSave: (updatedProfile: TargetProfile) => void;
}

export const CrossoverModal: React.FC<CrossoverModalProps> = ({
  isOpen,
  onClose,
  currentProfile,
  currentScope,
  onSave
}) => {
  const [name, setName] = useState(currentProfile.name || 'Mein Crossover-Mix');
  const [customNotes, setCustomNotes] = useState(currentProfile.customNotes || '');
  const [targetLufs, setTargetLufs] = useState<number>(currentProfile.targetIntegratedLufs ?? -12.0);
  const [crestMin, setCrestMin] = useState<number>(currentProfile.crestFactorRange?.min ?? 9.0);
  const [crestMax, setCrestMax] = useState<number>(currentProfile.crestFactorRange?.max ?? 12.0);

  // 5 Spectral Bands
  const [subBassDb, setSubBassDb] = useState<number>(currentProfile.spectralTargets?.subBassDb ?? 0.0);
  const [bassDb, setBassDb] = useState<number>(currentProfile.spectralTargets?.bassDb ?? 0.0);
  const [lowMidDb, setLowMidDb] = useState<number>(currentProfile.spectralTargets?.lowMidDb ?? 0.0);
  const [highMidDb, setHighMidDb] = useState<number>(currentProfile.spectralTargets?.highMidDb ?? 0.0);
  const [airDb, setAirDb] = useState<number>(currentProfile.spectralTargets?.airDb ?? 0.0);

  if (!isOpen) return null;

  const handleApplyPreset = (presetType: 'trap_rock' | 'club_pop' | 'dynamic_jazz') => {
    if (presetType === 'trap_rock') {
      setName('Trap Low-End + Rock Mitten');
      setSubBassDb(3.5);
      setBassDb(1.0);
      setLowMidDb(1.5);
      setHighMidDb(2.0);
      setAirDb(1.0);
      setTargetLufs(-9.5);
      setCrestMin(8.5);
      setCrestMax(11.0);
      setCustomNotes('Dominanter 808/Trap Sub-Bass (35-65 Hz) kombiniert mit rauen, durchsetzungsfähigen Rock-Gitarren in den Mitten (1.5-3 kHz).');
    } else if (presetType === 'club_pop') {
      setName('EDM Club Punch + Radio Air');
      setSubBassDb(3.0);
      setBassDb(1.5);
      setLowMidDb(-1.5);
      setHighMidDb(1.5);
      setAirDb(3.0);
      setTargetLufs(-8.0);
      setCrestMin(7.5);
      setCrestMax(10.0);
      setCustomNotes('Aggressive Club-Kompression mit kristallklarem Radio-Vocal-Glanz ab 10 kHz.');
    } else if (presetType === 'dynamic_jazz') {
      setName('Akustische Weite + Moderner Bass');
      setSubBassDb(0.5);
      setBassDb(0.5);
      setLowMidDb(0.0);
      setHighMidDb(0.5);
      setAirDb(1.5);
      setTargetLufs(-14.0);
      setCrestMin(13.0);
      setCrestMax(18.0);
      setCustomNotes('Volle dynamische Natürlichkeit für Live-Instrumente, ergänzt um kontrollierten Tiefbass.');
    }
  };

  const handleSave = () => {
    const updated: TargetProfile = {
      id: 'custom_crossover',
      name: name.trim() || 'Individuell / Crossover',
      targetScope: currentScope,
      genreProfile: 'custom_crossover',
      isCustom: true,
      customNotes: customNotes.trim(),
      targetIntegratedLufs: targetLufs,
      toleranceLufs: 1.5,
      crestFactorRange: { min: crestMin, max: crestMax },
      maxTruePeakDb: -0.8,
      recommendedHeadroomDb: 1.0,
      spectralTargets: {
        subBassDb,
        bassDb,
        lowMidDb,
        highMidDb,
        airDb
      },
      typicalRemedies: ['Spezifische Crossover-Kompensation nach Künstler-Notizen']
    };

    onSave(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-[#121418] border border-cyan-500/40 rounded-xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-800">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">⚙️</span>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">
                Individuelles Mixing-Profil & Crossover-Ziele
              </h2>
              <p className="text-xs text-gray-400">
                Wird direkt im DAW-Projekt (<span className="text-cyan-400">.logicx</span> / <span className="text-cyan-400">.cpr</span>) über das JUCE-Master-Plugin gesichert.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition"
          >
            ✕
          </button>
        </div>

        {/* Quick Presets */}
        <div className="mt-4 p-3 bg-gray-900/60 rounded-lg border border-gray-800">
          <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
            Schnell-Vorlagen für Crossover:
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleApplyPreset('trap_rock')}
              className="text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-amber-300 border border-amber-500/30 transition"
            >
              🎸 Trap Sub + Rock Mitten
            </button>
            <button
              onClick={() => handleApplyPreset('club_pop')}
              className="text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-cyan-300 border border-cyan-500/30 transition"
            >
              ⚡ Club Punch + Radio Glanz
            </button>
            <button
              onClick={() => handleApplyPreset('dynamic_jazz')}
              className="text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-emerald-300 border border-emerald-500/30 transition"
            >
              🎷 Akustische Weite + Moderner Bass
            </button>
          </div>
        </div>

        {/* Profile Name & Notes */}
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">
              Profil-Bezeichnung
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#1a1c23] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-400 transition"
              placeholder="z. B. Trap-Metal Hybrid v1"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1">
              Künstlerische Absicht & Crossover-Notizen (Für die KI-Engine)
            </label>
            <textarea
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
              rows={3}
              className="w-full bg-[#1a1c23] border border-gray-700 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-cyan-400 transition placeholder-gray-500 resize-none"
              placeholder="z. B. 'Aggressive 808-Subbässe (35-60 Hz) wie im Drill, aber die Gesangsstimme soll trocken und mittenbetont wie im 90er Grunge klingen.'"
            />
          </div>

          {/* Targets: Loudness & Crest */}
          <div className="grid grid-cols-2 gap-4 bg-gray-900/40 p-3 rounded-lg border border-gray-800">
            <div>
              <div className="flex justify-between text-xs text-gray-300 mb-1 font-semibold">
                <span>Ziel-Lautheit (Integrated LUFS)</span>
                <span className="text-cyan-400 font-mono">{targetLufs.toFixed(1)} LUFS</span>
              </div>
              <input
                type="range"
                min="-20"
                max="-5"
                step="0.5"
                value={targetLufs}
                onChange={(e) => setTargetLufs(parseFloat(e.target.value))}
                className="w-full accent-cyan-400 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-gray-500">
                <span>-20 (Klassik)</span>
                <span>-14 (Spotify)</span>
                <span>-6 (Club)</span>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-gray-300 mb-1 font-semibold">
                <span>Crest Factor Dynamik-Korridor</span>
                <span className="text-amber-400 font-mono">{crestMin.toFixed(0)} - {crestMax.toFixed(0)} dB</span>
              </div>
              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="number"
                  min="4"
                  max="15"
                  value={crestMin}
                  onChange={(e) => setCrestMin(parseFloat(e.target.value) || 6)}
                  className="w-16 bg-[#1a1c23] border border-gray-700 rounded px-2 py-1 text-xs text-white text-center font-mono"
                />
                <span className="text-gray-500 text-xs">bis</span>
                <input
                  type="number"
                  min="8"
                  max="24"
                  value={crestMax}
                  onChange={(e) => setCrestMax(parseFloat(e.target.value) || 12)}
                  className="w-16 bg-[#1a1c23] border border-gray-700 rounded px-2 py-1 text-xs text-white text-center font-mono"
                />
                <span className="text-gray-400 text-xs">dB</span>
              </div>
            </div>
          </div>

          {/* 5-Zone Spectral Targets */}
          <div className="bg-gray-900/40 p-3 rounded-lg border border-gray-800">
            <div className="text-xs font-semibold text-gray-300 mb-2">
              Spektral-Hüllkurve (5 Frequenz-Zonen Soll-Delta in dB):
            </div>
            <div className="grid grid-cols-5 gap-2 text-center">
              {/* Sub Bass */}
              <div className="bg-[#1a1c23] p-2 rounded border border-gray-800">
                <div className="text-[10px] text-gray-400">Sub-Bass</div>
                <div className="text-[9px] text-gray-500">20-60 Hz</div>
                <div className="text-xs font-mono font-bold text-cyan-300 mt-1">
                  {subBassDb >= 0 ? `+${subBassDb.toFixed(1)}` : subBassDb.toFixed(1)} dB
                </div>
                <input
                  type="range"
                  min="-6"
                  max="6"
                  step="0.5"
                  value={subBassDb}
                  onChange={(e) => setSubBassDb(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer mt-1"
                />
              </div>

              {/* Bass */}
              <div className="bg-[#1a1c23] p-2 rounded border border-gray-800">
                <div className="text-[10px] text-gray-400">Bass</div>
                <div className="text-[9px] text-gray-500">60-250 Hz</div>
                <div className="text-xs font-mono font-bold text-cyan-300 mt-1">
                  {bassDb >= 0 ? `+${bassDb.toFixed(1)}` : bassDb.toFixed(1)} dB
                </div>
                <input
                  type="range"
                  min="-6"
                  max="6"
                  step="0.5"
                  value={bassDb}
                  onChange={(e) => setBassDb(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer mt-1"
                />
              </div>

              {/* Low-Mid */}
              <div className="bg-[#1a1c23] p-2 rounded border border-gray-800">
                <div className="text-[10px] text-gray-400">Low-Mid</div>
                <div className="text-[9px] text-gray-500">250-1k Hz</div>
                <div className="text-xs font-mono font-bold text-cyan-300 mt-1">
                  {lowMidDb >= 0 ? `+${lowMidDb.toFixed(1)}` : lowMidDb.toFixed(1)} dB
                </div>
                <input
                  type="range"
                  min="-6"
                  max="6"
                  step="0.5"
                  value={lowMidDb}
                  onChange={(e) => setLowMidDb(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer mt-1"
                />
              </div>

              {/* High-Mid */}
              <div className="bg-[#1a1c23] p-2 rounded border border-gray-800">
                <div className="text-[10px] text-gray-400">High-Mid</div>
                <div className="text-[9px] text-gray-500">1k-5k Hz</div>
                <div className="text-xs font-mono font-bold text-cyan-300 mt-1">
                  {highMidDb >= 0 ? `+${highMidDb.toFixed(1)}` : highMidDb.toFixed(1)} dB
                </div>
                <input
                  type="range"
                  min="-6"
                  max="6"
                  step="0.5"
                  value={highMidDb}
                  onChange={(e) => setHighMidDb(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer mt-1"
                />
              </div>

              {/* Air */}
              <div className="bg-[#1a1c23] p-2 rounded border border-gray-800">
                <div className="text-[10px] text-gray-400">Air</div>
                <div className="text-[9px] text-gray-500">5k-20k Hz</div>
                <div className="text-xs font-mono font-bold text-cyan-300 mt-1">
                  {airDb >= 0 ? `+${airDb.toFixed(1)}` : airDb.toFixed(1)} dB
                </div>
                <input
                  type="range"
                  min="-6"
                  max="6"
                  step="0.5"
                  value={airDb}
                  onChange={(e) => setAirDb(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 cursor-pointer mt-1"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex items-center justify-between pt-4 border-t border-gray-800">
          <div className="text-xs text-gray-400 flex items-center space-x-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Wird im JUCE StateInformation Chunk abgelegt</span>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-300 hover:bg-gray-800 transition"
            >
              Abbrechen
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2 rounded-lg text-sm font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-950/50 transition flex items-center space-x-2"
            >
              <span>💾 Im Projekt speichern</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
