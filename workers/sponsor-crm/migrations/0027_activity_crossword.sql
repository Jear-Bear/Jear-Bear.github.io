-- The Discord Activity plays the Daily Kana Crossword too (discord.js): its channel list keeps
-- which game a finish was, and a crossword's time and revealed squares (guesses stays 0).
ALTER TABLE activity_finishes ADD COLUMN game TEXT NOT NULL DEFAULT 'wordle';
ALTER TABLE activity_finishes ADD COLUMN seconds INTEGER;
ALTER TABLE activity_finishes ADD COLUMN revealed INTEGER;
