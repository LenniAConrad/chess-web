import { useEffect, useState } from 'react';
import type { VariationMode } from '../types/api.js';

const STORAGE_KEY = 'chess-web-prefs';

export interface UserPreferences {
  autoNext: boolean;
  variationMode: VariationMode;
  hintsEnabled: boolean;
  autoQueenPromotion: boolean;
  darkMode: boolean;
  zenMode: boolean;
  captureRain: boolean;
  boardGlass: boolean;
  autoPlay: boolean;
  animations: boolean;
  soundEnabled: boolean;
  showEngineEval: boolean;
}

const DEFAULT_PREFS: UserPreferences = {
  autoNext: true,
  variationMode: 'explore',
  hintsEnabled: true,
  autoQueenPromotion: true,
  darkMode: false,
  zenMode: false,
  captureRain: true,
  boardGlass: true,
  autoPlay: false,
  animations: true,
  soundEnabled: true,
  showEngineEval: true
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
        autoQueenPromotion: parsed.autoQueenPromotion ?? DEFAULT_PREFS.autoQueenPromotion,
        darkMode: parsed.darkMode ?? DEFAULT_PREFS.darkMode,
        zenMode: parsed.zenMode ?? DEFAULT_PREFS.zenMode,
        captureRain: parsed.captureRain ?? DEFAULT_PREFS.captureRain,
        boardGlass: parsed.boardGlass ?? DEFAULT_PREFS.boardGlass,
        autoPlay: parsed.autoPlay ?? DEFAULT_PREFS.autoPlay,
        animations: parsed.animations ?? DEFAULT_PREFS.animations,
        soundEnabled: parsed.soundEnabled ?? DEFAULT_PREFS.soundEnabled,
        showEngineEval: parsed.showEngineEval ?? DEFAULT_PREFS.showEngineEval
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
