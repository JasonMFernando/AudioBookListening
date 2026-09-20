"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createRoom,
  formatBytes,
  listBooks,
  type BookInfo,
} from "@/lib/api";
import { formatTime } from "@/lib/format";

export function HomeClient() {
  const router = useRouter();
  const [books, setBooks] = useState<BookInfo[]>([]);
  const [prefix, setPrefix] = useState("AudioBooks/");
  const [selectedKey, setSelectedKey] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listBooks()
      .then((res) => {
        setPrefix(res.prefix);
        setBooks(res.books);
        if (res.books[0]) setSelectedKey(res.books[0].r2Key);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not load books");
      })
      .finally(() => setLoadingBooks(false));
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedKey) {
      setError("Pick an audiobook from the bucket first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const book = books.find((b) => b.r2Key === selectedKey);
      const room = await createRoom(selectedKey, book?.title);
      router.push(`/room/${room.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create room");
      setBusy(false);
    }
  }

  function onJoin(e: React.FormEvent) {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    router.push(`/room/${clean}`);
  }

  return (
    <main className="home">
      <div className="home-glow" aria-hidden />
      <div className="home-content">
        <p className="brand-hero">Listen Together</p>
        <h1 className="home-title">One room. One book. Same moment.</h1>
        <p className="home-sub">
          Files in your R2 folder <code>{prefix}</code> show up here. Pick one,
          create a room, listen together — bookmarks stay with that book.
        </p>

        <p className="home-library-link">
          <Link href="/library">Browse library →</Link>
        </p>

        <div className="home-actions">
          <form className="stack-form" onSubmit={(e) => void onCreate(e)}>
            <label>
              Select audiobook
              {loadingBooks ? (
                <span className="muted">Loading from R2…</span>
              ) : books.length === 0 ? (
                <span className="muted">
                  No audio files found under <code>{prefix}</code>. Upload an
                  .m4b there in Cloudflare R2, then refresh.
                </span>
              ) : (
                <select
                  value={selectedKey}
                  onChange={(e) => setSelectedKey(e.target.value)}
                  required
                >
                  {books.map((b) => (
                    <option key={b.r2Key} value={b.r2Key}>
                      {b.title}
                      {b.sizeBytes ? ` (${formatBytes(b.sizeBytes)})` : ""}
                      {b.lastPositionSeconds > 0
                        ? ` · resume ${formatTime(b.lastPositionSeconds)}`
                        : ""}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || books.length === 0}
            >
              {busy ? "Creating…" : "Create room"}
            </button>
          </form>

          <form className="stack-form join-form" onSubmit={onJoin}>
            <label>
              Have a code?
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={8}
                autoCapitalize="characters"
              />
            </label>
            <button type="submit" className="btn-ghost">
              Join room
            </button>
          </form>
        </div>

        {error ? <p className="error">{error}</p> : null}
      </div>
    </main>
  );
}
