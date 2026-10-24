import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  effectiveVisibility,
  getCurrentStatus,
  setCurrentStatus,
  setTownVisibilityCap,
} from './presence-state';

describe('effectiveVisibility', () => {
  let stored: string | null = null;

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: () => stored,
      setItem: (_: string, v: string) => {
        stored = v;
      },
    });
  });

  afterEach(() => {
    setTownVisibilityCap(null);
    vi.unstubAllGlobals();
  });

  it('is your own setting outside town', () => {
    stored = 'everyone';
    expect(effectiveVisibility()).toBe('everyone');
  });

  it('is narrowed by where you stand in town', () => {
    stored = 'everyone';
    setTownVisibilityCap('inner-circle');
    expect(effectiveVisibility()).toBe('inner-circle');
  });

  it('never widens your own narrower setting', () => {
    stored = 'no-one';
    setTownVisibilityCap('everyone');
    expect(effectiveVisibility()).toBe('no-one');
  });

  it('goes back to your setting when you leave town', () => {
    stored = 'community';
    setTownVisibilityCap('inner-circle');
    setTownVisibilityCap(null);
    expect(effectiveVisibility()).toBe('community');
  });
});

describe('current status', () => {
  it('is shared, so every sender keeps you away while you are away', () => {
    setCurrentStatus({ status: 'away', awayMessage: 'brb' });
    expect(getCurrentStatus()).toEqual({ status: 'away', awayMessage: 'brb' });
    setCurrentStatus({ status: 'online' });
  });
});
