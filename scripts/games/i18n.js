// i18n.js — English / Japanese interface for the word games (Kana Crossword,
// Kana Wordle). One choice covers both games and stays in this browser.
//
// Static text in the page: data-t="key" sets textContent, data-t-aria="key"
// sets aria-label, and blocks with rich markup are written twice with
// data-ui-only="en" / "ja" (the game's CSS hides the other one). An inline
// script in <head> sets html[data-ui] before paint so there's no flash.

const KEY = 'jareddesu.games.lang';
let current = (() => { try { return localStorage.getItem(KEY) === 'ja' ? 'ja' : 'en'; } catch { return 'en'; } })();

export const lang = () => current;
export const dateLocale = () => (current === 'ja' ? 'ja-JP' : 'en-US');

export function setLang(l) {
  current = l === 'ja' ? 'ja' : 'en';
  try { if (current === 'ja') localStorage.setItem(KEY, 'ja'); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}

// t(key, vars): a string with {name} slots, or a function of vars
export function translator(dict) {
  const t = (key, vars = {}) => {
    const s = dict[current]?.[key] ?? dict.en[key] ?? key;
    return typeof s === 'function' ? s(vars) : String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  };
  t.apply = () => {
    const d = document.documentElement;
    d.dataset.ui = current;
    d.lang = current;
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
    document.querySelectorAll('[data-t-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.tAria)));
    document.querySelectorAll('[data-lang-seg] button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.lang === current)));
  };
  return t;
}
