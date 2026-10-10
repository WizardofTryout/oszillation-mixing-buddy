import { z } from 'zod';

/**
 * Zod Schemas for Model Context Protocol (MCP) Mixing Tools
 */

export const GetMixTelemetrySchema = z.object({
  durationMs: z.number().int().positive().optional().describe('Duration in milliseconds to aggregate telemetry over (default: 500ms)')
});

export const ListTracksSchema = z.object({
  includePlugins: z.boolean().optional().describe('Whether to fetch detailed plugin slot information per track (default: true)')
});

export const ParameterDeltaSchema = z.object({
  trackId: z.string().describe('Unique DAW track identifier or channel number'),
  trackName: z.string().describe('Name of the track in the DAW project'),
  slotIndex: z.number().int().nonnegative().optional().describe('0-indexed insert slot position'),
  pluginName: z.string().optional().describe('Name of the insert plugin (e.g. Frequency 2, StudioEQ, Channel EQ)'),
  parameterName: z.string().describe('Parameter identifier (e.g. "fader_db", "pan", "band2_gain", "band3_freq")'),
  currentValue: z.number().describe('Current parameter value in the DAW'),
  proposedValue: z.number().describe('Target parameter value recommended by the AI'),
  unit: z.string().describe('Measurement unit (e.g. "dB", "Hz", "Q", "%")')
});

export const SidechainRouteSchema = z.object({
  trackName: z.string().describe('Target track name for sidechain routing'),
  slotIndex: z.number().int().positive().optional().describe('Audio FX insert slot number (e.g. 5)'),
  sourcePath: z.string().describe('Source path for sidechain trigger (e.g. "Audio > Motown Revisited Kit", "Bus > Bus 1")')
});

export const ProposeMixAdjustmentSchema = z.object({
  category: z.enum([
    'gain_staging',
    'eq_tonal_balance',
    'dynamic_control',
    'stereo_width',
    'masking_reduction'
  ]).describe('Psychoacoustic classification of the mixing action'),
  title: z.string().describe('Short headline summarizing the proposed change (e.g. "Carve 350 Hz Mud on Bass")'),
  rationale: z.string().describe('Acoustic explanation citing measured LUFS, frequency masking, or harshness'),
  confidenceScore: z.number().min(0.0).max(1.0).describe('Confidence probability of improvement (0.0 to 1.0)'),
  deltas: z.array(ParameterDeltaSchema).nonempty().describe('List of discrete parameter adjustments'),
  sidechainRoute: SidechainRouteSchema.optional().describe('Optional sidechain header routing instruction')
});

export const ExecuteMixAdjustmentSchema = z.object({
  proposalId: z.string().optional().describe('Optional ID of a previously approved proposal from the HUD queue'),
  trackId: z.string().describe('DAW Track ID or name to modify'),
  slotIndex: z.number().int().nonnegative().optional().describe('0-indexed insert plugin slot (default: 0)'),
  pluginName: z.string().optional().describe('Target plugin name (e.g. "Channel EQ", "Compressor")'),
  parameterName: z.string().describe('Parameter to adjust ("fader_db", "pan", or plugin parameter like "low_cut_frequency", "peak_1_gain", "threshold", "ratio", "attack", "release", "make_up", "knee")'),
  value: z.number().describe('Target numeric display value in audio units (Hz, dB, ms, :1, Q)'),
  unit: z.string().optional().describe('Optional measurement unit (e.g. "dB", "Hz", "ms", ":1", "Q")'),
  isMaster: z.boolean().optional().describe('Set to true if adjusting master fader (enforces master <= 0 dB clamp)')
});

export const AuditionRegionSchema = z.object({
  startBar: z.number().positive().describe('Start bar number for cycle/loop region'),
  endBar: z.number().positive().describe('End bar number for cycle/loop region'),
  autoPlay: z.boolean().optional().describe('Immediately trigger DAW playback on the audition region (default: true)'),
  durationSeconds: z.number().positive().optional().describe('Duration of the audit window in seconds (default: 8). Telemetry is collected for this duration.')
});

export const GetProjectInfoSchema = z.object({});

export const LearnPluginSchema = z.object({
  windowTitle: z
    .string()
    .optional()
    .describe('Optional window title or track name of the open plugin window to profile (defaults to frontmost floating plugin window)')
});

export const MatchReferenceSpectrumSchema = z.object({
  referenceId: z.string().optional().describe('ID or slug of saved reference profile (e.g. "dua-lipa-levitating")'),
  referenceName: z.string().optional().describe('Optional name of reference track'),
  frequencyBands: z.array(z.number()).optional().describe('Optional 32-band reference spectrum in dBFS (-70 to 0)'),
  thresholdDb: z.number().optional().describe('Minimum deviation threshold in dB to trigger adjustments (default: 2.5 dB)'),
  targetTrackId: z.string().optional().describe('Optional DAW track ID to apply Channel EQ adjustments to (defaults to Master / Mix Bus)')
});

export const SetActiveSkillSchema = z.object({
  skillId: z
    .string()
    .describe('ID or slug of the mixing skill to activate (e.g. "tonmischmeister", custom skill slug, or "none" to deactivate)')
});

// Sprint 7: Arranger Navigation

export const SetFolderStateSchema = z.object({
  trackName: z.string().describe('Name of the Track Stack or folder track to expand/collapse (e.g. "Drums", "Vocals", "Keys")'),
  expanded: z.boolean().describe('true to expand (open) the track stack, false to collapse (close) it')
});

export const SelectTrackSchema = z.object({
  trackName: z.string().describe('Name of the track to select in Logic Pro\'s arrangement. Selection causes the left Inspector to show this track\'s channel strip (e.g. "Snare 2", "Lead Vox", "Bass DI").')
});

// Sprint 8: Dynamic Plugin Loading via Logic Menus

export const LoadPluginSchema = z.object({
  trackName: z.string().describe('Name of the target track in Logic Pro (e.g. "Snare 2", "Motown Revisited Kit", "Lead Vox")'),
  slotIndex: z.number().int().min(1).max(15).describe('Audio FX insert slot number (1 to 15)'),
  pluginPath: z.string().describe('Hierarchy or name of the plugin to load, separated by ">" (e.g. "EQ > Channel EQ", "Dynamics > Compressor", "Audio Units > FabFilter > Pro-Q 3")')
});

// Sprint 9: Bus-Sends, Submixes & Aux-Routing

export const RouteSendSchema = z.object({
  trackName: z.string().describe('Name of the target track in Logic Pro (e.g. "Snare 2", "Vocal Lead")'),
  slotIndex: z.number().int().min(1).max(8).describe('Send slot index (1 to 8)'),
  busNumber: z.number().int().min(1).describe('Bus number to assign (e.g. 1 for Bus 1, 3 for Bus 3)'),
  levelDb: z.number().optional().describe('Optional send level in dB (e.g. -6.0 or -12.5). If omitted, default initial level is kept.')
});

// Sprint 10: Sidechain Routing & Ducking Automation

export const RouteSidechainSchema = z.object({
  trackName: z.string().describe('Name of the target track containing the plugin (e.g. "Simple Foundation", "Bass", "Pad")'),
  slotIndex: z.number().int().min(1).max(15).describe('Audio FX insert slot number of the dynamics plugin (e.g. 1 or 5)'),
  sourcePath: z.string().describe('Source path for sidechain trigger, separated by ">" (e.g. "Audio > Motown Revisited Kit", "Bus > Bus 1", or "Intern" / "None" to disconnect)')
});

export type GetMixTelemetryInput = z.infer<typeof GetMixTelemetrySchema>;
export type ListTracksInput = z.infer<typeof ListTracksSchema>;
export type ParameterDeltaInput = z.infer<typeof ParameterDeltaSchema>;
export type ProposeMixAdjustmentInput = z.infer<typeof ProposeMixAdjustmentSchema>;
export type ExecuteMixAdjustmentInput = z.infer<typeof ExecuteMixAdjustmentSchema>;
export type AuditionRegionInput = z.infer<typeof AuditionRegionSchema>;
export type GetProjectInfoInput = z.infer<typeof GetProjectInfoSchema>;
export type LearnPluginInput = z.infer<typeof LearnPluginSchema>;
export type MatchReferenceSpectrumInput = z.infer<typeof MatchReferenceSpectrumSchema>;
export type SetActiveSkillInput = z.infer<typeof SetActiveSkillSchema>;
export type SetFolderStateInput = z.infer<typeof SetFolderStateSchema>;
export type SelectTrackInput = z.infer<typeof SelectTrackSchema>;
export type LoadPluginInput = z.infer<typeof LoadPluginSchema>;
export type RouteSendInput = z.infer<typeof RouteSendSchema>;
export type RouteSidechainInput = z.infer<typeof RouteSidechainSchema>;
