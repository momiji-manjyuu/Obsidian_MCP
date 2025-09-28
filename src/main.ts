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
  const bootstrapLogger = logger.withModule('bootstrap');
  const timer = bootstrapLogger.startTimer('Bootstrap complete');

  try {
    const config = loadConfig();
    bootstrapLogger.info({ vaults: config.vaults.length }, 'Loaded configuration');

    appContext = await createAppContext(config, logger);
    server = new McpServer({
      name: 'obsidian-mcp',
      version: '0.1.0',
    });

    registerVaultSearchTool(server, appContext);
    registerVaultGetTool(server, appContext);

    bootstrapLogger.info('Starting stdio transport');
    await startStdio(server);
    timer.end('Bootstrap complete');
  } catch (error) {
    timer.fail(error, 'Failed to start server');
    if (appContext) {
      try {
        await shutdownApp(appContext);
      } catch (shutdownError) {
        bootstrapLogger.error({ err: shutdownError }, 'Failed during cleanup after bootstrap error');
      }
    }
    if (server) {
      await server.close();
    }
    process.exitCode = 1;
  }
}

async function handleShutdown(signal: NodeJS.Signals) {
  const baseLogger = appContext?.logger ?? createLogger();
  const shutdownLogger = baseLogger.withModule('lifecycle');
  shutdownLogger.info({ signal }, 'Received shutdown signal');
  const timer = shutdownLogger.startTimer('Shutdown sequence complete');
  let exitCode = 0;
  try {
    if (server) {
      await server.close();
      shutdownLogger.info('Closed MCP server transport');
    }
    if (appContext) {
      await shutdownApp(appContext);
    }
    timer.end('Shutdown sequence complete');
  } catch (error) {
    exitCode = 1;
    timer.fail(error, 'Shutdown sequence encountered an error');
  } finally {
    process.exit(exitCode);
  }
}

process.on('SIGINT', (signal) => {
  void handleShutdown(signal);
});
process.on('SIGTERM', (signal) => {
  void handleShutdown(signal);
});

void bootstrap();
