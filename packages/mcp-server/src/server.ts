import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { MixingToolHandlers } from './handlers.js';
import {
  AuditionRegionSchema,
  ExecuteMixAdjustmentSchema,
  GetMixTelemetrySchema,
  GetProjectInfoSchema,
  LearnPluginSchema,
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
    // 0. Get Project Info
    this.server.tool(
      'mcp__get_project_info',
      'Retrieves active DAW session status including connected DAW name (Logic Pro / Nuendo / Cubase), open project name, and playback state.',
      GetProjectInfoSchema.shape,
      async (args) => {
        try {
          const result = await this.handlers.getProjectInfo(args);
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
            content: [{ type: 'text', text: `Error fetching project info: ${String(err)}` }]
          };
        }
      }
    );
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

    // 6. Learn Plugin (Auto-Profiler & Plugin Vault)
    this.server.tool(
      'mcp__learn_plugin',
      "Scans the currently open plugin UI window in the active DAW, learns all its knobs/sliders, and saves it permanently to the user's plugin vault.",
      LearnPluginSchema.shape,
      async (args) => {
        try {
          const result = await this.handlers.learnPlugin(args);
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
            content: [{ type: 'text', text: `Plugin learning failed: ${String(err)}` }]
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

      if (url.pathname === '/api/ax-bridge' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            args?: string[];
          };
          const cliArgs = Array.isArray(body.args) ? body.args.map(String) : [];
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFile);
          const bridgeBin =
            '/Volumes/Spacestation/MCP/Antigravity-MCP-tools/Steinberg-Mixing-Buddy/packages/daw-adapters/bin/logic-ax-bridge';
          const { stdout } = await execFileAsync(bridgeBin, cliArgs, { timeout: 4000 });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(stdout.trim() || '{"success":false,"error":"Empty output from logic-ax-bridge"}');
        } catch (err: unknown) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: String(err) }));
        }
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
      this.httpServer?.on('error', () => {
        // Ignore EADDRINUSE if another MCP instance is already listening on 48124
        resolve();
      });
      this.httpServer?.listen(port, host, () => {
        console.error(`[MCP Server] SSE & AX-Bridge server listening on http://${host}:${port}`);
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
