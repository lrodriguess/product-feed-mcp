import { randomBytes } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import express, { Request, Response } from 'express';
import { vtexAuth } from '../middleware/vtex-auth';
import {
  getProductFeedStateSchema,
  handleGetProductFeedState,
  GetProductFeedStateInput,
} from './tools/get-product-feed-state';
import {
  listProductFeedIssuesSchema,
  handleListProductFeedIssues,
  ListProductFeedIssuesInput,
} from './tools/list-product-feed-issues';
import {
  getMarketplaceMappingStatusSchema,
  handleGetMarketplaceMappingStatus,
  GetMarketplaceMappingStatusInput,
} from './tools/get-marketplace-mapping-status';
import {
  explainOfferAvailabilitySchema,
  handleExplainOfferAvailability,
  ExplainOfferAvailabilityInput,
} from './tools/explain-offer-availability';
import {
  retryFeedSyncSchema,
  handleRetryFeedSync,
  RetryFeedSyncInput,
} from './tools/retry-feed-sync';
import {
  compareFeedStateAcrossChannelsSchema,
  handleCompareFeedStateAcrossChannels,
  CompareFeedStateAcrossChannelsInput,
} from './tools/compare-feed-state-across-channels';
import {
  getFeedSyncHistorySchema,
  handleGetFeedSyncHistory,
  GetFeedSyncHistoryInput,
} from './tools/get-feed-sync-history';
import {
  simulateProductFeedSchema,
  handleSimulateProductFeed,
  SimulateProductFeedInput,
} from './tools/simulate-product-feed';

// Session registry: sessionId → transport (T077)
const activeSessions = new Map<string, StreamableHTTPServerTransport>();

function generateSessionId(): string {
  return randomBytes(16).toString('hex');
}

// Allowed origins for MCP endpoint (T078)
const ALLOWED_ORIGINS = (process.env.MCP_ALLOWED_ORIGINS ?? 'http://localhost')
  .split(',')
  .map((o) => o.trim());

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // Allow requests without Origin (server-to-server)
  return ALLOWED_ORIGINS.some((allowed) => origin.startsWith(allowed));
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'vtex-product-feed-mcp',
    version: '0.1.0',
  });

  // US2: getProductFeedState
  server.tool(
    'getProductFeedState',
    'Returns the current canonical feed state for a SKU on a channel, including price, stock, availability, sync status, and data freshness indicators.',
    getProductFeedStateSchema.shape,
    async (args) => handleGetProductFeedState(args as GetProductFeedStateInput)
  );

  // US3: listProductFeedIssues
  server.tool(
    'listProductFeedIssues',
    'Returns a paginated list of open OfferIssue records for a channel, filterable by issue type, severity, and SKU.',
    listProductFeedIssuesSchema.shape,
    async (args) => handleListProductFeedIssues(args as ListProductFeedIssuesInput)
  );

  // US6: getMarketplaceMappingStatus (T059)
  server.tool(
    'getMarketplaceMappingStatus',
    'Returns the current category and attribute mapping status for a VTEX category on a marketplace channel.',
    getMarketplaceMappingStatusSchema.shape,
    async (args) => handleGetMarketplaceMappingStatus(args as GetMarketplaceMappingStatusInput)
  );

  // US1: explainOfferAvailability (T062)
  server.tool(
    'explainOfferAvailability',
    'Returns a structured breakdown explaining exactly why a SKU is or is not available on a marketplace channel, including eligibility checks for catalog, price, and inventory.',
    explainOfferAvailabilitySchema.shape,
    async (args) => handleExplainOfferAvailability(args as ExplainOfferAvailabilityInput)
  );

  // US7: retryFeedSync (T064)
  server.tool(
    'retryFeedSync',
    'Manually triggers a re-sync for a single SKU on a channel. Enforces a 60-second rate limit per SKU. Returns an idempotency key and estimated processing time.',
    retryFeedSyncSchema.shape,
    async (args) => handleRetryFeedSync(args as RetryFeedSyncInput)
  );

  // compareFeedStateAcrossChannels (T068)
  server.tool(
    'compareFeedStateAcrossChannels',
    'Returns feed state for a SKU across all active channels for an account, enabling price, stock, and availability comparison.',
    compareFeedStateAcrossChannelsSchema.shape,
    async (args) =>
      handleCompareFeedStateAcrossChannels(args as CompareFeedStateAcrossChannelsInput)
  );

  // getFeedSyncHistory (T068)
  server.tool(
    'getFeedSyncHistory',
    'Returns paginated sync event history for a SKU on a channel, showing past sync statuses, prices, and stock levels.',
    getFeedSyncHistorySchema.shape,
    async (args) => handleGetFeedSyncHistory(args as GetFeedSyncHistoryInput)
  );

  // simulateProductFeed (T068)
  server.tool(
    'simulateProductFeed',
    'Runs a hypothetical feed pipeline (steps 1–8) for a SKU with optional overrides for country, postal code, or minimum stock. Never writes to the Feed State Store. Returns isHypothetical: true.',
    simulateProductFeedSchema.shape,
    async (args) => handleSimulateProductFeed(args as SimulateProductFeedInput)
  );

  return server;
}

export function createMcpExpressApp(): express.Application {
  const app = express();
  app.use(express.json());

  // Origin validation (T078)
  app.use('/mcp', (req: Request, res: Response, next) => {
    if (!isOriginAllowed(req.headers.origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    next();
  });

  app.use('/mcp', vtexAuth);

  // Stateful transport per request (Streamable HTTP, T077 session management)
  app.post('/mcp', async (req: Request, res: Response) => {
    const existingSessionId = req.headers['mcp-session-id'] as string | undefined;

    // Resume existing session if present and known
    if (existingSessionId && activeSessions.has(existingSessionId)) {
      const transport = activeSessions.get(existingSessionId)!;
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // New session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: generateSessionId,
      onsessioninitialized: (sessionId) => {
        activeSessions.set(sessionId, transport);
      },
    });

    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId) activeSessions.delete(sessionId);
    };

    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    const existingSessionId = req.headers['mcp-session-id'] as string | undefined;
    if (existingSessionId && activeSessions.has(existingSessionId)) {
      const transport = activeSessions.get(existingSessionId)!;
      await transport.handleRequest(req, res);
      return;
    }
    res.status(400).json({ error: 'No active session. Start with POST /mcp.' });
  });

  // Session cleanup endpoint
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && activeSessions.has(sessionId)) {
      const transport = activeSessions.get(sessionId)!;
      activeSessions.delete(sessionId);
      await transport.close();
      res.status(200).json({ closed: true, sessionId });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  return app;
}
