/** Basic text content filter. Extend with more sophisticated patterns as needed. */

const BLOCKED_PATTERNS: RegExp[] = [
  // Placeholder patterns — add real patterns for production
];

export interface FilterResult {
  passed: boolean;
  reason?: string;
}

export function filterText(text: string): FilterResult {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return { passed: false, reason: 'Content filtered by automated moderation' };
    }
  }
  return { passed: true };
}
