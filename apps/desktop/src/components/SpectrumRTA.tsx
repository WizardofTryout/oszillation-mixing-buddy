import React from 'react';
import type {
  MeterSpectrumData,
  ReferenceTrackProfile,
  MetrologyTelemetryFrame,
  MixActionProposal,
  TrackDescriptor
} from '@mixing-buddy/shared-types';
import { RtaGraph } from './RtaGraph.js';

export interface SpectrumRTAProps {
  /** 30 fps Live Telemetry spectrum from JUCE meter */
  spectrum?: MeterSpectrumData;
  /** Full live metrology frame if available */
  telemetry?: MetrologyTelemetryFrame | null;
  /** Live integrated or short-term LUFS if available for gain matching */
  liveLufs?: number;
  /** Currently active reference track profile */
  activeReference?: ReferenceTrackProfile | null;
  /** Callback to set or clear active reference profile */
  onSelectReference?: (profile: ReferenceTrackProfile | null) => void;
  /** Callback to open the full ReferenceTrackModal */
  onOpenReferenceModal?: () => void;
  /** Callback when user clicks 'An Referenz anpassen' to inject proposal */
  onGenerateProposal?: (proposal: MixActionProposal) => void;
  /** Available DAW tracks for target assignment */
  availableTracks?: TrackDescriptor[];
}

export const SpectrumRTA: React.FC<SpectrumRTAProps> = ({
  spectrum,
  telemetry,
  liveLufs,
  activeReference = null,
  onSelectReference = () => {},
  onOpenReferenceModal = () => {},
  onGenerateProposal,
  availableTracks
}) => {
  return (
    <RtaGraph
      spectrum={spectrum}
      telemetry={telemetry}
      liveLufs={liveLufs}
      activeReference={activeReference}
      onSelectReference={onSelectReference}
      onOpenReferenceModal={onOpenReferenceModal}
      onGenerateProposal={onGenerateProposal}
      availableTracks={availableTracks}
    />
  );
};

export { RtaGraph };
