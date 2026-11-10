import { useEffect, useState } from "react";
// Fonts bundled with the app (no Google Fonts request, no flash of fallback text).
import "@fontsource/archivo/latin-400.css";
import "@fontsource/archivo/latin-500.css";
import "@fontsource/archivo/latin-600.css";
import "@fontsource/archivo/latin-700.css";
import "@fontsource/archivo/latin-800.css";
import "@fontsource/archivo-black/latin-400.css";
import { Avatar, Style } from "@dicebear/core";
import critters from "@dicebear/styles/critters.json";
import QRCode from "qrcode";
import { richHtml } from "../../shared/format";
import { currentAnswerer, timerRemaining } from "../../shared/game";
import type { PublicPlayer, QueueEntry, Timer } from "../../shared/types";

const critterStyle = new Style(critters as ConstructorParameters<typeof Style>[0]);
const avatarCache = new Map<string, string>();

function critterUri(name: string, color: string, animated: boolean): string {
  const key = `${name}|${color}|${animated}`;
  let uri = avatarCache.get(key);
  if (!uri) {
    uri = new Avatar(critterStyle, {
      seed: name.trim().toLowerCase() || "?",
      size: 128,
      backgroundColor: color.replace("#", ""),
      animationVariant: animated ? "slow" : "none",
    }).toDataUri();
    avatarCache.set(key, uri);
  }
  return uri;
}

/** DiceBear "Critters" avatar (CC0), generated from the player's name on their colour. */
export function PlayerAvatar({ name, color, size = 40, animated = false }: { name: string; color: string; size?: number; animated?: boolean }) {
  return (
    <span className="avatar" style={{ background: color, width: size, height: size }} aria-hidden>
      <img src={critterUri(name, color, animated)} width={size} height={size} alt="" draggable={false} />
    </span>
  );
}

export function Rich({ text, className, images = true }: { text: string; className?: string; images?: boolean }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: richHtml(text, { images }) }} />;
}

export function formatClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function TimerBadge({ timer, now, large }: { timer: Timer; now: number; large?: boolean }) {
  const left = timerRemaining(timer, now);
  const running = timer.startedAt != null && left > 0;
  const state = left <= 0 && (timer.startedAt != null || timer.elapsedBefore > 0) ? "up" : running ? (left <= 5000 ? "low" : "run") : "idle";
  return (
    <span className={`timer timer-${state} ${large ? "timer-large" : ""}`} role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      {state === "up" ? "Time's up" : formatClock(left)}
    </span>
  );
}

export interface QueueRow {
  entry: QueueEntry;
  player?: PublicPlayer;
  place: number;
  gapMs: number;
  answering: boolean;
  settled: boolean;
}

export function queueRows(queue: QueueEntry[], players: PublicPlayer[], now: number): QueueRow[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const ans = currentAnswerer(queue, now);
  const first = queue[0]?.est ?? 0;
  return queue.map((entry, i) => ({
    entry,
    player: byId.get(entry.id),
    place: i + 1,
    gapMs: Math.round(entry.est - first),
    answering: ans?.id === entry.id,
    settled: ans?.id === entry.id ? ans.settled : true,
  }));
}

export function Qr({ text, size = 200 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: size * 2, color: { dark: "#1d1d1f", light: "#ffffff" } }).then(setSrc, () => setSrc(""));
  }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt={`QR code for ${text}`} className="qr" /> : <div style={{ width: size, height: size }} />;
}

export function ConnPill({ status }: { status: string }) {
  return <span className={`conn conn-${status}`}>{status}</span>;
}

export function Toasts({ items }: { items: { id: number; text: string; kind: "info" | "error" }[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function useToasts() {
  const [items, setItems] = useState<{ id: number; text: string; kind: "info" | "error" }[]>([]);
  const push = (text: string, kind: "info" | "error" = "info") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3500);
  };
  return { items, push };
}

