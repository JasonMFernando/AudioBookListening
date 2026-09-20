CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  r2_key TEXT,
  audio_name TEXT,
  created_at INTEGER NOT NULL,
  last_position_seconds REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  guest_name TEXT NOT NULL,
  label TEXT NOT NULL,
  position_seconds REAL NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_room ON bookmarks(room_id);

CREATE TABLE IF NOT EXISTS uploads (
  upload_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);
