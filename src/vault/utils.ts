import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../app/context.js';
import type { VaultConfig } from '../config/index.js';

export interface ResolvedVaultPath {
  vault: VaultConfig;
  relativePath: string;
  absolutePath: string;
}

export function getVault(context: AppContext, vaultName?: string): VaultConfig {
  if (vaultName) {
    const vault = context.config.vaults.find((v) => v.name === vaultName);
    if (!vault) {
      throw new Error(`Vault not found: ${vaultName}`);
    }
    return vault;
  }
  return context.config.vaults[0];
}

export function normalizeVaultPath(inputPath: string): string {
  const normalized = inputPath.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  const safeSegments: string[] = [];
  for (const segment of segments) {
    if (segment === '.' || segment.length === 0) {
      continue;
    }
    if (segment === '..') {
      throw new Error('Path traversal is not allowed.');
    }
    safeSegments.push(segment);
  }
  return safeSegments.join('/');
}

function resolveFromUri(context: AppContext, uri: string): { vaultName: string; path: string } {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch (error) {
    throw new Error(`Invalid URI: ${uri}`);
  }

  if (parsed.protocol !== 'obsidian:') {
    throw new Error(`Unsupported URI scheme: ${parsed.protocol}`);
  }

  if (parsed.host !== 'vault') {
    throw new Error(`Unsupported Obsidian URI host: ${parsed.host}`);
  }

  const [vaultSegment, ...pathSegments] = parsed.pathname.replace(/^\//, '').split('/');
  if (!vaultSegment) {
    throw new Error(`Vault name missing in URI: ${uri}`);
  }
  const vaultName = decodeURIComponent(vaultSegment);
  const pathPart = pathSegments.map((segment) => decodeURIComponent(segment)).join('/');

  const resolvedVault = getVault(context, vaultName);
  const relativePath = normalizeVaultPath(pathPart);
  return { vaultName: resolvedVault.name, path: relativePath };
}

export function resolveVaultPath(context: AppContext, options: { vaultName?: string; path?: string; uri?: string }): ResolvedVaultPath {
  let targetVault: VaultConfig;
  let relativePath: string;

  if (options.uri) {
    const resolved = resolveFromUri(context, options.uri);
    targetVault = getVault(context, resolved.vaultName);
    relativePath = resolved.path;
  } else {
    targetVault = getVault(context, options.vaultName);
    if (!options.path) {
      throw new Error('Either path or uri must be provided.');
    }
    relativePath = normalizeVaultPath(options.path);
  }

  const absolutePath = path.join(targetVault.absolutePath, relativePath);
  const resolvedAbsolute = path.resolve(absolutePath);
  if (!resolvedAbsolute.startsWith(path.resolve(targetVault.absolutePath))) {
    throw new Error('Resolved path escapes the vault directory.');
  }

  return {
    vault: targetVault,
    relativePath,
    absolutePath: resolvedAbsolute,
  };
}

export function ensureFileExists(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
}
