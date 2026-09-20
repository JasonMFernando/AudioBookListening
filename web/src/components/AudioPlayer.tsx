"use client";

import { useEffect, useRef, useState } from "react";
import { audioUrlForRoom, savePosition } from "@/lib/api";
import { formatTime } from "@/lib/format";
import type { useRoomSync } from "@/hooks/useRoomSync";

type SyncApi = ReturnType<typeof useRoomSync>;

type Props = {
  code: string;
  bookId: string;
  hasAudio: boolean;
  initialPosition: number;
  sync: SyncApi;
  onTimeUpdate?: (seconds: number) => void;
};

export function AudioPlayer({
  code,
  bookId,
  hasAudio,
  initialPosition,
  sync,
  onTimeUpdate,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const applyingRemote = useRef(false);
  const seeded = useRef(false);
  const lastAppliedRevision = useRef(0);
  const [current, setCurrent] = useState(initialPosition);
  const [duration, setDuration] = useState(0);
  const lastSaved = useRef(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !hasAudio || seeded.current) return;
    if (initialPosition > 0) {
      audio.currentTime = initialPosition;
      setCurrent(initialPosition);
    }
    seeded.current = true;
  }, [hasAudio, initialPosition]);

  // Apply remote playback whenever the room revision advances.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !hasAudio) return;

    const revision = sync.state.revision;
    if (!revision || revision === lastAppliedRevision.current) return;
    lastAppliedRevision.current = revision;

    const target = sync.state.position;
    const drift = Math.abs(audio.currentTime - target);

    applyingRemote.current = true;
    if (drift > 0.75) {
      try {
        audio.currentTime = target;
      } catch {
        // ignore seek errors while metadata loading
      }
      setCurrent(target);
    }

    if (sync.state.isPlaying) {
      if (audio.paused) {
        void audio.play().catch(() => undefined);
      }
    } else if (!audio.paused) {
      audio.pause();
    }

    window.setTimeout(() => {
      applyingRemote.current = false;
    }, 350);
  }, [
    hasAudio,
    sync.state.revision,
    sync.state.position,
    sync.state.isPlaying,
  ]);

  useEffect(() => {
    const id = setInterval(() => {
      const audio = audioRef.current;
      if (!audio || audio.paused) return;
      sync.heartbeat(audio.currentTime, true);
    }, 20000);
    return () => clearInterval(id);
  }, [sync]);

  function skipBy(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const next = Math.max(
      0,
      Math.min(
        audio.duration || Number.POSITIVE_INFINITY,
        audio.currentTime + delta,
      ),
    );
    applyingRemote.current = true;
    audio.currentTime = next;
    setCurrent(next);
    sync.seek(next, !audio.paused);
    window.setTimeout(() => {
      applyingRemote.current = false;
    }, 350);
  }

  if (!hasAudio) {
    return (
      <div className="player-empty">
        <p>No audio linked to this room.</p>
      </div>
    );
  }

  return (
    <div className="player">
      <audio
        ref={audioRef}
        src={audioUrlForRoom(code)}
        preload="auto"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setDuration(el.duration || 0);
          if (!seeded.current && initialPosition > 0) {
            el.currentTime = initialPosition;
            setCurrent(initialPosition);
            seeded.current = true;
          }
        }}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrent(t);
          onTimeUpdate?.(t);
          if (t - lastSaved.current > 15) {
            lastSaved.current = t;
            void savePosition(bookId, t).catch(() => undefined);
          }
        }}
        onPlay={(e) => {
          if (applyingRemote.current) return;
          sync.play(e.currentTarget.currentTime);
        }}
        onPause={(e) => {
          if (applyingRemote.current) return;
          const t = e.currentTarget.currentTime;
          sync.pause(t);
          void savePosition(bookId, t).catch(() => undefined);
        }}
        onSeeked={(e) => {
          if (applyingRemote.current) return;
          sync.seek(e.currentTarget.currentTime, !e.currentTarget.paused);
        }}
      />

      <div className="player-times">
        <span>{formatTime(current)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      <input
        className="seek"
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={Math.min(current, duration || current)}
        onChange={(e) => {
          const next = Number(e.target.value);
          const audio = audioRef.current;
          if (!audio) return;
          applyingRemote.current = true;
          audio.currentTime = next;
          setCurrent(next);
          sync.seek(next, !audio.paused);
          window.setTimeout(() => {
            applyingRemote.current = false;
          }, 350);
        }}
      />

      <div className="player-controls">
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            const audio = audioRef.current;
            if (!audio) return;
            if (audio.paused) void audio.play();
            else audio.pause();
          }}
        >
          {sync.state.isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => skipBy(-15)}>
          -15s
        </button>
        <button type="button" className="btn-ghost" onClick={() => skipBy(15)}>
          +15s
        </button>
      </div>
    </div>
  );
}
