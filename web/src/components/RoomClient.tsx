"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getRoom,
  listBookmarks,
  type Bookmark,
  type RoomInfo,
} from "@/lib/api";
import { useRoomSync } from "@/hooks/useRoomSync";
import { AudioPlayer } from "@/components/AudioPlayer";
import { BookmarkList } from "@/components/BookmarkList";
import Link from "next/link";

const NAME_KEY = "listen-together-name";

type Props = {
  code: string;
};

export function RoomClient({ code }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nameReady, setNameReady] = useState(false);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [jumpToken, setJumpToken] = useState<{ t: number; n: number } | null>(
    null,
  );

  const sync = useRoomSync(code, name, nameReady && Boolean(room));

  const refresh = useCallback(async () => {
    const info = await getRoom(code);
    setRoom(info);
    if (info.bookId) {
      const marks = await listBookmarks(info.bookId);
      setBookmarks(marks.bookmarks);
    } else {
      setBookmarks([]);
    }
    setCurrentTime(info.lastPositionSeconds || 0);
  }, [code]);

  useEffect(() => {
    const saved = localStorage.getItem(NAME_KEY) || "";
    setName(saved);
  }, []);

  useEffect(() => {
    void refresh().catch((err) => {
      setError(err instanceof Error ? err.message : "Room not found");
    });
  }, [refresh]);

  function enterRoom(e: React.FormEvent) {
    e.preventDefault();
    const clean = name.trim().slice(0, 32) || "Guest";
    setName(clean);
    localStorage.setItem(NAME_KEY, clean);
    setNameReady(true);
  }

  if (error) {
    return (
      <main className="room-shell">
        <p className="error">{error}</p>
        <button type="button" className="btn-ghost" onClick={() => router.push("/")}>
          Back home
        </button>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="room-shell">
        <p className="muted">Loading room…</p>
      </main>
    );
  }

  if (!nameReady) {
    return (
      <main className="room-shell narrow">
        <Link href="/" className="btn-ghost back-link">
          ← Home
        </Link>
        <p className="brand-mark">Listen Together</p>
        <h1>{room.title}</h1>
        <p className="lede">
          Room {room.code}
          {room.bookTitle ? ` · ${room.bookTitle}` : ""}
        </p>
        <form className="stack-form" onSubmit={enterRoom}>
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex"
              maxLength={32}
              required
              autoFocus
            />
          </label>
          <button type="submit" className="btn-primary">
            Enter room
          </button>
        </form>
      </main>
    );
  }

  if (!room.bookId || !room.hasAudio) {
    return (
      <main className="room-shell">
        <p className="error">
          This room has no book with audio. Add a book in the library, then
          create a new room.
        </p>
        <Link className="btn-primary" href="/library" style={{ textAlign: "center" }}>
          Go to library
        </Link>
      </main>
    );
  }

  const seedPosition = jumpToken?.t ?? room.lastPositionSeconds;

  return (
    <main className="room-shell">
      <div className="top-nav">
        <Link href="/" className="btn-ghost back-link">
          ← Home
        </Link>
      </div>
      <header className="room-header">
        <div>
          <p className="brand-mark">Listen Together</p>
          <h1>{room.bookTitle || room.title}</h1>
          <p className="lede">
            Room <strong>{room.code}</strong>
            {room.audioName ? ` · ${room.audioName}` : ""}
          </p>
        </div>
        <div className="presence">
          <span
            className={`dot ${sync.state.connected ? "on" : "off"}`}
            aria-hidden
          />
          <div>
            <p className="presence-label">
              {sync.state.connected ? "Live" : "Reconnecting…"}
            </p>
            <p className="presence-list">
              {sync.state.listeners.length
                ? sync.state.listeners.join(", ")
                : name}
            </p>
          </div>
        </div>
      </header>

      {sync.error ? <p className="error">{sync.error}</p> : null}

      <AudioPlayer
        key={`${room.bookId}-${jumpToken?.n ?? 0}`}
        code={code}
        bookId={room.bookId}
        hasAudio={room.hasAudio}
        initialPosition={seedPosition}
        sync={sync}
        onTimeUpdate={setCurrentTime}
      />

      <BookmarkList
        bookId={room.bookId}
        guestName={name}
        currentTime={currentTime}
        bookmarks={bookmarks}
        onChange={setBookmarks}
        onJump={(seconds) => {
          setCurrentTime(seconds);
          setJumpToken({ t: seconds, n: Date.now() });
          sync.seek(seconds, sync.state.isPlaying);
        }}
      />
    </main>
  );
}
