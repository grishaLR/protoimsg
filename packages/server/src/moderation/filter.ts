const MAX_TEXT_LENGTH = 3000;

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /(.)\1{15,}/, reason: 'Character spam detected' },
  { pattern: /(?:\n\s*){10,}/, reason: 'Newline spam detected' },
];

export interface FilterResult {
  passed: boolean;
  reason?: string;
}

export function filterText(text: string): FilterResult {
  if (text.length > MAX_TEXT_LENGTH) {
    return {
      passed: false,
      reason: `Message exceeds ${String(MAX_TEXT_LENGTH)} characters`,
    };
  }

  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return { passed: false, reason };
    }
  }

  return { passed: true };
}
