/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-redundant-type-constituents */
// ^ @atproto/oauth-client-expo has incomplete type declarations — suppress unsafe rules file-wide.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Agent } from '@atproto/api';
import { ExpoOAuthClient } from '@atproto/oauth-client-expo';
import type { OAuthSession } from '@atproto/oauth-client-expo';
import { OAUTH_SCOPE } from '@protoimsg/shared';
import { OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI } from './config';
import {
  AccountBannedError,
  NotOnAllowlistError,
  preflightCheck,
  fetchChallenge,
  createServerSession,
  deleteServerSession,
  setServerToken,
  setSessionExpiredHandler,
} from './api';
import {
  getStoredDid,
  setStoredDid,
  getStoredHandle,
  setStoredHandle,
  clearAllAuth,
} from './storage';
import { registerForPushNotifications, unregisterPushNotifications } from './notifications';

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

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

let oauthClient: ExpoOAuthClient | null = null;

function getOAuthClient(): ExpoOAuthClient {
  if (oauthClient) return oauthClient;

  oauthClient = new ExpoOAuthClient({
    clientMetadata: {
      client_id: OAUTH_CLIENT_ID,
      redirect_uris: [OAUTH_REDIRECT_URI],
      application_type: 'native',
      dpop_bound_access_tokens: true,
      scope: OAUTH_SCOPE,
      token_endpoint_auth_method: 'none',
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
    },
    handleResolver: 'https://public.api.bsky.app',
  });

  return oauthClient;
}

/**
 * Complete server-side authentication after OAuth.
 * Resolves handle, writes challenge proof record, creates server session.
 */
async function completeServerAuth(
  oauthSession: OAuthSession,
  newAgent: Agent,
): Promise<{ handle: string; token: string }> {
  const profile = await newAgent.getProfile({ actor: oauthSession.did });
  const resolvedHandle = profile.data.handle;

  const { nonce } = await fetchChallenge(oauthSession.did);

  const authResult = await newAgent.com.atproto.repo.createRecord({
    repo: oauthSession.did,
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
    const serverSession = await createServerSession(oauthSession.did, resolvedHandle, nonce, rkey);
    return { handle: resolvedHandle, token: serverSession.token };
  } finally {
    void newAgent.com.atproto.repo.deleteRecord({
      repo: oauthSession.did,
      collection: 'app.protoimsg.chat.authVerify',
      rkey,
    });
  }
}

/**
 * Finalize an OAuth session: set state, resolve handle, create server session.
 */
async function finalizeSession(
  oauthSession: OAuthSession,
  setters: {
    setSession: (s: OAuthSession) => void;
    setAgent: (a: Agent) => void;
    setDid: (d: string) => void;
    setHandle: (h: string) => void;
    setServerTokenState: (t: string) => void;
    setAuthPhase: (p: AuthPhase) => void;
    setAuthError: (e: string | null) => void;
    clearAuth: () => void;
  },
): Promise<void> {
  const {
    setSession,
    setAgent,
    setDid,
    setHandle,
    setServerTokenState,
    setAuthPhase,
    setAuthError,
    clearAuth,
  } = setters;

  setAuthPhase('authenticating');
  const newAgent = new Agent(oauthSession);
  setSession(oauthSession);
  setAgent(newAgent);
  setDid(oauthSession.did);
  setStoredDid(oauthSession.did);

  try {
    setAuthPhase('resolving');
    const { handle: resolvedHandle, token } = await completeServerAuth(oauthSession, newAgent);
    setHandle(resolvedHandle);
    setStoredHandle(resolvedHandle);
    setServerToken(token);
    setServerTokenState(token);
    setAuthPhase('ready');
    // Register push token after successful server auth
    void registerForPushNotifications();
  } catch (err: unknown) {
    if (err instanceof AccountBannedError || err instanceof NotOnAllowlistError) {
      const client = getOAuthClient();
      void client.revoke(oauthSession.did);
      setAuthError((err as Error).message);
      clearAuth();
      return;
    }
    setHandle(getStoredHandle() ?? oauthSession.did);
    setAuthError('Failed to connect to server. Please try again.');
    setAuthPhase('idle');
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<OAuthSession | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [did, setDid] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [serverTokenState, setServerTokenState] = useState<string | null>(null);
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
    clearAllAuth();
  }, []);

  // Wire session-expired handler so 401 responses trigger logout
  useEffect(() => {
    setSessionExpiredHandler(() => {
      clearAuth();
    });
    return () => {
      setSessionExpiredHandler(null);
    };
  }, [clearAuth]);

  const setters = useMemo(
    () => ({
      setSession,
      setAgent,
      setDid,
      setHandle,
      setServerTokenState,
      setAuthPhase,
      setAuthError,
      clearAuth,
    }),
    [clearAuth],
  );

  const initCalled = useRef(false);

  // Restore previous session on mount
  useEffect(() => {
    if (initCalled.current) return;
    initCalled.current = true;

    let client: ExpoOAuthClient;
    try {
      client = getOAuthClient();
    } catch (err) {
      console.warn('[Auth] Failed to create OAuth client:', err);
      setAuthPhase('idle');
      return;
    }

    const storedDid = getStoredDid();
    if (!storedDid) {
      // Check if the app was opened via a callback deep link (cold start)
      client
        .handleCallback()
        .then((callbackSession: OAuthSession | null) => {
          if (callbackSession) {
            void finalizeSession(callbackSession, setters);
          } else {
            setAuthPhase('idle');
          }
        })
        .catch((err: unknown) => {
          console.warn('[Auth] handleCallback failed:', err);
          setAuthPhase('idle');
        });
      return;
    }

    // Restore existing session
    client
      .restore(storedDid)
      .then((restoredSession: OAuthSession) => {
        void finalizeSession(restoredSession, setters);
      })
      .catch((err: unknown) => {
        console.warn('[Auth] restore failed:', err);
        clearAllAuth();
        setAuthPhase('idle');
      });
  }, [setters]);

  const login = useCallback(
    async (inputHandle: string) => {
      setAuthError(null);

      try {
        await preflightCheck(inputHandle);
      } catch (err: unknown) {
        if (err instanceof AccountBannedError || err instanceof NotOnAllowlistError) throw err;
      }

      const client = getOAuthClient();

      // ExpoOAuthClient.signIn opens the system browser and awaits the full
      // round trip — it returns the OAuthSession directly (unlike web where
      // signIn redirects and init() catches the callback on return).
      console.info('[Auth] starting OAuth sign-in for', inputHandle);
      const oauthSession = await client.signIn(inputHandle, {
        scope: OAUTH_SCOPE,
      });
      console.info('[Auth] OAuth sign-in complete, DID:', oauthSession.did);

      await finalizeSession(oauthSession, setters);
    },
    [setters],
  );

  const logout = useCallback(() => {
    const sub = did;
    void unregisterPushNotifications();
    void deleteServerSession();
    clearAuth();
    if (sub) {
      const client = getOAuthClient();
      void client.revoke(sub);
    }
  }, [did, clearAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      agent,
      did,
      handle,
      serverToken: serverTokenState,
      isLoading,
      authPhase,
      authError,
      login,
      logout,
    }),
    [session, agent, did, handle, serverTokenState, isLoading, authPhase, authError, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
