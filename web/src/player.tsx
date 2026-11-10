import { StrictMode, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { buzzerPhase, currentAnswerer } from "../../shared/game";
import type { PlayerView } from "../../shared/types";
import { useRoom, useServerNow } from "./net";
import { buzzClick, keepScreenOn, unlockAudio, vibrate } from "./sound";
import { Avatar, ConnPill, TimerBadge } from "./ui";
import "./styles.css";

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

function getPid(): string {
  let pid = store.get("bq.pid");
  if (!pid) {
    pid = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
    store.set("bq.pid", pid);
  }
  return pid;
}

function App() {
  const params = new URLSearchParams(location.search);
  const [code, setCode] = useState((params.get("room") || store.get("bq.code") || "").toUpperCase());
  const [name, setName] = useState(store.get("bq.name") || "");
  const [joined, setJoined] = useState<{ code: string; name: string } | null>(null);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    const n = name.trim();
    if (!/^[A-Z]{4}$/.test(c) || !n) return;
    store.set("bq.code", c);
    store.set("bq.name", n);
    await unlockAudio(); // must happen during this tap
    keepScreenOn();
    setJoined({ code: c, name: n });
  };

  if (!joined) {
    return (
      <main className="join card">
        <h1>BuzzQuiz</h1>
        <p className="muted">Join a game</p>
        <form onSubmit={join}>
          <label>
            Room code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
              autoCapitalize="characters"
              autoComplete="off"
              inputMode="text"
              placeholder="ABCD"
              required
            />
          </label>
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value.slice(0, 20))} autoComplete="nickname" placeholder="Priya" required />
          </label>
          <button className="primary big" type="submit" disabled={code.length !== 4 || !name.trim()}>
            Join
          </button>
        </form>
      </main>
    );
  }
  return <Game code={joined.code} name={joined.name} onLeave={() => setJoined(null)} />;
}

function Game({ code, name, onLeave }: { code: string; name: string; onLeave: () => void }) {
  const pid = getPid();
  const path = `/ws/${code}?role=player&pid=${encodeURIComponent(pid)}&name=${encodeURIComponent(name)}`;
  const { view, status, send, sync } = useRoom<PlayerView>(path);
  const now = useServerNow(sync, 50);
  const [localBuzz, setLocalBuzz] = useState<string | null>(null); // qid we tapped on, for instant feedback
  const [tooEarly, setTooEarly] = useState(false);
  const earlyTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const onVis = () => document.visibilityState === "visible" && keepScreenOn();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  if (status === "rejected" || status === "removed" || status === "replaced" || status === "expired") {
    const msg = {
      rejected: "Couldn't join. Check the room code, or the room may be full (4 players max).",
      removed: "The host removed you from the game.",
      replaced: "You joined from another tab or phone.",
      expired: "This room has expired.",
    }[status];
    return (
      <main className="join card">
        <h1>BuzzQuiz</h1>
        <p className="notice">{msg}</p>
        <button className="primary big" onClick={onLeave}>
          Back
        </button>
      </main>
    );
  }

  const q = view?.q ?? null;
  const me = view?.me;
  const myEntry = q?.queue.find((e) => e.id === me?.id);
  const iBuzzed = !!myEntry || (q != null && localBuzz === q.qid);
  // Everyone in the room isn't known to players; resolution = someone correct.
  const phase = view?.phase === "question" ? buzzerPhase(q, [], now) : "waiting";
  const ans = q ? currentAnswerer(q.queue, now) : null;
  const waitingForClock = !sync.ready;

  let state: "waiting" | "locked" | "open" | "queued" | "answering" | "wrong" | "correct" | "closed" | "over" | "ended";
  if (view?.phase === "ended") state = "ended";
  else if (!q || view?.phase !== "question") state = "waiting";
  else if (myEntry?.mark === "correct") state = "correct";
  else if (myEntry?.mark === "wrong") state = "wrong";
  else if (iBuzzed && ans && ans.id === me?.id && ans.settled) state = "answering";
  else if (iBuzzed) state = "queued";
  else if (phase === "resolved") state = "over";
  else if (phase === "locked" || waitingForClock) state = "locked";
  else if (phase === "closed") state = "closed";
  else state = "open";

  const place = myEntry ? q!.queue.findIndex((e) => e.id === myEntry.id) + 1 : null;
  const opensIn = q ? Math.max(0, Math.ceil((q.buzzOpenAt - now) / 1000)) : 0;

  const status_text: Record<typeof state, string> = {
    waiting: "Waiting for the host…",
    locked: `Get ready… ${opensIn > 0 ? `buzzers open in ${opensIn}` : ""}`,
    open: "Buzzers open!",
    queued: place ? `You buzzed · #${place} in the queue` : "You buzzed!",
    answering: "Your turn: answer now!",
    wrong: "Not quite. You're out for this one.",
    correct: "Correct! +10",
    closed: "Time's up",
    over: "This question is done",
    ended: "Game over",
  };

  const onPress = (e: React.PointerEvent) => {
    e.preventDefault();
    // timeStamp = when the finger touched the screen, on the page's clock.
    const tapLocal = performance.timeOrigin + e.timeStamp;
    if (state === "locked") {
      setTooEarly(true);
      clearTimeout(earlyTimer.current);
      earlyTimer.current = setTimeout(() => setTooEarly(false), 1200);
      return;
    }
    if (state !== "open" || !q) return;
    setLocalBuzz(q.qid);
    buzzClick();
    vibrate(30);
    send({ t: "buzz", qid: q.qid, est: sync.toServer(tapLocal) });
  };

  const buttonClass =
    state === "open" ? "open" : state === "answering" ? "answering" : state === "correct" ? "correct" : state === "queued" ? "queued" : "locked";
  const buttonLabel =
    state === "open" ? "BUZZ!" : state === "locked" ? "WAIT" : state === "queued" ? (place ? `#${place}` : "BUZZED") : state === "answering" ? "ANSWER!" : state === "correct" ? "+10" : state === "wrong" ? "OUT" : "LOCKED";

  return (
    <main className="player-game">
      <header className="me">
        {me ? <Avatar emoji={me.emoji} color={me.color} size={44} /> : <span className="avatar placeholder" />}
        <div className="me-text">
          <div className="me-name">{me?.name ?? name}</div>
          <ConnPill status={status} />
        </div>
        <div className="me-score" aria-label="Your score">
          <span className="score-num">{me?.score ?? 0}</span>
          <span className="muted">points</span>
        </div>
      </header>

      <section className="player-status">
        <div className="player-q">
          {q ? <span className="muted">{q.kind === "spare" ? `Spare ${q.n}` : `Question ${q.n} of ${q.total}`}</span> : <span />}
          {q && <TimerBadge timer={q.timer} now={now} />}
        </div>
        <p className="status-text" aria-live="polite">
          {status_text[state]}
        </p>
        <p className="early">{tooEarly ? "Too early. Wait for BUZZ!" : ""}</p>
      </section>

      <button
        className={`buzzer ${buttonClass}`}
        onPointerDown={onPress}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={buttonLabel}
      >
        {buttonLabel}
      </button>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
