// Types shared by the Worker (server) and the browser screens.

export interface Question {
  id: string; // "q1".."qN" for main questions, "s1".. for spares
  n: number; // 1-based position within its list
  label: string; // original round/question label from the file (host only)
  text: string; // raw question text (markdown-ish + <br>/<img>)
  answer: string; // answer with marking notes removed
  notes: string[]; // [Accept: ...], [Prompt: ...] etc. Host only.
  image?: string; // imageUrl column
}

export interface Quiz {
  title: string;
  questions: Question[];
  spares: Question[];
}

export interface PlayerRec {
  pid: string; // secret: stored on the phone, used to rejoin
  id: string; // public id ("p1".."p8") used in every view
  name: string;
  avatar: number;
  score: number;
}

export interface Buzz {
  id: string; // public player id
  arrival: number; // server time the buzz arrived
  est: number; // tap time on the server clock (Mode B ordering key)
}

export type Mark = "wrong" | "correct";

export interface Timer {
  duration: number; // ms
  startedAt: number | null; // server time when last started; null = not running
  elapsedBefore: number; // ms run before the last start
}

export interface QState {
  qid: string;
  kind: "main" | "spare";
  shownAt: number;
  buzzOpenAt: number | null; // null until the host starts the timer
  timer: Timer;
  buzzes: Buzz[];
  marks: Record<string, Mark>; // by public player id
  revealed: boolean;
}

export interface Game {
  phase: "lobby" | "question" | "ended";
  index: number; // index into quiz.questions of the current (or last) main question
  current: QState | null;
  played: Record<string, QState>; // questions already left, by qid
  defaultTimer: number; // seconds
}

export interface Snapshot {
  label: string;
  scores: Record<string, number>; // by public player id
  game: Game;
}

export interface RoomState {
  code: string;
  hostKey: string;
  createdAt: number;
  quiz: Quiz;
  players: Record<string, PlayerRec>; // by secret pid
  game: Game;
  undo: Snapshot[];
  redo: Snapshot[];
}

// Avatar colours; each player's pixel critter is drawn from their name.
export const AVATARS = [
  { color: "#E8590C" },
  { color: "#3B5BDB" },
  { color: "#2B8A3E" },
  { color: "#C2255C" },
  { color: "#7048E8" },
  { color: "#0C8599" },
  { color: "#D9480F" },
  { color: "#5C677D" },
] as const;

export const MAX_PLAYERS = 4;
export const POINTS = 10;
// When the host starts the timer, buzzers open this long later, so every phone
// hears the opening time before it happens (fair even on slower connections).
export const BUZZ_LEAD_MS = 800;
export const SETTLE_MS = 200; // wait this long after a tap before naming the answerer
export const MAX_TRAVEL_MS = 1000; // clamp for tap-time estimates

// ---------- Messages ----------

export type HostAction =
  | { t: "start" }
  | { t: "next" }
  | { t: "prev" }
  | { t: "correct"; id: string }
  | { t: "wrong"; id: string }
  | { t: "reveal" }
  | { t: "timerStart" }
  | { t: "timerPause" }
  | { t: "timerAdd"; ms: number }
  | { t: "timerSet"; sec: number }
  | { t: "defaultTimer"; sec: number }
  | { t: "spare"; qid: string }
  | { t: "end" }
  | { t: "undo" }
  | { t: "redo" }
  | { t: "kick"; id: string };

export type ClientMsg =
  | { t: "ping"; c: number }
  | { t: "buzz"; est: number; qid: string }
  | HostAction;

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  score: number;
  online: boolean;
}

export interface QueueEntry {
  id: string;
  est: number;
  mark?: Mark;
}

export interface PublicQuestion {
  qid: string;
  kind: "main" | "spare";
  n: number;
  total: number;
  buzzOpenAt: number | null;
  timer: Timer;
  queue: QueueEntry[]; // sorted by tap time
  revealed: boolean;
}

export interface DisplayQuestion extends PublicQuestion {
  text: string;
  image?: string;
  answer?: string; // only once revealed
}

export interface DisplayView {
  t: "display";
  code: string;
  title: string;
  phase: Game["phase"];
  players: PublicPlayer[];
  q: DisplayQuestion | null;
  nextImage?: string;
}

export interface HostView extends Omit<DisplayView, "t" | "q"> {
  t: "host";
  q: (DisplayQuestion & { answer: string; notes: string[]; label: string }) | null;
  questionCount: number;
  index: number;
  defaultTimer: number;
  undoLabel: string | null;
  redoLabel: string | null;
  spares: { qid: string; n: number; text: string; played: boolean }[];
}

export interface PlayerView {
  t: "player";
  me: { id: string; name: string; color: string; score: number };
  phase: Game["phase"];
  q: PublicQuestion | null;
}

export type ServerMsg =
  | { t: "pong"; c: number; s: number }
  | DisplayView
  | HostView
  | PlayerView
  | { t: "error"; message: string }
  | { t: "toast"; message: string };
