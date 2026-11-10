import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { richHtml } from "../../shared/format";
import { currentAnswerer, timerRemaining } from "../../shared/game";
import type { PublicPlayer, QueueEntry, Timer } from "../../shared/types";

function hashName(s: string): number {
  let h = 2166136261;
  for (const c of s.toLowerCase()) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Pixel critter: a mirrored 5x5 creature generated from the player's name. */
export function Avatar({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  const h = hashName(name || "?");
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const on = ((h >> (y * 3 + x)) & 1) === 1 || (y === 1 && x === 1) || (y === 2 && x === 2);
      if (!on) continue;
      cells.push({ x, y });
      if (x < 2) cells.push({ x: 4 - x, y });
    }
  }
  const px = 5.6;
  const o = 6;
  return (
    <span className="avatar" style={{ background: color, width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 40 40" width={size} height={size} shapeRendering="crispEdges">
        {cells.map((c) => (
          <rect key={`${c.x}-${c.y}`} x={o + c.x * px} y={o + c.y * px} width={px} height={px} fill="#fff" />
        ))}
        <rect x={o + px + 1.6} y={o + px + 1.6} width={2.4} height={2.4} fill={color} />
        <rect x={o + 3 * px + 1.6} y={o + px + 1.6} width={2.4} height={2.4} fill={color} />
      </svg>
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

export function Standings({ players, title }: { players: PublicPlayer[]; title?: ReactNode }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  let rank = 0;
  let prev: number | null = null;
  return (
    <div className="standings">
      {title}
      <ol>
        {sorted.map((p, i) => {
          if (p.score !== prev) rank = i + 1;
          prev = p.score;
          return (
            <li key={p.id} className={rank === 1 ? "winner" : ""}>
              <span className="rank">{rank}</span>
              <Avatar name={p.name} color={p.color} size={44} />
              <span className="name">{p.name}</span>
              <span className="score">{p.score}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ScoreStrip({ players }: { players: PublicPlayer[] }) {
  return (
    <div className="score-strip">
      {players.map((p) => (
        <div key={p.id} className="score-chip">
          <Avatar name={p.name} color={p.color} size={36} />
          <span className="name">{p.name}</span>
          <span className="score">{p.score}</span>
        </div>
      ))}
    </div>
  );
}

/** Ranked leaderboard shown on the Display when the answer is revealed. */
export function Leaderboard({ players, scoredId }: { players: PublicPlayer[]; scoredId?: string }) {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let rank = 0;
  let prev: number | null = null;
  return (
    <section className="leaderboard" aria-label="Leaderboard">
      <h2 className="leaderboard-title">Leaderboard</h2>
      <ol>
        {sorted.map((p, i) => {
          if (p.score !== prev) rank = i + 1;
          prev = p.score;
          return (
            <li key={p.id} className={`lb-row ${rank === 1 && p.score > 0 ? "lead" : ""} ${p.id === scoredId ? "scored" : ""}`}>
              <span className="lb-rank">{rank}</span>
              <Avatar name={p.name} color={p.color} size={48} />
              <span className="lb-name">{p.name}</span>
              {p.id === scoredId && <span className="lb-delta">+10</span>}
              <span className="lb-score">{p.score}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
