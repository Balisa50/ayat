"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

interface FloatingReciteButtonProps {
  playing: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

/**
 * Draggable floating play/pause button.
 * Defaults to middle-left of screen.
 * When playing: collapses to a small pulsing circle.
 * When idle: shows as a full play button.
 */
export function FloatingReciteButton({
  playing,
  onToggle,
  disabled = false,
}: FloatingReciteButtonProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);
  const dragOffset = useRef({ dx: 0, dy: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hasMoved = useRef(false);

  // Initialise position after mount (needs window dimensions).
  // Default: middle-right edge of viewport.
  useEffect(() => {
    setPos({
      x: window.innerWidth - 64,
      y: Math.round(window.innerHeight / 2) - 24,
    });
  }, []);

  // ── Mouse drag ──────────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    if (disabled) return;
    dragging.current = true;
    hasMoved.current = false;
    dragOffset.current = {
      dx: e.clientX - (pos?.x ?? 16),
      dy: e.clientY - (pos?.y ?? window.innerHeight / 2),
    };
    e.preventDefault();
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !pos) return;
      hasMoved.current = true;
      const size = playing ? 36 : 48;
      const newX = Math.max(0, Math.min(window.innerWidth - size, e.clientX - dragOffset.current.dx));
      const newY = Math.max(0, Math.min(window.innerHeight - size, e.clientY - dragOffset.current.dy));
      setPos({ x: newX, y: newY });
    };
    const onMouseUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [pos, playing]);

  // ── Touch drag ──────────────────────────────────────────────────────────
  const onTouchStart = (e: React.TouchEvent) => {
    if (disabled) return;
    const t = e.touches[0];
    dragging.current = true;
    hasMoved.current = false;
    dragOffset.current = {
      dx: t.clientX - (pos?.x ?? 16),
      dy: t.clientY - (pos?.y ?? window.innerHeight / 2),
    };
  };

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current || !pos) return;
      hasMoved.current = true;
      const t = e.touches[0];
      const size = playing ? 36 : 48;
      const newX = Math.max(0, Math.min(window.innerWidth - size, t.clientX - dragOffset.current.dx));
      const newY = Math.max(0, Math.min(window.innerHeight - size, t.clientY - dragOffset.current.dy));
      setPos({ x: newX, y: newY });
      e.preventDefault();
    };
    const onTouchEnd = () => { dragging.current = false; };
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [pos, playing]);

  const handleClick = () => {
    // Only fire click if the button wasn't dragged
    if (hasMoved.current) return;
    onToggle();
  };

  if (!pos) return null;

  const size = playing ? 36 : 48;

  return (
    <button
      ref={buttonRef}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onClick={handleClick}
      disabled={disabled}
      aria-label={playing ? "Pause recitation" : "Play recitation"}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 50,
        width: size,
        height: size,
        borderRadius: "50%",
        border: playing
          ? "1.5px solid rgba(255,215,0,0.55)"
          : "1.5px solid rgba(255,255,255,0.25)",
        background: playing
          ? "rgba(255,215,0,0.12)"
          : "rgba(0,0,0,0.55)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "grab",
        opacity: disabled ? 0.35 : 1,
        transition: "width 0.2s ease, height 0.2s ease, border-color 0.2s ease, background 0.2s ease",
        boxShadow: playing
          ? "0 0 14px rgba(255,215,0,0.25), 0 2px 8px rgba(0,0,0,0.4)"
          : "0 2px 8px rgba(0,0,0,0.4)",
        userSelect: "none",
        touchAction: "none",
        WebkitUserSelect: "none",
      }}
    >
      {playing ? (
        /* Collapsed "O" mode - small pulsing circle with pause icon */
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "recite-pulse 1.4s ease-in-out infinite",
          }}
        >
          <VolumeX
            size={15}
            style={{ color: "rgba(255,215,0,0.9)", flexShrink: 0 }}
          />
        </span>
      ) : (
        <Volume2
          size={20}
          style={{ color: "rgba(255,255,255,0.8)", flexShrink: 0 }}
        />
      )}
      <style>{`
        @keyframes recite-pulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50%       { opacity: 1;   transform: scale(1.15); }
        }
      `}</style>
    </button>
  );
}
