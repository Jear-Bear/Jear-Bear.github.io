// sealed.js — Crossword+ content that's public in the repo but only readable
// here. The nightly crossword task encrypts bonus puzzles with this Worker's
// public key (RSA-OAEP-256 wrapping an AES-256-GCM key) and commits them to
// data/crossword/bonus/. The private key lives only in D1, so nobody else
// can read them; at launch this Worker opens them for subscribers.
//
//   GET /public/crossword-key   the public key (made on first use)
//   GET /api/crossword-bonus    signed in: the bonus backlog, each puzzle
//                               opened as a check that it decrypts

const DEFAULT_SITE = 'https://www.jareddesu.com';
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyRow(db) {
  return db.prepare('SELECT kid, public_jwk, private_jwk FROM crossword_keys ORDER BY created_at LIMIT 1').first();
}

export async function publicKey(db) {
  let row = await keyRow(db);
  if (!row) {
    const pair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const kid = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
    // Two first requests at once: only one key wins, both read it back
    await db.prepare('INSERT OR IGNORE INTO crossword_keys (kid, public_jwk, private_jwk, created_at) VALUES (?, ?, ?, ?)')
      .bind(kid, JSON.stringify(pub), JSON.stringify(priv), new Date().toISOString()).run();
    row = await keyRow(db);
  }
  const jwk = JSON.parse(row.public_jwk);
  return { kid: row.kid, alg: 'RSA-OAEP-256+A256GCM', jwk: { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RSA-OAEP-256' } };
}

export async function openSealed(db, box) {
  const row = await keyRow(db);
  if (!row || box.kid !== row.kid) throw new Error('Sealed with a different key');
  const priv = await crypto.subtle.importKey('jwk', JSON.parse(row.private_jwk), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, priv, b64d(box.ek));
  const aes = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(box.iv) }, aes, b64d(box.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

// The backlog as published on the site, each one opened to prove it's readable
export async function bonusBacklog(db, site = DEFAULT_SITE) {
  const SITE = site;
  const res = await fetch(`${SITE}/data/crossword/bonus/index.json`, { cf: { cacheTtl: 300 } });
  if (res.status === 404) return { count: 0, items: [] };
  if (!res.ok) throw new Error(`Couldn’t read the bonus index (${res.status})`);
  const index = await res.json();
  const items = [];
  for (const it of index.bonus || []) {
    let ok = false;
    try {
      const box = await (await fetch(`${SITE}/data/crossword/bonus/${it.id}.json`, { cf: { cacheTtl: 300 } })).json();
      const p = await openSealed(db, box);
      ok = Boolean(p && p.grid && p.clues);
    } catch { ok = false; }
    items.push({ ...it, readable: ok });
  }
  return { count: items.length, readable: items.filter((i) => i.readable).length, items };
}
