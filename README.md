# BuzzQuiz

A multi-screen buzzer quiz for one host and up to 4 players. Load a `.tsv` quiz, put the **Display** on a TV, run the game from the **Control** panel (laptop or phone), and players buzz on their phones.

Live: https://buzzquiz.romapandya49.workers.dev

## How to play

1. **Host:** open `/host`, choose a `.tsv` file, check the preview, click **Create room**.
2. Click **Open display** and drag that window to the TV (click once to turn on sound and full screen). It shows the room code and a QR code.
3. **Players:** scan the QR code or open the site, enter the code and a name, tap **Join**.
4. **Host:** pick the timer (30 s or 60 s) and press **Start game**.
5. For each question: buzzers open 5 s after it appears. The buzz order shows live with avatars and the gap behind the first buzz. Mark the highlighted player **Correct** (+10) or **Wrong** (next person in the queue answers). **Reveal** shows the answer and the scores on the Display. **Next** moves on.

Made a mistake? **Undo** steps back one action at a time (scores, marks, reveal, next/previous) and **Redo** puts it back. Buzzes that came in meanwhile are kept.

To run the game from your phone, click **Control on phone** and scan the QR code. Keep that link private: it carries the host key.

Shortcuts on the Control panel: `C` correct · `W` wrong · `R` reveal · `N`/`→` next · `←` previous · `Space` start/pause timer · `Ctrl+Z` undo · `Ctrl+Y` redo.

## Quiz file format

Tab-separated, with a header row. Either:

- **Full:** `roundNo, questionNo, questionText, answerText, imageUrl`. Rows whose `roundNo` starts with `Spare` become spare questions the host can play at any time; rows starting with `Instructions` are skipped.
- **Simple:** `question, answer` and optionally `image`.

Text may use `**bold**`, `<br>` and `<img src="https://...">`. Marking notes in the answer like `[Accept: SALT]`, `[Prompt: SNOW WHITE]` or `[Do not accept: ...]` are shown to the host only.

## Buzz fairness

Buzzes are ordered by **when the finger touched the screen**, converted to the server's clock (each phone syncs its clock every 2 s). The M0 test on real phones showed arrival order gave a consistent ~15 ms edge to the fastest connection. The server waits 200 ms after a tap before naming who answers, so a slower phone's earlier tap can't be overtaken.

## Develop

```bash
npm install
npm run dev     # builds the screens, serves http://localhost:8787
npm test        # unit tests for parsing and game rules
npm run check   # type-check
```

## Deploy

Cloudflare Workers Builds deploys every push to `main` with `npx wrangler deploy`, which runs `npm run build:web` first (see `wrangler.jsonc`).

## Layout

- `shared/`: code used by both server and screens. `types.ts` (data and messages), `game.ts` (rules, undo/redo, per-screen views), `tsv.ts` (file parsing), `format.ts` (safe rich text).
- `worker/index.ts`: Worker (room creation, routing) and the `Room` Durable Object, one per room, which holds the game state and talks to every screen over WebSockets.
- `web/`: the three screens (React): `player.tsx`, `host.tsx` (setup and Control), `display.tsx`.
- `tests/`: unit tests.
