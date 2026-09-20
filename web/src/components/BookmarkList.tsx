"use client";

import { useState } from "react";
import {
  createBookmark,
  deleteBookmark,
  type Bookmark,
} from "@/lib/api";
import { formatTime } from "@/lib/format";

type Props = {
  bookId: string;
  guestName: string;
  currentTime: number;
  bookmarks: Bookmark[];
  onChange: (bookmarks: Bookmark[]) => void;
  onJump: (seconds: number) => void;
};

export function BookmarkList({
  bookId,
  guestName,
  currentTime,
  bookmarks,
  onChange,
  onJump,
}: Props) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const bookmark = await createBookmark(bookId, {
        guestName,
        label: label.trim() || `At ${formatTime(currentTime)}`,
        positionSeconds: currentTime,
      });
      onChange(
        [...bookmarks, bookmark].sort(
          (a, b) => a.positionSeconds - b.positionSeconds,
        ),
      );
      setLabel("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save bookmark");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteBookmark(bookId, id);
      onChange(bookmarks.filter((b) => b.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bookmarks">
      <div className="section-head">
        <h2>Bookmarks</h2>
        <p>Saved on this book — they come back next time you listen.</p>
      </div>

      <div className="bookmark-form">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          maxLength={80}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void save()}
        >
          Save {formatTime(currentTime)}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <ul className="bookmark-list">
        {bookmarks.length === 0 ? (
          <li className="muted">No bookmarks yet.</li>
        ) : (
          bookmarks.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className="bookmark-jump"
                onClick={() => onJump(b.positionSeconds)}
              >
                <span className="bookmark-time">
                  {formatTime(b.positionSeconds)}
                </span>
                <span className="bookmark-label">{b.label}</span>
                <span className="bookmark-by">{b.guestName}</span>
              </button>
              <button
                type="button"
                className="btn-ghost tiny"
                disabled={busy}
                onClick={() => void remove(b.id)}
                aria-label="Delete bookmark"
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
