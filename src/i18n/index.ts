// §14 step 10: i18next setup. No backend/HTTP loader — this is a small static site, so every
// locale's strings are just bundled resources; no i18next-browser-languagedetector dependency
// either, a plain navigator.language check covers v1's "detect once at startup" need without
// pulling in a package for it.
import i18next from 'i18next';
import en from './locales/en.ts';
import pt from './locales/pt.ts';

export const SUPPORTED_LANGUAGES = ['en', 'pt'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const LANG_STORAGE_KEY = 'crapette-lang';

function isSupported(lang: string): lang is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang);
}

function detectLanguage(): SupportedLanguage {
  // A manually-chosen language (see setLanguage) always wins over browser detection, once one
  // exists — otherwise switching languages wouldn't survive a reload.
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && isSupported(stored)) return stored;
  } catch {
    // localStorage can throw (private browsing quota, disabled storage) — fall through to
    // browser detection rather than failing startup over a persistence nicety.
  }
  const preferred = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en';
  return isSupported(preferred) ? preferred : 'en';
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

// scene.ts's footer language toggle calls this — persists the choice (so it survives a
// reload instead of falling back to browser detection every time) and switches i18next's
// active language; the caller is responsible for refreshing whatever text is already on
// screen afterward (i18next doesn't retroactively update Pixi Text objects on its own).
export async function setLanguage(lang: SupportedLanguage): Promise<void> {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // see detectLanguage
  }
  await i18next.changeLanguage(lang);
}

export { i18next };
