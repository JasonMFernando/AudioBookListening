CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  r2_key TEXT,
  audio_name TEXT,
  last_position_seconds REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_books_created ON books(created_at);

ALTER TABLE rooms ADD COLUMN book_id TEXT;

DROP TABLE IF EXISTS bookmarks;
CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  guest_name TEXT NOT NULL,
  label TEXT NOT NULL,
  position_seconds REAL NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_id);

DROP TABLE IF EXISTS uploads;
CREATE TABLE uploads (
  upload_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
