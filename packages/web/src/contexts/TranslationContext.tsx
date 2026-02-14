import { createContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { translateTexts, fetchTranslateStatus } from '../lib/api';

const AUTO_TRANSLATE_KEY = 'protoimsg:autoTranslate';

export interface TranslationContextValue {
  autoTranslate: boolean;
  setAutoTranslate: (value: boolean) => void;
  available: boolean;
  targetLang: string;
  getTranslation: (text: string) => string | undefined;
  isTranslating: (text: string) => boolean;
  requestTranslation: (text: string) => void;
  requestBatchTranslation: (texts: string[]) => void;
}

export const TranslationContext = createContext<TranslationContextValue | null>(null);

export function TranslationProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const targetLang = i18n.language.split('-')[0] ?? 'en';

  const [autoTranslate, setAutoTranslateState] = useState(
    () => localStorage.getItem(AUTO_TRANSLATE_KEY) === 'true',
  );
  const [available, setAvailable] = useState(false);

  const cacheRef = useRef(new Map<string, string>());
  const loadingSetRef = useRef(new Set<string>());
  const [cacheVersion, forceUpdate] = useState(0);
  const prevLangRef = useRef(targetLang);

  // Check availability on mount
  useEffect(() => {
    void fetchTranslateStatus().then((status) => {
      setAvailable(status.available);
    });
  }, []);

  // Clear cache when language changes
  useEffect(() => {
    if (prevLangRef.current !== targetLang) {
      cacheRef.current.clear();
      loadingSetRef.current.clear();
      prevLangRef.current = targetLang;
      forceUpdate((n) => n + 1);
    }
  }, [targetLang]);

  const setAutoTranslate = useCallback((value: boolean) => {
    setAutoTranslateState(value);
    if (value) {
      localStorage.setItem(AUTO_TRANSLATE_KEY, 'true');
    } else {
      localStorage.removeItem(AUTO_TRANSLATE_KEY);
    }
  }, []);

  const getTranslation = useCallback((text: string): string | undefined => {
    return cacheRef.current.get(text);
  }, []);

  const isTranslating = useCallback((text: string): boolean => {
    return loadingSetRef.current.has(text);
  }, []);

  const requestTranslation = useCallback(
    (text: string) => {
      if (!text.trim() || !available) return;
      if (cacheRef.current.has(text) || loadingSetRef.current.has(text)) return;

      loadingSetRef.current.add(text);
      forceUpdate((n) => n + 1);

      void translateTexts([text], targetLang).then((response) => {
        loadingSetRef.current.delete(text);
        for (const item of response.translations) {
          cacheRef.current.set(item.text, item.translated);
        }
        forceUpdate((n) => n + 1);
      });
    },
    [targetLang, available],
  );

  const requestBatchTranslation = useCallback(
    (texts: string[]) => {
      if (!available) return;

      const toTranslate = texts.filter(
        (t) => t.trim().length > 0 && !cacheRef.current.has(t) && !loadingSetRef.current.has(t),
      );
      if (toTranslate.length === 0) return;

      for (const text of toTranslate) {
        loadingSetRef.current.add(text);
      }
      forceUpdate((n) => n + 1);

      void translateTexts(toTranslate, targetLang).then((response) => {
        for (const text of toTranslate) {
          loadingSetRef.current.delete(text);
        }
        for (const item of response.translations) {
          cacheRef.current.set(item.text, item.translated);
        }
        forceUpdate((n) => n + 1);
      });
    },
    [targetLang, available],
  );

  const value = useMemo<TranslationContextValue>(
    () => ({
      autoTranslate,
      setAutoTranslate,
      available,
      targetLang,
      getTranslation,
      isTranslating,
      requestTranslation,
      requestBatchTranslation,
    }),
    [
      autoTranslate,
      setAutoTranslate,
      available,
      targetLang,
      getTranslation,
      isTranslating,
      requestTranslation,
      requestBatchTranslation,
      cacheVersion,
    ],
  );

  return <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>;
}
