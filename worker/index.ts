import { DurableObject } from "cloudflare:workers";
import {
  applyBuzz,
  applyHost,
  displayView,
  hostView,
  joinPlayer,
  newRoom,
  playerView,
} from "../shared/game";
import { MAX_PLAYERS, type ClientMsg, type HostAction, type Quiz, type RoomState } from "../shared/types";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_QUIZ_BYTES = 2_000_000;

const randomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
const randomKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

function validQuiz(x: unknown): x is Quiz {
  const q = x as Quiz;
  const okList = (l: unknown) =>
    Array.isArray(l) &&
    l.every((i) => i && typeof i.id === "string" && typeof i.text === "string" && typeof i.answer === "string" && Array.isArray(i.notes));
  return !!q && typeof q.title === "string" && okList(q.questions) && okList(q.spares) && q.questions.length > 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/rooms" && req.method === "POST") {
      const body = await req.text();
      if (body.length > MAX_QUIZ_BYTES) return new Response("Quiz file is too large", { status: 413 });
      let quiz: unknown;
      try {
        quiz = JSON.parse(body).quiz;
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      if (!validQuiz(quiz)) return new Response("That quiz has no questions", { status: 400 });
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = randomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const hostKey = randomKey();
        if (await stub.init(code, hostKey, quiz)) return Response.json({ code, hostKey });
      }
      return new Response("Could not allocate a room, try again", { status: 503 });
    }

    const ws = url.pathname.match(/^\/ws\/([A-Za-z]{4})$/);
    if (ws) {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      const code = ws[1].toUpperCase();
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  role: "host" | "display" | "player";
  pid?: string;
}

export class Room extends DurableObject<Env> {
  private s: RoomState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<RoomState>("state");
      // Ignore rooms saved by older versions (e.g. the M0 buzz test).
      this.s = saved && saved.quiz && saved.game ? saved : null;
    });
  }

  async init(code: string, hostKey: string, quiz: Quiz): Promise<boolean> {
    if (this.s) return false;
    this.s = newRoom(code, hostKey, quiz, Date.now());
    await this.save();
    return true;
  }

  private async save() {
    if (!this.s) return;
    await this.ctx.storage.put("state", this.s);
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
  }

  async alarm() {
    // Room idle for 12 hours: forget it.
    for (const ws of this.ctx.getWebSockets()) ws.close(4002, "Room expired");
    await this.ctx.storage.deleteAll();
    this.s = null;
  }

  async fetch(req: Request): Promise<Response> {
    const s = this.s;
    if (!s) return new Response("No such room", { status: 404 });
    const url = new URL(req.url);
    const role = url.searchParams.get("role");
    let att: Attachment;

    if (role === "host") {
      if (url.searchParams.get("key") !== s.hostKey) return new Response("Bad host key", { status: 403 });
      att = { role: "host" };
    } else if (role === "display") {
      att = { role: "display" };
    } else {
      const pid = (url.searchParams.get("pid") ?? "").slice(0, 64);
      const name = (url.searchParams.get("name") ?? "").trim().slice(0, 20);
      if (!pid || !name) return new Response("Missing name", { status: 400 });
      const err = joinPlayer(s, pid, name, MAX_PLAYERS);
      if (err) return new Response(err, { status: 409 });
      for (const old of this.ctx.getWebSockets(`p:${pid}`)) old.close(4000, "Replaced");
      att = { role: "player", pid };
      await this.save();
    }

    const [client, server] = Object.values(new WebSocketPair());
    const tags = att.role === "player" ? ["player", `p:${att.pid}`] : [att.role];
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment(att);
    queueMicrotask(() => this.broadcast());
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const now = Date.now();
    const s = this.s;
    if (!s || typeof raw !== "string" || raw.length > 4096) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.t === "ping") {
      ws.send(JSON.stringify({ t: "pong", c: msg.c, s: now }));
      return;
    }
    const att = ws.deserializeAttachment() as Attachment;

    if (att.role === "player") {
      if (msg.t !== "buzz" || typeof msg.est !== "number") return;
      const place = applyBuzz(s, att.pid!, msg.qid, msg.est, now);
      if (place == null) return;
      await this.save();
      this.broadcast();
      return;
    }

    if (att.role !== "host") return;
    const before = new Set(Object.keys(s.players));
    const err = applyHost(s, msg as HostAction, now);
    if (err) {
      ws.send(JSON.stringify({ t: "error", message: err }));
      return;
    }
    if (msg.t === "undo" || msg.t === "redo") {
      // label of what was undone/redone is on the opposite stack now
      const label = msg.t === "undo" ? s.redo.at(-1)?.label : s.undo.at(-1)?.label;
      ws.send(JSON.stringify({ t: "toast", message: `${msg.t === "undo" ? "Undone" : "Redone"}: ${label}` }));
    }
    for (const pid of before) {
      if (!s.players[pid]) for (const old of this.ctx.getWebSockets(`p:${pid}`)) old.close(4001, "Removed by host");
    }
    await this.save();
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code);
    } catch {}
    this.broadcast();
  }

  async webSocketError() {
    this.broadcast();
  }

  private broadcast() {
    const s = this.s;
    if (!s) return;
    const online = new Set<string>();
    for (const ws of this.ctx.getWebSockets("player")) {
      if (ws.readyState === WebSocket.OPEN) online.add((ws.deserializeAttachment() as Attachment).pid!);
    }
    const send = (ws: WebSocket, data: string) => {
      try {
        ws.send(data);
      } catch {}
    };
    const host = JSON.stringify(hostView(s, online));
    for (const ws of this.ctx.getWebSockets("host")) send(ws, host);
    const display = JSON.stringify(displayView(s, online));
    for (const ws of this.ctx.getWebSockets("display")) send(ws, display);
    for (const ws of this.ctx.getWebSockets("player")) {
      const v = playerView(s, (ws.deserializeAttachment() as Attachment).pid!);
      if (v) send(ws, JSON.stringify(v));
    }
  }
}
