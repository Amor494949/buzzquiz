// Animated pieces for the Display (TV) and host screens. Kept out of the
// player page so the phone buzzer stays as light as possible.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import NumberFlow from "@number-flow/react";
import confetti from "canvas-confetti";
import type { PublicPlayer } from "../../shared/types";
import { PlayerAvatar } from "./ui";

export { AnimatePresence, motion };

/** Wrap a page so every animation respects the OS "reduce motion" setting. */
export function Motion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

const spring = { type: "spring", stiffness: 420, damping: 34, mass: 0.9 } as const;

/** A score that rolls to its new value. */
export function Score({ value, className }: { value: number; className?: string }) {
  return (
    <span className={className} data-value={value} aria-label={String(value)}>
      <NumberFlow value={value} willChange aria-hidden />
    </span>
  );
}

function ranked(players: { id: string; name: string; score: number }[]) {
  const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  let rank = 0;
  let prev: number | null = null;
  return sorted.map((p, i) => {
    if (p.score !== prev) rank = i + 1;
    prev = p.score;
    return { id: p.id, rank };
  });
}

/**
 * Leaderboard shown on reveal. It first appears in the order from before this
 * question, then the scorer's +10 lands: their score rolls up and rows slide
 * into their new places.
 */
export function Leaderboard({ players, scoredId, points = 10 }: { players: PublicPlayer[]; scoredId?: string; points?: number }) {
  const [settled, setSettled] = useState(!scoredId);
  useEffect(() => {
    if (!scoredId) return setSettled(true);
    setSettled(false);
    const t = setTimeout(() => setSettled(true), 700);
    return () => clearTimeout(t);
  }, [scoredId]);

  const before = players.map((p) => ({ ...p, score: p.id === scoredId ? p.score - points : p.score }));
  const prevRank = new Map(ranked(before).map((r) => [r.id, r.rank]));
  const newRank = new Map(ranked(players).map((r) => [r.id, r.rank]));
  const scorerBefore = before.find((p) => p.id === scoredId)?.score;
  const scorerAfter = players.find((p) => p.id === scoredId)?.score;
  // Places moved: the scorer climbs by however many ranks they gained; anyone else
  // drops one place only if the scorer was strictly behind them and is now strictly ahead.
  const moveOf = (p: PublicPlayer): number => {
    if (scoredId == null || scorerBefore == null || scorerAfter == null) return 0;
    if (p.id === scoredId) return (prevRank.get(p.id) ?? 0) - (newRank.get(p.id) ?? 0);
    return scorerBefore < p.score && scorerAfter > p.score ? -1 : 0;
  };
  const shown = settled ? players : before;
  const order = ranked(shown);
  const byId = new Map(shown.map((p) => [p.id, p]));

  return (
    <motion.section
      className="leaderboard"
      aria-label="Leaderboard"
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={spring}
    >
      <h2 className="leaderboard-title">Leaderboard</h2>
      <ol>
        {order.map(({ id, rank }, i) => {
          const p = byId.get(id)!;
          const lead = rank === 1 && p.score > 0;
          return (
            <motion.li
              key={id}
              layout
              transition={spring}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0, transition: { ...spring, delay: 0.05 * i } }}
              className={`lb-row ${lead ? "lead" : ""} ${id === scoredId ? "scored" : ""}`}
            >
              <span className="lb-rank">{rank}</span>
              <PlayerAvatar name={p.name} color={p.color} size={48} animated />
              <span className="lb-name">
                {p.name}
                {settled && p.streak >= 2 && <span className="streak-tag">{p.streak} streak</span>}
              </span>
              <RankMove delta={moveOf(players.find((x) => x.id === id)!)} show={settled} />
              <Score value={p.score} className="lb-score" />
            </motion.li>
          );
        })}
      </ol>
    </motion.section>
  );
}

function RankMove({ delta: d, show }: { delta: number; show: boolean }) {
  const cls = !show || d === 0 ? "same" : d > 0 ? "up" : "down";
  const text = !show || d === 0 ? "–" : d > 0 ? `▲${d}` : `▼${-d}`;
  return (
    <motion.span key={`${cls}${text}`} className={`mv ${cls}`} initial={{ opacity: 0, y: d > 0 ? 6 : -6 }} animate={{ opacity: 1, y: 0 }} aria-label={cls === "same" ? "no change" : `${cls} ${Math.abs(d)}`}>
      {text}
    </motion.span>
  );
}

/** Final standings: rows arrive from last place up to the winner. */
export function Standings({ players, title, animated = true }: { players: PublicPlayer[]; title?: ReactNode; animated?: boolean }) {
  const order = ranked(players);
  const byId = new Map(players.map((p) => [p.id, p]));
  const n = order.length;
  return (
    <div className="standings">
      {title}
      <ol>
        {order.map(({ id, rank }, i) => {
          const p = byId.get(id)!;
          return (
            <motion.li
              key={id}
              layout
              className={rank === 1 ? "winner" : ""}
              initial={animated ? { opacity: 0, y: 30, scale: 0.96 } : false}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { ...spring, delay: animated ? 0.35 * (n - 1 - i) : 0 } }}
            >
              <span className="rank">{rank}</span>
              <PlayerAvatar name={p.name} color={p.color} size={44} animated={animated} />
              <span className="name">{p.name}</span>
              <Score value={p.score} className="score" />
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------- Confetti ----------

const CONFETTI_COLORS = ["#ff4b5c", "#2fd3c6", "#ece8e1", "#f5b83d"];

/** Small burst from the bottom corners: a correct answer. */
export function burstCorrect() {
  const base = { particleCount: 70, spread: 60, startVelocity: 55, ticks: 160, colors: CONFETTI_COLORS, disableForReducedMotion: true };
  confetti({ ...base, angle: 60, origin: { x: 0, y: 0.95 } });
  confetti({ ...base, angle: 120, origin: { x: 1, y: 0.95 } });
}

/** Longer celebration: the winner at the end of the game. */
export function celebrateWinner() {
  const end = Date.now() + 2600;
  const frame = () => {
    confetti({ particleCount: 6, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors: CONFETTI_COLORS, disableForReducedMotion: true });
    confetti({ particleCount: 6, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors: CONFETTI_COLORS, disableForReducedMotion: true });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
}

/** Run `fn` once each time `key` changes to a new non-empty value. */
export function useOnNewKey(key: string | null | undefined, fn: () => void) {
  const seen = useRef<string | null | undefined>(key);
  useEffect(() => {
    if (key && key !== seen.current) fn();
    seen.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
