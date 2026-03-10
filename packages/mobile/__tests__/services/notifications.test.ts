import { router } from 'expo-router';

// Mock expo-notifications at module level
const mockAddListener = jest.fn().mockReturnValue({ remove: jest.fn() });
const mockGetLast = jest.fn().mockResolvedValue(null);

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[mock]' }),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: (...args: unknown[]) =>
    mockAddListener(...args) as unknown,
  getLastNotificationResponseAsync: (...args: unknown[]) => mockGetLast(...args) as unknown,
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
}));

jest.mock('../../src/services/api', () => ({
  authFetch: jest.fn().mockResolvedValue({ ok: true }),
}));

// Use require() since dynamic import() doesn't work in Jest CJS mode
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { setupNotificationResponseListener } = require('../../src/services/notifications') as {
  setupNotificationResponseListener: () => () => void;
};

const mockRouterPush = router.push as jest.Mock;

describe('notifications service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLast.mockResolvedValue(null);
  });

  describe('setupNotificationResponseListener', () => {
    it('registers a response listener and returns cleanup', () => {
      const cleanup = setupNotificationResponseListener();
      expect(mockAddListener).toHaveBeenCalledTimes(1);
      expect(typeof cleanup).toBe('function');
    });

    it('navigates to DM on dm notification tap with valid DID', () => {
      let handler: (response: unknown) => void = () => {};
      mockAddListener.mockImplementation((cb: typeof handler) => {
        handler = cb;
        return { remove: jest.fn() };
      });

      setupNotificationResponseListener();

      handler({
        notification: {
          request: {
            content: {
              data: { type: 'dm', did: 'did:plc:abc123' },
            },
          },
        },
      });

      expect(mockRouterPush).toHaveBeenCalledWith('/dm/did:plc:abc123');
    });

    it('navigates to call on call notification tap with valid DID', () => {
      let handler: (response: unknown) => void = () => {};
      mockAddListener.mockImplementation((cb: typeof handler) => {
        handler = cb;
        return { remove: jest.fn() };
      });

      setupNotificationResponseListener();

      handler({
        notification: {
          request: {
            content: {
              data: { type: 'call', did: 'did:plc:caller456' },
            },
          },
        },
      });

      expect(mockRouterPush).toHaveBeenCalledWith('/call/did:plc:caller456');
    });

    it('navigates to room on mention notification tap', () => {
      let handler: (response: unknown) => void = () => {};
      mockAddListener.mockImplementation((cb: typeof handler) => {
        handler = cb;
        return { remove: jest.fn() };
      });

      setupNotificationResponseListener();

      handler({
        notification: {
          request: {
            content: {
              data: { type: 'mention', roomId: 'room-abc-123' },
            },
          },
        },
      });

      expect(mockRouterPush).toHaveBeenCalledWith('/room/room-abc-123');
    });

    it('rejects invalid DID format (path traversal)', () => {
      let handler: (response: unknown) => void = () => {};
      mockAddListener.mockImplementation((cb: typeof handler) => {
        handler = cb;
        return { remove: jest.fn() };
      });

      setupNotificationResponseListener();

      handler({
        notification: {
          request: {
            content: {
              data: { type: 'dm', did: '../../../etc/passwd' },
            },
          },
        },
      });

      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it('rejects notification with no data', () => {
      let handler: (response: unknown) => void = () => {};
      mockAddListener.mockImplementation((cb: typeof handler) => {
        handler = cb;
        return { remove: jest.fn() };
      });

      setupNotificationResponseListener();

      handler({
        notification: {
          request: {
            content: {},
          },
        },
      });

      expect(mockRouterPush).not.toHaveBeenCalled();
    });
  });
});
