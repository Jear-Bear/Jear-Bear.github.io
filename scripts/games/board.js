// board.js — the Discord leaderboard on the game pages (crossword, Wordle).
//
// Opt-in, for signed-in players only: a nickname and a switch in Settings, kept on the
// account (so one switch covers every game), and a finished daily sent once to the sponsor
// Worker (workers/sponsor-crm/src/board.js), which posts the day's results to Discord.
// Signed-out players see none of this. The page passes its own CSS classes so the
// Settings section looks like the rest of its Settings.

import { translator } from './i18n.js?v=1';
import { signedIn, onAccount, accountId, boardCall } from '../crossword/account.js?v=7';

const DISCORD = 'https://discord.gg/SqeuUd39sJ';
const INVITED = 'jareddesu.board.invited';      // accounts this browser has shown the invite to

const t = translator({
  en: {
    title: 'Discord leaderboard',
    about: 'Put your daily results in the results post in Jared’s Discord each morning, under a nickname. Only the nickname and your results are shared.',
    toggle: 'Show my results', toggleSub: 'on the Discord leaderboard',
    nick: 'Nickname', nickHint: '2–20 letters or numbers', save: 'Save', saving: 'Saving…', saved: 'Saved.',
    off: 'Turning it off removes your results from the leaderboard.', join: 'Join the Discord',
    needNick: 'Pick a nickname first.', failed: 'Couldn’t save that. Please try again.',
    invite: 'Want your results in the Discord’s daily post?', inviteGo: 'Turn on the leaderboard',
  },
  ja: {
    title: 'Discordのランキング',
    about: '毎朝、JaredのDiscordに投稿される結果に、ニックネームで載ります。共有されるのはニックネームと結果だけです。',
    toggle: '自分の結果を載せる', toggleSub: 'Discordのランキングに',
    nick: 'ニックネーム', nickHint: '2〜20文字の文字や数字', save: '保存', saving: '保存中…', saved: '保存しました。',
    off: 'オフにすると、ランキングから結果が削除されます。', join: 'Discordに参加',
    needNick: '先にニックネームを決めてください。', failed: '保存できませんでした。もう一度お試しください。',
    invite: 'Discordの毎日の結果に載せてみませんか？', inviteGo: 'ランキングをオンにする',
  },
});

let profile = null;          // { opt_in, nickname } for the signed-in account, once loaded
let loading = null;
let loadedFor = null;
const listeners = new Set();
const emit = () => listeners.forEach((f) => { try { f(profile); } catch { /* keep going */ } });

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v != null && v !== false) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((x) => x != null && x !== false));
  return el;
}

export function loadProfile() {
  if (!signedIn()) { profile = null; loadedFor = null; return Promise.resolve(null); }
  if (loadedFor === accountId() && profile) return Promise.resolve(profile);
  if (!loading) {
    loading = boardCall('profile', null, 'GET')
      .then((p) => { profile = { opt_in: Boolean(p.opt_in), nickname: p.nickname || '' }; loadedFor = accountId(); emit(); return profile; })
      .catch(() => null)
      .finally(() => { loading = null; });
  }
  return loading;
}
onAccount(() => { if (loadedFor !== accountId()) { profile = null; loadedFor = null; emit(); } loadProfile(); });
export const onProfile = (f) => { listeners.add(f); return () => listeners.delete(f); };

// A finished daily: { game, puzzleId, ... }. Sent only while opted in; resolves to the
// Worker's answer ({ ok, points } or { ok, duplicate }) or null if it wasn't sent.
export async function sendResult(result) {
  if (!signedIn()) return null;
  const p = await loadProfile();
  if (!p || !p.opt_in) return null;
  try { return await boardCall('result', result); } catch (e) { return { ok: false, error: e.message, status: e.status }; }
}

// The Settings section: { head, toggle, ... } are the page's classes. Hidden while signed out.
export function mountBoardSettings(el, cls = {}) {
  if (!el) return;
  let said = '';        // the last save's message, kept across the redraw the save causes
  const draw = () => {
    if (!signedIn()) { el.hidden = true; el.replaceChildren(); return; }
    el.hidden = false;
    const p = profile || { opt_in: false, nickname: '' };
    const status = h('p', { class: 'board-status', role: 'status', 'aria-live': 'polite' }, said);
    said = '';
    const input = h('input', { type: 'text', class: 'board-nick-input', maxlength: '20', autocomplete: 'nickname', spellcheck: 'false', value: p.nickname || '', placeholder: t('nickHint'), 'aria-label': t('nick') });
    const box = h('input', { type: 'checkbox', checked: p.opt_in });
    const save = async (optIn) => {
      const nickname = input.value.trim();
      if (optIn && !nickname) { status.textContent = t('needNick'); box.checked = false; input.focus(); return; }
      status.textContent = t('saving');
      try {
        const r = await boardCall('profile', { opt_in: optIn, nickname });
        profile = { opt_in: Boolean(r.opt_in), nickname: r.nickname || nickname };
        loadedFor = accountId();
        box.checked = profile.opt_in;
        said = t('saved');
        emit();
      } catch (e) { box.checked = Boolean(profile && profile.opt_in); status.textContent = e.status === 400 ? e.message : t('failed'); }
    };
    box.addEventListener('change', () => save(box.checked));
    el.replaceChildren(
      h('h3', { class: cls.head || '' }, t('title')),
      h('p', { class: 'board-about' }, t('about'), ' ', h('a', { href: DISCORD, target: '_blank', rel: 'noopener' }, t('join'), ' ↗')),
      h('label', { class: cls.toggle || '' }, box, ' ', h('span', {}, h('strong', {}, t('toggle')), ' ', h('span', {}, t('toggleSub')))),
      h('div', { class: 'board-nick' },
        h('label', {}, h('span', { class: 'board-nick-label' }, t('nick')), input),
        h('button', { type: 'button', class: cls.button || 'btn', onclick: () => save(true) }, t('save'))),
      p.opt_in ? h('p', { class: 'board-note' }, t('off')) : null,
      status);
  };
  draw();
  onProfile(draw);
  onAccount(draw);
  return draw;        // call again when the page language changes
}

// The solved screen's one-line invite: signed in, leaderboard off, and not shown to this
// account in this browser before (it marks itself shown). open(): show the Settings section.
export function boardInvite({ open, cls = {} } = {}) {
  if (!signedIn() || !profile || profile.opt_in) return null;
  const id = accountId();
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem(INVITED) || '[]'); } catch { return null; }   // no storage: can't keep it to once, so skip
  if (!id || seen.includes(id)) return null;
  try { localStorage.setItem(INVITED, JSON.stringify([...seen, id].slice(-20))); } catch { return null; }
  return h('p', { class: cls.line || 'board-invite' }, t('invite'), ' ',
    h('button', { type: 'button', class: cls.link || 'btn-link', onclick: () => open && open() }, t('inviteGo')));
}
