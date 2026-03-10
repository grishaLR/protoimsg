import { useRef, useState, useEffect, useCallback } from 'react';
import { TURNSTILE_SITE_KEY } from '../lib/config';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback': () => void;
          'error-callback': () => void;
          theme?: 'light' | 'dark' | 'auto';
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_ID = 'cf-turnstile-script';

export interface UseTurnstileResult {
  /** Ref to attach to the container element */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Whether a valid token is available */
  ready: boolean;
  /** Whether Turnstile is enabled (site key configured) */
  enabled: boolean;
  /** Get the current token (null if not ready) */
  getToken: () => string | null;
  /** Reset the widget (e.g. after a failed attempt) */
  reset: () => void;
}

export function useTurnstile(): UseTurnstileResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !containerRef.current) return;

    const container = containerRef.current;
    const siteKey = TURNSTILE_SITE_KEY;
    let cancelled = false;

    function renderWidget() {
      if (cancelled || !window.turnstile) return;
      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: siteKey,
        callback: (token: string) => {
          tokenRef.current = token;
          setReady(true);
        },
        'expired-callback': () => {
          tokenRef.current = null;
          setReady(false);
        },
        'error-callback': () => {
          tokenRef.current = null;
          setReady(false);
        },
        theme: 'auto',
      });
    }

    if (window.turnstile) {
      renderWidget();
    } else if (!document.getElementById(TURNSTILE_SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = renderWidget;
      document.head.appendChild(script);
    } else {
      // Script is loading but not ready yet — poll for it
      const interval = setInterval(() => {
        if (window.turnstile) {
          clearInterval(interval);
          renderWidget();
        }
      }, 100);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  const reset = useCallback(() => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      tokenRef.current = null;
      setReady(false);
    }
  }, []);

  const getToken = useCallback(() => tokenRef.current, []);

  return {
    containerRef,
    ready,
    enabled: !!TURNSTILE_SITE_KEY,
    getToken,
    reset,
  };
}
