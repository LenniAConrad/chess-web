import { useEffect, useState } from 'react';
import type { LanguageCode } from '../lib/i18n.js';
import type { VariationMode } from '../types/api.js';

const STORAGE_KEY = 'chess-web-prefs';

export interface UserPreferences {
  language: LanguageCode;
  backgroundHue: number;
  boardHue: number;
  autoNext: boolean;
  oneTryMode: boolean;
  variationMode: VariationMode;
  skipSimilarVariations: boolean;
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
  language: 'en',
  backgroundHue: 0,
  boardHue: 0,
  autoNext: false,
  oneTryMode: false,
  variationMode: 'explore',
  skipSimilarVariations: true,
  hintsEnabled: true,
  autoQueenPromotion: false,
  darkMode: false,
  zenMode: false,
  captureRain: true,
  boardGlass: false,
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
        language: parsed.language ?? DEFAULT_PREFS.language,
        backgroundHue: typeof parsed.backgroundHue === 'number' ? parsed.backgroundHue : DEFAULT_PREFS.backgroundHue,
        boardHue: typeof parsed.boardHue === 'number' ? parsed.boardHue : DEFAULT_PREFS.boardHue,
        autoNext: parsed.autoNext ?? DEFAULT_PREFS.autoNext,
        oneTryMode: parsed.oneTryMode ?? DEFAULT_PREFS.oneTryMode,
        variationMode: parsed.variationMode ?? DEFAULT_PREFS.variationMode,
        skipSimilarVariations: parsed.skipSimilarVariations ?? DEFAULT_PREFS.skipSimilarVariations,
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
