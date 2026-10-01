import React from 'react';
import type { MeterSpectrumData, ReferenceTrackProfile } from '@mixing-buddy/shared-types';
import { RtaGraph } from './RtaGraph.js';

export interface SpectrumRTAProps {
  /** 30 fps Live Telemetry spectrum from JUCE meter */
  spectrum?: MeterSpectrumData;
  /** Live integrated or short-term LUFS if available for gain matching */
  liveLufs?: number;
  /** Currently active reference track profile */
  activeReference?: ReferenceTrackProfile | null;
  /** Callback to set or clear active reference profile */
  onSelectReference?: (profile: ReferenceTrackProfile | null) => void;
  /** Callback to open the full ReferenceTrackModal */
  onOpenReferenceModal?: () => void;
}

export const SpectrumRTA: React.FC<SpectrumRTAProps> = ({
  spectrum,
  liveLufs,
  activeReference = null,
  onSelectReference = () => {},
  onOpenReferenceModal = () => {}
}) => {
  return (
    <RtaGraph
      spectrum={spectrum}
      liveLufs={liveLufs}
      activeReference={activeReference}
      onSelectReference={onSelectReference}
      onOpenReferenceModal={onOpenReferenceModal}
    />
  );
};

export { RtaGraph };
