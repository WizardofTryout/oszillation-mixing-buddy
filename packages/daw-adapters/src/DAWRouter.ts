import type {
  SupportedDAW,
  TrackDescriptor,
  PluginMetadata
} from '@mixing-buddy/shared-types';
import type { DAWDriver, DAWDriverEvents } from './types.js';
import { LogicProDriver, type LogicProDriverOptions } from './logic/LogicProDriver.js';
import { NuendoDriver, type NuendoDriverOptions } from './nuendo/NuendoDriver.js';

export interface DAWRouterOptions {
  logicOptions?: LogicProDriverOptions;
  nuendoOptions?: NuendoDriverOptions;
  defaultDAW?: SupportedDAW;
}

/**
 * Dynamic runtime router implementing the canonical DAWDriver interface.
 * Delegates to the appropriate isolated driver (LogicProDriver or NuendoDriver)
 * based on the currently active DAW, completely insulating the HUD and AI engine
 * from DAW-specific branching logic.
 */
export class DAWRouter implements DAWDriver {
  private activeDriver: DAWDriver;
  private logicDriver: LogicProDriver;
  private nuendoDriver: NuendoDriver;
  private currentDawName: SupportedDAW;
  private eventSubscriptions: Set<DAWDriverEvents> = new Set();
  private unsubscribeChildEvents?: () => void;

  constructor(options: DAWRouterOptions = {}) {
    this.logicDriver = new LogicProDriver(options.logicOptions);
    this.nuendoDriver = new NuendoDriver(options.nuendoOptions);
    this.currentDawName = options.defaultDAW ?? 'logic_pro';
    this.activeDriver =
      this.currentDawName === 'nuendo' || this.currentDawName === 'cubase'
        ? this.nuendoDriver
        : this.logicDriver;

    this.bindActiveDriverEvents();
  }

  public get dawName(): SupportedDAW {
    return this.activeDriver.dawName;
  }

  public get isConnected(): boolean {
    return this.activeDriver.isConnected;
  }

  /**
   * Switches the active DAW driver at runtime.
   * Completely preserves Lane-Isolation between Logic Pro and Steinberg Nuendo.
   */
  public setActiveDAW(daw: SupportedDAW): void {
    if (daw === this.currentDawName) return;
    this.currentDawName = daw;

    if (this.unsubscribeChildEvents) {
      this.unsubscribeChildEvents();
      this.unsubscribeChildEvents = undefined;
    }

    if (daw === 'nuendo' || daw === 'cubase') {
      this.activeDriver = this.nuendoDriver;
    } else {
      this.activeDriver = this.logicDriver;
    }

    this.bindActiveDriverEvents();
  }

  private bindActiveDriverEvents(): void {
    this.unsubscribeChildEvents = this.activeDriver.subscribe({
      onTrackListChanged: (tracks) => {
        for (const sub of this.eventSubscriptions) {
          sub.onTrackListChanged?.(tracks);
        }
      },
      onTransportChanged: (transport) => {
        for (const sub of this.eventSubscriptions) {
          sub.onTransportChanged?.(transport);
        }
      },
      onError: (err) => {
        for (const sub of this.eventSubscriptions) {
          sub.onError?.(err);
        }
      }
    });
  }

  public async connect(): Promise<boolean> {
    return this.activeDriver.connect();
  }

  public async disconnect(): Promise<void> {
    return this.activeDriver.disconnect();
  }

  public async getTrackList(): Promise<TrackDescriptor[]> {
    return this.activeDriver.getTrackList();
  }

  public async createTrack(type: 'audio' | 'instrument' = 'audio', name?: string): Promise<TrackDescriptor> {
    return this.activeDriver.createTrack(type, name);
  }

  public async setTrackVolume(trackId: string, volumeDb: number): Promise<void> {
    return this.activeDriver.setTrackVolume(trackId, volumeDb);
  }

  public async setTrackPan(trackId: string, pan: number): Promise<void> {
    return this.activeDriver.setTrackPan(trackId, pan);
  }

  public async setTrackMute(trackId: string, muted: boolean): Promise<void> {
    return this.activeDriver.setTrackMute(trackId, muted);
  }

  public async setTrackSolo(trackId: string, solo: boolean): Promise<void> {
    if (this.activeDriver.setTrackSolo) {
      return this.activeDriver.setTrackSolo(trackId, solo);
    }
  }

  public async inspectPluginSlot(trackId: string, slotIndex: number): Promise<PluginMetadata | null> {
    return this.activeDriver.inspectPluginSlot(trackId, slotIndex);
  }

  public async ensurePlugin(trackId: string, pluginType: 'eq' | 'compressor'): Promise<PluginMetadata> {
    return this.activeDriver.ensurePlugin(trackId, pluginType);
  }

  public async setPluginParameter(
    trackId: string,
    slotIndex: number,
    paramName: string,
    targetValue: number,
    unit?: string
  ): Promise<void> {
    return this.activeDriver.setPluginParameter(trackId, slotIndex, paramName, targetValue, unit);
  }

  public async togglePluginBypass(trackId: string, slotIndex: number): Promise<boolean> {
    return this.activeDriver.togglePluginBypass(trackId, slotIndex);
  }

  public async routeSend(trackId: string, sendIndex: number, busName: string, gainDb: number): Promise<void> {
    if (this.activeDriver.routeSend) {
      return this.activeDriver.routeSend(trackId, sendIndex, busName, gainDb);
    }
  }

  public async routeSidechain(targetTrackId: string, slotIndex: number, sourceTrackName: string): Promise<void> {
    if (this.activeDriver.routeSidechain) {
      return this.activeDriver.routeSidechain(targetTrackId, slotIndex, sourceTrackName);
    }
  }

  public async playRegion(startBar: number, endBar: number): Promise<void> {
    return this.activeDriver.playRegion(startBar, endBar);
  }

  public async locateBar(bar: number): Promise<void> {
    if (this.activeDriver.locateBar) {
      return this.activeDriver.locateBar(bar);
    }
  }

  public async play(): Promise<void> {
    if (this.activeDriver.play) {
      return this.activeDriver.play();
    }
  }

  public async stop(): Promise<void> {
    return this.activeDriver.stop();
  }

  public subscribe(events: DAWDriverEvents): () => void {
    this.eventSubscriptions.add(events);
    return () => {
      this.eventSubscriptions.delete(events);
    };
  }

  public getLogicDriver(): LogicProDriver {
    return this.logicDriver;
  }

  public getNuendoDriver(): NuendoDriver {
    return this.nuendoDriver;
  }
}
