export function normalizeMarkdown(raw: string): string {
  if (typeof raw !== 'string') {
    return '';
  }
  let normalized = raw.replace(/\r\n?/g, '\n');
  normalized = normalized.normalize('NFC');
  if (!normalized.endsWith('\n')) {
    normalized += '\n';
  }
  return normalized;
}
