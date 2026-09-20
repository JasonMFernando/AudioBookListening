export type Env = {
  DB: D1Database;
  AUDIO: R2Bucket;
  ROOM: DurableObjectNamespace;
  CORS_ORIGIN: string;
  LIBRARY_PREFIX: string;
};

export type BookRow = {
  id: string;
  title: string;
  r2_key: string | null;
  audio_name: string | null;
  last_position_seconds: number;
  created_at: number;
};

export type RoomRow = {
  id: string;
  code: string;
  title: string;
  book_id: string | null;
  r2_key: string | null;
  audio_name: string | null;
  created_at: number;
  last_position_seconds: number;
};

export type BookmarkRow = {
  id: string;
  book_id: string;
  guest_name: string;
  label: string;
  position_seconds: number;
  created_at: number;
};

export type PlaybackState = {
  position: number;
  isPlaying: boolean;
  updatedAt: number;
};

export type SessionAttachment = {
  name: string;
};

export type ClientMessage =
  | { type: "join"; name: string }
  | { type: "play"; position: number }
  | { type: "pause"; position: number }
  | { type: "seek"; position: number; isPlaying: boolean }
  | { type: "heartbeat"; position: number; isPlaying: boolean };

export type ServerMessage =
  | {
      type: "state";
      position: number;
      isPlaying: boolean;
      updatedAt: number;
      revision: number;
      listeners: string[];
      you: string;
    }
  | { type: "error"; message: string };
