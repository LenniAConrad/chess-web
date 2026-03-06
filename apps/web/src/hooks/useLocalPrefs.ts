import { useEffect, useState } from 'react';
import type { VariationMode } from '../types/api.js';

const STORAGE_KEY = 'chess-web-prefs';

export interface UserPreferences {
  autoNext: boolean;
  variationMode: VariationMode;
  hintsEnabled: boolean;
  autoQueenPromotion: boolean;
}

const DEFAULT_PREFS: UserPreferences = {
  autoNext: true,
  variationMode: 'explore',
  hintsEnabled: true,
  autoQueenPromotion: true
};

export function useLocalPrefs() {
  const [prefs, setPrefs] = useState<UserPreferences>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_PREFS;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<UserPreferences>;
      return {
        autoNext: parsed.autoNext ?? DEFAULT_PREFS.autoNext,
        variationMode: parsed.variationMode ?? DEFAULT_PREFS.variationMode,
        hintsEnabled: parsed.hintsEnabled ?? DEFAULT_PREFS.hintsEnabled,
        autoQueenPromotion: parsed.autoQueenPromotion ?? DEFAULT_PREFS.autoQueenPromotion
      };
    } catch {
      return DEFAULT_PREFS;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }, [prefs]);

  return {
    prefs,
    setPrefs
  };
}
