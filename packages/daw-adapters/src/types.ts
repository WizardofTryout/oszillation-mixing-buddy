import type {
  SupportedDAW,
  TrackDescriptor,
  PluginMetadata,
  TransportState
} from '@mixing-buddy/shared-types';

export interface DAWDriverEvents {
  onTrackListChanged?: (tracks: TrackDescriptor[]) => void;
  onTransportChanged?: (transport: TransportState) => void;
  onError?: (error: Error) => void;
}

/**
 * Canonical polymorphic interface for controlling Digital Audio Workstations
 */
export interface DAWDriver {
  readonly dawName: SupportedDAW;
  readonly isConnected: boolean;

  connect(): Promise<boolean>;
  disconnect(): Promise<void>;

  // Mixer & Channel Strip Control
  getTrackList(): Promise<TrackDescriptor[]>;
  setTrackVolume(trackId: string, volumeDb: number): Promise<void>;
  setTrackPan(trackId: string, pan: number): Promise<void>;
  setTrackMute(trackId: string, muted: boolean): Promise<void>;

  // Insert Plugin & Parameter Control
  inspectPluginSlot(trackId: string, slotIndex: number): Promise<PluginMetadata | null>;
  setPluginParameter(
    trackId: string,
    slotIndex: number,
    paramName: string,
    targetValue: number,
    unit?: string
  ): Promise<void>;

  // Transport & Auditioning
  playRegion(startBar: number, endBar: number): Promise<void>;
  stop(): Promise<void>;

  // Event Subscription
  subscribe(events: DAWDriverEvents): () => void;
}

export interface MIDITransport {
  send(bytes: number[] | Uint8Array): void;
  onMessage?: (bytes: Uint8Array) => void;
  close(): void;
}
