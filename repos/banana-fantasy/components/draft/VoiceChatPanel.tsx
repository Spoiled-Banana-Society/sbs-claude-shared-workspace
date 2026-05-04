'use client';

import React, { useEffect, useRef, useState } from 'react';

interface VoiceChatPanelProps {
  draftId: string;
}

export default function VoiceChatPanel({ draftId }: VoiceChatPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopStream = () => {
    if (!streamRef.current) return;
    streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const handleJoin = async () => {
    setError(null);
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setError('Voice chat unavailable in this browser.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setJoined(true);
      setMuted(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access failed.');
    }
  };

  const handleLeave = () => {
    stopStream();
    setJoined(false);
    setMuted(false);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
    }
  };

  useEffect(() => {
    return () => stopStream();
  }, []);

  return (
    <div className="fixed right-3 bottom-3 z-40 sm:right-4 sm:bottom-4">
      <div className="rounded-xl border border-white/15 bg-black/80 backdrop-blur-sm shadow-xl">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full px-3 py-2 text-sm font-semibold text-white flex items-center justify-between gap-2"
        >
          <span>🎤 Voice Chat (Beta)</span>
          <span className="text-xs text-white/60">{expanded ? 'Hide' : 'Open'}</span>
        </button>

        {expanded && (
          <div className="px-3 pb-3 space-y-2 min-w-[250px]">
            <div className="text-xs text-white/60">Room: {draftId}</div>

            {!joined ? (
              <button
                onClick={handleJoin}
                className="w-full rounded-lg bg-yellow-400 text-black font-semibold py-2 text-sm hover:bg-yellow-300 transition-colors"
              >
                Join Voice
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={toggleMute}
                  className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                    muted ? 'bg-red-500/80 text-white' : 'bg-emerald-500/80 text-white'
                  }`}
                >
                  {muted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  onClick={handleLeave}
                  className="rounded-lg py-2 text-sm font-semibold bg-white/10 text-white hover:bg-white/20 transition-colors"
                >
                  Leave
                </button>
              </div>
            )}

            {error && <p className="text-xs text-red-300">{error}</p>}
            <p className="text-[11px] text-white/45">MVP voice controls only (mic join/mute/leave) for pre-full room voice rollout.</p>
          </div>
        )}
      </div>
    </div>
  );
}
