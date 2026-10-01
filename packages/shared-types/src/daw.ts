/**
 * Polymorphic DAW Abstraction Types ("The Hands")
 */

export type SupportedDAW = 'nuendo' | 'logic_pro';

export interface PluginParameter {
  id: string;
  name: string;
  currentValue: number;
  minValue: number;
  maxValue: number;
  displayValue: string;
  unit: string;
  isAutomated?: boolean;
}

export interface PluginMetadata {
  slotIndex: number;
  pluginName: string;
  vendor?: string;
  format: 'vst3' | 'au' | 'internal';
  isBypassed: boolean;
  parameters: PluginParameter[];
}

export interface SendSlotDescriptor {
  slotIndex: number;
  busNumber: number;
  name?: string;
  levelDb: number;
}

export interface TrackDescriptor {
  id: string;
  index: number;
  name: string;
  type: 'audio' | 'instrument' | 'bus' | 'master' | 'aux' | 'vca';
  colorHex?: string;
  volumeDb: number;
  pan: number; // -1.0 (hard left) to +1.0 (hard right), 0 = center
  isMuted: boolean;
  isSoloed: boolean;
  isSelected: boolean;
  insertSlots: (PluginMetadata | null)[];
  sendSlots?: SendSlotDescriptor[];
}

export interface TransportState {
  isPlaying: boolean;
  isRecording: boolean;
  isLooping: boolean;
  currentBar: number;
  currentBeat: number;
  tempoBpm: number;
  timeSignature: string;
  loopStartBar: number;
  loopEndBar: number;
}
