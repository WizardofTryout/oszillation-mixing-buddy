#!/usr/bin/env node
import { LogicProDriver } from '@mixing-buddy/daw-adapters';
import { MixingBuddyMCPServer } from './server.js';
import { MixingToolHandlers } from './handlers.js';

export * from './tools.js';
export * from './handlers.js';
export * from './server.js';

async function main() {
  const args = process.argv.slice(2);
  const useSSE = args.includes('--sse') || args.includes('--transport=sse');
  const useStdio = args.includes('--stdio') || args.includes('--transport=stdio') || !useSSE;

  const dawDriver = new LogicProDriver();
  await dawDriver.connect().catch(() => {});

  const handlers = new MixingToolHandlers(dawDriver);
  const server = new MixingBuddyMCPServer(handlers);

  // Always start the local HTTP server on port 48124 so the Desktop HUD can delegate
  // AXUIElement commands via /api/ax-bridge using the IDE's macOS TCC Accessibility trust
  await server.startSSE({ port: 48124 }).catch(() => {});

  if (useStdio) {
    await server.startStdio();
  }
}

// Auto-run if executed directly as a script
if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  main().catch((err) => {
    console.error('[MCP Server Error]', err);
    process.exit(1);
  });
}
