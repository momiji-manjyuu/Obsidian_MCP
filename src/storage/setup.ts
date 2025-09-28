import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../config/index.js';
import type { Logger } from '../log/logger.js';

const REQUIRED_SUBDIRECTORIES = ['diff', 'logs', 'metrics'];

export async function ensureWorkspaceDirectories(config: AppConfig, logger: Logger): Promise<void> {
  if (config.storage.location === 'memory') {
    logger.debug('Skipping workspace directory creation for in-memory storage');
    return;
  }

  const baseDirectory = config.storage.baseDirectory;
  if (!baseDirectory) {
    throw new Error('Storage base directory is not configured');
  }

  const timer = logger.startTimer('Ensured workspace directories', { baseDirectory });
  try {
    await fs.mkdir(baseDirectory, { recursive: true });
    for (const subdir of REQUIRED_SUBDIRECTORIES) {
      const target = path.join(baseDirectory, subdir);
      await fs.mkdir(target, { recursive: true });
    }
    timer.end('Ensured workspace directories', { subdirectories: REQUIRED_SUBDIRECTORIES });
  } catch (error) {
    timer.fail(error, 'Failed to ensure workspace directories', { baseDirectory });
    throw error;
  }
}
