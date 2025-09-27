import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const transportSchema = z.object({
  stdio: z
    .object({
      enabled: z.boolean().default(true),
    })
    .default({ enabled: true }),
  http: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({ enabled: false }),
});

const vaultSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});

const storageSchema = z.object({
  location: z.enum(['vault', 'system', 'memory']).default('vault'),
  vaultSubdir: z.string().default('.mcp'),
  filename: z.string().default('index-v1.sqlite'),
});

const markdownSchema = z.object({
  profile: z.string().default('omp-default'),
  enforcement: z.enum(['strict', 'lenient', 'inherit-per-file']).default('strict'),
});

const rootSchema = z.object({
  vaults: z.array(vaultSchema).min(1).default([{ name: 'default', path: './vault' }]),
  transport: transportSchema.default({ stdio: { enabled: true }, http: { enabled: false } }),
  storage: storageSchema.default({}),
  markdown: markdownSchema.default({}),
});

export type AppConfig = z.infer<typeof rootSchema>;

function readConfigFile(configPath: string): unknown {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse config file at ${configPath}: ${(error as Error).message}`);
  }
}

export function loadConfig(): AppConfig {
  const fromEnv = process.env.MCP_OBSIDIAN_CONFIG;
  const candidates: Array<{ source: string; value: unknown }> = [];

  if (fromEnv) {
    candidates.push({ source: 'env', value: readConfigFile(path.resolve(fromEnv)) });
  }

  const cwdConfigPath = path.resolve(process.cwd(), 'config.json');
  if (fs.existsSync(cwdConfigPath)) {
    candidates.push({ source: 'config.json', value: readConfigFile(cwdConfigPath) });
  }

  const merged = candidates.reduce<Record<string, unknown>>((acc, curr) => {
    if (curr.value && typeof curr.value === 'object') {
      return {
        ...acc,
        ...curr.value,
      };
    }
    return acc;
  }, {});

  const result = rootSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid configuration: ${result.error.message}`);
  }

  return result.data;
}

