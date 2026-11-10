// Shared client code: WebSocket with auto-reconnect + clock sync.
//
// Clock sync (NTP-style): every 2 s we send our local time c, the server replies
// with its time s, and when the reply arrives at local time r:
//   rtt    = r - c
//   offset = s - (c + r) / 2      (server clock minus local clock)
// We keep the last 12 samples and trust the offset from the sample with the
// lowest RTT, because that one had the least queueing delay.

export const localNow = () => performance.timeOrigin + performance.now();

export function connect(path, { onMessage, onStatus }) {
  const samples = [];
  let ws = null;
  let pingTimer = null;
  let retry = 0;
  let closedByUs = false;

  const sync = {
    offset: 0,
    rtt: null,
    ready: false,
    serverNow: () => localNow() + sync.offset,
    toServer: (localTime) => localTime + sync.offset,
  };

  function ping() {
    if (ws?.readyState !== 1) return;
    ws.send(JSON.stringify({ t: "ping", c: localNow(), rtt: sync.rtt ?? undefined, off: sync.ready ? sync.offset : undefined }));
  }

  function open() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}${path}`);
    onStatus?.("connecting");

    ws.onopen = () => {
      retry = 0;
      onStatus?.("online");
      // A quick burst of pings gets a good offset fast, then every 2 s.
      for (let i = 0; i < 5; i++) setTimeout(ping, i * 150);
      clearInterval(pingTimer);
      pingTimer = setInterval(ping, 2000);
    };

    ws.onmessage = (ev) => {
      const r = localNow();
      const msg = JSON.parse(ev.data);
      if (msg.t === "pong") {
        const rtt = r - msg.c;
        samples.push({ rtt, offset: msg.s - (msg.c + r) / 2 });
        if (samples.length > 12) samples.shift();
        const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        sync.offset = best.offset;
        sync.rtt = rtt;
        sync.bestRtt = best.rtt;
        sync.ready = samples.length >= 3;
        return;
      }
      onMessage(msg);
    };

    ws.onclose = (ev) => {
      clearInterval(pingTimer);
      if (closedByUs) return;
      if (ev.code === 4000 || ev.code === 4001) {
        onStatus?.(ev.code === 4001 ? "removed" : "replaced");
        return;
      }
      onStatus?.("offline");
      const wait = Math.min(5000, 300 * 2 ** retry++);
      setTimeout(open, wait);
    };
  }

  open();

  return {
    sync,
    send: (obj) => {
      if (ws?.readyState === 1) {
        ws.send(JSON.stringify(obj));
        return true;
      }
      return false;
    },
    close: () => {
      closedByUs = true;
      ws?.close();
    },
  };
}
