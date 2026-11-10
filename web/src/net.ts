// WebSocket connection with auto-reconnect and NTP-style clock sync.
//
// Every 2 s we send local time c; the server answers with its time s; the reply
// lands at local time r. rtt = r - c, offset = s - (c + r) / 2. We trust the
// offset from the recent sample with the lowest rtt (least queueing delay).

import { useEffect, useRef, useState } from "react";
import type { ClientMsg, ServerMsg } from "../../shared/types";

export const localNow = () => performance.timeOrigin + performance.now();

export interface Sync {
  offset: number;
  rtt: number | null;
  ready: boolean;
  serverNow: () => number;
  toServer: (local: number) => number;
}

export type ConnStatus = "connecting" | "online" | "offline" | "replaced" | "removed" | "rejected" | "expired";

export function useRoom<V extends ServerMsg>(
  path: string | null,
  onEvent?: (msg: ServerMsg) => void,
) {
  const [view, setView] = useState<V | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const syncRef: { current: Sync } = useRef<Sync>({
    offset: 0,
    rtt: null,
    ready: false,
    serverNow: (): number => localNow() + syncRef.current.offset,
    toServer: (l: number): number => l + syncRef.current.offset,
  });

  useEffect(() => {
    if (!path) return;
    let closedByUs = false;
    let retry = 0;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let openedOnce = false;
    const samples: { rtt: number; offset: number }[] = [];
    const sync = syncRef.current;

    const ping = () => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "ping", c: localNow() }));
    };

    const open = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}${path}`);
      wsRef.current = ws;
      setStatus("connecting");

      ws.onopen = () => {
        retry = 0;
        openedOnce = true;
        setStatus("online");
        for (let i = 0; i < 6; i++) setTimeout(ping, i * 120);
        clearInterval(pingTimer);
        pingTimer = setInterval(ping, 2000);
      };

      ws.onmessage = (ev) => {
        const r = localNow();
        const msg = JSON.parse(ev.data) as ServerMsg;
        if (msg.t === "pong") {
          samples.push({ rtt: r - msg.c, offset: msg.s - (msg.c + r) / 2 });
          if (samples.length > 12) samples.shift();
          const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
          sync.offset = best.offset;
          sync.rtt = r - msg.c;
          sync.ready = samples.length >= 3;
          return;
        }
        if (msg.t === "error" || msg.t === "toast") {
          onEventRef.current?.(msg);
          return;
        }
        setView(msg as V);
      };

      ws.onclose = (ev) => {
        clearInterval(pingTimer);
        if (closedByUs) return;
        if (ev.code === 4000) return setStatus("replaced");
        if (ev.code === 4001) return setStatus("removed");
        if (ev.code === 4002) return setStatus("expired");
        // Never opened at all: the server refused (bad code, full room, bad key).
        if (!openedOnce && retry >= 2) {
          setStatus("rejected");
          return;
        }
        setStatus("offline");
        retryTimer = setTimeout(open, Math.min(5000, 300 * 2 ** retry++));
      };
    };

    open();
    const onVisible = () => {
      // Phones drop sockets in the background; reconnect quickly when shown again.
      if (document.visibilityState === "visible" && wsRef.current?.readyState !== WebSocket.OPEN && !closedByUs) {
        clearTimeout(retryTimer);
        retry = 0;
        open();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closedByUs = true;
      clearInterval(pingTimer);
      clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      wsRef.current?.close();
    };
  }, [path]);

  const send = (msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  };

  return { view, status, send, sync: syncRef.current };
}

/** Re-render ~10 times a second with the current server time. */
export function useServerNow(sync: Sync, intervalMs = 100): number {
  const [now, setNow] = useState(() => sync.serverNow());
  useEffect(() => {
    const id = setInterval(() => setNow(sync.serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [sync, intervalMs]);
  return now;
}
