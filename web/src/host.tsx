import { StrictMode, useCallback, useEffect, useState, type DragEvent } from "react";
import { createRoot } from "react-dom/client";
import { plainText } from "../../shared/format";
import { buzzerPhase, currentAnswerer } from "../../shared/game";
import { parseQuiz, type ParseResult } from "../../shared/tsv";
import type { HostAction, HostView, ServerMsg } from "../../shared/types";
import { useRoom, useServerNow } from "./net";
import { Avatar, ConnPill, Qr, Rich, Standings, TimerBadge, Toasts, queueRows, useToasts } from "./ui";
import "./styles.css";

const keyFor = (code: string) => `bq.host.${code}`;
const safeGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const safeSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

function App() {
  const params = new URLSearchParams(location.search);
  const [code, setCode] = useState((params.get("room") || "").toUpperCase());
  // A control link opened on a phone carries the key in the #hash; keep it locally.
  const hashKey = new URLSearchParams(location.hash.slice(1)).get("key");
  if (code && hashKey) {
    safeSet(keyFor(code), hashKey);
    history.replaceState(null, "", `?room=${code}`);
  }
  const key = code ? safeGet(keyFor(code)) : null;

  if (code && key) return <Control code={code} hostKey={key} />;
  return (
    <Setup
      missingKey={code && !key ? code : null}
      onCreated={(c, k) => {
        safeSet(keyFor(c), k);
        history.replaceState(null, "", `?room=${c}`);
        setCode(c);
      }}
    />
  );
}

// ---------- Setup: upload + preview ----------

function Setup({ onCreated, missingKey }: { onCreated: (code: string, key: string) => void; missingKey: string | null }) {
  const [parsed, setParsed] = useState<(ParseResult & { fileName: string }) | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [drag, setDrag] = useState(false);

  const readFile = async (file: File) => {
    setError("");
    if (file.size > 2_000_000) return setError("That file is over 2 MB. Is it the right one?");
    const text = await file.text();
    const r = parseQuiz(text, file.name);
    setParsed({ ...r, fileName: file.name });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  };

  const create = async () => {
    if (!parsed) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quiz: parsed.quiz }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { code, hostKey } = (await res.json()) as { code: string; hostKey: string };
      onCreated(code, hostKey);
    } catch (e) {
      setError(`Couldn't create the room: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const qs = parsed?.quiz.questions ?? [];
  const shown = showAll ? qs : qs.slice(0, 5);

  return (
    <main className="setup">
      <h1>BuzzQuiz · Host</h1>
      {missingKey && (
        <p className="notice">
          This browser doesn't have the host key for room {missingKey}. Open the control link from the host's laptop, or create a new room.
        </p>
      )}
      <label
        className={`dropzone ${drag ? "drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        <input type="file" accept=".tsv,.txt,text/tab-separated-values,text/plain" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
        <strong>Choose a .tsv quiz file</strong>
        <span className="muted">or drop it here</span>
        <span className="muted small">Columns: roundNo, questionNo, questionText, answerText, imageUrl, or just question and answer</span>
      </label>

      {parsed && (
        <section className="preview">
          <h2>{parsed.quiz.title}</h2>
          <div className="stats">
            <div>
              <span className="big">{qs.length}</span> questions
            </div>
            <div>
              <span className="big">{parsed.quiz.spares.length}</span> spares
            </div>
            <div>
              <span className="big">{qs.filter((q) => q.image).length}</span> with images
            </div>
            <div>
              <span className="big">{parsed.skipped}</span> rows skipped
            </div>
          </div>
          {parsed.warnings.length > 0 && (
            <ul className="warnings">
              {parsed.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <ol className="preview-list">
            {shown.map((q) => (
              <li key={q.id}>
                <div className="preview-q">{plainText(q.text)}</div>
                <div className="preview-a">
                  <Rich text={q.answer} images={false} className="inline" />
                  {q.notes.length > 0 && <span className="note-chip">{q.notes.length} note{q.notes.length > 1 ? "s" : ""}</span>}
                  {q.image && <span className="note-chip">image</span>}
                </div>
              </li>
            ))}
          </ol>
          {qs.length > 5 && (
            <button className="link" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all ${qs.length}`}
            </button>
          )}
          <div className="setup-actions">
            <button className="primary big" disabled={!qs.length || busy} onClick={create}>
              {busy ? "Creating…" : "Create room"}
            </button>
          </div>
        </section>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}

// ---------- Control panel ----------

function Control({ code, hostKey }: { code: string; hostKey: string }) {
  const toasts = useToasts();
  const onEvent = useCallback((m: ServerMsg) => {
    if (m.t === "error") toasts.push(m.message, "error");
    if (m.t === "toast") toasts.push(m.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { view, status, send, sync } = useRoom<HostView>(`/ws/${code}?role=host&key=${hostKey}`, onEvent);
  const now = useServerNow(sync, 100);
  const [showPhone, setShowPhone] = useState(false);
  const [showSpares, setShowSpares] = useState(false);

  const act = (a: HostAction) => {
    if (!send(a)) toasts.push("Not connected, try again in a moment", "error");
  };

  const q = view?.q ?? null;
  const rows = q && view ? queueRows(q.queue, view.players, now) : [];
  const ans = q ? currentAnswerer(q.queue, now) : null;
  const answering = ans && ans.settled ? rows.find((r) => r.entry.id === ans.id) : null;

  // Keyboard shortcuts (laptop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.altKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey && k === "z") || (e.ctrlKey && k === "y")) {
        e.preventDefault();
        act({ t: k === "z" && !e.shiftKey ? "undo" : "redo" });
        return;
      }
      if (e.ctrlKey) return;
      if (k === "c" && answering) act({ t: "correct", id: answering.entry.id });
      else if (k === "w" && answering) act({ t: "wrong", id: answering.entry.id });
      else if (k === "r") act({ t: "reveal" });
      else if (k === "n" || k === "arrowright") act({ t: "next" });
      else if (k === "arrowleft") act({ t: "prev" });
      else if (k === " ") {
        e.preventDefault();
        if (q) act({ t: q.timer.startedAt != null ? "timerPause" : "timerStart" });
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const controlUrl = `${location.origin}/host?room=${code}#key=${hostKey}`;
  const displayUrl = `/display?room=${code}`;

  return (
    <main className="control">
      <header className="control-head">
        <div className="room">
          <span className="muted small">Room</span>
          <span className="room-code-sm">{code}</span>
          <ConnPill status={status} />
        </div>
        <div className="head-actions">
          <a className="button" href={displayUrl} target="bq-display" rel="noopener">
            Open display
          </a>
          <button onClick={() => setShowPhone(true)}>Control on phone</button>
        </div>
      </header>

      {showPhone && (
        <div className="modal" role="dialog" aria-label="Control on phone" onClick={() => setShowPhone(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Open the control panel on your phone</h2>
            <p className="muted">Scan this with your phone camera. Keep it private: anyone with this link can run the game.</p>
            <Qr text={controlUrl} size={240} />
            <button onClick={() => setShowPhone(false)}>Close</button>
          </div>
        </div>
      )}

      {!view && <p className="muted">Connecting…</p>}

      {view && view.phase === "lobby" && (
        <section className="panel">
          <h2>{view.title}</h2>
          <p>
            Players join at <strong>{location.host}</strong> with code <strong>{code}</strong> (the display shows a QR code).
          </p>
          <PlayersPanel view={view} act={act} />
          <div className="row">
            <span className="muted">Timer per question</span>
            <Seg value={view.defaultTimer} options={[30, 60]} onChange={(sec) => act({ t: "defaultTimer", sec })} suffix="s" />
          </div>
          <button className="primary big" disabled={!view.players.length} onClick={() => act({ t: "start" })}>
            Start game ({view.questionCount} questions)
          </button>
        </section>
      )}

      {view && view.phase === "ended" && (
        <section className="panel">
          <Standings players={view.players} title={<h2>Final standings</h2>} />
          <div className="row wrap">
            <button onClick={() => act({ t: "prev" })}>← Back to last question</button>
            <button onClick={() => setShowSpares(!showSpares)}>Spares ({view.spares.length})</button>
            <UndoRedo view={view} act={act} />
          </div>
          {showSpares && <SparesList view={view} act={act} />}
        </section>
      )}

      {view && view.phase === "question" && q && (
        <div className="control-grid">
          <section className="panel q-panel">
            <div className="q-meta">
              <strong>{q.kind === "spare" ? `Spare ${q.n}` : `Q${q.n} / ${q.total}`}</strong>
              {q.label && q.kind === "main" && <span className="muted small">{q.label}</span>}
            </div>
            <Rich text={q.text} className="host-q" images={false} />
            {q.image && <img className="host-img" src={q.image} alt="" referrerPolicy="no-referrer" />}
            <div className={`host-answer ${q.revealed ? "revealed" : ""}`}>
              <div className="answer-head">
                <span>Answer</span>
                <span className="muted small">{q.revealed ? "showing on display" : "hidden from players"}</span>
              </div>
              <Rich text={q.answer} className="answer-text" />
              {q.notes.map((n, i) => (
                <div key={i} className="note">
                  <Rich text={n} className="inline" />
                </div>
              ))}
            </div>
          </section>

          <section className="panel live-panel">
            <BuzzStatus view={view} now={now} />
            <div className="timer-row">
              <TimerBadge timer={q.timer} now={now} large />
              <div className="timer-buttons">
                <button className="primary" onClick={() => act({ t: q.timer.startedAt != null ? "timerPause" : "timerStart" })}>
                  {q.timer.startedAt != null ? "Pause" : q.buzzOpenAt == null ? "Start timer & open buzzers" : "Resume timer"}
                </button>
                <button onClick={() => act({ t: "timerAdd", ms: -10_000 })}>−10s</button>
                <button onClick={() => act({ t: "timerAdd", ms: 10_000 })}>+10s</button>
                <Seg value={Math.round(q.timer.duration / 1000)} options={[30, 60]} onChange={(sec) => act({ t: "timerSet", sec })} suffix="s" />
              </div>
            </div>

            <h3>Buzz order</h3>
            {rows.length === 0 ? (
              <p className="muted">No buzzes yet.</p>
            ) : (
              <ol className="queue">
                {rows.map((r) => (
                  <li key={r.entry.id} className={`queue-row ${r.answering ? "answering" : ""} ${r.entry.mark ?? ""}`}>
                    <span className="place">{r.place}</span>
                    {r.player && <Avatar name={r.player.name} color={r.player.color} size={32} />}
                    <span className="name">{r.player?.name ?? "(removed)"}</span>
                    <span className="gap muted">{r.place === 1 ? "first" : `+${r.gapMs} ms`}</span>
                    <span className="state">
                      {r.entry.mark === "correct" ? "correct" : r.entry.mark === "wrong" ? "wrong" : r.answering ? (r.settled ? "answering" : "checking…") : "waiting"}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <div className="mark-buttons">
              <button className="correct big" disabled={!answering} onClick={() => answering && act({ t: "correct", id: answering.entry.id })}>
                ✓ Correct{answering ? `: ${answering.player?.name}` : ""} <kbd>C</kbd>
              </button>
              <button className="wrong big" disabled={!answering} onClick={() => answering && act({ t: "wrong", id: answering.entry.id })}>
                ✗ Wrong <kbd>W</kbd>
              </button>
            </div>

            <div className="row wrap">
              <button onClick={() => act({ t: "reveal" })} disabled={q.revealed}>
                {q.revealed ? "Answer revealed" : "Reveal answer"} <kbd>R</kbd>
              </button>
              <button onClick={() => act({ t: "prev" })}>
                ← Prev
              </button>
              <button className="primary" onClick={() => act({ t: "next" })}>
                {view.index + 1 >= view.questionCount && q.kind === "main" ? "Finish game" : "Next →"} <kbd>N</kbd>
              </button>
            </div>
            <div className="row wrap">
              <UndoRedo view={view} act={act} />
              <button onClick={() => setShowSpares(!showSpares)}>Spares ({view.spares.length})</button>
              <button
                className="danger"
                onClick={() => confirm("End the game now and show final standings?") && act({ t: "end" })}
              >
                End game
              </button>
            </div>
            {showSpares && <SparesList view={view} act={act} />}
          </section>

          <section className="panel players-panel">
            <PlayersPanel view={view} act={act} />
            <p className="muted small">
              Shortcuts: C correct · W wrong · R reveal · N or → next · ← previous · Space timer · Ctrl+Z undo · Ctrl+Y redo
            </p>
          </section>
        </div>
      )}

      <Toasts items={toasts.items} />
    </main>
  );
}

function BuzzStatus({ view, now }: { view: HostView; now: number }) {
  const q = view.q!;
  const phase = buzzerPhase(q, view.players.map((p) => p.id), now);
  const text = {
    waiting: "",
    locked: q.buzzOpenAt == null ? "Buzzers locked: start the timer when you finish reading" : "Opening…",
    open: "Buzzers open",
    closed: "Time's up: buzzers closed",
    resolved: "Question resolved",
  }[phase];
  return <div className={`pill pill-${phase === "resolved" ? "done" : phase}`}>{text}</div>;
}

function UndoRedo({ view, act }: { view: HostView; act: (a: HostAction) => void }) {
  return (
    <>
      <button onClick={() => act({ t: "undo" })} disabled={!view.undoLabel} title={view.undoLabel ?? ""}>
        ↶ Undo{view.undoLabel ? `: ${view.undoLabel}` : ""}
      </button>
      <button onClick={() => act({ t: "redo" })} disabled={!view.redoLabel} title={view.redoLabel ?? ""}>
        ↷ Redo
      </button>
    </>
  );
}

function SparesList({ view, act }: { view: HostView; act: (a: HostAction) => void }) {
  if (!view.spares.length) return <p className="muted">This quiz has no spare questions.</p>;
  return (
    <ul className="spares">
      {view.spares.map((s) => (
        <li key={s.qid}>
          <span>
            <strong>Spare {s.n}</strong> {s.played && <span className="note-chip">played</span>}
            <br />
            <span className="muted small">{s.text}…</span>
          </span>
          <button onClick={() => act({ t: "spare", qid: s.qid })}>Play</button>
        </li>
      ))}
    </ul>
  );
}

function PlayersPanel({ view, act }: { view: HostView; act: (a: HostAction) => void }) {
  return (
    <div>
      <h3>Players ({view.players.length}/4)</h3>
      {view.players.length === 0 && <p className="muted">No one has joined yet.</p>}
      <ul className="players">
        {view.players.map((p) => (
          <li key={p.id}>
            <Avatar name={p.name} color={p.color} size={32} />
            <span className="name">{p.name}</span>
            <span className={`dot ${p.online ? "on" : "off"}`} title={p.online ? "connected" : "disconnected"} />
            <span className="score">{p.score}</span>
            <button
              className="link"
              onClick={() => confirm(`Remove ${p.name} from the game? Their score will be lost.`) && act({ t: "kick", id: p.id })}
            >
              remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Seg({ value, options, onChange, suffix = "" }: { value: number; options: number[]; onChange: (v: number) => void; suffix?: string }) {
  return (
    <span className="seg" role="group">
      {options.map((o) => (
        <button key={o} className={o === value ? "on" : ""} aria-pressed={o === value} onClick={() => onChange(o)}>
          {o}
          {suffix}
        </button>
      ))}
    </span>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
