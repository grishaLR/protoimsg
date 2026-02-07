import { describe, it, expect } from 'vitest';
import { resolveVisibleStatus } from './visibility.js';

describe('resolveVisibleStatus', () => {
  it('returns real status when visibility is everyone', () => {
    expect(resolveVisibleStatus('everyone', 'online', false)).toBe('online');
    expect(resolveVisibleStatus('everyone', 'away', false)).toBe('away');
    expect(resolveVisibleStatus('everyone', 'idle', true)).toBe('idle');
    expect(resolveVisibleStatus('everyone', 'offline', false)).toBe('offline');
  });

  it('returns offline when visibility is nobody', () => {
    expect(resolveVisibleStatus('nobody', 'online', false)).toBe('offline');
    expect(resolveVisibleStatus('nobody', 'online', true)).toBe('offline');
    expect(resolveVisibleStatus('nobody', 'away', true)).toBe('offline');
  });

  it('returns real status for close-friends when requester is a friend', () => {
    expect(resolveVisibleStatus('close-friends', 'online', true)).toBe('online');
    expect(resolveVisibleStatus('close-friends', 'away', true)).toBe('away');
    expect(resolveVisibleStatus('close-friends', 'idle', true)).toBe('idle');
  });

  it('returns offline for close-friends when requester is not a friend', () => {
    expect(resolveVisibleStatus('close-friends', 'online', false)).toBe('offline');
    expect(resolveVisibleStatus('close-friends', 'away', false)).toBe('offline');
    expect(resolveVisibleStatus('close-friends', 'idle', false)).toBe('offline');
  });

  it('returns invisible as-is for everyone visibility', () => {
    expect(resolveVisibleStatus('everyone', 'invisible', false)).toBe('invisible');
  });

  it('returns offline for invisible status with nobody visibility', () => {
    expect(resolveVisibleStatus('nobody', 'invisible', true)).toBe('offline');
  });

  it('returns offline for close-friends when not a friend regardless of status', () => {
    expect(resolveVisibleStatus('close-friends', 'invisible', false)).toBe('offline');
  });
});
