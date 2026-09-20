"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { wsUrl } from "@/lib/api";

export type SyncState = {
  position: number;
  isPlaying: boolean;
  updatedAt: number;
  listeners: string[];
  connected: boolean;
};

type ServerMessage =
  | {
      type: "state";
      position: number;
      isPlaying: boolean;
      updatedAt: number;
      listeners: string[];
      you: string;
    }
  | { type: "error"; message: string };

const LOCAL_IGNORE_MS = 1500;

export function useRoomSync(code: string, name: string, enabled: boolean) {
  const [state, setState] = useState<SyncState>({
    position: 0,
    isPlaying: false,
    updatedAt: Date.now(),
    listeners: [],
    connected: false,
  });
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ignoreUntil = useRef(0);
  const lastRemoteUpdatedAt = useRef(0);

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  const markLocalControl = useCallback(() => {
    ignoreUntil.current = Date.now() + LOCAL_IGNORE_MS;
  }, []);

  useEffect(() => {
    if (!enabled || !code || !name) return;

    let closed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const ws = new WebSocket(wsUrl(code, name));
      wsRef.current = ws;

      ws.onopen = () => {
        if (closed) return;
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
          // Ignore echoes while we are driving playback locally.
          if (Date.now() < ignoreUntil.current) {
            setState((s) => ({
              ...s,
              listeners: msg.listeners,
              connected: true,
            }));
            return;
          }

          lastRemoteUpdatedAt.current = msg.updatedAt;
          setState({
            position: msg.position,
            isPlaying: msg.isPlaying,
            updatedAt: msg.updatedAt,
            listeners: msg.listeners,
            connected: true,
          });
        }
      };

      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!closed) {
          retryTimer = setTimeout(connect, 1500);
        }
      };

      ws.onerror = () => {
        setError("Realtime connection error");
      };
    };

    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
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
      // Soft presence only — does not fight the local playhead.
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
    lastRemoteUpdatedAt,
  };
}
