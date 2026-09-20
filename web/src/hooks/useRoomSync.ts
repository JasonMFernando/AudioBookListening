"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { wsUrl } from "@/lib/api";

export type SyncState = {
  position: number;
  isPlaying: boolean;
  updatedAt: number;
  revision: number;
  listeners: string[];
  connected: boolean;
};

type ServerMessage =
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

/** Brief window where we don't re-apply our own echoed state as "remote". */
const LOCAL_ECHO_MS = 300;

export function useRoomSync(code: string, name: string, enabled: boolean) {
  const [state, setState] = useState<SyncState>({
    position: 0,
    isPlaying: false,
    updatedAt: Date.now(),
    revision: 0,
    listeners: [],
    connected: false,
  });
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ignoreEchoUntil = useRef(0);
  const intentionalClose = useRef(false);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const markLocalControl = useCallback(() => {
    ignoreEchoUntil.current = Date.now() + LOCAL_ECHO_MS;
  }, []);

  const leave = useCallback(() => {
    intentionalClose.current = true;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "leave" }));
      } catch {
        // ignore
      }
      try {
        ws.close(1000, "left");
      } catch {
        // ignore
      }
    }
    wsRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled || !code || !name) return;

    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    intentionalClose.current = false;

    const connect = () => {
      const ws = new WebSocket(wsUrl(code, name));
      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
        attempt = 0;
        setState((s) => ({ ...s, connected: true }));
        setError(null);
        ws.send(JSON.stringify({ type: "join", name }));
      };

      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === "error") {
          setError(msg.message);
          return;
        }
        if (msg.type === "state") {
          const suppressPlayhead = Date.now() < ignoreEchoUntil.current;

          setState((prev) => ({
            position: suppressPlayhead ? prev.position : msg.position,
            isPlaying: suppressPlayhead ? prev.isPlaying : msg.isPlaying,
            updatedAt: suppressPlayhead ? prev.updatedAt : msg.updatedAt,
            revision: msg.revision,
            listeners: msg.listeners,
            connected: true,
          }));
        }
      };

      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!closed && !intentionalClose.current) {
          attempt += 1;
          const delay = Math.min(8000, 500 * 2 ** Math.min(attempt, 4));
          retryTimer = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        if (!intentionalClose.current) {
          setError("Realtime connection error — retrying…");
        }
      };
    };

    connect();

    return () => {
      closed = true;
      intentionalClose.current = true;
      if (retryTimer) clearTimeout(retryTimer);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "leave" }));
        } catch {
          // ignore
        }
        try {
          ws.close(1000, "left");
        } catch {
          // ignore
        }
      }
      wsRef.current = null;
    };
  }, [code, name, enabled]);

  const play = useCallback(
    (position: number) => {
      markLocalControl();
      send({ type: "play", position });
      setState((s) => ({
        ...s,
        isPlaying: true,
        position,
        updatedAt: Date.now(),
      }));
    },
    [send, markLocalControl],
  );

  const pause = useCallback(
    (position: number) => {
      markLocalControl();
      send({ type: "pause", position });
      setState((s) => ({
        ...s,
        isPlaying: false,
        position,
        updatedAt: Date.now(),
      }));
    },
    [send, markLocalControl],
  );

  const seek = useCallback(
    (position: number, isPlaying: boolean) => {
      markLocalControl();
      send({ type: "seek", position, isPlaying });
      setState((s) => ({
        ...s,
        position,
        isPlaying,
        updatedAt: Date.now(),
      }));
    },
    [send, markLocalControl],
  );

  const heartbeat = useCallback(
    (position: number, isPlaying: boolean) => {
      send({ type: "heartbeat", position, isPlaying });
    },
    [send],
  );

  return {
    state,
    error,
    play,
    pause,
    seek,
    heartbeat,
    leave,
  };
}
