"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatBytes, listBooks, type BookInfo } from "@/lib/api";
import { formatTime } from "@/lib/format";

export function LibraryClient() {
  const [books, setBooks] = useState<BookInfo[]>([]);
  const [prefix, setPrefix] = useState("AudioBooks/");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await listBooks();
    setPrefix(res.prefix);
    setBooks(res.books);
  }, []);

  useEffect(() => {
    void refresh()
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not load library");
      })
      .finally(() => setLoading(false));
  }, [refresh]);

  return (
    <main className="room-shell">
      <header className="room-header">
        <div>
          <p className="brand-mark">Listen Together</p>
          <h1>Library</h1>
          <p className="lede">
            Reading from R2 prefix <code>{prefix}</code>. Upload files there in
            the Cloudflare dashboard — they appear here automatically.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setLoading(true);
              void refresh()
                .catch((err) => {
                  setError(
                    err instanceof Error ? err.message : "Could not refresh",
                  );
                })
                .finally(() => setLoading(false));
            }}
          >
            Refresh
          </button>
          <Link href="/" className="btn-ghost">
            Back home
          </Link>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      <section className="bookmarks">
        <div className="section-head">
          <h2>Audiobooks in bucket</h2>
          <p>{books.length} file{books.length === 1 ? "" : "s"}</p>
        </div>
        <ul className="book-list">
          {books.length === 0 && !loading ? (
            <li className="muted">
              No audio under <code>{prefix}</code> yet.
            </li>
          ) : (
            books.map((b) => (
              <li key={b.r2Key} className="book-row">
                <div>
                  <strong>{b.title}</strong>
                  <p className="muted">
                    {b.audioName}
                    {b.sizeBytes ? ` · ${formatBytes(b.sizeBytes)}` : ""}
                    {b.lastPositionSeconds > 0
                      ? ` · last at ${formatTime(b.lastPositionSeconds)}`
                      : ""}
                  </p>
                  <p className="muted tiny-path">{b.r2Key}</p>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>
    </main>
  );
}
