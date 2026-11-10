// Pure game rules. The Durable Object calls these; the screens use the
// read-only helpers (queue order, answerer, timer) to render between updates.

import {
  AVATARS,
  BUZZ_LEAD_MS,
  MAX_TRAVEL_MS,
  POINTS,
  SETTLE_MS,
  type DisplayView,
  type Game,
  type HostAction,
  type HostView,
  type PlayerView,
  type PublicPlayer,
  type PublicQuestion,
  type QState,
  type QueueEntry,
  type Question,
  type RoomState,
  type Timer,
} from "./types";

const MAX_UNDO = 300;

// ---------- Read-only helpers (used by server and clients) ----------

export function timerElapsed(t: Timer, now: number): number {
  return t.elapsedBefore + (t.startedAt != null ? Math.max(0, now - t.startedAt) : 0);
}

export function timerRemaining(t: Timer, now: number): number {
  return Math.max(0, t.duration - timerElapsed(t, now));
}

export function timerExpired(t: Timer, now: number): boolean {
  const started = t.startedAt != null || t.elapsedBefore > 0;
  return started && timerRemaining(t, now) <= 0;
}

export function sortedQueue(entries: QueueEntry[]): QueueEntry[] {
  return [...entries].sort((a, b) => a.est - b.est);
}

/** Who should answer now: the earliest unmarked buzz, once it has settled. */
export function currentAnswerer(
  queue: QueueEntry[],
  now: number,
): { id: string; settled: boolean } | null {
  if (queue.some((e) => e.mark === "correct")) return null;
  const next = sortedQueue(queue).find((e) => !e.mark);
  if (!next) return null;
  return { id: next.id, settled: now >= next.est + SETTLE_MS };
}

export function isResolved(q: { queue: QueueEntry[] }, playerIds: string[]): boolean {
  if (q.queue.some((e) => e.mark === "correct")) return true;
  return playerIds.length > 0 && playerIds.every((id) => q.queue.some((e) => e.id === id && e.mark === "wrong"));
}

export type BuzzerPhase = "waiting" | "locked" | "open" | "closed" | "resolved";

export function buzzerPhase(
  q: PublicQuestion | null,
  playerIds: string[],
  now: number,
): BuzzerPhase {
  if (!q) return "waiting";
  if (isResolved(q, playerIds)) return "resolved";
  if (q.buzzOpenAt == null || now < q.buzzOpenAt) return "locked";
  if (timerExpired(q.timer, now)) return "closed";
  return "open";
}

// ---------- State helpers ----------

function queueOf(q: QState): QueueEntry[] {
  return sortedQueue(q.buzzes.map((b) => ({ id: b.id, est: b.est, mark: q.marks[b.id] })));
}

function playerIds(s: RoomState): string[] {
  return Object.values(s.players).map((p) => p.id);
}

function questionFor(s: RoomState, q: QState): Question {
  const list = q.kind === "main" ? s.quiz.questions : s.quiz.spares;
  return list.find((x) => x.id === q.qid)!;
}

function freshQuestion(qid: string, kind: QState["kind"], defaultTimer: number, now: number): QState {
  return {
    qid,
    kind,
    shownAt: now,
    buzzOpenAt: null,
    timer: { duration: defaultTimer * 1000, startedAt: null, elapsedBefore: 0 },
    buzzes: [],
    marks: {},
    revealed: false,
  };
}

function open(s: RoomState, qid: string, kind: QState["kind"], now: number) {
  const g = s.game;
  if (g.current) g.played[g.current.qid] = g.current;
  g.current = g.played[qid] ?? freshQuestion(qid, kind, g.defaultTimer, now);
  g.phase = "question";
}

function leaveCurrent(g: Game) {
  if (g.current) g.played[g.current.qid] = g.current;
  g.current = null;
}

function clone<T>(x: T): T {
  return structuredClone(x);
}

function snapshot(s: RoomState, label: string) {
  const scores: Record<string, number> = {};
  for (const p of Object.values(s.players)) scores[p.id] = p.score;
  s.undo.push({ label, scores, game: clone(s.game) });
  if (s.undo.length > MAX_UNDO) s.undo.shift();
  s.redo = [];
}

function restore(s: RoomState, snap: { scores: Record<string, number>; game: Game }) {
  const live = s.game.current;
  const game = clone(snap.game);
  // Buzzes and the running timer are live facts: keep them if we land on the same question.
  if (live && game.current && game.current.qid === live.qid) {
    game.current.buzzes = clone(live.buzzes);
    game.current.timer = clone(live.timer);
    game.current.buzzOpenAt = live.buzzOpenAt;
  }
  s.game = game;
  for (const p of Object.values(s.players)) {
    if (p.id in snap.scores) p.score = snap.scores[p.id];
  }
}

function nameOf(s: RoomState, id: string): string {
  return Object.values(s.players).find((p) => p.id === id)?.name ?? "player";
}

export function newRoom(code: string, hostKey: string, quiz: RoomState["quiz"], now: number): RoomState {
  return {
    code,
    hostKey,
    createdAt: now,
    quiz,
    players: {},
    game: { phase: "lobby", index: 0, current: null, played: {}, defaultTimer: 30 },
    undo: [],
    redo: [],
  };
}

export function joinPlayer(s: RoomState, pid: string, name: string, maxPlayers: number): string | null {
  const existing = s.players[pid];
  if (existing) {
    existing.name = name;
    return null;
  }
  const list = Object.values(s.players);
  if (list.length >= maxPlayers) return "Room is full";
  const usedAvatars = new Set(list.map((p) => p.avatar));
  const usedIds = new Set(list.map((p) => p.id));
  let n = 1;
  while (usedIds.has(`p${n}`)) n++;
  const avatar = AVATARS.findIndex((_, i) => !usedAvatars.has(i));
  s.players[pid] = { pid, id: `p${n}`, name, avatar, score: 0 };
  return null;
}

// ---------- Player buzz ----------

export function applyBuzz(s: RoomState, pid: string, qid: string, est: number, now: number): number | null {
  const p = s.players[pid];
  const q = s.game.current;
  if (!p || !q || s.game.phase !== "question" || q.qid !== qid) return null;
  if (q.buzzOpenAt == null || now < q.buzzOpenAt - 100) return null; // not open yet (allow small clock error)
  if (isResolved({ queue: queueOf(q) }, playerIds(s))) return null;
  if (timerExpired(q.timer, now - SETTLE_MS)) return null;
  if (q.buzzes.some((b) => b.id === p.id)) return null;
  const clamped = Math.min(now, Math.max(est, q.buzzOpenAt, now - MAX_TRAVEL_MS));
  q.buzzes.push({ id: p.id, arrival: now, est: clamped });
  return queueOf(q).findIndex((e) => e.id === p.id) + 1;
}

// ---------- Host actions ----------

export function applyHost(s: RoomState, a: HostAction, now: number): string | null {
  const g = s.game;
  const q = g.current;
  const qs = s.quiz.questions;

  switch (a.t) {
    case "start": {
      if (g.phase !== "lobby") return "Game already started";
      if (!qs.length) return "This quiz has no questions";
      snapshot(s, "Start game");
      g.index = 0;
      open(s, qs[0].id, "main", now);
      return null;
    }
    case "next": {
      if (g.phase === "lobby" || g.phase === "ended") return "Nothing to move to";
      snapshot(s, "Next question");
      const nextIndex = g.index + 1; // after a spare, carry on from the main question it replaced
      if (nextIndex >= qs.length) {
        leaveCurrent(g);
        g.index = qs.length;
        g.phase = "ended";
      } else {
        g.index = nextIndex;
        open(s, qs[nextIndex].id, "main", now);
      }
      return null;
    }
    case "prev": {
      if (g.phase === "lobby") return "Nothing to go back to";
      let target: number;
      if (g.phase === "ended") target = qs.length - 1;
      else if (q?.kind === "spare") target = Math.min(g.index, qs.length - 1);
      else target = g.index - 1;
      if (target < 0) return "Already at the first question";
      snapshot(s, "Previous question");
      g.index = target;
      open(s, qs[target].id, "main", now);
      return null;
    }
    case "spare": {
      const sp = s.quiz.spares.find((x) => x.id === a.qid);
      if (!sp) return "No such spare";
      if (g.phase === "lobby") return "Start the game first";
      snapshot(s, `Play spare ${sp.n}`);
      open(s, sp.id, "spare", now);
      return null;
    }
    case "correct":
    case "wrong": {
      if (!q) return "No question showing";
      const ans = currentAnswerer(queueOf(q), now);
      if (!ans || ans.id !== a.id) return "That player isn't answering right now";
      if (!ans.settled) return "Still checking the buzz order, try again";
      const name = nameOf(s, a.id);
      snapshot(s, a.t === "correct" ? `+${POINTS} to ${name}` : `Marked ${name} wrong`);
      q.marks[a.id] = a.t;
      if (a.t === "correct") {
        const p = Object.values(s.players).find((x) => x.id === a.id);
        if (p) p.score += POINTS;
      }
      return null;
    }
    case "reveal": {
      if (!q) return "No question showing";
      if (q.revealed) return null;
      snapshot(s, "Reveal answer");
      q.revealed = true;
      return null;
    }
    case "end": {
      if (g.phase === "ended") return null;
      snapshot(s, "End game");
      leaveCurrent(g);
      g.phase = "ended";
      return null;
    }
    case "undo": {
      const snap = s.undo.pop();
      if (!snap) return "Nothing to undo";
      const scores: Record<string, number> = {};
      for (const p of Object.values(s.players)) scores[p.id] = p.score;
      s.redo.push({ label: snap.label, scores, game: clone(g) });
      restore(s, snap);
      return null;
    }
    case "redo": {
      const snap = s.redo.pop();
      if (!snap) return "Nothing to redo";
      const scores: Record<string, number> = {};
      for (const p of Object.values(s.players)) scores[p.id] = p.score;
      s.undo.push({ label: snap.label, scores, game: clone(g) });
      restore(s, snap);
      return null;
    }
    // Timer controls are not undoable: the opposite button reverses them.
    case "timerStart": {
      if (!q) return "No question showing";
      if (q.timer.startedAt == null && timerRemaining(q.timer, now) > 0) {
        // First start: the host has finished reading, so buzzers open with the clock.
        if (q.buzzOpenAt == null) {
          q.buzzOpenAt = now + BUZZ_LEAD_MS;
          q.timer.startedAt = now + BUZZ_LEAD_MS;
        } else {
          q.timer.startedAt = now;
        }
      }
      return null;
    }
    case "timerPause": {
      if (!q || q.timer.startedAt == null) return null;
      q.timer.elapsedBefore = timerElapsed(q.timer, now);
      q.timer.startedAt = null;
      return null;
    }
    case "timerAdd": {
      if (!q) return "No question showing";
      const elapsed = timerElapsed(q.timer, now);
      q.timer.duration = Math.max(elapsed, q.timer.duration + a.ms);
      return null;
    }
    case "timerSet": {
      if (!q) return "No question showing";
      if (![30, 60].includes(a.sec)) return "Timer must be 30 or 60 seconds";
      q.timer = { duration: a.sec * 1000, startedAt: null, elapsedBefore: 0 };
      return null;
    }
    case "defaultTimer": {
      if (![30, 60].includes(a.sec)) return "Timer must be 30 or 60 seconds";
      g.defaultTimer = a.sec;
      if (q && q.timer.startedAt == null && q.timer.elapsedBefore === 0) q.timer.duration = a.sec * 1000;
      return null;
    }
    case "kick": {
      const entry = Object.entries(s.players).find(([, p]) => p.id === a.id);
      if (!entry) return "No such player";
      delete s.players[entry[0]];
      return null;
    }
  }
}

// ---------- Views ----------

function publicPlayers(s: RoomState, online: Set<string>): PublicPlayer[] {
  return Object.values(s.players)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map((p) => ({ id: p.id, name: p.name, ...AVATARS[p.avatar], score: p.score, online: online.has(p.pid) }));
}

function publicQuestion(s: RoomState, q: QState): PublicQuestion {
  const list = q.kind === "main" ? s.quiz.questions : s.quiz.spares;
  const question = questionFor(s, q);
  return {
    qid: q.qid,
    kind: q.kind,
    n: question.n,
    total: list.length,
    buzzOpenAt: q.buzzOpenAt,
    timer: q.timer,
    queue: queueOf(q),
    revealed: q.revealed,
  };
}

export function displayView(s: RoomState, online: Set<string>): DisplayView {
  const q = s.game.current;
  let dq: DisplayView["q"] = null;
  if (q) {
    const question = questionFor(s, q);
    dq = { ...publicQuestion(s, q), text: question.text, image: question.image };
    if (q.revealed) dq.answer = question.answer;
  }
  const upcoming = s.quiz.questions[s.game.index + 1];
  return {
    t: "display",
    code: s.code,
    title: s.quiz.title,
    phase: s.game.phase,
    players: publicPlayers(s, online),
    q: dq,
    nextImage: upcoming?.image,
  };
}

export function hostView(s: RoomState, online: Set<string>): HostView {
  const d = displayView(s, online);
  const q = s.game.current;
  let hq: HostView["q"] = null;
  if (q && d.q) {
    const question = questionFor(s, q);
    hq = { ...d.q, answer: question.answer, notes: question.notes, label: question.label };
  }
  return {
    ...d,
    t: "host",
    q: hq,
    questionCount: s.quiz.questions.length,
    index: s.game.index,
    defaultTimer: s.game.defaultTimer,
    undoLabel: s.undo.at(-1)?.label ?? null,
    redoLabel: s.redo.at(-1)?.label ?? null,
    spares: s.quiz.spares.map((sp) => ({
      qid: sp.id,
      n: sp.n,
      text: sp.text.replace(/<[^>]*>/g, " ").replace(/\*\*/g, "").slice(0, 90),
      played: sp.id in s.game.played || s.game.current?.qid === sp.id,
    })),
  };
}

export function playerView(s: RoomState, pid: string): PlayerView | null {
  const p = s.players[pid];
  if (!p) return null;
  const q = s.game.current;
  return {
    t: "player",
    me: { id: p.id, name: p.name, ...AVATARS[p.avatar], score: p.score },
    phase: s.game.phase,
    q: q ? publicQuestion(s, q) : null,
  };
}
