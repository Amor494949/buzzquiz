import { describe, expect, it } from "vitest";
import { parseQuiz, splitNotes, splitTSV } from "../shared/tsv";
import { richHtml } from "../shared/format";
import {
  applyBuzz,
  applyHost,
  currentAnswerer,
  displayView,
  hostView,
  joinPlayer,
  newRoom,
  playerView,
  timerRemaining,
} from "../shared/game";
import { BUZZ_LEAD_MS, SETTLE_MS, type RoomState } from "../shared/types";

const FULL = [
  "roundNo\tquestionNo\tquestionText\tanswerText\timageUrl",
  "Round 1 Player 1\tQuestion 1\tWhat is **shio**?\t**SEA SALT** [Accept: **SALT**]\t",
  "Round 1 Player 2\tQuestion 1\tName this watch\t**TANK**\thttps://i.imgur.com/x.jpeg",
  "Round 1 Player 3\tQuestion 1\tWhich film?\t**SNOW WHITE** [Prompt: **SNOW WHITE**]; <br><br> (1937)\t",
  "Spare 1\t\tSpare question\tHERBIE\t",
  "Instructions\tGame Week 1\t\t\t",
  "Instructions\tKeep hands visible\t\t\t",
].join("\n");

describe("TSV parsing", () => {
  it("reads the full league format", () => {
    const { quiz, warnings, skipped } = parseQuiz(FULL, "GW1_S8.tsv");
    expect(quiz.title).toBe("GW1 S8");
    expect(quiz.questions).toHaveLength(3);
    expect(quiz.spares).toHaveLength(1);
    expect(skipped).toBe(2);
    expect(warnings).toEqual([]);
    expect(quiz.questions[0]).toMatchObject({ id: "q1", n: 1, label: "Round 1 Player 1 · Question 1", answer: "**SEA SALT**", notes: ["Accept: **SALT**"] });
    expect(quiz.questions[1].image).toBe("https://i.imgur.com/x.jpeg");
    expect(quiz.questions[2].answer).toBe("**SNOW WHITE**<br><br> (1937)");
    expect(quiz.questions[2].notes).toEqual(["Prompt: **SNOW WHITE**"]);
    expect(quiz.spares[0]).toMatchObject({ id: "s1", answer: "HERBIE" });
  });

  it("reads a simple question/answer file", () => {
    const { quiz } = parseQuiz("question\tanswer\nCapital of France?\tParis\nCapital of Italy?\tRome\n");
    expect(quiz.questions.map((q) => q.answer)).toEqual(["Paris", "Rome"]);
    expect(quiz.spares).toEqual([]);
  });

  it("reads a headerless file as question, answer", () => {
    const { quiz, warnings } = parseQuiz("2+2?\t4\n3+3?\t6");
    expect(quiz.questions).toHaveLength(2);
    expect(warnings[0]).toMatch(/No header/);
  });

  it("handles quoted cells with newlines and CRLF", () => {
    expect(splitTSV('a\t"line1\nline2"\r\nb\t"say ""hi"""\r\n')).toEqual([
      ["a", "line1\nline2"],
      ["b", 'say "hi"'],
    ]);
  });

  it("warns about missing answers", () => {
    const { warnings } = parseQuiz("question\tanswer\nQ1?\t\n");
    expect(warnings).toEqual(["Line 2: no answer."]);
  });

  it("splits several note kinds", () => {
    expect(splitNotes("**KILL BILL** [Do not accept: Kill Bill 2]")).toEqual({ answer: "**KILL BILL**", notes: ["Do not accept: Kill Bill 2"] });
    expect(splitNotes("**MAUI** [Prompt on HAWAII. Ask for the specific island]").notes).toHaveLength(1);
  });
});

describe("rich text", () => {
  it("allows bold, br and https images, escapes everything else", () => {
    expect(richHtml("**A** <br> b")).toBe("<strong>A</strong> <br> b");
    expect(richHtml('<img src = "https://i.imgur.com/a.jpg">')).toContain('src="https://i.imgur.com/a.jpg"');
    expect(richHtml('<script>alert(1)</script>')).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(richHtml('<img src="javascript:alert(1)">')).toBe("&lt;img src=&quot;javascript:alert(1)&quot;&gt;");
    expect(richHtml('<img src="https://x.com/a.jpg" onerror="alert(1)">')).not.toContain("onerror");
  });
});

// ---------- Game rules ----------

function setup(): { s: RoomState; t0: number } {
  const { quiz } = parseQuiz(FULL, "Test");
  const s = newRoom("ABCD", "key", quiz, 0);
  joinPlayer(s, "secret-a", "Priya", 4);
  joinPlayer(s, "secret-b", "Sam", 4);
  joinPlayer(s, "secret-c", "Ana", 4);
  const t0 = 1_000_000;
  expect(applyHost(s, { t: "start" }, t0)).toBeNull();
  expect(applyHost(s, { t: "timerStart" }, t0 + READ_MS)).toBeNull();
  return { s, t0 };
}
// The host finishes reading and starts the timer 3 s in; buzzers open BUZZ_LEAD_MS later.
const READ_MS = 3000;
const open = (t0: number) => t0 + READ_MS + BUZZ_LEAD_MS;
const idOf = (s: RoomState, pid: string) => s.players[pid].id;

describe("game", () => {
  it("assigns distinct public ids and avatars, caps players", () => {
    const { s } = setup();
    const ids = Object.values(s.players).map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
    joinPlayer(s, "d", "D", 4);
    expect(joinPlayer(s, "e", "E", 4)).toBe("Room is full");
    expect(joinPlayer(s, "secret-a", "Priya 2", 4)).toBeNull(); // rejoin is fine
    expect(s.players["secret-a"].name).toBe("Priya 2");
  });

  it("keeps buzzers locked until the host starts the timer", () => {
    const { quiz } = parseQuiz(FULL, "Test");
    const s = newRoom("ABCD", "key", quiz, 0);
    joinPlayer(s, "secret-a", "Priya", 4);
    applyHost(s, { t: "start" }, 1000);
    expect(s.game.current!.buzzOpenAt).toBeNull();
    expect(applyBuzz(s, "secret-a", "q1", 60_000, 60_000)).toBeNull(); // reading takes as long as it takes
    applyHost(s, { t: "timerStart" }, 60_000);
    const openAt = 60_000 + BUZZ_LEAD_MS;
    expect(s.game.current!.buzzOpenAt).toBe(openAt);
    expect(timerRemaining(s.game.current!.timer, openAt)).toBe(30_000); // clock starts with the buzzers
    expect(applyBuzz(s, "secret-a", "q1", openAt + 50, openAt + 90)).toBe(1);
  });

  it("ignores buzzes before buzzers open", () => {
    const { s, t0 } = setup();
    expect(applyBuzz(s, "secret-a", "q1", t0 + 1000, t0 + 1000)).toBeNull();
    expect(s.game.current!.buzzes).toHaveLength(0);
  });

  it("orders by tap time, not arrival (Mode B)", () => {
    const { s, t0 } = setup();
    const o = open(t0);
    applyBuzz(s, "secret-a", "q1", o + 100, o + 160); // tapped first, slow network
    applyBuzz(s, "secret-b", "q1", o + 120, o + 140); // tapped later, arrived first
    const v = hostView(s, new Set());
    expect(v.q!.queue.map((e) => e.id)).toEqual([idOf(s, "secret-a"), idOf(s, "secret-b")]);
  });

  it("one buzz per player, clamps impossible tap times", () => {
    const { s, t0 } = setup();
    const o = open(t0);
    applyBuzz(s, "secret-a", "q1", o - 5000, o + 50); // claims a tap before opening
    expect(applyBuzz(s, "secret-a", "q1", o + 60, o + 70)).toBeNull();
    expect(s.game.current!.buzzes[0].est).toBe(o);
  });

  it("waits for the buzz to settle before scoring", () => {
    const { s, t0 } = setup();
    const o = open(t0);
    applyBuzz(s, "secret-a", "q1", o + 100, o + 130);
    const a = idOf(s, "secret-a");
    expect(applyHost(s, { t: "correct", id: a }, o + 150)).toMatch(/Still checking/);
    expect(applyHost(s, { t: "correct", id: a }, o + 100 + SETTLE_MS)).toBeNull();
    expect(s.players["secret-a"].score).toBe(10);
  });

  it("wrong moves to the next buzzer; correct ends the question", () => {
    const { s, t0 } = setup();
    const o = open(t0);
    const [a, b, c] = ["secret-a", "secret-b", "secret-c"].map((p) => idOf(s, p));
    applyBuzz(s, "secret-a", "q1", o + 10, o + 50);
    applyBuzz(s, "secret-b", "q1", o + 20, o + 60);
    const t = o + 1000;
    expect(applyHost(s, { t: "correct", id: b }, t)).toMatch(/isn't answering/);
    expect(applyHost(s, { t: "wrong", id: a }, t)).toBeNull();
    expect(currentAnswerer(hostView(s, new Set()).q!.queue, t)!.id).toBe(b);
    expect(applyHost(s, { t: "correct", id: b }, t)).toBeNull();
    expect(s.players["secret-b"].score).toBe(10);
    expect(applyBuzz(s, "secret-c", "q1", t + 10, t + 20)).toBeNull(); // resolved: no more buzzes
    expect(c).toBeDefined();
  });

  it("undo gives back wrongly awarded points and keeps live buzzes", () => {
    const { s, t0 } = setup();
    const o = open(t0);
    const [a, b] = ["secret-a", "secret-b"].map((p) => idOf(s, p));
    applyBuzz(s, "secret-a", "q1", o + 10, o + 50);
    applyHost(s, { t: "correct", id: a }, o + 1000);
    expect(s.players["secret-a"].score).toBe(10);
    expect(s.undo.at(-1)!.label).toBe("+10 to Priya");

    applyHost(s, { t: "undo" }, o + 2000);
    expect(s.players["secret-a"].score).toBe(0);
    expect(s.game.current!.marks).toEqual({});
    // A buzz that came in after the mark is still there after undo
    applyBuzz(s, "secret-b", "q1", o + 20, o + 2100); // clamped to arrival-1000 at most
    applyHost(s, { t: "wrong", id: a }, o + 3000);
    expect(applyHost(s, { t: "correct", id: b }, o + 3000)).toBeNull();
    expect(s.players["secret-b"].score).toBe(10);

    // redo is cleared by new actions; undo twice then redo twice
    applyHost(s, { t: "undo" }, o + 3100);
    applyHost(s, { t: "undo" }, o + 3200);
    expect(s.players["secret-b"].score).toBe(0);
    applyHost(s, { t: "redo" }, o + 3300);
    applyHost(s, { t: "redo" }, o + 3400);
    expect(s.players["secret-b"].score).toBe(10);
    expect(s.game.current!.buzzes).toHaveLength(2);
  });

  it("undo of Next returns to the previous question with its state", () => {
    const { s, t0 } = setup();
    const o = open(t0);
    applyBuzz(s, "secret-a", "q1", o + 10, o + 50);
    applyHost(s, { t: "reveal" }, o + 1000);
    applyHost(s, { t: "next" }, o + 2000);
    expect(s.game.current!.qid).toBe("q2");
    applyHost(s, { t: "undo" }, o + 3000);
    expect(s.game.current!.qid).toBe("q1");
    expect(s.game.current!.revealed).toBe(true);
    expect(s.game.current!.buzzes).toHaveLength(1);
  });

  it("previous shows a played question as it was", () => {
    const { s, t0 } = setup();
    const o = open(t0);
    applyBuzz(s, "secret-a", "q1", o + 10, o + 50);
    applyHost(s, { t: "next" }, o + 1000);
    applyHost(s, { t: "prev" }, o + 2000);
    expect(s.game.current!.qid).toBe("q1");
    expect(s.game.current!.buzzes).toHaveLength(1);
  });

  it("everyone wrong resolves the question", () => {
    const { s, t0 } = setup();
    const o = open(t0);
    for (const [i, p] of ["secret-a", "secret-b", "secret-c"].entries()) applyBuzz(s, p, "q1", o + 10 * (i + 1), o + 50);
    for (const p of ["secret-a", "secret-b", "secret-c"]) expect(applyHost(s, { t: "wrong", id: idOf(s, p) }, o + 1000)).toBeNull();
    expect(Object.values(s.players).every((p) => p.score === 0)).toBe(true);
  });

  it("timer: start, add/remove 10 s, pause, expiry closes buzzers", () => {
    const { s, t0 } = setup();
    const q = () => s.game.current!;
    expect(timerRemaining(q().timer, t0)).toBe(30_000);
    applyHost(s, { t: "timerSet", sec: 60 }, t0);
    expect(q().timer.duration).toBe(60_000);
    applyHost(s, { t: "timerStart" }, t0);
    applyHost(s, { t: "timerAdd", ms: 10_000 }, t0 + 1000);
    expect(timerRemaining(q().timer, t0 + 1000)).toBe(69_000);
    applyHost(s, { t: "timerAdd", ms: -10_000 }, t0 + 1000);
    applyHost(s, { t: "timerPause" }, t0 + 5000);
    expect(timerRemaining(q().timer, t0 + 50_000)).toBe(55_000);
    applyHost(s, { t: "timerStart" }, t0 + 50_000);
    const end = t0 + 50_000 + 55_000;
    expect(applyBuzz(s, "secret-a", "q1", end + 300, end + 400)).toBeNull();
  });

  it("spares detour and next continues the main list", () => {
    const { s, t0 } = setup();
    applyHost(s, { t: "spare", qid: "s1" }, t0 + 10);
    expect(s.game.current!.kind).toBe("spare");
    applyHost(s, { t: "next" }, t0 + 20);
    expect(s.game.current!.qid).toBe("q2");
  });

  it("next after the last question ends the game", () => {
    const { s, t0 } = setup();
    applyHost(s, { t: "next" }, t0 + 1);
    applyHost(s, { t: "next" }, t0 + 2);
    applyHost(s, { t: "next" }, t0 + 3);
    expect(s.game.phase).toBe("ended");
    applyHost(s, { t: "prev" }, t0 + 4);
    expect(s.game.current!.qid).toBe("q3");
  });

  it("tracks win streaks and undo removes them", () => {
    const { s, t0 } = setup();
    const a = idOf(s, "secret-a"), b = idOf(s, "secret-b");
    const win = (pid: string, id: string, qid: string, t: number) => {
      const o = t + 3000 + BUZZ_LEAD_MS;
      if (s.game.current!.buzzOpenAt == null) applyHost(s, { t: "timerStart" }, t + 3000);
      applyBuzz(s, pid, qid, o + 10, o + 30);
      expect(applyHost(s, { t: "correct", id }, o + 1000)).toBeNull();
    };
    win("secret-a", a, "q1", t0);
    applyHost(s, { t: "next" }, t0 + 20_000);
    win("secret-a", a, "q2", t0 + 20_000);
    let v = hostView(s, new Set());
    expect(v.players.find((p) => p.id === a)!.streak).toBe(2);
    applyHost(s, { t: "undo" }, t0 + 30_000);
    v = hostView(s, new Set());
    expect(v.players.find((p) => p.id === a)!.streak).toBe(1);
    applyHost(s, { t: "next" }, t0 + 50_000);
    expect(s.game.current!.qid).toBe("q3");
    win("secret-b", b, "q3", t0 + 50_000);
    v = hostView(s, new Set());
    expect(v.players.find((p) => p.id === a)!.streak).toBe(0);
    expect(v.players.find((p) => p.id === b)!.streak).toBe(1);
  });

  it("views never leak answers or secret ids", () => {
    const { s, t0 } = setup();
    const o = open(t0);
    applyBuzz(s, "secret-a", "q1", o + 10, o + 50);
    const dv = JSON.stringify(displayView(s, new Set()));
    const pv = JSON.stringify(playerView(s, "secret-a"));
    for (const v of [dv, pv]) {
      expect(v).not.toContain("SEA SALT");
      expect(v).not.toContain("Accept");
      expect(v).not.toContain("secret-");
    }
    expect(pv).not.toContain("shio");
    applyHost(s, { t: "reveal" }, o + 100);
    const dv2 = JSON.stringify(displayView(s, new Set()));
    expect(dv2).toContain("SEA SALT");
    expect(dv2).not.toContain("Accept");
    expect(JSON.stringify(hostView(s, new Set()))).toContain("Accept: **SALT**");
  });
});
