import type {
  ClientMessage,
  Env,
  PlaybackState,
  ServerMessage,
  SessionAttachment,
} from "./types";

type Meta = {
  playback: PlaybackState;
  roomId: string | null;
  bookId: string | null;
  revision: number;
};

/**
 * Hibernation-safe Durable Object.
 * Never rely on an in-memory Map of sockets — after hibernation it is empty.
 * Use state.getWebSockets() + serializeAttachment instead.
 */
export class ListeningRoom implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private playback: PlaybackState = {
    position: 0,
    isPlaying: false,
    updatedAt: Date.now(),
  };
  private roomId: string | null = null;
  private bookId: string | null = null;
  private revision = 0;
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
        this.revision = stored.revision ?? 0;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/hydrate") && request.method === "POST") {
      const body = (await request.json()) as {
        roomId: string;
        bookId?: string | null;
        lastPosition: number;
      };
      this.roomId = body.roomId;
      this.bookId = body.bookId ?? this.bookId;
      const sockets = this.state.getWebSockets();
      if (!this.playback.isPlaying && sockets.length === 0) {
        this.playback.position = body.lastPosition || 0;
        this.playback.updatedAt = Date.now();
      } else if (this.playback.position === 0 && body.lastPosition) {
        this.playback.position = body.lastPosition;
        this.playback.updatedAt = Date.now();
      }
      await this.persistMeta();
      return Response.json({ ok: true });
    }

    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const name =
      url.searchParams.get("name")?.trim().slice(0, 32) || "Guest";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    const attachment: SessionAttachment = { name };
    server.serializeAttachment(attachment);

    this.revision += 1;
    await this.persistMeta();

    // Tell everyone who is here + current playback.
    this.broadcastAll();

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

    let attachment =
      (ws.deserializeAttachment() as SessionAttachment | null) ?? {
        name: "Guest",
      };

    if (data.type === "join") {
      attachment = {
        name: data.name.trim().slice(0, 32) || "Guest",
      };
      ws.serializeAttachment(attachment);
      this.revision += 1;
      await this.persistMeta();
      this.broadcastAll();
      return;
    }

    if (data.type === "leave") {
      // Drop this socket from presence immediately, then close.
      this.revision += 1;
      await this.persistMeta();
      this.broadcastExcept(ws);
      try {
        ws.close(1000, "left");
      } catch {
        // ignore
      }
      return;
    }

    if (data.type === "heartbeat") {
      // Keep-alive only — do not overwrite shared playback from followers.
      return;
    }

    if (
      data.type === "play" ||
      data.type === "pause" ||
      data.type === "seek"
    ) {
      const position = Math.max(0, Number(data.position) || 0);
      let isPlaying = this.playback.isPlaying;
      if (data.type === "play") isPlaying = true;
      if (data.type === "pause") isPlaying = false;
      if (data.type === "seek") isPlaying = Boolean(data.isPlaying);

      this.playback = {
        position,
        isPlaying,
        updatedAt: Date.now(),
      };
      this.revision += 1;
      await this.persistMeta();
      await this.schedulePersist();

      // Broadcast to everyone including sender so clients share one timeline.
      this.broadcastAll();
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean) {
    this.revision += 1;
    await this.persistMeta();
    // The closing socket can still appear in getWebSockets() — exclude it.
    this.broadcastExcept(ws);
    const remaining = this.state
      .getWebSockets()
      .filter((socket) => socket !== ws);
    if (remaining.length === 0) {
      await this.flushPositionToD1();
    }
  }

  async webSocketError(ws: WebSocket) {
    this.revision += 1;
    await this.persistMeta();
    this.broadcastExcept(ws);
    try {
      ws.close(1011, "error");
    } catch {
      // ignore
    }
  }

  async alarm() {
    this.persistAlarmSet = false;
    await this.flushPositionToD1();
  }

  private listeners(exclude?: WebSocket): string[] {
    return this.state
      .getWebSockets()
      .filter((socket) => socket !== exclude)
      .map((socket) => {
        const attachment = socket.deserializeAttachment() as
          | SessionAttachment
          | null;
        return attachment?.name?.trim() || "Guest";
      });
  }

  private livePosition(): number {
    if (!this.playback.isPlaying) return this.playback.position;
    const elapsed = (Date.now() - this.playback.updatedAt) / 1000;
    return this.playback.position + Math.max(0, elapsed);
  }

  private statePayload(you: string | null, exclude?: WebSocket): ServerMessage {
    return {
      type: "state",
      position: this.livePosition(),
      isPlaying: this.playback.isPlaying,
      updatedAt: this.playback.updatedAt,
      revision: this.revision,
      listeners: this.listeners(exclude),
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

  private broadcastAll() {
    for (const ws of this.state.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as SessionAttachment | null;
      const you = attachment?.name || "";
      this.send(ws, this.statePayload(you));
    }
  }

  private broadcastExcept(exclude: WebSocket) {
    for (const ws of this.state.getWebSockets()) {
      if (ws === exclude) continue;
      const attachment = ws.deserializeAttachment() as SessionAttachment | null;
      const you = attachment?.name || "";
      this.send(ws, this.statePayload(you, exclude));
    }
  }

  private async persistMeta() {
    await this.state.storage.put("meta", {
      playback: this.playback,
      roomId: this.roomId,
      bookId: this.bookId,
      revision: this.revision,
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
