import { Hono } from "hono";
import { cors } from "hono/cors";
import { ListeningRoom } from "./room";
import type { BookRow, Env, RoomRow } from "./types";

export { ListeningRoom };

const app = new Hono<{ Bindings: Env }>();

const AUDIO_EXT = /\.(m4b|m4a|mp3|aac|flac|ogg|wav|mp4)$/i;

app.use("*", async (c, next) => {
  if (c.req.header("Upgrade")?.toLowerCase() === "websocket") {
    return next();
  }
  const origin = c.env.CORS_ORIGIN || "*";
  return cors({
    origin,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })(c, next);
});

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function randomCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function id() {
  return crypto.randomUUID();
}

function libraryPrefix(env: Env) {
  const raw = env.LIBRARY_PREFIX || "AudioBooks/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function titleFromKey(key: string, prefix: string) {
  const relative = key.startsWith(prefix) ? key.slice(prefix.length) : key;
  const base = relative.split("/").filter(Boolean).pop() || relative;
  return base.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").trim() || base;
}

function mapBook(book: BookRow) {
  return {
    id: book.id,
    title: book.title,
    r2Key: book.r2_key,
    hasAudio: Boolean(book.r2_key),
    audioName: book.audio_name,
    lastPositionSeconds: book.last_position_seconds,
    createdAt: book.created_at,
  };
}

async function getRoomByCode(db: D1Database, code: string) {
  return db
    .prepare("SELECT * FROM rooms WHERE code = ?")
    .bind(code.toUpperCase())
    .first<RoomRow>();
}

async function getBook(db: D1Database, bookId: string) {
  return db
    .prepare("SELECT * FROM books WHERE id = ?")
    .bind(bookId)
    .first<BookRow>();
}

async function getBookByKey(db: D1Database, r2Key: string) {
  return db
    .prepare("SELECT * FROM books WHERE r2_key = ?")
    .bind(r2Key)
    .first<BookRow>();
}

async function ensureBookFromR2(
  env: Env,
  r2Key: string,
): Promise<BookRow | null> {
  const prefix = libraryPrefix(env);
  if (!r2Key.startsWith(prefix)) return null;
  if (r2Key.endsWith("/")) return null;
  if (!AUDIO_EXT.test(r2Key)) return null;

  const object = await env.AUDIO.head(r2Key);
  if (!object) return null;

  const existing = await getBookByKey(env.DB, r2Key);
  if (existing) return existing;

  const fileName = r2Key.split("/").pop() || r2Key;
  const title = titleFromKey(r2Key, prefix);
  const bookId = id();
  const createdAt = Date.now();

  await env.DB.prepare(
    `INSERT INTO books (id, title, r2_key, audio_name, last_position_seconds, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  )
    .bind(bookId, title, r2Key, fileName, createdAt)
    .run();

  return getBook(env.DB, bookId);
}

async function listLibraryFiles(env: Env) {
  const prefix = libraryPrefix(env);
  const files: { key: string; size: number; uploaded: Date }[] = [];
  let cursor: string | undefined;

  do {
    const page = await env.AUDIO.list({ prefix, cursor, limit: 1000 });
    for (const obj of page.objects) {
      if (obj.key.endsWith("/")) continue;
      if (!AUDIO_EXT.test(obj.key)) continue;
      files.push({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded,
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  files.sort((a, b) => a.key.localeCompare(b.key));
  return { prefix, files };
}

async function getRoomStub(env: Env, roomId: string) {
  return env.ROOM.get(env.ROOM.idFromName(roomId));
}

async function streamAudio(
  env: Env,
  r2Key: string,
  request: Request,
  corsOrigin: string,
) {
  const rangeHeader = request.headers.get("Range");
  const object = await env.AUDIO.get(
    r2Key,
    rangeHeader ? { range: request.headers } : undefined,
  );
  if (!object) return jsonError("Audio missing from storage", 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=3600");
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "audio/mp4");
  }
  headers.set("Access-Control-Allow-Origin", corsOrigin || "*");
  headers.set(
    "Access-Control-Expose-Headers",
    "Content-Range, Accept-Ranges, Content-Length, Content-Type",
  );

  if (rangeHeader && object.range) {
    const offset =
      "offset" in object.range ? (object.range.offset ?? 0) : 0;
    const length =
      "length" in object.range && object.range.length != null
        ? object.range.length
        : Math.max(0, object.size - offset);
    const end = offset + length - 1;
    headers.set("Content-Range", `bytes ${offset}-${end}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

app.get("/api/health", (c) => c.json({ ok: true }));

// --- Library from R2 AudioBooks/ ---

app.get("/api/books", async (c) => {
  const { prefix, files } = await listLibraryFiles(c.env);
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM books WHERE r2_key IS NOT NULL",
  ).all<BookRow>();
  const byKey = new Map((results || []).map((b) => [b.r2_key as string, b]));

  const books = files.map((file) => {
    const existing = byKey.get(file.key);
    const title = existing?.title || titleFromKey(file.key, prefix);
    return {
      id: existing?.id ?? null,
      r2Key: file.key,
      title,
      hasAudio: true,
      audioName: file.key.split("/").pop() || file.key,
      sizeBytes: file.size,
      lastPositionSeconds: existing?.last_position_seconds ?? 0,
      createdAt: existing?.created_at ?? file.uploaded.getTime(),
    };
  });

  return c.json({ prefix, books });
});

app.get("/api/books/:bookId", async (c) => {
  const book = await getBook(c.env.DB, c.req.param("bookId"));
  if (!book) return jsonError("Book not found", 404);
  return c.json(mapBook(book));
});

app.get("/api/books/:bookId/audio", async (c) => {
  const book = await getBook(c.env.DB, c.req.param("bookId"));
  if (!book) return jsonError("Book not found", 404);
  if (!book.r2_key) return jsonError("No audio file", 404);
  return streamAudio(c.env, book.r2_key, c.req.raw, c.env.CORS_ORIGIN);
});

app.get("/api/books/:bookId/bookmarks", async (c) => {
  const book = await getBook(c.env.DB, c.req.param("bookId"));
  if (!book) return jsonError("Book not found", 404);

  const { results } = await c.env.DB.prepare(
    `SELECT id, book_id, guest_name, label, position_seconds, created_at
     FROM bookmarks WHERE book_id = ? ORDER BY position_seconds ASC`,
  )
    .bind(book.id)
    .all();

  return c.json({
    bookmarks: (results || []).map((b) => ({
      id: b.id,
      guestName: b.guest_name,
      label: b.label,
      positionSeconds: b.position_seconds,
      createdAt: b.created_at,
    })),
  });
});

app.post("/api/books/:bookId/bookmarks", async (c) => {
  const book = await getBook(c.env.DB, c.req.param("bookId"));
  if (!book) return jsonError("Book not found", 404);

  const body = (await c.req.json()) as {
    guestName?: string;
    label?: string;
    positionSeconds?: number;
  };

  const guestName = (body.guestName || "Guest").trim().slice(0, 32);
  const label = (body.label || "Bookmark").trim().slice(0, 80);
  const positionSeconds = Math.max(0, Number(body.positionSeconds) || 0);
  const bookmarkId = id();
  const createdAt = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO bookmarks (id, book_id, guest_name, label, position_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(bookmarkId, book.id, guestName, label, positionSeconds, createdAt)
    .run();

  return c.json({
    id: bookmarkId,
    guestName,
    label,
    positionSeconds,
    createdAt,
  });
});

app.delete("/api/books/:bookId/bookmarks/:bookmarkId", async (c) => {
  const book = await getBook(c.env.DB, c.req.param("bookId"));
  if (!book) return jsonError("Book not found", 404);

  await c.env.DB.prepare(
    "DELETE FROM bookmarks WHERE id = ? AND book_id = ?",
  )
    .bind(c.req.param("bookmarkId"), book.id)
    .run();

  return c.json({ ok: true });
});

app.post("/api/books/:bookId/position", async (c) => {
  const book = await getBook(c.env.DB, c.req.param("bookId"));
  if (!book) return jsonError("Book not found", 404);
  const body = (await c.req.json()) as { positionSeconds?: number };
  const positionSeconds = Math.max(0, Number(body.positionSeconds) || 0);
  await c.env.DB.prepare(
    "UPDATE books SET last_position_seconds = ? WHERE id = ?",
  )
    .bind(positionSeconds, book.id)
    .run();
  return c.json({ ok: true });
});

// --- Rooms ---

app.post("/api/rooms", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    r2Key?: string;
    bookId?: string;
  };

  let book: BookRow | null = null;

  if (body.r2Key) {
    book = await ensureBookFromR2(c.env, body.r2Key);
    if (!book) {
      return jsonError(
        "File not found in R2 under AudioBooks/ (check the key and prefix)",
        404,
      );
    }
  } else if (body.bookId) {
    book = await getBook(c.env.DB, body.bookId);
    if (!book?.r2_key) return jsonError("Book not found or has no file", 404);
  } else {
    return jsonError("r2Key is required");
  }

  const title =
    (body.title || book.title || "Listening room").trim().slice(0, 80);
  const roomId = id();
  const code = randomCode();
  const createdAt = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO rooms (id, code, title, book_id, r2_key, audio_name, created_at, last_position_seconds)
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 0)`,
  )
    .bind(roomId, code, title, book.id, createdAt)
    .run();

  const stub = await getRoomStub(c.env, roomId);
  await stub.fetch("https://room/hydrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId,
      bookId: book.id,
      lastPosition: book.last_position_seconds || 0,
    }),
  });

  return c.json({
    id: roomId,
    code,
    title,
    bookId: book.id,
    r2Key: book.r2_key,
    createdAt,
  });
});

app.get("/api/rooms/:code", async (c) => {
  const room = await getRoomByCode(c.env.DB, c.req.param("code"));
  if (!room) return jsonError("Room not found", 404);

  let book: BookRow | null = null;
  if (room.book_id) {
    book = await getBook(c.env.DB, room.book_id);
  }

  return c.json({
    id: room.id,
    code: room.code,
    title: room.title,
    bookId: room.book_id,
    bookTitle: book?.title ?? null,
    r2Key: book?.r2_key ?? null,
    hasAudio: Boolean(book?.r2_key),
    audioName: book?.audio_name ?? null,
    lastPositionSeconds: book?.last_position_seconds ?? 0,
    createdAt: room.created_at,
  });
});

app.get("/api/rooms/:code/ws", async (c) => {
  const room = await getRoomByCode(c.env.DB, c.req.param("code"));
  if (!room) return jsonError("Room not found", 404);

  let lastPosition = 0;
  if (room.book_id) {
    const book = await getBook(c.env.DB, room.book_id);
    lastPosition = book?.last_position_seconds ?? 0;
  }

  const stub = await getRoomStub(c.env, room.id);
  await stub.fetch("https://room/hydrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: room.id,
      bookId: room.book_id,
      lastPosition,
    }),
  });

  const name = new URL(c.req.url).searchParams.get("name") || "Guest";
  const doUrl = new URL(`https://room/ws?name=${encodeURIComponent(name)}`);
  return stub.fetch(doUrl, c.req.raw);
});

app.get("/api/rooms/:code/audio", async (c) => {
  const room = await getRoomByCode(c.env.DB, c.req.param("code"));
  if (!room) return jsonError("Room not found", 404);
  if (!room.book_id) return jsonError("Room has no book", 404);
  const book = await getBook(c.env.DB, room.book_id);
  if (!book?.r2_key) return jsonError("No audio file", 404);
  return streamAudio(c.env, book.r2_key, c.req.raw, c.env.CORS_ORIGIN);
});

export default app;
