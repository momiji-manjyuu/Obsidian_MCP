import type { AppConfig } from '../config/index.js';
import { createDatabase, type DatabaseContext } from '../db/sqlite.js';
import { Indexer } from '../indexer/indexer.js';
import type { Logger } from '../log/logger.js';
import { ensureWorkspaceDirectories } from '../storage/setup.js';

export interface AppContext {
  config: AppConfig;
  logger: Logger;
  db: DatabaseContext;
  indexer: Indexer;
}

export async function createAppContext(config: AppConfig, logger: Logger): Promise<AppContext> {
  const appLogger = logger.withModule('app');
  const timer = appLogger.startTimer('Application context initialized');
  try {
    await ensureWorkspaceDirectories(config, logger.withModule('storage'));
    const db = createDatabase(config, logger.withModule('database'));
    const indexer = new Indexer(config, db, logger.withModule('indexer'));
    await indexer.start();
    timer.end('Application context initialized', { vaults: config.vaults.length });
    return { config, logger, db, indexer };
  } catch (error) {
    timer.fail(error, 'Failed to initialize application context');
    throw error;
  }
}

export async function shutdownApp(context: AppContext): Promise<void> {
  const appLogger = context.logger.withModule('app');
  const timer = appLogger.startTimer('Application context shutdown');
  try {
    await context.indexer.stop();
    context.db.close();
    timer.end('Application context shutdown');
  } catch (error) {
    timer.fail(error, 'Failed to shutdown application context');
    throw error;
  }
}
