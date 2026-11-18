// themes.mjs — the automatic theme and part of speech for Kana Wordle answers (Node only),
// shared by build.mjs (the first word lists, frozen) and build-v2.mjs (the lists from V2_FROM).

export const THEMES = [
  ['Food & drink', 'food eat eating drink rice meal bread meat fish vegetable fruit tea coffee sugar salt cook cooking kitchen restaurant lunch dinner breakfast noodle noodles egg milk beer sake soup candy cake sweets delicious taste flavor apple banana orange juice snack bento dumpling dumplings pancake curry tofu soy sauce wasabi cucumber potato onion'],
  ['Body & health', 'body head hand hands foot feet leg legs arm arms eye eyes ear ears mouth nose tooth teeth face hair stomach belly heart blood sick sickness illness ill medicine doctor dentist nurse hospital health healthy pain painful cold fever cough injury wound throat neck finger shoulder knee back skin'],
  ['Family & people', 'mother father parent parents brother sister child children son daughter wife husband family friend person people man woman baby aunt uncle grandfather grandmother grandchild teacher student boss adult boy girl lover guest neighbor neighbour colleague senior junior'],
  ['Time & calendar', 'day days week month year time morning evening night today tomorrow yesterday hour minute monday tuesday wednesday thursday friday saturday sunday spring summer autumn fall winter season birthday holiday vacation calendar era future past soon later early late always sometimes noon midnight weekend'],
  ['Numbers & counting', 'one two three four five six seven eight nine ten hundred thousand counter number numbers counting half double first second third quantity'],
  ['Weather & nature', 'rain snow wind weather sky cloud sun sunny moon star mountain river sea ocean tree trees flower flowers forest woods island lake nature earth fire water stone rock leaf leaves grass typhoon thunder storm beach sand pond hill field garden'],
  ['Animals', 'dog cat bird animal horse cow cattle pig insect bug monkey bear fox mouse rabbit tiger elephant snake turtle frog duck chicken whale goldfish raccoon'],
  ['Around the house', 'house home room door window desk chair table bed bedding futon bath toilet key box bag umbrella phone telephone television radio clock watch pen pencil book paper cup glass plate closet stairs wall floor roof shelf furniture refrigerator mattress blanket pillow towel soap mirror lamp light'],
  ['Clothes', 'clothes clothing shirt shoe shoes sock socks hat cap coat skirt trousers pants kimono wear dress glove gloves button pocket sweater uniform necktie tie suit belt'],
  ['Getting around', 'train car bus bicycle bike airplane plane ship boat station road street bridge airport travel trip ticket drive taxi map traffic corner intersection crossing subway platform passenger journey'],
  ['Around town', 'shop store bank post office library park city town village country building company embassy police temple shrine hotel theater theatre museum cinema market supermarket convenience cafe café'],
  ['School & work', 'study school class lesson test exam examination homework university college work job meeting business letter word words language kanji read write question answer dictionary practice office career salary interview report notebook'],
  ['Feelings', 'happy sad angry anger fear afraid love lonely glad worried worry kind gentle strict feel feeling emotion embarrassed surprise surprised nervous tired sleepy bored joy fun pleasant unpleasant hate envy proud shy'],
  ['Colors & looks', 'red blue green white black yellow brown color colour bright dark beautiful pretty cute ugly big small large little long short round thin thick tall wide narrow heavy light new old'],
  ['Fun & hobbies', 'sport sports game games music song songs sing singing dance dancing movie film picture photo photograph play hobby party festival guitar piano swim swimming karaoke anime manga comics toy toys cards'],
];
export const THEME_WORDS = THEMES.map(([name, list]) => [name, new Set(list.split(' '))]);
export const EXTRA_TAGS = { food: 'Food & drink', pop: 'Pop culture', comedy: 'Pop culture', slang: 'Slang', culture: 'Japanese culture', places: 'Places in Japan', animals: 'Animals', 'daily life': 'Everyday life', sport: 'Fun & hobbies', fun: 'Fun & hobbies', onomatopoeia: 'Sound words', idioms: 'Sayings', phrases: 'Things people say', society: 'Life in Japan', untranslatable: 'Hard-to-translate words' };

// pos: the word's JMdict parts of speech (first sense); m: its English meaning
export function partOfSpeech(pos, m) {
  const has = (re) => pos.some((p) => re.test(p));
  if (has(/^adj-i$/)) return 'adjective';
  if (has(/^(v1|v2|v4|v5|vk|vz|vs-i|vs-s|vs-c)/)) return 'verb';      // not plain "vs" (a noun you can use with する)
  if (!pos.length && /^(\([^)]*\) )?to /.test(m)) return 'verb';
  if (has(/^adj-na$/)) return 'na-adjective';
  if (has(/^adv/)) return 'adverb';
  if (has(/^(exp|int)$/)) return 'expression';
  if (has(/^(ctr|num)$/)) return 'counter';
  return 'noun';
}
// extras: data/crossword/extra-words.json by grid kana
export function theme(w, extras) {
  const x = extras.get(w.a);
  if (x && x.tags && EXTRA_TAGS[x.tags[0]]) return EXTRA_TAGS[x.tags[0]];
  // The category whose keyword shows up earliest in the English meaning
  const words = w.m.toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-zé']+/).filter(Boolean);
  let best = null, at = Infinity;
  THEME_WORDS.forEach(([name, set]) => {
    const i = words.findIndex((t) => set.has(t));
    if (i >= 0 && i < at) { at = i; best = name; }
  });
  return best;
}
export const POS_THEME = { verb: 'Something you do', adjective: 'A describing word', 'na-adjective': 'A describing word', adverb: 'How, when or how much', expression: 'Something people say', counter: 'Numbers & counting', noun: 'A thing or an idea' };

