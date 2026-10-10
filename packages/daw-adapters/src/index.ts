import { NuendoDriver, type NuendoDriverOptions } from './nuendo/NuendoDriver.js';
import { LogicProDriver, type LogicProDriverOptions } from './logic/LogicProDriver.js';
import {
  MacOSAccessibilityClient,
  findAXElement,
  type AccessibilityClientOptions,
  type AXElementNode,
  type AXSearchCriteria
} from './logic/macos_ax_client.js';
import type { DAWDriver } from './types.js';

export * from './types.js';
export * from './logic/transformers.js';
export * from './logic/PluginRegistry.js';
export { NuendoDriver, type NuendoDriverOptions } from './nuendo/NuendoDriver.js';
export { LogicProDriver, type LogicProDriverOptions } from './logic/LogicProDriver.js';
export {
  MacOSAccessibilityClient,
  findAXElement,
  type AccessibilityClientOptions,
  type AXElementNode,
  type AXSearchCriteria
} from './logic/macos_ax_client.js';

/**
 * Factory function to create a NuendoDriver instance
 */
export function createNuendoDriver(options?: NuendoDriverOptions): DAWDriver {
  return new NuendoDriver(options);
}

/**
 * Factory function to create a LogicProDriver instance
 */
export function createLogicProDriver(options?: LogicProDriverOptions): DAWDriver {
  return new LogicProDriver(options);
}
