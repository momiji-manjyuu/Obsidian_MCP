import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import fg from 'fast-glob';
import type { AppConfig, VaultConfig } from '../config/index.js';
import type { DatabaseContext } from '../db/sqlite.js';
import type { Logger } from '../log/logger.js';
import { normalizeMarkdown } from '../markdown/normalize.js';
import { parseMarkdown } from './parser.js';

export interface IndexerOptions {
  batchSize?: number;
  debounceMs?: number;
}

export interface IndexerStatus {
  queued: number;
  initialScanComplete: boolean;
  lastIndexedAt?: number;
  isProcessing: boolean;
}

interface PendingQueue {
  vault: VaultConfig;
  paths: Set<string>;
}

export class Indexer {
  private readonly db: DatabaseContext;
  private readonly config: AppConfig;
  private readonly logger: Logger;
  private readonly batchSize: number;
  private readonly debounceMs: number;
  private readonly pending = new Map<string, PendingQueue>();
  private processTimer?: NodeJS.Timeout;
  private initialScanCompleted = false;
  private isProcessing = false;
  private lastIndexedAt?: number;
  private watchers: chokidar.FSWatcher[] = [];

  constructor(config: AppConfig, db: DatabaseContext, logger: Logger, options: IndexerOptions = {}) {
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.batchSize = options.batchSize ?? 100;
    this.debounceMs = options.debounceMs ?? 500;
  }

  async start(): Promise<void> {
    const timer = this.logger.startTimer('Indexer started');
    await Promise.all(
      this.config.vaults.map(async (vault) => {
        this.pending.set(vault.name, { vault, paths: new Set() });
        await this.scheduleInitialScan(vault);
        this.watchVault(vault);
      })
    );
    timer.end('Indexer started', { vaults: this.config.vaults.length });
  }

  getStatus(): IndexerStatus {
    return {
      queued: this.getQueuedCount(),
      initialScanComplete: this.initialScanCompleted && this.getQueuedCount() === 0 && !this.isProcessing,
      lastIndexedAt: this.lastIndexedAt,
      isProcessing: this.isProcessing,
    };
  }

  async stop(): Promise<void> {
    for (const watcher of this.watchers) {
      await watcher.close();
    }
    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = undefined;
    }
  }

  private async scheduleInitialScan(vault: VaultConfig) {
    const patterns = ['**/*.md'];
    const ignore = ['**/.mcp/**', '**/.git/**', '**/node_modules/**'];
    const timer = this.logger.startTimer('Initial scan queued', { vault: vault.name });
    const files = await fg(patterns, {
      cwd: vault.absolutePath,
      dot: false,
      onlyFiles: true,
      unique: true,
      ignore,
    });
    timer.end('Initial scan queued', { files: files.length });
    for (const relative of files) {
      this.enqueue(vault, relative);
    }
    this.initialScanCompleted = true;
  }

  private watchVault(vault: VaultConfig) {
    const watcher = chokidar.watch(vault.absolutePath, {
      ignoreInitial: true,
      ignored: (watchedPath) => {
        const relative = path.relative(vault.absolutePath, watchedPath);
        if (!relative) {
          return false;
        }
        const normalized = this.normalizeRelative(relative);
        if (normalized.startsWith('.mcp/')) {
          return true;
        }
        if (normalized.startsWith('.git/')) {
          return true;
        }
        return false;
      },
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    watcher.on('add', (filePath) => {
      const rel = path.relative(vault.absolutePath, filePath);
      this.enqueue(vault, rel);
    });
    watcher.on('change', (filePath) => {
      const rel = path.relative(vault.absolutePath, filePath);
      this.enqueue(vault, rel);
    });
    watcher.on('unlink', (filePath) => {
      const rel = path.relative(vault.absolutePath, filePath);
      this.handleDelete(vault, rel);
    });

    this.watchers.push(watcher);
  }

  private enqueue(vault: VaultConfig, relativePath: string) {
    const normalized = this.normalizeRelative(relativePath);
    if (!normalized.endsWith('.md')) {
      return;
    }

    const queue = this.pending.get(vault.name);
    if (!queue) {
      this.pending.set(vault.name, { vault, paths: new Set([normalized]) });
    } else {
      queue.paths.add(normalized);
    }
    this.scheduleProcessing();
  }

  private handleDelete(vault: VaultConfig, relativePath: string) {
    const normalized = this.normalizeRelative(relativePath);
    if (!normalized.endsWith('.md')) {
      return;
    }
    this.logger.debug({ vault: vault.name, path: normalized }, 'Deleting note from index');
    this.db.deleteNote(vault.name, normalized);
  }

  private scheduleProcessing() {
    if (this.processTimer) {
      return;
    }
    this.processTimer = setTimeout(() => {
      this.processTimer = undefined;
      void this.processQueue();
    }, this.debounceMs);
  }

  private async processQueue() {
    const totalQueued = this.getQueuedCount();
    if (totalQueued === 0) {
      return;
    }

    this.isProcessing = true;
    try {
      for (const [vaultName, queue] of this.pending.entries()) {
        const paths = Array.from(queue.paths).slice(0, this.batchSize);
        if (paths.length === 0) {
          continue;
        }
        for (const relativePath of paths) {
          queue.paths.delete(relativePath);
          await this.indexFile(queue.vault, relativePath);
        }
      }
    } finally {
      this.isProcessing = false;
      this.lastIndexedAt = Date.now();
      if (this.getQueuedCount() > 0) {
        this.scheduleProcessing();
      }
    }
  }

  private async indexFile(vault: VaultConfig, relativePath: string) {
    const absolutePath = path.join(vault.absolutePath, relativePath);
    const timer = this.logger.startTimer('Indexed file', { vault: vault.name, path: relativePath });
    try {
      const stat = await fs.promises.stat(absolutePath);
      if (!stat.isFile()) {
        this.db.deleteNote(vault.name, relativePath);
        timer.end('Removed non-file entry from index', { removed: true });
        return;
      }

      const rawContent = await fs.promises.readFile(absolutePath, 'utf-8');
      const normalized = normalizeMarkdown(rawContent);
      const hash = crypto.createHash('sha256').update(normalized).digest('hex');

      const existing = this.db.getNoteRecord(vault.name, relativePath);
      if (existing && existing.hash === hash && existing.mtime === Math.floor(stat.mtimeMs)) {
        return;
      }

      const parsed = parseMarkdown(normalized);
      const noteTags = new Set<string>();
      for (const tag of parsed.tags) {
        if (typeof tag === 'string' && tag.trim().length > 0) {
          noteTags.add(tag.toLowerCase());
        }
      }

      this.db.upsertNote({
        vault: vault.name,
        path: relativePath,
        hash,
        mtime: Math.floor(stat.mtimeMs),
        tags: Array.from(noteTags),
        aliases: parsed.aliases,
        frontmatter: parsed.frontmatter,
        chunks: parsed.chunks,
      });
      timer.end('Indexed file', {
        chunkCount: parsed.chunks.length,
        tagCount: noteTags.size,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.db.deleteNote(vault.name, relativePath);
        timer.end('Removed missing file from index', { removed: true });
        return;
      }
      timer.fail(error, 'Failed to index file', { vault: vault.name, path: relativePath });
    }
  }

  private normalizeRelative(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/');
    const trimmed = normalized.startsWith('./') ? normalized.slice(2) : normalized;
    return trimmed.replace(/^\/+/, '');
  }

  private getQueuedCount(): number {
    let total = 0;
    for (const queue of this.pending.values()) {
      total += queue.paths.size;
    }
    return total;
  }
}
