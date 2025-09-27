import { loadConfig } from './config/index.js';
import { createLogger } from './log/logger.js';

async function bootstrap() {
  const logger = createLogger();
  try {
    const config = loadConfig();
    logger.info({ vaults: config.vaults.length }, 'Loaded configuration');
    logger.info('MCP server scaffolding is ready for further implementation.');
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exitCode = 1;
  }
}

void bootstrap();
