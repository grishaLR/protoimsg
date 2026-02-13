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
import { getOAuthClient } from '../lib/oauth';
import {
  AccountBannedError,
  preflightCheck,
  fetchChallenge,
  createServerSession,
  deleteServerSession,
  setServerToken,
  getServerToken,
} from '../lib/api';
import { IS_TAURI } from '../lib/config';

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
  login: (handle: string) => Promise<void>;
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
  }, []);

  // Guard against StrictMode double-mount: OAuth callback processing consumes
  // URL params on the first call, so a second init() would see no callback and
  // return null → brief flash of /login before the first call's session arrives.
  const initCalled = useRef(false);

  useEffect(() => {
    if (initCalled.current) return;
    initCalled.current = true;

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
            setSession(restoredSession);
            const newAgent = new Agent(restoredSession);
            setAgent(newAgent);
            setDid(restoredSession.did);

            // Persist DID/handle for Tauri child windows
            localStorage.setItem('protoimsg:did', restoredSession.did);

            // Resolve real handle via profile
            try {
              setAuthPhase('resolving');
              const profile = await newAgent.getProfile({ actor: restoredSession.did });
              const resolvedHandle = profile.data.handle;
              setHandle(resolvedHandle);
              localStorage.setItem('protoimsg:handle', resolvedHandle);

              // Create server session via challenge-response proof
              setAuthPhase('connecting');
              const { nonce } = await fetchChallenge(restoredSession.did);

              // Write nonce to ATProto repo — proves we have OAuth write access
              const authResult = await newAgent.com.atproto.repo.createRecord({
                repo: restoredSession.did,
                collection: 'app.protoimsg.chat.authVerify',
                record: { nonce, createdAt: new Date().toISOString() },
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
              if (err instanceof AccountBannedError) {
                // Account is globally banned — revoke OAuth so it doesn't auto-restore
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

  const login = useCallback(async (inputHandle: string) => {
    setAuthError(null);

    // Pre-OAuth ban check — throws AccountBannedError if banned.
    // Let it propagate so the caller (LoginForm) can show a proper banned screen.
    // Non-ban errors (network, etc.) are swallowed — let OAuth proceed normally.
    try {
      await preflightCheck(inputHandle);
    } catch (err: unknown) {
      if (err instanceof AccountBannedError) throw err;
    }

    // Flag that an OAuth redirect is in progress — checked on return to
    // decide whether to show the full ConnectingScreen or a quick restore.
    sessionStorage.setItem('protoimsg:oauth_pending', '1');
    const oauthClient = getOAuthClient();
    await oauthClient.signIn(inputHandle, {
      scope: 'atproto transition:generic',
    });
    // This redirects to PDS — execution won't continue here.
    // On return, init() in the useEffect above catches the callback.
  }, []);

  const logout = useCallback(() => {
    const sub = did;
    void deleteServerSession();
    localStorage.removeItem('protoimsg:did');
    localStorage.removeItem('protoimsg:handle');
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
      login,
      logout,
    }),
    [session, agent, did, handle, serverToken, isLoading, authPhase, authError, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
