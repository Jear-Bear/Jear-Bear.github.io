// crossword.js — the Daily Kana Crossword as a Discord Activity (activity/crossword/). The
// shared part is activity.js; docs/discord-activity.md.
import { startActivity } from './activity.js?v=1';

startActivity({ game: 'crossword', load: () => import('../crossword/app.js?v=39') });
