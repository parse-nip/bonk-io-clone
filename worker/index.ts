import { GameRoom } from "./room";
import { LobbyDirectory } from "./lobby";

export { GameRoom, LobbyDirectory };

export interface Env {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  ASSETS: Fetcher;
}

function roomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "bonk", domain: "bonk.popped.dev" });
    }

    if (url.pathname === "/api/rooms") {
      const id = env.LOBBY.idFromName("global");
      const stub = env.LOBBY.get(id);
      return stub.fetch("https://lobby/list", { method: "GET" });
    }

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      let code = (url.searchParams.get("code") || "").toUpperCase().trim();
      const create = url.searchParams.get("create") === "1";

      if (create || !code) {
        code = roomCode();
      }

      const id = env.ROOM.idFromName(code);
      const stub = env.ROOM.get(id);
      const forward = new URL(request.url);
      forward.searchParams.set("code", code);
      return stub.fetch(forward.toString(), request);
    }

    // Static SPA assets (Vite build output)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
