import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../app/context.js';
import { normalizeVaultPath } from '../vault/utils.js';

const searchInputSchema = {
  query: z.string().min(1),
  topK: z.number().int().min(1).max(100).optional(),
  filter: z
    .object({
      tags: z.array(z.string()).optional(),
      paths: z.array(z.string()).optional(),
      since: z.union([z.string(), z.number()]).optional(),
      until: z.union([z.string(), z.number()]).optional(),
      vaultName: z.string().optional(),
    })
    .optional(),
  mode: z.enum(['keyword']).optional(),
  withContent: z.boolean().optional(),
  vaultName: z.string().optional(),
};

function parseTime(value?: string | number) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function registerVaultSearchTool(server: McpServer, context: AppContext) {
  server.tool('vault.search', searchInputSchema, async (args) => {
    const vaultName = args.vaultName ?? args.filter?.vaultName;
    const normalizedPaths = args.filter?.paths?.map((p) => normalizeVaultPath(p));
    const normalizedTags = args.filter?.tags?.map((tag) => tag.toLowerCase());

    const since = parseTime(args.filter?.since);
    const until = parseTime(args.filter?.until);

    const results = context.db.search({
      query: args.query,
      topK: args.topK,
      withContent: args.withContent ?? false,
      filter: {
        vaultName: vaultName,
        paths: normalizedPaths,
        tags: normalizedTags,
        since,
        until,
      },
    });

    const payload = results.map((result) => ({
      uri: result.uri,
      path: result.path,
      vault: result.vault,
      snippet: result.snippet,
      headingPath: result.headingPath,
      blockId: result.blockId,
      score: result.score,
      tags: result.tags,
      aliases: result.aliases,
      updatedAt: result.updatedAt,
      content: args.withContent ? result.content : undefined,
    }));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ results: payload }, null, 2),
        },
      ],
      structuredContent: {
        results: payload,
      },
    };
  });
}
