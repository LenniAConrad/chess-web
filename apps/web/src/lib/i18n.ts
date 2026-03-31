import { LANGUAGE_CODES, LANGUAGE_NAME_PARTS, LANGUAGE_NAMES } from './i18n-language-meta.js';
import { I18N_SUPPLEMENTS } from './i18n-supplements.js';
import { buildCoreI18n } from './i18n-locales-core.js';
import { buildSupplementalI18n } from './i18n-locales-supplemental.js';
import type { FrontendI18n, LanguageCode } from './i18n-types.js';
import { buildExtraI18n } from './i18n-extra.js';

export type { FrontendI18n, LanguageCode, PromotionPieceCode } from './i18n-types.js';

const rawI18n: Partial<Record<LanguageCode, FrontendI18n>> = {
  ...buildCoreI18n(LANGUAGE_NAMES),
  ...buildExtraI18n(LANGUAGE_NAMES),
  ...buildSupplementalI18n(LANGUAGE_NAMES)
};

const I18N: Partial<Record<LanguageCode, FrontendI18n>> = Object.fromEntries(
  Object.entries(rawI18n).map(([code, locale]) => {
    const language = code as LanguageCode;
    return [language, { ...I18N_SUPPLEMENTS[language], ...locale }];
  })
) as Partial<Record<LanguageCode, FrontendI18n>>;

const ENGLISH_I18N = I18N.en as FrontendI18n;

export const LANGUAGE_OPTIONS: Array<{
  code: LanguageCode;
  label: string;
  englishLabel: string;
  nativeLabel: string;
}> = LANGUAGE_CODES.map((code) => ({
  code,
  label: LANGUAGE_NAMES[code],
  englishLabel: LANGUAGE_NAME_PARTS[code].english,
  nativeLabel: LANGUAGE_NAME_PARTS[code].native
})).sort((left, right) => left.englishLabel.localeCompare(right.englishLabel, 'en'));

export function getI18n(language: LanguageCode): FrontendI18n {
  return I18N[language] ?? ENGLISH_I18N;
}
