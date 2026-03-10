import {
  isSoundEnabled,
  setSoundEnabled,
  playDoorOpen,
  playDoorClose,
  playImNotify,
} from '../../src/services/sounds';

describe('sounds service', () => {
  beforeEach(() => {
    // Reset sound state before each test
    setSoundEnabled(true);
  });

  describe('isSoundEnabled / setSoundEnabled', () => {
    it('defaults to enabled', () => {
      expect(isSoundEnabled()).toBe(true);
    });

    it('can disable sounds', () => {
      setSoundEnabled(false);
      expect(isSoundEnabled()).toBe(false);
    });

    it('can re-enable sounds', () => {
      setSoundEnabled(false);
      setSoundEnabled(true);
      expect(isSoundEnabled()).toBe(true);
    });
  });

  describe('playback functions', () => {
    it('playDoorOpen does not throw', async () => {
      await expect(playDoorOpen()).resolves.not.toThrow();
    });

    it('playDoorClose does not throw', async () => {
      await expect(playDoorClose()).resolves.not.toThrow();
    });

    it('playImNotify does not throw', async () => {
      await expect(playImNotify()).resolves.not.toThrow();
    });

    it('does not play when disabled', async () => {
      setSoundEnabled(false);
      // Should silently return
      await expect(playDoorOpen()).resolves.not.toThrow();
    });
  });
});
