import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { MixingToolHandlers } from './handlers.js';
import {
  AuditionRegionSchema,
  ExecuteMixAdjustmentSchema,
  GetMixTelemetrySchema,
  ListTracksSchema,
  ProposeMixAdjustmentSchema
} from './tools.js';

export interface ServerOptions {
  port?: number;
  host?: string;
}

export class MixingBuddyMCPServer {
  private server: McpServer;
  private handlers: MixingToolHandlers;
  private sseTransports = new Map<string, SSEServerTransport>();
  private httpServer?: http.Server;

  constructor(handlers?: MixingToolHandlers) {
    this.handlers = handlers ?? new MixingToolHandlers();
    this.server = new McpServer({
      name: 'oszillation-mixing-buddy',
      version: '0.1.0'
    });

    this.registerTools();
  }

  public getHandlers(): MixingToolHandlers {
    return this.handlers;
  }

  private registerTools(): void {
    // 1. Get Mix Telemetry
    this.server.tool(
      'mcp__get_mix_telemetry',
      'Retrieves real-time audio metrology from the master bus plugin (Momentary/Short-term/Integrated LUFS, True Peak, Stereo Correlation, 32-band FFT spectrum, and top-5 prominent resonances).',
      GetMixTelemetrySchema.shape,
      async (args) => {
        try {
          const result = await this.handlers.getMixTelemetry(args);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          };
        } catch (err: unknown) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Error fetching telemetry: ${String(err)}` }]
          };
        }
      }
    );

    // 2. List Tracks
    this.server.tool(
      'mcp__list_tracks',
      'Lists active tracks in Nuendo or Logic Pro with fader levels (dB), stereo pan, mute/solo states, and insert plugin names.',
      ListTracksSchema.shape,
      async (args) => {
        try {
          const result = await this.handlers.listTracks(args);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          };
        } catch (err: unknown) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Error listing tracks: ${String(err)}` }]
          };
        }
      }
    );

    // 3. Propose Mix Adjustment
    this.server.tool(
      'mcp__propose_mix_adjustment',
      'Submits a structured mix modification proposal to the Human-in-the-Loop review queue in the Desktop Companion HUD with acoustic rationale, before/after diffs, and confidence score.',
      ProposeMixAdjustmentSchema.shape,
      async (args) => {
        try {
          const result = await this.handlers.proposeMixAdjustment(args);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          };
        } catch (err: unknown) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Shield rejection: ${String(err)}` }]
          };
        }
      }
    );

    // 4. Execute Mix Adjustment
    this.server.tool(
      'mcp__execute_mix_adjustment',
      'Executes approved parameter adjustments directly in Nuendo or Logic Pro through the Acoustic Shock Shield (master <= 0 dB, track <= +6 dB, step <= +3 dB).',
      ExecuteMixAdjustmentSchema.shape,
      async (args) => {
        try {
          const result = await this.handlers.executeMixAdjustment(args);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          };
        } catch (err: unknown) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Execution failed: ${String(err)}` }]
          };
        }
      }
    );

    // 5. Audition Region
    this.server.tool(
      'mcp__audition_region',
      'Sets cycle/loop markers in Nuendo/Logic Pro around a mix section and starts playback for immediate A/B auditioning.',
      AuditionRegionSchema.shape,
      async (args) => {
        try {
          const result = await this.handlers.auditionRegion(args);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          };
        } catch (err: unknown) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Audition failed: ${String(err)}` }]
          };
        }
      }
    );
  }

  /**
   * Starts the MCP server on stdio transport (for Claude Desktop, Gemini CLI, Cursor)
   */
  public async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[MCP Server] Running on stdio transport.');
  }

  /**
   * Starts the MCP server on SSE transport for remote / web agent clients
   */
  public async startSSE(options: ServerOptions = {}): Promise<void> {
    const port = options.port ?? 48124;
    const host = options.host ?? '127.0.0.1';

    this.httpServer = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', `http://${host}:${port}`);

      if (url.pathname === '/sse' && req.method === 'GET') {
        const transport = new SSEServerTransport('/message', res);
        this.sseTransports.set(transport.sessionId, transport);

        transport.onclose = () => {
          this.sseTransports.delete(transport.sessionId);
        };

        await this.server.connect(transport);
        return;
      }

      if (url.pathname === '/message' && req.method === 'POST') {
        const sessionId = url.searchParams.get('sessionId');
        const transport = sessionId ? this.sseTransports.get(sessionId) : Array.from(this.sseTransports.values())[0];

        if (!transport) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }

        await transport.handlePostMessage(req, res);
        return;
      }

      if (url.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'online',
            service: 'Oszillation Mixing Buddy MCP',
            sessions: this.sseTransports.size
          })
        );
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    return new Promise((resolve) => {
      this.httpServer?.listen(port, host, () => {
        console.error(`[MCP Server] SSE server listening on http://${host}:${port}/sse`);
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer?.close(() => resolve()));
    }
    await this.server.close();
  }
}
