// §14 step 10: i18next setup. No backend/HTTP loader — this is a small static site, so every
// locale's strings are just bundled resources; no i18next-browser-languagedetector dependency
// either, a plain navigator.language check covers v1's "detect once at startup" need without
// pulling in a package for it.
import i18next from 'i18next';
import en from './locales/en.ts';
import pt from './locales/pt.ts';

export const SUPPORTED_LANGUAGES = ['en', 'pt'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function detectLanguage(): SupportedLanguage {
  const preferred = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(preferred) ? (preferred as SupportedLanguage) : 'en';
}

export async function initI18n(): Promise<void> {
  await i18next.init({
    lng: detectLanguage(),
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      pt: { translation: pt },
    },
    interpolation: { escapeValue: false },
  });
}

export { i18next };
