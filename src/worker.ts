import { DurableObject } from "cloudflare:workers";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

// ---------- Worker entry: room creation + WebSocket routing ----------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O

function randomCode(len = 4): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/rooms" && req.method === "POST") {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const hostKey = randomKey();
        if (await stub.init(code, hostKey)) {
          return Response.json({ code, hostKey });
        }
      }
      return new Response("Could not allocate a room", { status: 503 });
    }

    const ws = url.pathname.match(/^\/ws\/([A-Z]{4})$/);
    if (ws) {
      if (req.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(ws[1]));
      return stub.fetch(req);
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

// ---------- Room state ----------

const AVATARS = [
  { emoji: "🦊", color: "#E8590C" },
  { emoji: "🐼", color: "#495057" },
  { emoji: "🐸", color: "#2F9E44" },
  { emoji: "🐙", color: "#C2255C" },
  { emoji: "🦉", color: "#7048E8" },
  { emoji: "🐳", color: "#1971C2" },
  { emoji: "🦁", color: "#E67700" },
  { emoji: "🐧", color: "#0C8599" },
];

const MAX_PLAYERS = 4;
const RTT_SAMPLES = 40;

interface Player {
  pid: string;
  name: string;
  avatar: number;
  rtts: number[]; // recent round-trip times, ms
  offset: number; // client clock minus server clock estimate, ms
}

interface Buzz {
  pid: string;
  arrival: number; // server clock when the buzz message arrived (Mode A)
  est: number; // client tap time converted to server clock (Mode B)
  rtt: number; // client's best recent RTT at tap time
}

interface Round {
  n: number;
  openAt: number; // server clock when buzzers open
  closed: boolean;
  buzzes: Buzz[];
}

interface RoomState {
  code: string;
  hostKey: string;
  createdAt: number;
  players: Record<string, Player>;
  rounds: Round[];
}

interface Attachment {
  role: "host" | "player";
  pid?: string;
}

type ClientMsg =
  | { t: "ping"; c: number; rtt?: number; off?: number }
  | { t: "buzz"; n: number; est: number; rtt: number }
  | { t: "arm" }
  | { t: "close" }
  | { t: "reset" }
  | { t: "kick"; pid: string };

export class Room extends DurableObject<Env> {
  private s: RoomState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<RoomState>("state")) ?? null;
    });
    // Answer pings without waking the object from hibernation is not possible
    // (we need server time), so pings are handled in webSocketMessage.
  }

  async init(code: string, hostKey: string): Promise<boolean> {
    if (this.s) return false; // code already taken
    this.s = { code, hostKey, createdAt: Date.now(), players: {}, rounds: [] };
    await this.save();
    return true;
  }

  private async save() {
    if (this.s) await this.ctx.storage.put("state", this.s);
  }

  async fetch(req: Request): Promise<Response> {
    if (!this.s) return new Response("No such room", { status: 404 });
    const url = new URL(req.url);
    const role = url.searchParams.get("role");
    let att: Attachment;

    if (role === "host") {
      if (url.searchParams.get("key") !== this.s.hostKey) {
        return new Response("Bad host key", { status: 403 });
      }
      att = { role: "host" };
    } else {
      const pid = (url.searchParams.get("pid") ?? "").slice(0, 40);
      const name = (url.searchParams.get("name") ?? "").trim().slice(0, 20);
      if (!pid || !name) return new Response("Missing name", { status: 400 });
      let p = this.s.players[pid];
      if (!p) {
        if (Object.keys(this.s.players).length >= MAX_PLAYERS) {
          return new Response("Room is full", { status: 409 });
        }
        const used = new Set(Object.values(this.s.players).map((x) => x.avatar));
        const avatar = AVATARS.findIndex((_, i) => !used.has(i));
        p = { pid, name, avatar, rtts: [], offset: 0 };
        this.s.players[pid] = p;
      } else {
        p.name = name;
      }
      // One live socket per player: close older ones.
      for (const old of this.ctx.getWebSockets(`p:${pid}`)) old.close(4000, "Replaced");
      att = { role: "player", pid };
      await this.save();
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const tags = att.role === "host" ? ["host"] : ["player", `p:${att.pid}`];
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment(att);

    queueMicrotask(() => {
      if (att.role === "player") this.sendPlayerState(server, att.pid!);
      this.broadcastHost();
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const now = Date.now(); // arrival time of this message
    if (!this.s || typeof raw !== "string") return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment;

    // Clock sync: reply immediately with server time.
    if (msg.t === "ping") {
      ws.send(JSON.stringify({ t: "pong", c: msg.c, s: now }));
      if (att.role === "player" && att.pid && typeof msg.rtt === "number") {
        const p = this.s.players[att.pid];
        if (p) {
          p.rtts.push(Math.round(msg.rtt * 10) / 10);
          if (p.rtts.length > RTT_SAMPLES) p.rtts.shift();
          if (typeof msg.off === "number") p.offset = Math.round(msg.off * 10) / 10;
        }
      }
      return;
    }

    if (att.role === "player" && msg.t === "buzz") {
      const round = this.s.rounds.at(-1);
      if (!round || round.closed || round.n !== msg.n) return;
      if (now < round.openAt - 300) return; // far too early: ignore
      if (round.buzzes.some((b) => b.pid === att.pid)) return; // one per round
      round.buzzes.push({ pid: att.pid!, arrival: now, est: msg.est, rtt: msg.rtt });
      ws.send(JSON.stringify({ t: "buzzed", n: round.n, place: round.buzzes.length }));
      const connected = this.ctx.getWebSockets("player").length;
      if (round.buzzes.length >= connected) round.closed = true;
      await this.save();
      if (round.closed) this.broadcastPlayers();
      this.broadcastHost();
      return;
    }

    if (att.role !== "host") return;

    if (msg.t === "arm") {
      const prev = this.s.rounds.at(-1);
      if (prev) prev.closed = true;
      // Random 1.5-3.5 s delay so nobody can anticipate the opening.
      const delay = 1500 + Math.floor(Math.random() * 2000);
      this.s.rounds.push({ n: this.s.rounds.length + 1, openAt: now + delay, closed: false, buzzes: [] });
    } else if (msg.t === "close") {
      const r = this.s.rounds.at(-1);
      if (r) r.closed = true;
    } else if (msg.t === "reset") {
      this.s.rounds = [];
      for (const p of Object.values(this.s.players)) p.rtts = [];
    } else if (msg.t === "kick") {
      delete this.s.players[msg.pid];
      for (const old of this.ctx.getWebSockets(`p:${msg.pid}`)) old.close(4001, "Removed by host");
    }
    await this.save();
    this.broadcastPlayers();
    this.broadcastHost();
  }

  async webSocketClose(ws: WebSocket) {
    ws.close();
    this.broadcastHost();
  }

  async webSocketError() {
    this.broadcastHost();
  }

  // ---------- Outgoing state ----------

  private sendPlayerState(ws: WebSocket, pid: string) {
    if (!this.s) return;
    const p = this.s.players[pid];
    if (!p) return;
    const r = this.s.rounds.at(-1);
    const mine = r?.buzzes.findIndex((b) => b.pid === pid) ?? -1;
    ws.send(
      JSON.stringify({
        t: "state",
        me: { name: p.name, ...AVATARS[p.avatar] },
        round: r ? { n: r.n, openAt: r.openAt, closed: r.closed, buzzed: mine >= 0, place: mine + 1 } : null,
      }),
    );
  }

  private broadcastPlayers() {
    for (const ws of this.ctx.getWebSockets("player")) {
      const att = ws.deserializeAttachment() as Attachment;
      try {
        this.sendPlayerState(ws, att.pid!);
      } catch {}
    }
  }

  private broadcastHost() {
    if (!this.s) return;
    const online = new Set(
      this.ctx.getWebSockets("player").map((ws) => (ws.deserializeAttachment() as Attachment).pid),
    );
    const players = Object.values(this.s.players).map((p) => ({
      pid: p.pid,
      name: p.name,
      ...AVATARS[p.avatar],
      online: online.has(p.pid),
      rtts: p.rtts,
      offset: p.offset,
    }));
    const msg = JSON.stringify({ t: "host", code: this.s.code, now: Date.now(), players, rounds: this.s.rounds });
    for (const ws of this.ctx.getWebSockets("host")) {
      try {
        ws.send(msg);
      } catch {}
    }
  }
}
