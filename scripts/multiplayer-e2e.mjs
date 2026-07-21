/**
 * End-to-end multiplayer smoke test against local wrangler or Vite proxy.
 * Flow: create room → join → start → client input → host snapshots → client receives.
 */
import { WebSocket } from "ws";
import { execSync } from "node:child_process";

const BASE = process.env.BONK_WS_BASE ?? "ws://127.0.0.1:8787";
const API = process.env.BONK_API_BASE ?? "http://127.0.0.1:8787";

const SKIN = { baseColor: "#e74c3c", eyes: true, mouth: true, accent: "#222" };
const ROOM = {
  name: "E2E Test",
  mode: "classic",
  mapId: "classic",
  roundsToWin: 1,
  maxPlayers: 6,
  teams: false,
  bots: 0,
};

function collect(ws, label) {
  const msgs = [];
  ws.on("message", (raw) => {
    try {
      msgs.push(JSON.parse(String(raw)));
    } catch {
      /* ignore */
    }
  });
  return {
    waitFor(pred, timeoutMs = 8000) {
      const existing = msgs.find(pred);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.off("message", onMsg);
          reject(
            new Error(
              `Timeout [${label}] waiting for message. Got: ${msgs.map((m) => m.type).join(", ")}`,
            ),
          );
        }, timeoutMs);
        function onMsg(raw) {
          let msg;
          try {
            msg = JSON.parse(String(raw));
          } catch {
            return;
          }
          msgs.push(msg);
          if (pred(msg)) {
            clearTimeout(timer);
            ws.off("message", onMsg);
            resolve(msg);
          }
        }
        ws.on("message", onMsg);
      });
    },
    all: () => msgs,
  };
}

function connect(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE}${path}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

async function main() {
  const health = await fetch(`${API}/api/health`);
  if (!health.ok) throw new Error(`Health check failed: ${health.status}`);

  const hostWs = await connect("/ws?create=1");
  const host = collect(hostWs, "host");
  hostWs.send(
    JSON.stringify({
      type: "create",
      name: "Host",
      guest: true,
      skin: SKIN,
      room: ROOM,
    }),
  );
  const welcome = await host.waitFor((m) => m.type === "welcome");
  const code = welcome.code;
  const hostId = welcome.playerId;
  if (!welcome.isHost) throw new Error("Creator should be host");
  await host.waitFor((m) => m.type === "lobby");

  const listRes = await fetch(`${API}/api/rooms`);
  const listJson = await listRes.json();
  let listed = (listJson.rooms ?? []).find((r) => r.code === code);
  if (!listed) {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const retry = await fetch(`${API}/api/rooms`).then((r) => r.json());
      listed = (retry.rooms ?? []).find((r) => r.code === code);
      if (listed) break;
    }
  }
  if (!listed) throw new Error(`Room ${code} not in /api/rooms`);

  const clientWs = await connect(`/ws?code=${encodeURIComponent(code)}`);
  const client = collect(clientWs, "client");
  clientWs.send(
    JSON.stringify({
      type: "join",
      name: "Client",
      guest: true,
      skin: { ...SKIN, baseColor: "#3498db" },
      code,
    }),
  );
  const clientWelcome = await client.waitFor((m) => m.type === "welcome");
  const clientId = clientWelcome.playerId;
  if (clientWelcome.isHost) throw new Error("Joiner should not be host");

  const lobbyClient = await client.waitFor((m) => m.type === "lobby" && m.players.length === 2);
  const lobbyHost = await host.waitFor((m) => m.type === "lobby" && m.players.length === 2);
  if (lobbyClient.players.length !== 2) throw new Error("Client lobby missing players");
  if (lobbyHost.players.length !== 2) throw new Error("Host lobby missing players");

  hostWs.send(JSON.stringify({ type: "ready", ready: true }));
  clientWs.send(JSON.stringify({ type: "ready", ready: true }));
  hostWs.send(JSON.stringify({ type: "start" }));

  const startedHostP = host.waitFor((m) => m.type === "started");
  const startedClientP = client.waitFor((m) => m.type === "started");
  const [startedHost, startedClient] = await Promise.all([startedHostP, startedClientP]);
  if (startedClient.players.length !== 2) throw new Error("Started payload missing players");

  execSync(
    "node_modules/.bin/esbuild src/game/engine.ts --bundle --format=esm --platform=node --outfile=.tmp-multiplayer-engine.mjs",
    { stdio: "pipe" },
  );
  const { BonkEngine } = await import("../.tmp-multiplayer-engine.mjs?update=" + Date.now());

  const profiles = startedHost.players.map((p) => ({
    id: p.id,
    name: p.name,
    guest: p.guest,
    skin: p.skin,
    wins: 0,
    team: p.team,
    ready: true,
    isBot: false,
  }));

  const engine = new BonkEngine(ROOM.mode, ROOM.mapId, ROOM.roundsToWin);
  engine.addPlayers(profiles);
  engine.startRound();

  let snapshotsReceived = 0;
  let inputRelayed = false;
  clientWs.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type === "snapshot") snapshotsReceived += 1;
  });
  hostWs.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.type === "input" && msg.playerId === clientId) inputRelayed = true;
  });

  clientWs.send(JSON.stringify({ type: "input", seq: 1, bits: 2 }));

  for (let i = 0; i < 30; i++) {
    engine.setInput(hostId, {
      left: false,
      right: true,
      up: false,
      down: false,
      heavy: false,
      special: false,
    });
    engine.update(1 / 60);
    hostWs.send(JSON.stringify({ type: "snapshot", snap: engine.getSnapshot() }));
    await new Promise((r) => setTimeout(r, 16));
  }

  const deadline = Date.now() + 3000;
  while (snapshotsReceived < 5 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!inputRelayed) throw new Error("Host never received client input relay");
  if (snapshotsReceived < 5) throw new Error(`Client only got ${snapshotsReceived} snapshots`);

  clientWs.send(JSON.stringify({ type: "chat", text: "hello e2e" }));
  await host.waitFor((m) => m.type === "chat" && m.text === "hello e2e");

  hostWs.send(JSON.stringify({ type: "end_match" }));
  await host.waitFor((m) => m.type === "lobby" && !m.inGame);

  hostWs.close();
  clientWs.close();

  console.log(
    JSON.stringify({
      ok: true,
      via: BASE,
      code,
      hostId,
      clientId,
      snapshotsReceived,
      inputRelayed,
    }),
  );
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, via: BASE, error: err.message }));
  process.exit(1);
});
