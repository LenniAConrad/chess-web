import type { FrontendI18n, LanguageCode } from './i18n-types.js';
import { buildCoreI18nGroupA } from './i18n-locales-core-a.js';
import { buildCoreI18nGroupB } from './i18n-locales-core-b.js';

export function buildCoreI18n(
  languageNames: Record<LanguageCode, string>
): Partial<Record<LanguageCode, FrontendI18n>> {
  return {
    ...buildCoreI18nGroupA(languageNames),
    ...buildCoreI18nGroupB(languageNames)
  };
}
