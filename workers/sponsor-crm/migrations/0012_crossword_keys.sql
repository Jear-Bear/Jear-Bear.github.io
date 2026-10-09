-- Crossword+ sealing key. Bonus puzzles (and, at launch, the paid archive)
-- are committed to the public repo encrypted with the public half; only this
-- Worker holds the private half, so only it can open them for subscribers.
-- Created on first use by GET /public/crossword-key; never leaves D1.
CREATE TABLE crossword_keys (
  kid TEXT PRIMARY KEY,
  public_jwk TEXT NOT NULL,
  private_jwk TEXT NOT NULL,
  created_at TEXT NOT NULL
);
