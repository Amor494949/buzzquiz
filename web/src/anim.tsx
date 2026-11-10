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

  const shown = players.map((p) => ({ ...p, score: !settled && p.id === scoredId ? p.score - points : p.score }));
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
              <span className="lb-name">{p.name}</span>
              <AnimatePresence>
                {id === scoredId && settled && (
                  <motion.span className="lb-delta" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring}>
                    +{points}
                  </motion.span>
                )}
              </AnimatePresence>
              <Score value={p.score} className="lb-score" />
            </motion.li>
          );
        })}
      </ol>
    </motion.section>
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

const CONFETTI_COLORS = ["#2e6b53", "#f05d3b", "#e9a21b", "#dbeee0", "#fbfcfa"];

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
