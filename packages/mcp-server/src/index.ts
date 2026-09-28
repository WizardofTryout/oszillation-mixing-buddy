#!/usr/bin/env node
import { MixingBuddyMCPServer } from './server.js';
import { MixingToolHandlers } from './handlers.js';

export * from './tools.js';
export * from './handlers.js';
export * from './server.js';

async function main() {
  const args = process.argv.slice(2);
  const useSSE = args.includes('--sse') || args.includes('--transport=sse');
  const useStdio = args.includes('--stdio') || args.includes('--transport=stdio') || !useSSE;

  const handlers = new MixingToolHandlers();
  const server = new MixingBuddyMCPServer(handlers);

  if (useStdio && !useSSE) {
    await server.startStdio();
  } else if (useSSE && !useStdio) {
    await server.startSSE({ port: 48124 });
  } else {
    // Dual mode
    await server.startSSE({ port: 48124 });
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
