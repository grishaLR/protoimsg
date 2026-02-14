interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: { $type: string }[];
}

interface ParseResult {
  text: string;
  facets: Facet[];
}

interface MatchInfo {
  /** Start index in source string (char offset) */
  start: number;
  /** End index in source string (char offset, exclusive) */
  end: number;
  /** The inner text (without syntax markers) */
  inner: string;
  /** Facet feature $type */
  feature: string;
}

const encoder = new TextEncoder();

function byteLen(s: string): number {
  return encoder.encode(s).length;
}

/**
 * Parse markdown syntax from text and return cleaned text + formatting facets.
 *
 * Supported syntax:
 *   `inline code`  **bold**  ~~strikethrough~~  *italic*
 *   > blockquote (at line start, full line)
 *
 * Does NOT handle nesting (e.g. `***bold italic***`).
 */
export function parseMarkdownFacets(text: string): ParseResult {
  // ── Pass 1: Strip blockquote prefixes ──────────────────────────────
  const srcLines = text.split('\n');
  const strippedLines: string[] = [];
  const isBlockquoteLine: boolean[] = [];

  for (const line of srcLines) {
    const bqMatch = /^>\s?/.exec(line);
    if (bqMatch) {
      strippedLines.push(line.slice(bqMatch[0].length));
      isBlockquoteLine.push(true);
    } else {
      strippedLines.push(line);
      isBlockquoteLine.push(false);
    }
  }

  const afterBq = strippedLines.join('\n');

  // ── Pass 2: Collect all inline matches (no overlaps) ───────────────
  // Priority order: code > bold > strikethrough > italic
  const patterns: { re: RegExp; feature: string }[] = [
    { re: /`([^`]+)`/g, feature: 'app.protoimsg.chat.message#codeInline' },
    { re: /\*\*(.+?)\*\*/g, feature: 'app.protoimsg.chat.message#bold' },
    { re: /~~(.+?)~~/g, feature: 'app.protoimsg.chat.message#strikethrough' },
    { re: /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, feature: 'app.protoimsg.chat.message#italic' },
  ];

  const allMatches: MatchInfo[] = [];
  // Track occupied character ranges to prevent overlaps
  const occupied: { start: number; end: number }[] = [];

  function overlaps(start: number, end: number): boolean {
    return occupied.some((r) => start < r.end && end > r.start);
  }

  for (const { re, feature } of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(afterBq)) !== null) {
      const inner = m[1] ?? '';
      if (!overlaps(m.index, m.index + m[0].length)) {
        allMatches.push({
          start: m.index,
          end: m.index + m[0].length,
          inner,
          feature,
        });
        occupied.push({ start: m.index, end: m.index + m[0].length });
      }
    }
  }

  // Sort by start position
  allMatches.sort((a, b) => a.start - b.start);

  // ── Pass 3: Rebuild text, stripping syntax markers ─────────────────
  const facets: Facet[] = [];
  let cleaned = '';
  let lastIdx = 0;

  for (const match of allMatches) {
    // Append text before this match
    cleaned += afterBq.slice(lastIdx, match.start);

    // Record byte offset of inner content start
    const innerByteStart = byteLen(cleaned);
    cleaned += match.inner;
    const innerByteEnd = byteLen(cleaned);

    facets.push({
      index: { byteStart: innerByteStart, byteEnd: innerByteEnd },
      features: [{ $type: match.feature }],
    });

    lastIdx = match.end;
  }

  cleaned += afterBq.slice(lastIdx);

  // ── Pass 4: Blockquote facets on final cleaned text ────────────────
  // Map original line indices to byte ranges in the cleaned string
  const cleanedLines = cleaned.split('\n');
  let bOff = 0;

  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i] ?? '';
    const lineBytes = byteLen(line);
    if (i < isBlockquoteLine.length && isBlockquoteLine[i] && lineBytes > 0) {
      facets.push({
        index: { byteStart: bOff, byteEnd: bOff + lineBytes },
        features: [{ $type: 'app.protoimsg.chat.message#blockquote' }],
      });
    }
    bOff += lineBytes + 1; // +1 for the newline separator
  }

  return { text: cleaned, facets };
}
