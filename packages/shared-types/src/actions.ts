/**
 * Safety & Action Proposal Types for Human-in-the-Loop Diff Cards
 */

export type ActionCategory = 
  | 'gain_staging' 
  | 'eq_tonal_balance' 
  | 'dynamic_control' 
  | 'stereo_width' 
  | 'masking_reduction';

export interface ParameterDelta {
  trackId: string;
  trackName: string;
  slotIndex?: number;
  pluginName?: string;
  parameterName: string;
  currentValue: number;
  proposedValue: number;
  unit: string;
}

export interface SidechainRoute {
  trackName: string;
  slotIndex: number;
  sourcePath: string;
}

export interface MixActionProposal {
  id: string;
  timestamp: number;
  category: ActionCategory;
  title: string;
  rationale: string;
  confidenceScore: number; // 0.0 to 1.0
  deltas: ParameterDelta[];
  status: 'pending' | 'applied' | 'rejected' | 'auditioning';
  isPinned?: boolean;
  sidechainRoute?: SidechainRoute;
  startBar?: number;
  endBar?: number;
  description?: string;
}

export interface SafetyShieldBounds {
  /** Master output hard clamp ceiling in dB */
  masterMaxDb: 0.0;
  /** Track fader absolute maximum ceiling in dB */
  trackMaxDb: 6.0;
  /** Minimum fader floor in dB */
  faderMinDb: -96.0;
  /** Maximum allowable single-step volume jump in dB */
  maxSingleStepJumpDb: 3.0;
}
