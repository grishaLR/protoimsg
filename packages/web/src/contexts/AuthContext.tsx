import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Agent } from '@atproto/api';
import type { OAuthSession } from '@atproto/oauth-client-browser';
import { getOAuthClient } from '../lib/oauth';

export interface AuthContextValue {
  session: OAuthSession | null;
  agent: Agent | null;
  did: string | null;
  handle: string | null;
  isLoading: boolean;
  login: (handle: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<OAuthSession | null>(null);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [did, setDid] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const oauthClient = getOAuthClient();

    oauthClient
      .init()
      .then((result) => {
        if (result) {
          const { session: restoredSession } = result;
          setSession(restoredSession);
          const newAgent = new Agent(restoredSession);
          setAgent(newAgent);
          setDid(restoredSession.did);
          setHandle(restoredSession.did);
        }
      })
      .catch((err: unknown) => {
        console.error('OAuth init failed:', err);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const login = useCallback(async (inputHandle: string) => {
    const oauthClient = getOAuthClient();
    await oauthClient.signIn(inputHandle, {
      scope: 'atproto transition:generic',
    });
    // This redirects to PDS — execution won't continue here.
    // On return, init() in the useEffect above catches the callback.
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    setAgent(null);
    setDid(null);
    setHandle(null);
  }, []);

  return (
    <AuthContext.Provider value={{ session, agent, did, handle, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
