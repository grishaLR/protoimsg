import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Agent } from '@atproto/api';
import type { OAuthSession } from '@atproto/oauth-client-browser';
import { OAUTH_SCOPE } from '@protoimsg/shared';
import { getOAuthClient, REQUIRED_SCOPES, AUTH_VERSION } from '../lib/oauth';
import {
  AccountBannedError,
  NotOnAllowlistError,
  CaptchaFailedError,
  preflightCheck,
  fetchChallenge,
  createServerSession,
  deleteServerSession,
  setServerToken,
  getServerToken,
} from '../lib/api';
import { IS_TAURI } from '../lib/config';
import { publicAgent } from '../lib/public-agent';
import { Sentry } from '../sentry';

export type AuthPhase =
  | 'initializing'
  | 'authenticating'
  | 'resolving'
  | 'connecting'
  | 'ready'
  | 'idle';

export interface AuthContextValue {
  session: OAuthSession | null;
  agent: Agent | null;
  did: string | null;
  handle: string | null;
  serverToken: string | null;
  isLoading: boolean;
  authPhase: AuthPhase;
  authError: string | null;
  grantedScopes: string[];
  login: (handle: string, turnstileToken?: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<OAuthSession | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [did, setDid] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [serverToken, setServerTokenState] = useState<string | null>(null);
  const [authPhase, setAuthPhase] = useState<AuthPhase>('initializing');
  const [authError, setAuthError] = useState<string | null>(null);
  const [grantedScopes, setGrantedScopes] = useState<string[]>(() => {
    const stored = localStorage.getItem('protoimsg:grantedScopes');
    if (!stored) return [];
    try {
      return JSON.parse(stored) as string[];
    } catch {
      return [];
    }
  });

  const isLoading = useMemo(() => authPhase !== 'ready' && authPhase !== 'idle', [authPhase]);

  const clearAuth = useCallback(() => {
    setSession(null);
    setAgent(null);
    setDid(null);
    setHandle(null);
    setServerTokenState(null);
    setServerToken(null);
    setAuthError(null);
    setAuthPhase('idle');
    setGrantedScopes([]);
    localStorage.removeItem('protoimsg:grantedScopes');
  }, []);

  // Guard against StrictMode double-mount: OAuth callback processing consumes
  // URL params on the first call, so a second init() would see no callback and
  // return null → brief flash of /login before the first call's session arrives.
  const initCalled = useRef(false);

  useEffect(() => {
    if (initCalled.current) return;
    initCalled.current = true;

    // Force re-login when OAuth scopes change. Bump AUTH_VERSION in oauth.ts
    // to invalidate all existing sessions. Only check when a session exists —
    // otherwise we'd intercept the OAuth callback redirect on first login.
    const hasExistingSession = !!localStorage.getItem('protoimsg:did');
    const storedVersion = Number(localStorage.getItem('protoimsg:authVersion') ?? '1');
    if (hasExistingSession && storedVersion !== AUTH_VERSION) {
      console.info('[Auth] auth version mismatch, clearing session for re-login');
      localStorage.removeItem('protoimsg:did');
      localStorage.removeItem('protoimsg:handle');
      localStorage.removeItem('protoimsg:grantedScopes');
      localStorage.setItem('protoimsg:authVersion', String(AUTH_VERSION));
      clearAuth();
      // Clear IndexedDB OAuth session so init() returns null
      const oauthClient = getOAuthClient();
      void oauthClient
        .init()
        .then((result) => {
          if (result) void oauthClient.revoke(result.session.did);
        })
        .catch((err: unknown) =>
          Sentry.captureException(err, {
            tags: { component: 'AuthContext', action: 'revoke_stale_session' },
          }),
        )
        .finally(() => {
          setAuthPhase('idle');
        });
      return;
    }

    // Tauri child windows: restore auth from localStorage immediately (covers
    // DM/room windows that only need server token), then try OAuth in the
    // background to obtain the ATProto Agent (needed for feed/compose).
    if (IS_TAURI) {
      void import('../lib/tauri-windows').then(({ isMainWindow }) => {
        if (!isMainWindow()) {
          const storedToken = getServerToken();
          const storedDid = localStorage.getItem('protoimsg:did');
          const storedHandle = localStorage.getItem('protoimsg:handle');
          if (storedToken && storedDid) {
            setServerTokenState(storedToken);
            setDid(storedDid);
            setHandle(storedHandle ?? storedDid);
            setAuthPhase('ready');
          } else {
            setAuthPhase('idle');
          }

          // Also try to restore OAuth session for the Agent.
          // The main window has already authorized Keychain access, so
          // this should succeed silently. If it fails, agent stays null
          // (feed won't load, but DM/rooms still work fine).
          tryRestoreAgent();
        } else {
          initOAuth();
        }
      });
      return;
    }

    initOAuth();

    // Lightweight Agent-only restore for Tauri child windows.
    // Skips server session creation (already have server token from localStorage).
    function tryRestoreAgent() {
      try {
        const oauthClient = getOAuthClient();
        oauthClient
          .init()
          .then((result) => {
            if (result) {
              const newAgent = new Agent(result.session);
              setAgent(newAgent);
            }
          })
          .catch(() => {
            // Silently fail — agent stays null, feed won't load but DMs work
          });
      } catch {
        // getOAuthClient itself might fail in some Tauri contexts
      }
    }

    function initOAuth() {
      const oauthClient = getOAuthClient();

      oauthClient
        .init()
        .then(async (result) => {
          if (result) {
            sessionStorage.removeItem('protoimsg:oauth_pending');
            const { session: restoredSession } = result;
            setAuthPhase('authenticating');

            // Verify the PDS granted the scopes we need. Some PDS implementations
            // may grant fewer scopes than requested — if `atproto` is missing we
            // can't write records at all (messages, rooms, auth proof), so bail
            // early with a clear error instead of failing on every createRecord.
            const tokenInfo = await restoredSession.getTokenInfo();
            const granted = tokenInfo.scope.split(' ');
            setGrantedScopes(granted);
            localStorage.setItem('protoimsg:grantedScopes', JSON.stringify(granted));
            localStorage.setItem('protoimsg:authVersion', String(AUTH_VERSION));
            const missingScopes = REQUIRED_SCOPES.filter((s) => !granted.includes(s));
            if (missingScopes.length > 0) {
              console.error('OAuth scopes missing:', missingScopes.join(', '));
              const oauthClient = getOAuthClient();
              void oauthClient.revoke(restoredSession.did);
              setAuthError(
                `Your PDS did not grant the required permissions: ${missingScopes.join(', ')}. ` +
                  'proto instant messenger needs write access to function. ' +
                  'Please contact your PDS administrator or try a different account.',
              );
              setAuthPhase('idle');
              return;
            }

            setSession(restoredSession);
            const newAgent = new Agent(restoredSession);
            setAgent(newAgent);
            setDid(restoredSession.did);

            // Persist DID/handle for Tauri child windows
            localStorage.setItem('protoimsg:did', restoredSession.did);

            // Resolve handle + fetch challenge in parallel (both only need DID)
            try {
              setAuthPhase('resolving');
              const [profile, { nonce }] = await Promise.all([
                publicAgent.getProfile({ actor: restoredSession.did }),
                fetchChallenge(restoredSession.did),
              ]);
              const resolvedHandle = profile.data.handle;
              setHandle(resolvedHandle);
              localStorage.setItem('protoimsg:handle', resolvedHandle);

              setAuthPhase('connecting');

              // Write nonce to ATProto repo — proves we have OAuth write access
              const authResult = await newAgent.com.atproto.repo.createRecord({
                repo: restoredSession.did,
                collection: 'app.protoimsg.chat.authVerify',
                record: {
                  $type: 'app.protoimsg.chat.authVerify',
                  nonce,
                  createdAt: new Date().toISOString(),
                },
              });
              const rkey = authResult.data.uri.split('/').pop();
              if (!rkey) throw new Error('Invalid AT-URI from createRecord');

              try {
                const serverSession = await createServerSession(
                  restoredSession.did,
                  resolvedHandle,
                  nonce,
                  rkey,
                );
                setServerToken(serverSession.token);
                setServerTokenState(serverSession.token);
                setAuthPhase('ready');
              } finally {
                // Clean up the verification record regardless of outcome
                void newAgent.com.atproto.repo.deleteRecord({
                  repo: restoredSession.did,
                  collection: 'app.protoimsg.chat.authVerify',
                  rkey,
                });
              }
            } catch (err: unknown) {
              if (err instanceof AccountBannedError || err instanceof NotOnAllowlistError) {
                // Account is banned or not on allowlist — revoke OAuth so it doesn't auto-restore
                const oauthClient = getOAuthClient();
                void oauthClient.revoke(restoredSession.did);
                setAuthError(err.message);
                setAuthPhase('idle');
                return;
              }
              console.error('Failed to create server session:', err);
              setHandle(restoredSession.did);
              setAuthError('Failed to connect to server. Please try again.');
              setAuthPhase('ready');
            }
          } else {
            sessionStorage.removeItem('protoimsg:oauth_pending');
            setAuthPhase('idle');
          }
        })
        .catch((err: unknown) => {
          console.error('OAuth init failed:', err);
          setAuthPhase('idle');
        });

      // Sync logout across tabs — fires when session is revoked anywhere
      const onDeleted = () => {
        void deleteServerSession();
        clearAuth();
      };
      oauthClient.addEventListener('deleted', onDeleted);
    }
  }, [clearAuth]);

  const login = useCallback(async (inputHandle: string, turnstileToken?: string) => {
    setAuthError(null);

    // Pre-OAuth ban + captcha check — throws on ban, allowlist, or captcha failure.
    // Let it propagate so the caller (LoginForm) can show the proper screen.
    // Non-ban errors (network, etc.) are swallowed — let OAuth proceed normally.
    try {
      await preflightCheck(inputHandle, turnstileToken);
    } catch (err: unknown) {
      if (
        err instanceof AccountBannedError ||
        err instanceof NotOnAllowlistError ||
        err instanceof CaptchaFailedError
      )
        throw err;
    }

    // Flag that an OAuth redirect is in progress — checked on return to
    // decide whether to show the full ConnectingScreen or a quick restore.
    sessionStorage.setItem('protoimsg:oauth_pending', '1');
    const oauthClient = getOAuthClient();
    await oauthClient.signIn(inputHandle, {
      scope: OAUTH_SCOPE,
    });
    // This redirects to PDS — execution won't continue here.
    // On return, init() in the useEffect above catches the callback.
  }, []);

  const logout = useCallback(() => {
    const sub = did;
    void deleteServerSession();
    localStorage.removeItem('protoimsg:did');
    localStorage.removeItem('protoimsg:handle');
    localStorage.removeItem('protoimsg:grantedScopes');
    localStorage.removeItem('protoimsg:authVersion');
    clearAuth();
    if (sub) {
      const oauthClient = getOAuthClient();
      void oauthClient.revoke(sub);
    }
  }, [did, clearAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      agent,
      did,
      handle,
      serverToken,
      isLoading,
      authPhase,
      authError,
      grantedScopes,
      login,
      logout,
    }),
    [
      session,
      agent,
      did,
      handle,
      serverToken,
      isLoading,
      authPhase,
      authError,
      grantedScopes,
      login,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
