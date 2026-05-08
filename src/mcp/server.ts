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

function generateSessionId(): string {
  return randomBytes(16).toString('hex');
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'vtex-product-feed-mcp',
    version: '0.1.0',
  });

  // Register getProductFeedState (T051)
  server.tool(
    'getProductFeedState',
    'Returns the current canonical feed state for a SKU on a channel, including price, stock, availability, sync status, and data freshness indicators.',
    getProductFeedStateSchema.shape,
    async (args) => handleGetProductFeedState(args as GetProductFeedStateInput)
  );

  // Register listProductFeedIssues (T054)
  server.tool(
    'listProductFeedIssues',
    'Returns a paginated list of open OfferIssue records for a channel, filterable by issue type, severity, and SKU.',
    listProductFeedIssuesSchema.shape,
    async (args) => handleListProductFeedIssues(args as ListProductFeedIssuesInput)
  );

  return server;
}

export function createMcpExpressApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/mcp', vtexAuth);

  // Stateful transport per request (Streamable HTTP)
  app.post('/mcp', async (req: Request, res: Response) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: generateSessionId });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', async (req: Request, res: Response) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: generateSessionId });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  });

  return app;
}
