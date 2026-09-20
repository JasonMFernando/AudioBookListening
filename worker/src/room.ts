import type { ClientMessage, Env, PlaybackState, ServerMessage } from "./types";

type Session = {
  name: string;
  quit: boolean;
};

type Meta = {
  playback: PlaybackState;
  roomId: string | null;
  bookId: string | null;
};

export class ListeningRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private sessions = new Map<WebSocket, Session>();
  private playback: PlaybackState = {
    position: 0,
    isPlaying: false,
    updatedAt: Date.now(),
  };
  private roomId: string | null = null;
  private bookId: string | null = null;
  private persistAlarmSet = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<Meta>("meta");
      if (stored) {
        this.playback = stored.playback;
        this.roomId = stored.roomId;
        this.bookId = stored.bookId ?? null;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/hydrate" && request.method === "POST") {
      const body = (await request.json()) as {
        roomId: string;
        bookId?: string | null;
        lastPosition: number;
      };
      this.roomId = body.roomId;
      this.bookId = body.bookId ?? this.bookId;
      if (!this.playback.isPlaying && this.sessions.size === 0) {
        this.playback.position = body.lastPosition || 0;
        this.playback.updatedAt = Date.now();
      } else if (this.playback.position === 0 && body.lastPosition) {
        this.playback.position = body.lastPosition;
        this.playback.updatedAt = Date.now();
      }
      await this.persistMeta();
      return Response.json({ ok: true });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const name = url.searchParams.get("name")?.trim() || "Guest";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    this.sessions.set(server, { name, quit: false });
    this.send(server, this.statePayload(name));
    this.broadcast(this.statePayload(null), server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    let data: ClientMessage;
    try {
      data = JSON.parse(message) as ClientMessage;
    } catch {
      this.send(ws, { type: "error", message: "Invalid message" });
      return;
    }

    const session = this.sessions.get(ws);
    if (!session) return;

    if (data.type === "join") {
      session.name = data.name.trim().slice(0, 32) || "Guest";
      this.broadcast(
        {
          type: "state",
          position: this.livePosition(),
          isPlaying: this.playback.isPlaying,
          updatedAt: this.playback.updatedAt,
          listeners: this.listeners(),
          you: "",
        },
        ws,
      );
      this.send(ws, this.statePayload(session.name));
      return;
    }

    if (
      data.type === "play" ||
      data.type === "pause" ||
      data.type === "seek" ||
      data.type === "heartbeat"
    ) {
      const position = Math.max(0, Number(data.position) || 0);
      let isPlaying = this.playback.isPlaying;
      if (data.type === "play") isPlaying = true;
      if (data.type === "pause") isPlaying = false;
      if (data.type === "seek") isPlaying = Boolean(data.isPlaying);
      if (data.type === "heartbeat") isPlaying = Boolean(data.isPlaying);

      this.playback = {
        position,
        isPlaying,
        updatedAt: Date.now(),
      };
      await this.persistMeta();
      await this.schedulePersist();

      if (data.type !== "heartbeat") {
        this.broadcast(this.statePayload(null), ws);
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.sessions.delete(ws);
    this.broadcast(this.statePayload(null));
    if (this.sessions.size === 0) {
      await this.flushPositionToD1();
    }
  }

  async webSocketError(ws: WebSocket) {
    this.sessions.delete(ws);
    this.broadcast(this.statePayload(null));
  }

  async alarm() {
    this.persistAlarmSet = false;
    await this.flushPositionToD1();
  }

  private listeners(): string[] {
    return [...this.sessions.values()]
      .filter((s) => !s.quit)
      .map((s) => s.name);
  }

  private livePosition(): number {
    if (!this.playback.isPlaying) return this.playback.position;
    const elapsed = (Date.now() - this.playback.updatedAt) / 1000;
    return this.playback.position + elapsed;
  }

  private statePayload(you: string | null): ServerMessage {
    return {
      type: "state",
      position: this.livePosition(),
      isPlaying: this.playback.isPlaying,
      updatedAt: this.playback.updatedAt,
      listeners: this.listeners(),
      you: you ?? "",
    };
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore closed sockets
    }
  }

  private broadcast(msg: ServerMessage, except?: WebSocket) {
    for (const ws of this.sessions.keys()) {
      if (except && ws === except) continue;
      this.send(ws, msg);
    }
  }

  private async persistMeta() {
    await this.state.storage.put("meta", {
      playback: this.playback,
      roomId: this.roomId,
      bookId: this.bookId,
    } satisfies Meta);
  }

  private async schedulePersist() {
    if (this.persistAlarmSet) return;
    this.persistAlarmSet = true;
    await this.state.storage.setAlarm(Date.now() + 5000);
  }

  private async flushPositionToD1() {
    if (!this.bookId) return;
    const position = this.livePosition();
    await this.env.DB.prepare(
      "UPDATE books SET last_position_seconds = ? WHERE id = ?",
    )
      .bind(position, this.bookId)
      .run();
  }
}
