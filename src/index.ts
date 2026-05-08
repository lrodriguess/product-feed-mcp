import { env } from './config/env';
import { createApp } from './app';
import { createMcpExpressApp } from './mcp/server';
import { stopConsumers } from './sqs/consumer';
import { closeRedis } from './config/redis';

async function main(): Promise<void> {
  // API Server (channels, broadcaster ingestion)
  const apiApp = createApp();
  const apiServer = apiApp.listen(env.API_PORT, () => {
    console.log(`[API] Server listening on port ${env.API_PORT}`);
  });

  // MCP Server
  const mcpApp = createMcpExpressApp();
  const mcpServer = mcpApp.listen(env.MCP_PORT, () => {
    console.log(`[MCP] Server listening on port ${env.MCP_PORT}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[Server] Received ${signal}, shutting down...`);
    stopConsumers();

    apiServer.close();
    mcpServer.close();
    await closeRedis();

    console.log('[Server] Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err);
  process.exit(1);
});
