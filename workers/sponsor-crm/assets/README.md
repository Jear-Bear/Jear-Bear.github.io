# Fonts for the daily post's picture

`noto-sans-jp-400.ttf` and `noto-sans-jp-700.ttf` are Noto Sans JP (Google, Adobe), subset to
the characters in `subset-chars.txt` (Latin, kana, CJK punctuation, full-width ASCII and a few
symbols). Licensed under the SIL Open Font License 1.1, in `OFL.txt`. `board-image.js` fetches
any other character a name needs (kanji) from Google Fonts at render time.

To rebuild the subset (e.g. after adding characters to `subset-chars.txt`), ask the Google
Fonts CSS API for each weight with `&text=` set to the URL-encoded contents of
`subset-chars.txt`, for example
`https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@700&text=…`, with a non-browser
client so it answers with TrueType, then download the `truetype` URL in the response to
`noto-sans-jp-700.ttf` (400 the same way).
