// importer.js — turns pasted text, CSV or Excel (.xlsx) into a kanji list.
//
// Every kanji character found becomes part of the list. Cells/tokens with
// two or more characters that contain kanji are also kept as words; if the
// same row has a kana-only cell (reading) or a Latin-text cell (meaning),
// those are attached to the word.
//
// .xlsx is a zip of XML files; it's read here with the browser's built-in
// DecompressionStream and DOMParser, so no spreadsheet library is needed.

import { isKanji, hasKanji, isKana } from './data.js?v=2';

// ---------------------------------------------------------------- entry
export async function parseFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return rowsToList(await readXlsx(await file.arrayBuffer()));
  if (name.endsWith('.xls')) throw new Error('Old .xls files aren\'t supported. Save it as .xlsx or CSV first.');
  const text = await file.text();
  if (name.endsWith('.csv') || name.endsWith('.tsv') || /[,\t;]/.test(text.split('\n')[0] || '')) {
    return rowsToList(parseCSV(text));
  }
  return parseText(text);
}

export function parseText(text) {
  // Each line may be "word reading meaning" or just kanji/words
  const rows = text.split(/\r?\n/).map((line) => line.split(/[\s,、，;；\t]+/).filter(Boolean));
  return rowsToList(rows);
}

// ---------------------------------------------------------------- rows -> list
function rowsToList(rows) {
  const chars = [];
  const seen = new Set();
  const words = [];
  const seenWords = new Set();
  const addChars = (s) => {
    for (const ch of s) if (isKanji(ch) && !seen.has(ch)) { seen.add(ch); chars.push(ch); }
  };

  for (const row of rows) {
    const cells = row.map((c) => String(c == null ? '' : c).trim()).filter(Boolean);
    if (!cells.length) continue;
    const kanjiCells = cells.filter(hasKanji);
    kanjiCells.forEach(addChars);
    const reading = cells.find((c) => !hasKanji(c) && isKana(c)) || '';
    const meaning = cells.find((c) => /[A-Za-z]/.test(c) && !hasKanji(c)) || '';
    for (const cell of kanjiCells) {
      // A cell with several space-separated items: treat each as its own token
      for (const token of cell.split(/[\s、，,]+/)) {
        if ([...token].length >= 2 && hasKanji(token) && !seenWords.has(token)) {
          seenWords.add(token);
          const single = kanjiCells.length === 1 && !/[\s、，,]/.test(cell);
          words.push([token, single ? reading : '', single ? meaning : '']);
        }
      }
    }
  }
  return { chars: chars.join(''), words };
}

// ---------------------------------------------------------------- CSV
export function parseCSV(text) {
  const first = text.split('\n')[0] || '';
  const delim = [',', '\t', ';'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------------------------------------------------------------- XLSX
async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  // End of central directory: scan backwards for its signature
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That doesn\'t look like an Excel file.');
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const size = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const local = view.getUint32(ptr + 42, true);
    const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files[name] = { method, data: bytes.subarray(dataStart, dataStart + size) };
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: (name) => !!files[name],
    names: () => Object.keys(files),
    async text(name) {
      const f = files[name];
      if (!f) return null;
      if (f.method === 0) return dec.decode(f.data);
      if (f.method !== 8 || typeof DecompressionStream === 'undefined') {
        throw new Error('This browser can\'t read Excel files. Save the sheet as CSV instead.');
      }
      const stream = new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    },
  };
}

function colIndex(ref) {
  const letters = (ref || '').replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

export async function readXlsx(buffer) {
  const zip = await unzip(buffer);
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const shared = [];
  const ss = await zip.text('xl/sharedStrings.xml');
  if (ss) {
    for (const si of xml(ss).getElementsByTagName('si')) {
      shared.push([...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    }
  }
  // First worksheet in workbook order
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await zip.text('xl/workbook.xml');
  const rels = await zip.text('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = xml(wb).getElementsByTagName('sheet')[0];
    const rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
    const rel = [...xml(rels).getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
    if (rel) {
      const target = rel.getAttribute('Target').replace(/^\//, '');
      sheetPath = target.startsWith('xl/') ? target : `xl/${target}`;
    }
  }
  if (!zip.has(sheetPath)) sheetPath = zip.names().find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const sheet = sheetPath && (await zip.text(sheetPath));
  if (!sheet) throw new Error('No worksheet found in that file.');

  const rows = [];
  for (const r of xml(sheet).getElementsByTagName('row')) {
    const row = [];
    for (const c of r.getElementsByTagName('c')) {
      const t = c.getAttribute('t');
      let v = '';
      if (t === 's') v = shared[Number((c.getElementsByTagName('v')[0] || {}).textContent)] || '';
      else if (t === 'inlineStr') v = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
      else v = (c.getElementsByTagName('v')[0] || {}).textContent || '';
      row[colIndex(c.getAttribute('r'))] = v;
    }
    rows.push(row);
  }
  return rows;
}
