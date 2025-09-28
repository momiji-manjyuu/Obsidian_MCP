import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

export interface VaultConfig extends z.infer<typeof vaultSchema> {
  absolutePath: string;
}

export interface StorageConfig extends z.infer<typeof storageSchema> {
  baseDirectory: string;
  databasePath: string;
}

export interface AppConfig {
  vaults: VaultConfig[];
  transport: z.infer<typeof transportSchema>;
  storage: StorageConfig;
  markdown: z.infer<typeof markdownSchema>;
}

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

  const parsed = result.data;
  const resolvedVaults: VaultConfig[] = parsed.vaults.map((vault) => {
    const absolutePath = path.resolve(vault.path);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Vault path does not exist: ${absolutePath}`);
    }
    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
      throw new Error(`Vault path is not a directory: ${absolutePath}`);
    }

    return {
      ...vault,
      absolutePath,
    };
  });

  const storage = parsed.storage;
  let baseDirectory: string;
  switch (storage.location) {
    case 'vault': {
      const primaryVault = resolvedVaults[0];
      baseDirectory = path.join(primaryVault.absolutePath, storage.vaultSubdir);
      break;
    }
    case 'system': {
      const systemRoot = path.join(os.homedir(), '.obsidian-mcp');
      baseDirectory = path.join(systemRoot, storage.vaultSubdir);
      break;
    }
    case 'memory': {
      baseDirectory = '';
      break;
    }
    default: {
      baseDirectory = '';
    }
  }

  const databasePath = storage.location === 'memory' ? ':memory:' : path.join(baseDirectory, storage.filename);

  return {
    vaults: resolvedVaults,
    transport: parsed.transport,
    markdown: parsed.markdown,
    storage: {
      ...storage,
      baseDirectory,
      databasePath,
    },
  };
}

