import fs from 'node:fs';
import Database from 'better-sqlite3';
import type { AppConfig } from '../config/index.js';
import type { Logger } from '../log/logger.js';

export type ChunkKind = 'heading' | 'paragraph' | 'list' | 'code' | 'blockquote' | 'table' | 'other';

export interface ChunkInsert {
  kind: ChunkKind;
  content: string;
  headingPath: string[];
  blockId?: string;
  tags: string[];
  aliases: string[];
}

export interface NoteUpsertInput {
  vault: string;
  path: string;
  hash: string;
  mtime: number;
  tags: string[];
  aliases: string[];
  frontmatter: Record<string, unknown>;
  chunks: ChunkInsert[];
}

export interface NoteRecord {
  id: number;
  vault: string;
  path: string;
  hash: string;
  mtime: number;
  createdAt: number;
  updatedAt: number;
  tags: string[];
  aliases: string[];
  frontmatter: Record<string, unknown>;
}

export interface SearchFilters {
  tags?: string[];
  paths?: string[];
  since?: number;
  until?: number;
  vaultName?: string;
}

export interface SearchOptions {
  query: string;
  topK?: number;
  filter?: SearchFilters;
  withContent?: boolean;
}

export interface SearchResult {
  uri: string;
  vault: string;
  path: string;
  headingPath: string[];
  blockId?: string;
  snippet: string;
  score: number;
  tags: string[];
  aliases: string[];
  content?: string;
  updatedAt?: number;
}

export interface DatabaseContext {
  db: Database.Database;
  close(): void;
  upsertNote(input: NoteUpsertInput): void;
  deleteNote(vault: string, notePath: string): void;
  getNoteRecord(vault: string, notePath: string): NoteRecord | undefined;
  search(options: SearchOptions): SearchResult[];
  getStatus(): { noteCount: number; chunkCount: number };
}

function encodeVaultPath(notePath: string): string {
  return notePath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

const SQL_CREATE_TABLES = [
  `PRAGMA journal_mode = WAL;`,
  `PRAGMA synchronous = NORMAL;`,
  `PRAGMA foreign_keys = ON;`,
  `CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vault TEXT NOT NULL,
    path TEXT NOT NULL,
    hash TEXT NOT NULL,
    mtime INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    tags TEXT,
    aliases TEXT,
    frontmatter TEXT,
    UNIQUE(vault, path)
  );`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    noteId INTEGER NOT NULL,
    vault TEXT NOT NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL,
    headingPath TEXT,
    blockId TEXT,
    tags TEXT,
    aliases TEXT,
    ftsRowid INTEGER UNIQUE,
    FOREIGN KEY(noteId) REFERENCES notes(id) ON DELETE CASCADE
  );`,
  `CREATE TABLE IF NOT EXISTS journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    op TEXT NOT NULL,
    vault TEXT NOT NULL,
    path TEXT,
    detailJson TEXT
  );`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5 (
    content,
    path UNINDEXED,
    vault UNINDEXED,
    headingPath UNINDEXED,
    blockId UNINDEXED,
    notePath UNINDEXED,
    kind UNINDEXED
  );`,
  `CREATE INDEX IF NOT EXISTS idx_notes_vault_path ON notes(vault, path);`,
  `CREATE INDEX IF NOT EXISTS idx_notes_mtime ON notes(mtime);`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_note ON chunks(noteId);`
];

function ensureStorageDirectory(config: AppConfig) {
  if (config.storage.databasePath === ':memory:') {
    return;
  }
  const directory = config.storage.baseDirectory;
  if (!directory) {
    throw new Error('Storage base directory is empty');
  }
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function rowToNoteRecord(row: any): NoteRecord {
  return {
    id: row.id,
    vault: row.vault,
    path: row.path,
    hash: row.hash,
    mtime: row.mtime,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    tags: row.tags ? JSON.parse(row.tags) : [],
    aliases: row.aliases ? JSON.parse(row.aliases) : [],
    frontmatter: row.frontmatter ? JSON.parse(row.frontmatter) : {},
  };
}

export function createDatabase(config: AppConfig, logger: Logger): DatabaseContext {
  ensureStorageDirectory(config);
  const dbPath = config.storage.databasePath;
  const timer = logger.startTimer('SQLite database ready', { dbPath });
  try {
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('foreign_keys = ON');

    const transaction = sqlite.transaction((queries: string[]) => {
      for (const query of queries) {
        sqlite.exec(query);
      }
    });
    transaction(SQL_CREATE_TABLES);

  const insertNoteStmt = sqlite.prepare<{
    vault: string;
    path: string;
    hash: string;
    mtime: number;
    createdAt: number;
    updatedAt: number;
    tags: string;
    aliases: string;
    frontmatter: string;
  }>(
    `INSERT INTO notes (vault, path, hash, mtime, createdAt, updatedAt, tags, aliases, frontmatter)
     VALUES (@vault, @path, @hash, @mtime, @createdAt, @updatedAt, @tags, @aliases, @frontmatter)
     ON CONFLICT(vault, path)
     DO UPDATE SET hash=excluded.hash,
                   mtime=excluded.mtime,
                   updatedAt=excluded.updatedAt,
                   tags=excluded.tags,
                   aliases=excluded.aliases,
                   frontmatter=excluded.frontmatter`
  );

  const selectNoteStmt = sqlite.prepare<[string, string]>(
    'SELECT * FROM notes WHERE vault = ? AND path = ?'
  );

  const selectNoteIdStmt = sqlite.prepare<[string, string]>(
    'SELECT id FROM notes WHERE vault = ? AND path = ?'
  );

  const selectChunkRowIdsStmt = sqlite.prepare<[number]>(
    'SELECT ftsRowid FROM chunks WHERE noteId = ?'
  );

  const deleteChunksByNoteStmt = sqlite.prepare<[number]>(
    'DELETE FROM chunks WHERE noteId = ?'
  );

  const deleteFtsByRowIdStmt = sqlite.prepare<[number]>(
    'DELETE FROM fts_chunks WHERE rowid = ?'
  );

  const insertFtsStmt = sqlite.prepare<[
    string,
    string,
    string,
    string,
    string | null,
    string,
    string
  ]>(
    `INSERT INTO fts_chunks (content, path, vault, headingPath, blockId, notePath, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const insertChunkStmt = sqlite.prepare<[
    number,
    string,
    string,
    string,
    string,
    string | null,
    string,
    string,
    number
  ]>(
    `INSERT INTO chunks (noteId, vault, path, kind, headingPath, blockId, tags, aliases, ftsRowid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const deleteNoteStmt = sqlite.prepare<[string, string]>(
    'DELETE FROM notes WHERE vault = ? AND path = ?'
  );

  const insertJournalStmt = sqlite.prepare<[
    number,
    string,
    string,
    string | null,
    string
  ]>(
    'INSERT INTO journal (ts, op, vault, path, detailJson) VALUES (?, ?, ?, ?, ?)'
  );

  const searchBase = `
    SELECT
      fts.rowid AS rowid,
      fts.content AS content,
      fts.path AS chunkPath,
      fts.vault AS vault,
      fts.headingPath AS headingPath,
      fts.blockId AS blockId,
      fts.notePath AS notePath,
      fts.kind AS kind,
      notes.updatedAt AS updatedAt,
      notes.tags AS noteTags,
      notes.aliases AS noteAliases,
      chunks.tags AS chunkTags,
      chunks.aliases AS chunkAliases,
      bm25(fts) AS score,
      snippet(fts, 0, '<mark>', '</mark>', ' … ', 15) AS snippet
    FROM fts_chunks AS fts
    JOIN chunks ON chunks.ftsRowid = fts.rowid
    JOIN notes ON notes.id = chunks.noteId
  `;

  const statusStmt = sqlite.prepare('SELECT COUNT(*) as count FROM notes');
  const chunkCountStmt = sqlite.prepare('SELECT COUNT(*) as count FROM chunks');

    const context: DatabaseContext = {
      db: sqlite,
      close() {
        sqlite.close();
    },
    upsertNote(input: NoteUpsertInput) {
      const tagsJson = JSON.stringify(input.tags);
      const aliasesJson = JSON.stringify(input.aliases);
      const frontmatterJson = JSON.stringify(input.frontmatter ?? {});

      sqlite.transaction(() => {
        const existing = selectNoteStmt.get(input.vault, input.path) as
          | (Record<string, unknown> & { createdAt: number })
          | undefined;
        const createdAt = typeof existing?.createdAt === 'number' ? existing.createdAt : input.mtime;

        insertNoteStmt.run({
          vault: input.vault,
          path: input.path,
          hash: input.hash,
          mtime: input.mtime,
          createdAt,
          updatedAt: input.mtime,
          tags: tagsJson,
          aliases: aliasesJson,
          frontmatter: frontmatterJson,
        });

        const noteRow = selectNoteIdStmt.get(input.vault, input.path) as { id: number } | undefined;
        if (!noteRow) {
          throw new Error(`Failed to upsert note metadata for ${input.vault}:${input.path}`);
        }
        const noteId = noteRow.id;

        const existingRowIds = selectChunkRowIdsStmt.all(noteId) as Array<{ ftsRowid: number }>;
        for (const row of existingRowIds) {
          deleteFtsByRowIdStmt.run(row.ftsRowid);
        }
        deleteChunksByNoteStmt.run(noteId);

        for (const chunk of input.chunks) {
          if (!chunk.content || chunk.content.trim().length === 0) {
            continue;
          }
          const headingPath = JSON.stringify(chunk.headingPath ?? []);
          const blockId = chunk.blockId ?? null;
          const chunkTags = JSON.stringify(chunk.tags ?? []);
          const chunkAliases = JSON.stringify(chunk.aliases ?? []);
          const ftsResult = insertFtsStmt.run(
            chunk.content,
            input.path,
            input.vault,
            headingPath,
            blockId,
            input.path,
            chunk.kind
          );
          const ftsRowid = Number(ftsResult.lastInsertRowid);
          insertChunkStmt.run(
            noteId,
            input.vault,
            input.path,
            chunk.kind,
            headingPath,
            blockId,
            chunkTags,
            chunkAliases,
            ftsRowid
          );
        }

        insertJournalStmt.run(Date.now(), 'upsert', input.vault, input.path, JSON.stringify({ chunkCount: input.chunks.length }));
      })();
    },
    deleteNote(vault: string, notePath: string) {
      sqlite.transaction(() => {
        const noteRow = selectNoteIdStmt.get(vault, notePath) as { id: number } | undefined;
        if (!noteRow) {
          return;
        }
        const noteId = noteRow.id;
        const existingRowIds = selectChunkRowIdsStmt.all(noteId) as Array<{ ftsRowid: number }>;
        for (const row of existingRowIds) {
          deleteFtsByRowIdStmt.run(row.ftsRowid);
        }
        deleteChunksByNoteStmt.run(noteId);
        deleteNoteStmt.run(vault, notePath);
        insertJournalStmt.run(Date.now(), 'delete', vault, notePath, JSON.stringify({}));
      })();
    },
    getNoteRecord(vault: string, notePath: string) {
      const row = selectNoteStmt.get(vault, notePath);
      if (!row) {
        return undefined;
      }
      return rowToNoteRecord(row);
    },
    search(options: SearchOptions): SearchResult[] {
      const topK = options.topK ?? 10;
      const whereClauses: string[] = [];
      const params: unknown[] = [];

      if (options.query && options.query.trim().length > 0) {
        whereClauses.push('fts MATCH ?');
        params.push(options.query.trim());
      } else {
        whereClauses.push('1 = 1');
      }

      if (options.filter?.vaultName) {
        whereClauses.push('fts.vault = ?');
        params.push(options.filter.vaultName);
      }

      if (options.filter?.paths && options.filter.paths.length > 0) {
        const pathClauses = options.filter.paths.map(() => 'fts.notePath LIKE ?');
        whereClauses.push(`(${pathClauses.join(' OR ')})`);
        for (const p of options.filter.paths) {
          const normalized = p.endsWith('/') ? `${p}%` : `${p.replace(/\/+$/u, '')}%`;
          params.push(normalized);
        }
      }

      if (options.filter?.tags && options.filter.tags.length > 0) {
        const tagConditions = options.filter.tags.map(() => `EXISTS (SELECT 1 FROM json_each(notes.tags) WHERE value = ?)`);
        whereClauses.push(tagConditions.join(' AND '));
        for (const tag of options.filter.tags) {
          params.push(tag.toLowerCase());
        }
      }

      if (options.filter?.since) {
        whereClauses.push('notes.updatedAt >= ?');
        params.push(options.filter.since);
      }

      if (options.filter?.until) {
        whereClauses.push('notes.updatedAt <= ?');
        params.push(options.filter.until);
      }

      const query = `${searchBase} WHERE ${whereClauses.join(' AND ')} ORDER BY score LIMIT ?`;
      params.push(topK);

      const stmt = sqlite.prepare(query);
      const rows = stmt.all(...params);

      return rows.map((row: any) => {
        const headingPath = row.headingPath ? JSON.parse(row.headingPath) : [];
        const chunkTags = row.chunkTags ? JSON.parse(row.chunkTags) : [];
        const chunkAliases = row.chunkAliases ? JSON.parse(row.chunkAliases) : [];
        return {
          uri: `obsidian://vault/${encodeURIComponent(row.vault)}/${encodeVaultPath(row.notePath)}${row.blockId ? `#^${row.blockId}` : ''}`,
          vault: row.vault,
          path: row.notePath,
          headingPath,
          blockId: row.blockId ?? undefined,
          snippet: row.snippet ?? '',
          score: row.score,
          tags: Array.from(new Set([...(row.noteTags ? JSON.parse(row.noteTags) : []), ...chunkTags])),
          aliases: chunkAliases,
          content: options.withContent ? row.content : undefined,
          updatedAt: row.updatedAt ?? undefined,
        } satisfies SearchResult;
      });
    },
    getStatus() {
      const notesCount = statusStmt.get() as { count: number };
      const chunksCount = chunkCountStmt.get() as { count: number };
      return { noteCount: notesCount.count, chunkCount: chunksCount.count };
    },
    } satisfies DatabaseContext;

    timer.end('SQLite database ready', { dbPath });

    return context;
  } catch (error) {
    timer.fail(error, 'Failed to initialize SQLite database', { dbPath });
    throw error;
  }
}
