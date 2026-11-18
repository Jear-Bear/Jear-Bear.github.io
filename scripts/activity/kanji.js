// kanji.js — the Kanji Crossword Activity (activity/kanji/): the Daily Kana Crossword in kanji
// mode, its own Discord app. The shared part is activity.js; docs/discord-activity.md.
import { startActivity } from './activity.js?v=2';

startActivity({ game: 'crossword', mode: 'kanji', load: () => import('../crossword/app.js?v=39') });
