import { describe, it, expect } from 'vitest';
import { filterText } from './filter.js';

describe('filterText', () => {
  it('passes normal text', () => {
    const result = filterText('Hello, world!');
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('passes empty text', () => {
    const result = filterText('');
    expect(result.passed).toBe(true);
  });

  it('passes whitespace-only text', () => {
    const result = filterText('   \n\t  ');
    expect(result.passed).toBe(true);
  });

  it('returns FilterResult shape', () => {
    const result = filterText('test');
    expect(result).toHaveProperty('passed');
    expect(typeof result.passed).toBe('boolean');
  });
});
