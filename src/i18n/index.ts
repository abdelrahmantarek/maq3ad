import type { Lang } from '../config/venue';
import { ar } from './ar';
import { en } from './en';

export type MessageKey = keyof typeof ar;

const dictionaries: Record<Lang, typeof ar> = { ar, en };
const STORAGE_KEY = 'maq3ad.lang';

let current: Lang = 'ar';

export function initialLang(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'ar' || saved === 'en') return saved;
  } catch {
    // Storage unavailable: fall through to the browser preference.
  }
  return navigator.language.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

export function setLang(lang: Lang): void {
  current = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Preference simply won't persist.
  }
}

export function getLang(): Lang {
  return current;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  let text = dictionaries[current][key];
  if (params) {
    for (const [name, value] of Object.entries(params)) text = text.replace(`{${name}}`, String(value));
  }
  return text;
}

const locale = () => (current === 'ar' ? 'ar-EG' : 'en-GB');

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(locale(), { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(locale()).format(n);
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso));
}
