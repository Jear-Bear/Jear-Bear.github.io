// crossword.js — the Kana Crossword Activity (activity/crossword/): the Daily Kana Crossword in
// kana. The shared part is activity.js; docs/discord-activity.md.
import { startActivity } from './activity.js?v=3';

startActivity({ game: 'crossword', mode: 'kana', load: () => import('../crossword/app.js?v=40') });
