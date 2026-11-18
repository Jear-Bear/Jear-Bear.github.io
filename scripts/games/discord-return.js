// discord-return.js — the /discord/ page: Discord sends people here after they link their
// Discord account (Settings) or sign in with it. Finish it with the Worker, then go back to
// the page they came from (discord.js).

import { translator } from './i18n.js?v=1';
import { finishDiscord, discordBack } from './discord.js?v=1';

const t = translator({
  en: { linked: 'Discord linked.', signedIn: 'Signed in.', back: 'Taking you back…', cancelled: 'Discord sign-in was cancelled.', failed: 'That didn’t work.', goBack: 'Go back' },
  ja: { linked: 'Discordを連携しました。', signedIn: 'サインインしました。', back: '元のページに戻ります…', cancelled: 'Discordのサインインはキャンセルされました。', failed: 'うまくいきませんでした。', goBack: '戻る' },
});
const $ = (id) => document.getElementById(id);
const back = $('back');
back.textContent = t('goBack');

finishDiscord().then((r) => {
  $('title').textContent = t(r.kind);
  $('msg').textContent = t('back');
  back.href = r.back;
  back.hidden = false;
  setTimeout(() => location.replace(r.back), 900);
}).catch((e) => {
  $('title').textContent = e.message === 'cancelled' ? t('cancelled') : t('failed');
  if (e.message !== 'cancelled' && e.message !== 'failed') $('msg').textContent = e.message;
  back.href = discordBack();
  back.hidden = false;
});
