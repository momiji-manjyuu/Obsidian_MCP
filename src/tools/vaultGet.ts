import fs from 'node:fs/promises';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../app/context.js';
import { normalizeMarkdown } from '../markdown/normalize.js';
import { parseMarkdown } from '../indexer/parser.js';
import { ensureFileExists, resolveVaultPath } from '../vault/utils.js';

const rangeSchema = z
  .object({
    fromHeading: z.string().optional(),
    blockId: z.string().optional(),
  })
  .optional();

const getInputSchema = {
  uri: z.string().optional(),
  path: z.string().optional(),
  vaultName: z.string().optional(),
  range: rangeSchema,
};

function sliceLines(lines: string[], startLine: number, endLine: number): string {
  const startIndex = Math.max(0, startLine - 1);
  const endIndex = Math.max(startIndex, endLine);
  const segment = lines.slice(startIndex, endIndex).join('\n');
  return segment;
}

function extractBlockContent(normalized: string, blockId: string, parsed = parseMarkdown(normalized)): string {
  const target = parsed.chunks.find((chunk) => chunk.blockId === blockId);
  if (!target) {
    throw new Error(`Block ID not found: ${blockId}`);
  }
  const lines = normalized.split('\n');
  return sliceLines(lines, target.startLine, target.endLine);
}

function extractHeadingSection(normalized: string, heading: string, parsed = parseMarkdown(normalized)): string {
  const headingChunk = parsed.chunks.find((chunk) => chunk.kind === 'heading' && chunk.content === heading);
  if (!headingChunk || !headingChunk.headingLevel) {
    throw new Error(`Heading not found: ${heading}`);
  }
  const currentLevel = headingChunk.headingLevel;
  let endLine = normalized.split('\n').length;
  for (const chunk of parsed.chunks) {
    if (chunk === headingChunk) {
      continue;
    }
    if (chunk.kind === 'heading' && chunk.headingLevel && chunk.headingLevel <= currentLevel && chunk.startLine > headingChunk.startLine) {
      endLine = chunk.startLine - 1;
      break;
    }
  }
  const lines = normalized.split('\n');
  return sliceLines(lines, headingChunk.startLine, endLine);
}

export function registerVaultGetTool(server: McpServer, context: AppContext) {
  server.tool('vault.get', getInputSchema, async (args) => {
    if (!args.uri && !args.path) {
      throw new Error('Either uri or path must be provided.');
    }

    const resolved = resolveVaultPath(context, { uri: args.uri, path: args.path, vaultName: args.vaultName });
    ensureFileExists(resolved.absolutePath);

    const rawContent = await fs.readFile(resolved.absolutePath, 'utf-8');
    const normalized = normalizeMarkdown(rawContent);
    const parsed = parseMarkdown(normalized);

    let returnedContent = normalized;
    if (args.range?.blockId && args.range?.fromHeading) {
      throw new Error('Specify either blockId or fromHeading, not both.');
    }
    if (args.range?.blockId) {
      returnedContent = extractBlockContent(normalized, args.range.blockId, parsed);
    } else if (args.range?.fromHeading) {
      returnedContent = extractHeadingSection(normalized, args.range.fromHeading, parsed);
    }

    const metadata = context.db.getNoteRecord(resolved.vault.name, resolved.relativePath);

    return {
      content: [
        {
          type: 'text',
          text: returnedContent,
        },
      ],
      structuredContent: {
        path: resolved.relativePath,
        vault: resolved.vault.name,
        metadata: metadata
          ? {
              tags: metadata.tags,
              aliases: metadata.aliases,
              updatedAt: metadata.updatedAt,
              createdAt: metadata.createdAt,
              frontmatter: metadata.frontmatter,
            }
          : undefined,
        range: args.range ?? null,
      },
    };
  });
}
