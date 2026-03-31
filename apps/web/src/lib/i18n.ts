import { LANGUAGE_CODES, LANGUAGE_NAME_PARTS, LANGUAGE_NAMES } from './i18n-language-meta.js';
import { buildCoreI18n } from './i18n-locales-core.js';
import { buildSupplementalI18n } from './i18n-locales-supplemental.js';
import type { FrontendI18n, LanguageCode } from './i18n-types.js';
import { buildExtraI18n } from './i18n-extra.js';

export type { FrontendI18n, LanguageCode, PromotionPieceCode } from './i18n-types.js';

const I18N: Partial<Record<LanguageCode, FrontendI18n>> = {
  ...buildCoreI18n(LANGUAGE_NAMES),
  ...buildExtraI18n(LANGUAGE_NAMES),
  ...buildSupplementalI18n(LANGUAGE_NAMES)
};

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
