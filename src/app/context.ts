import type { AppConfig } from '../config/index.js';
import { createDatabase, type DatabaseContext } from '../db/sqlite.js';
import { Indexer } from '../indexer/indexer.js';
import type { Logger } from '../log/logger.js';

export interface AppContext {
  config: AppConfig;
  logger: Logger;
  db: DatabaseContext;
  indexer: Indexer;
}

export async function createAppContext(config: AppConfig, logger: Logger): Promise<AppContext> {
  const db = createDatabase(config, logger);
  const indexer = new Indexer(config, db, logger);
  await indexer.start();
  return { config, logger, db, indexer };
}

export async function shutdownApp(context: AppContext): Promise<void> {
  await context.indexer.stop();
  context.db.close();
}
