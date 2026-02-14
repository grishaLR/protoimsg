import { useContext } from 'react';
import { TranslationContext, type TranslationContextValue } from '../contexts/TranslationContext';

export function useContentTranslation(): TranslationContextValue {
  const ctx = useContext(TranslationContext);
  if (!ctx) {
    throw new Error('useContentTranslation must be used within a TranslationProvider');
  }
  return ctx;
}
