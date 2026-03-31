import type { FrontendI18n, LanguageCode } from './i18n-types.js';
import { buildExtraI18nGroupA } from './i18n-locales-extra-a.js';
import { buildExtraI18nGroupB } from './i18n-locales-extra-b.js';
import { buildExtraI18nGroupC } from './i18n-locales-extra-c.js';
import { buildExtraI18nGroupD } from './i18n-locales-extra-d.js';
import { buildExtraI18nGroupE } from './i18n-locales-extra-e.js';
import { buildExtraI18nGroupF } from './i18n-locales-extra-f.js';
import { buildExtraI18nGroupG } from './i18n-locales-extra-g.js';

export function buildExtraI18n(
  languageNames: Record<LanguageCode, string>
): Partial<Record<LanguageCode, FrontendI18n>> {
  return {
    ...buildExtraI18nGroupA(languageNames),
    ...buildExtraI18nGroupB(languageNames),
    ...buildExtraI18nGroupC(languageNames),
    ...buildExtraI18nGroupD(languageNames),
    ...buildExtraI18nGroupE(languageNames),
    ...buildExtraI18nGroupF(languageNames),
    ...buildExtraI18nGroupG(languageNames)
  };
}
