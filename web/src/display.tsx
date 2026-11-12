import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { buzzerPhase, timerExpired } from "../../shared/game";
import type { DisplayView } from "../../shared/types";
import { useRoom, useServerNow } from "./net";
import { buzzIn, keepScreenOn, timeUp, unlockAudio } from "./sound";
import { Check, X } from "lucide-react";
import { AnimatePresence, Leaderboard, Motion, Standings, burstCorrect, celebrateWinner, motion, useOnNewKey } from "./anim";
import { ConnPill, PlayerAvatar, Qr, Rich, TimerBadge, queueRows } from "./ui";
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

  // Confetti: a correct answer, and the winner when the game ends.
  const correctId = q?.queue.find((e) => e.mark === "correct")?.id;
  useOnNewKey(started && q && correctId ? `${q.qid}:${correctId}` : null, burstCorrect);
  useOnNewKey(started && view?.phase === "ended" ? `ended:${view.players.length}` : null, () => setTimeout(celebrateWinner, 350 * Math.max(1, view?.players.length ?? 1)));

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
            <p className="muted">Join on your phone at</p>
            <p className="join-url">{location.host}</p>
            <p className="muted">Room code</p>
            <p className="room-code">{view.code}</p>
          </div>
          <Qr text={joinUrl} size={260} />
        </div>
        <div className="lobby-players">
          {view.players.length === 0 && <p className="muted">Waiting for players…</p>}
          <AnimatePresence>
            {view.players.map((p) => (
              <motion.div
                key={p.id}
                layout
                className={`lobby-player ${p.online ? "" : "offline"}`}
                initial={{ opacity: 0, scale: 0.5, y: 20 }}
                animate={{ opacity: p.online ? 1 : 0.4, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ type: "spring", stiffness: 380, damping: 22 }}
              >
                <PlayerAvatar name={p.name} color={p.color} size={96} animated />
                <span>{p.name}</span>
              </motion.div>
            ))}
          </AnimatePresence>
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
  const pill =
    phase === "locked"
      ? { cls: "locked", text: q.buzzOpenAt == null ? "Stand by" : "Get ready" }
      : phase === "open"
        ? { cls: "open", text: "Buzzers live" }
        : phase === "resolved"
          ? { cls: "done", text: "Round won" }
          : { cls: "closed", text: "Time" };

  return (
    <main className="display question">
      <header className="display-head">
        <span className="qnum">
          {q.kind === "spare" ? (
            <>
              Spare <b>{q.n}</b>
            </>
          ) : (
            <>
              Question <b>{String(q.n).padStart(2, "0")}</b> / {q.total}
            </>
          )}
        </span>
        <span className={`pill pill-${pill.cls}`}>{pill.text}</span>
        <TimerBadge timer={q.timer} now={now} large bar />
      </header>

      <div className={`display-main ${q.revealed ? "revealed" : ""}`}>
        <div className="display-left">
          <section className={`display-body ${q.image ? "with-image" : ""}`}>
            <Rich text={q.text} className={`q-text ${textSizeClass(q.text)}`} images={false} />
            {q.image && <img className="q-image" src={q.image} alt="" referrerPolicy="no-referrer" />}
          </section>

          <AnimatePresence>
            {q.revealed && q.answer != null && (
              <motion.section
                key={`answer-${q.qid}`}
                className="answer-panel"
                initial={{ opacity: 0, y: 24, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 340, damping: 26 }}
              >
                <span className="answer-label">Answer</span>
                <Rich text={q.answer} className="answer-text" />
              </motion.section>
            )}
          </AnimatePresence>

          <ol className="buzz-order">
            <AnimatePresence initial={false}>
              {rows.map((r) => (
                <motion.li
                  key={`${q.qid}-${r.entry.id}`}
                  layout
                  initial={{ opacity: 0, scale: 0.6, y: 20 }}
                  animate={{ opacity: r.entry.mark === "wrong" ? 0.45 : 1, scale: r.answering && r.settled ? 1.06 : 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 500, damping: 28 }}
                  className={`buzz-row ${r.answering && r.settled ? "answering" : ""} ${r.entry.mark ?? ""}`}
                >
                  <span className="place">{r.place}</span>
                  {r.player && <PlayerAvatar name={r.player.name} color={r.player.color} size={44} animated={r.answering && r.settled} />}
                  <span className="name">{r.player?.name ?? "?"}</span>
                  <span className="gap">{r.place === 1 ? "first" : `+${(r.gapMs / 1000).toFixed(2)} s`}</span>
                  {r.entry.mark === "correct" && <Check className="mark" aria-label="correct" strokeWidth={3} />}
                  {r.entry.mark === "wrong" && <X className="mark" aria-label="wrong" strokeWidth={3} />}
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        </div>

        <AnimatePresence>{q.revealed && <Leaderboard key={`lb-${q.qid}`} players={view.players} scoredId={correctId} />}</AnimatePresence>
      </div>

      {view.nextImage && <img src={view.nextImage} alt="" referrerPolicy="no-referrer" className="preload" />}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Motion>
      <App />
    </Motion>
  </StrictMode>,
);
