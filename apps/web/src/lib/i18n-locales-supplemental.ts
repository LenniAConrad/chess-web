import type { FrontendI18n, LanguageCode } from './i18n-types.js';
import { buildSupplementalI18nGroupA } from './i18n-locales-supplemental-a.js';
import { buildSupplementalI18nGroupB } from './i18n-locales-supplemental-b.js';

export function buildSupplementalI18n(
  languageNames: Record<LanguageCode, string>
): Partial<Record<LanguageCode, FrontendI18n>> {
  return {
    ...buildSupplementalI18nGroupA(languageNames),
    ...buildSupplementalI18nGroupB(languageNames)
  };
}
