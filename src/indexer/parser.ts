import { parse as parseYaml } from 'yaml';
import type { ChunkInsert, ChunkKind } from '../db/sqlite.js';
import { normalizeMarkdown } from '../markdown/normalize.js';

export interface ParsedChunk extends ChunkInsert {
  startLine: number;
  endLine: number;
  headingLevel?: number;
}

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  tags: string[];
  aliases: string[];
  chunks: ParsedChunk[];
}

interface ParseContext {
  headingStack: string[];
  chunks: ParsedChunk[];
  buffer: string[];
  bufferKind: ChunkKind;
  bufferStart: number | null;
  bufferEnd: number | null;
  pendingBlockId?: string;
  noteTags: Set<string>;
  noteAliases: Set<string>;
  frontmatter: Record<string, unknown>;
}

const INLINE_TAG_REGEX = /(^|\s)#([A-Za-z0-9][\w/-]*)/g;
const BLOCK_ID_REGEX = /\^([A-Za-z0-9-]+)$/;

function normalizeTag(tag: string): string {
  return tag.replace(/^#+/u, '').toLowerCase();
}

function extractTagsFromText(text: string, accumulator: Set<string>) {
  let match: RegExpExecArray | null;
  INLINE_TAG_REGEX.lastIndex = 0;
  while ((match = INLINE_TAG_REGEX.exec(text)) !== null) {
    const normalized = normalizeTag(match[2]);
    if (normalized) {
      accumulator.add(normalized);
    }
  }
}

function extractAliasesFromFrontmatter(frontmatter: Record<string, unknown>, accumulator: Set<string>) {
  const aliases = frontmatter.aliases ?? frontmatter.alias ?? undefined;
  if (!aliases) {
    return;
  }
  if (Array.isArray(aliases)) {
    for (const alias of aliases) {
      if (typeof alias === 'string' && alias.trim().length > 0) {
        accumulator.add(alias.trim());
      }
    }
  } else if (typeof aliases === 'string') {
    accumulator.add(aliases.trim());
  }
}

function applyPendingBlockId(context: ParseContext, blockId: string) {
  const lastChunk = context.chunks[context.chunks.length - 1];
  if (lastChunk && !lastChunk.blockId) {
    lastChunk.blockId = blockId;
  } else {
    context.pendingBlockId = blockId;
  }
}

function handleBlockId(line: string, context: ParseContext): string {
  const trimmed = line.trimEnd();
  const match = trimmed.match(BLOCK_ID_REGEX);
  if (!match) {
    return line;
  }
  const blockId = match[1];
  const without = trimmed.replace(BLOCK_ID_REGEX, '').trimEnd();
  if (without.length === 0) {
    applyPendingBlockId(context, blockId);
    return '';
  }
  context.pendingBlockId = blockId;
  return line.replace(BLOCK_ID_REGEX, '').trimEnd();
}

function finalizeBuffer(context: ParseContext) {
  if (context.buffer.length === 0) {
    context.pendingBlockId = undefined;
    context.bufferStart = null;
    context.bufferEnd = null;
    context.bufferKind = 'paragraph';
    return;
  }

  const content = context.buffer.join('\n').trim();
  if (!content) {
    context.buffer = [];
    context.pendingBlockId = undefined;
    context.bufferStart = null;
    context.bufferEnd = null;
    context.bufferKind = 'paragraph';
    return;
  }

  const chunkTags = new Set<string>();
  extractTagsFromText(content, chunkTags);
  for (const tag of chunkTags) {
    context.noteTags.add(tag);
  }

  const chunk: ParsedChunk = {
    kind: context.bufferKind,
    content,
    headingPath: [...context.headingStack],
    blockId: context.pendingBlockId,
    tags: Array.from(chunkTags),
    aliases: [],
    startLine: context.bufferStart ?? 0,
    endLine: context.bufferEnd ?? context.bufferStart ?? 0,
  };

  context.chunks.push(chunk);
  context.buffer = [];
  context.bufferKind = 'paragraph';
  context.pendingBlockId = undefined;
  context.bufferStart = null;
  context.bufferEnd = null;
}

function detectList(line: string): boolean {
  return /^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line);
}

function detectBlockquote(line: string): boolean {
  return /^\s*>/.test(line);
}

function detectTable(line: string): boolean {
  return /\|/.test(line) && line.trim().startsWith('|');
}

function updateHeadingStack(context: ParseContext, level: number, title: string) {
  const cleanTitle = title.trim();
  context.headingStack = context.headingStack.slice(0, level - 1);
  while (context.headingStack.length < level - 1) {
    context.headingStack.push('');
  }
  context.headingStack[level - 1] = cleanTitle;
}

export function parseMarkdown(content: string): ParsedNote {
  const normalized = normalizeMarkdown(content);
  const lines = normalized.split('\n');
  const context: ParseContext = {
    headingStack: [],
    chunks: [],
    buffer: [],
    bufferKind: 'paragraph',
    bufferStart: null,
    bufferEnd: null,
    noteTags: new Set(),
    noteAliases: new Set(),
    frontmatter: {},
  };

  let index = 0;
  if (lines[0]?.trim() === '---') {
    let fmEnd = -1;
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === '---') {
        fmEnd = i;
        break;
      }
    }
    if (fmEnd > 0) {
      const frontmatterRaw = lines.slice(1, fmEnd).join('\n');
      try {
        const parsedFrontmatter = parseYaml(frontmatterRaw) as Record<string, unknown> | undefined;
        if (parsedFrontmatter && typeof parsedFrontmatter === 'object') {
          context.frontmatter = parsedFrontmatter;
          const tags = parsedFrontmatter.tags ?? parsedFrontmatter.tag ?? undefined;
          if (Array.isArray(tags)) {
            for (const tag of tags) {
              if (typeof tag === 'string') {
                context.noteTags.add(normalizeTag(tag));
              }
            }
          } else if (typeof tags === 'string') {
            context.noteTags.add(normalizeTag(tags));
          }
          extractAliasesFromFrontmatter(parsedFrontmatter, context.noteAliases);
        }
      } catch (error) {
        console.warn('Failed to parse frontmatter', error);
      }
      index = fmEnd + 1;
    }
  }

  let inCodeBlock = false;

  for (; index < lines.length; index += 1) {
    let line = lines[index];
    if (!inCodeBlock) {
      line = handleBlockId(line, context);
      if (!line) {
        continue;
      }
    }

    const lineNumber = index + 1;

    if (!inCodeBlock) {
      const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        finalizeBuffer(context);
        const level = headingMatch[1].length;
        const title = headingMatch[2].trim();
        updateHeadingStack(context, level, title);
        context.chunks.push({
          kind: 'heading',
          content: title,
          headingPath: context.headingStack.slice(0, level),
          blockId: context.pendingBlockId,
          tags: [],
          aliases: [],
          startLine: lineNumber,
          endLine: lineNumber,
          headingLevel: level,
        });
        context.pendingBlockId = undefined;
        continue;
      }
    }

    const fenceMatch = line.match(/^```/);
    if (fenceMatch) {
      if (inCodeBlock) {
        context.buffer.push(line);
        context.bufferEnd = lineNumber;
        finalizeBuffer(context);
        inCodeBlock = false;
      } else {
        finalizeBuffer(context);
        inCodeBlock = true;
        context.bufferKind = 'code';
        context.bufferStart = lineNumber;
        context.bufferEnd = lineNumber;
        context.buffer.push(line);
      }
      continue;
    }

    if (inCodeBlock) {
      context.buffer.push(line);
      context.bufferEnd = lineNumber;
      continue;
    }

    if (line.trim().length === 0) {
      finalizeBuffer(context);
      continue;
    }

    if (detectList(line)) {
      if (context.bufferKind !== 'list') {
        finalizeBuffer(context);
        context.bufferKind = 'list';
        context.bufferStart = lineNumber;
      }
      context.buffer.push(line);
      context.bufferEnd = lineNumber;
      continue;
    }

    if (detectBlockquote(line)) {
      if (context.bufferKind !== 'blockquote') {
        finalizeBuffer(context);
        context.bufferKind = 'blockquote';
        context.bufferStart = lineNumber;
      }
      context.buffer.push(line);
      context.bufferEnd = lineNumber;
      continue;
    }

    if (detectTable(line)) {
      if (context.bufferKind !== 'table') {
        finalizeBuffer(context);
        context.bufferKind = 'table';
        context.bufferStart = lineNumber;
      }
      context.buffer.push(line);
      context.bufferEnd = lineNumber;
      continue;
    }

    if (context.bufferKind !== 'paragraph') {
      finalizeBuffer(context);
      context.bufferKind = 'paragraph';
      context.bufferStart = lineNumber;
    }
    if (context.bufferStart === null) {
      context.bufferStart = lineNumber;
    }
    context.buffer.push(line);
    context.bufferEnd = lineNumber;
  }

  finalizeBuffer(context);

  return {
    frontmatter: context.frontmatter,
    tags: Array.from(context.noteTags),
    aliases: Array.from(context.noteAliases),
    chunks: context.chunks,
  };
}
