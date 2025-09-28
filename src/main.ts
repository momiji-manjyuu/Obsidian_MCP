import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from './config/index.js';
import { createLogger } from './log/logger.js';
import { createAppContext, shutdownApp, type AppContext } from './app/context.js';
import { registerVaultGetTool } from './tools/vaultGet.js';
import { registerVaultSearchTool } from './tools/vaultSearch.js';
import { startStdio } from './transport/stdio.js';

let appContext: AppContext | undefined;
let server: McpServer | undefined;

async function bootstrap() {
  const logger = createLogger();

  try {
    const config = loadConfig();
    logger.info({ vaults: config.vaults.length }, 'Loaded configuration');

    appContext = await createAppContext(config, logger);
    server = new McpServer({
      name: 'obsidian-mcp',
      version: '0.1.0',
    });

    registerVaultSearchTool(server, appContext);
    registerVaultGetTool(server, appContext);

    logger.info('Starting stdio transport');
    await startStdio(server);
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    if (appContext) {
      await shutdownApp(appContext);
    }
    if (server) {
      await server.close();
    }
    process.exitCode = 1;
  }
}

async function handleShutdown(signal: NodeJS.Signals) {
  const logger = createLogger();
  logger.info({ signal }, 'Received shutdown signal');
  if (server) {
    await server.close();
  }
  if (appContext) {
    await shutdownApp(appContext);
  }
  process.exit(0);
}

process.on('SIGINT', (signal) => {
  void handleShutdown(signal);
});
process.on('SIGTERM', (signal) => {
  void handleShutdown(signal);
});

void bootstrap();
