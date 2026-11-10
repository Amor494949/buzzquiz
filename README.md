# BuzzQuiz

Multi-screen buzzer quiz for one host and up to 4 players. See the PRD for the full plan.

## Current stage: M0 buzz test

A bare room that records every buzz in two orders so we can choose how to rank buzzes:

- **Mode A, arrival order:** when the buzz reached the server.
- **Mode B, tap-time order:** when the finger touched the screen, converted to the server's clock.

### Running a test session

1. Host opens `/host.html` on a laptop and clicks **Create a test room**.
2. Each player opens the site on their phone, enters the room code and a name, and taps **Join**.
3. Host presses **Start round** (or Space). Buzzers open after a random 1.5 to 3.5 s delay.
4. Everyone buzzes as fast as they can. The round closes once everyone has buzzed.
5. Repeat for 30+ rounds. Mix setups: same Wi-Fi, some on 4G, iPhone and Android.
6. Read **Verdict so far** and click **Download log (JSON)** to keep the raw data.

Decision rule (from the PRD): Mode A if the two modes pick a different winner in under 2% of rounds and the worst jitter is under 40 ms; otherwise Mode B.

## Develop

```bash
npm install
npm run dev     # http://localhost:8787  (host: /host.html)
npm run check   # type-check
```

## Deploy (Cloudflare, free plan)

Either connect this GitHub repo in the Cloudflare dashboard (Workers & Pages → Create → Import a repository; build command empty, deploy command `npx wrangler deploy`), or run `npx wrangler login` then `npm run deploy` from your own computer.

## Layout

- `src/worker.ts`: Worker (room creation, routing) and the `Room` Durable Object (one per room: players, rounds, buzzes, clock-sync replies).
- `public/net.js`: WebSocket with auto-reconnect and NTP-style clock sync.
- `public/index.html`: player phone screen with the buzzer.
- `public/host.html`: host test console.
