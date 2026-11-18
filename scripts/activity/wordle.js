// wordle.js — Kana Wordle as a Discord Activity (activity/wordle/). The shared part is
// activity.js; docs/discord-activity.md.
import { startActivity } from './activity.js?v=1';

startActivity({ game: 'wordle', load: () => import('../wordle/app.js?v=12') });
