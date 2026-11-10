import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { buzzerPhase, timerExpired } from "../../shared/game";
import type { DisplayView } from "../../shared/types";
import { useRoom, useServerNow } from "./net";
import { buzzIn, keepScreenOn, timeUp, unlockAudio } from "./sound";
import { Avatar, ConnPill, Qr, Rich, Leaderboard, Standings, TimerBadge, queueRows } from "./ui";
import "./styles.css";

function textSizeClass(text: string): string {
  const len = text.replace(/<[^>]*>/g, "").length;
  if (len > 420) return "q-xs";
  if (len > 300) return "q-sm";
  if (len > 180) return "q-md";
  return "q-lg";
}

function App() {
  const code = (new URLSearchParams(location.search).get("room") || "").toUpperCase();
  const [started, setStarted] = useState(false);
  const { view, status, sync } = useRoom<DisplayView>(code ? `/ws/${code}?role=display` : null);
  const now = useServerNow(sync, 100);

  // Sounds: first buzz on a question, and time running out.
  const lastBuzzKey = useRef("");
  const lastUpKey = useRef("");
  const q = view?.q ?? null;
  useEffect(() => {
    if (!q) return;
    // Play a sound each time the queue grows on the same question.
    const [prevQid, prevLen] = lastBuzzKey.current.split(":");
    const before = prevQid === q.qid ? Number(prevLen) : 0;
    if (started && q.queue.length > before) buzzIn();
    lastBuzzKey.current = `${q.qid}:${q.queue.length}`;
  }, [q?.qid, q?.queue.length, started]);
  const expired = q ? timerExpired(q.timer, now) : false;
  useEffect(() => {
    if (!q || !expired || !started) return;
    const key = `${q.qid}:${q.timer.duration}`;
    if (lastUpKey.current !== key) {
      lastUpKey.current = key;
      timeUp();
    }
  }, [expired, q?.qid, q?.timer.duration, started]);

  if (!code) {
    return (
      <main className="card">
        <h1>BuzzQuiz display</h1>
        <p>Open this screen from the host page with “Open display”.</p>
      </main>
    );
  }

  const joinUrl = `${location.origin}/?room=${code}`;

  if (!started) {
    return (
      <main className="display-start" onClick={() => {
        unlockAudio();
        keepScreenOn();
        document.documentElement.requestFullscreen?.().catch(() => {});
        setStarted(true);
      }}>
        <div className="card center">
          <h1>BuzzQuiz display</h1>
          <p>Room {code}</p>
          <button className="primary big">Click to start the display</button>
          <p className="muted small">Turns on sound and full screen. Press Esc to leave full screen.</p>
        </div>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="display">
        <p className="muted center-text">Connecting… <ConnPill status={status} /></p>
      </main>
    );
  }

  if (view.phase === "lobby") {
    return (
      <main className="display lobby">
        <h1 className="display-title">{view.title}</h1>
        <div className="lobby-grid">
          <div className="lobby-join">
            <p className="muted">Join on your phone</p>
            <p className="join-url">{location.host}</p>
            <p className="muted">Room code</p>
            <p className="room-code">{view.code}</p>
          </div>
          <Qr text={joinUrl} size={260} />
        </div>
        <div className="lobby-players">
          {view.players.length === 0 && <p className="muted">Waiting for players…</p>}
          {view.players.map((p) => (
            <div key={p.id} className={`lobby-player ${p.online ? "" : "offline"}`}>
              <Avatar emoji={p.emoji} color={p.color} size={72} />
              <span>{p.name}</span>
            </div>
          ))}
        </div>
      </main>
    );
  }

  if (view.phase === "ended" || !q) {
    return (
      <main className="display ended">
        <Standings players={view.players} title={<h1 className="display-title">Final standings</h1>} />
      </main>
    );
  }

  const phase = buzzerPhase(q, [], now);
  const rows = queueRows(q.queue, view.players, now);
  const opensIn = Math.max(0, Math.ceil((q.buzzOpenAt - now) / 1000));
  const pill =
    phase === "locked"
      ? { cls: "locked", text: `Buzzers open in ${opensIn}` }
      : phase === "open"
        ? { cls: "open", text: "Buzzers OPEN" }
        : phase === "resolved"
          ? { cls: "done", text: "Answered" }
          : { cls: "closed", text: "Buzzers closed" };

  return (
    <main className="display question">
      <header className="display-head">
        <span className="qnum">{q.kind === "spare" ? `Spare ${q.n}` : `Q${q.n} / ${q.total}`}</span>
        <span className={`pill pill-${pill.cls}`}>{pill.text}</span>
        <TimerBadge timer={q.timer} now={now} large />
      </header>

      <div className={`display-main ${q.revealed ? "revealed" : ""}`}>
        <div className="display-left">
          <section className={`display-body ${q.image ? "with-image" : ""}`}>
            <Rich text={q.text} className={`q-text ${textSizeClass(q.text)}`} images={false} />
            {q.image && <img className="q-image" src={q.image} alt="" referrerPolicy="no-referrer" />}
          </section>

          {q.revealed && q.answer != null && (
            <section className="answer-panel">
              <span className="answer-label">Answer</span>
              <Rich text={q.answer} className="answer-text" />
            </section>
          )}

          {rows.length > 0 && (
            <ol className="buzz-order">
              {rows.map((r) => (
                <li key={r.entry.id} className={`buzz-row ${r.answering && r.settled ? "answering" : ""} ${r.entry.mark ?? ""}`}>
                  <span className="place">{r.place}</span>
                  {r.player && <Avatar emoji={r.player.emoji} color={r.player.color} size={44} />}
                  <span className="name">{r.player?.name ?? "?"}</span>
                  <span className="gap">{r.place === 1 ? "first" : `+${(r.gapMs / 1000).toFixed(2)} s`}</span>
                  {r.entry.mark === "correct" && <span className="mark">✓</span>}
                  {r.entry.mark === "wrong" && <span className="mark">✗</span>}
                </li>
              ))}
            </ol>
          )}
        </div>

        {q.revealed && <Leaderboard players={view.players} scoredId={q.queue.find((e) => e.mark === "correct")?.id} />}
      </div>

      {view.nextImage && <img src={view.nextImage} alt="" referrerPolicy="no-referrer" className="preload" />}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
