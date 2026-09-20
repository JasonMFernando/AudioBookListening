const WORKER_URL =
  process.env.NEXT_PUBLIC_WORKER_URL?.replace(/\/$/, "") ||
  "http://localhost:8787";

export function getWorkerUrl() {
  return WORKER_URL;
}

export function audioUrlForRoom(code: string) {
  return `${WORKER_URL}/api/rooms/${encodeURIComponent(code)}/audio`;
}

export function wsUrl(code: string, name: string) {
  const httpBase =
    process.env.NEXT_PUBLIC_WORKER_URL?.replace(/\/$/, "") ||
    "http://localhost:8787";
  const wsBase = httpBase.startsWith("https://")
    ? `wss://${httpBase.slice("https://".length)}`
    : httpBase.startsWith("http://")
      ? `ws://${httpBase.slice("http://".length)}`
      : httpBase.replace(/^http/, "ws");
  return `${wsBase}/api/rooms/${encodeURIComponent(code)}/ws?name=${encodeURIComponent(name)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `Request failed (${res.status})`,
    );
  }
  return data as T;
}

export type BookInfo = {
  id: string | null;
  r2Key: string;
  title: string;
  hasAudio: boolean;
  audioName: string | null;
  sizeBytes?: number;
  lastPositionSeconds: number;
  createdAt: number;
};

export type RoomInfo = {
  id: string;
  code: string;
  title: string;
  bookId: string | null;
  bookTitle: string | null;
  r2Key: string | null;
  hasAudio: boolean;
  audioName: string | null;
  lastPositionSeconds: number;
  createdAt: number;
};

export type Bookmark = {
  id: string;
  guestName: string;
  label: string;
  positionSeconds: number;
  createdAt: number;
};

export function listBooks() {
  return request<{ prefix: string; books: BookInfo[] }>("/api/books");
}

export function createRoom(r2Key: string, title?: string) {
  return request<{
    id: string;
    code: string;
    title: string;
    bookId: string;
    r2Key: string | null;
    createdAt: number;
  }>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ r2Key, title }),
  });
}

export function getRoom(code: string) {
  return request<RoomInfo>(`/api/rooms/${encodeURIComponent(code)}`);
}

export function listBookmarks(bookId: string) {
  return request<{ bookmarks: Bookmark[] }>(
    `/api/books/${encodeURIComponent(bookId)}/bookmarks`,
  );
}

export function createBookmark(
  bookId: string,
  payload: { guestName: string; label: string; positionSeconds: number },
) {
  return request<Bookmark>(
    `/api/books/${encodeURIComponent(bookId)}/bookmarks`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function deleteBookmark(bookId: string, bookmarkId: string) {
  return request<{ ok: boolean }>(
    `/api/books/${encodeURIComponent(bookId)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
    { method: "DELETE" },
  );
}

export function savePosition(bookId: string, positionSeconds: number) {
  return request<{ ok: boolean }>(
    `/api/books/${encodeURIComponent(bookId)}/position`,
    {
      method: "POST",
      body: JSON.stringify({ positionSeconds }),
    },
  );
}

export function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
