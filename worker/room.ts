import { DurableObject } from "cloudflare:workers";
import type {
  ClientMessage,
  GameSnapshot,
  NetPlayer,
  NetRoomConfig,
  NetSkin,
  RoomSummary,
  ServerMessage,
} from "../shared/protocol";

interface Env {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
}

interface Attachment {
  playerId: string;
  name: string;
  guest: boolean;
  skin: NetSkin;
  wins: number;
  team: number;
  ready: boolean;
}

const DEFAULT_ROOM: NetRoomConfig = {
  name: "Custom Game",
  mode: "classic",
  mapId: "classic",
  roundsToWin: 3,
  maxPlayers: 8,
  teams: false,
  bots: 0,
};

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export class GameRoom extends DurableObject<Env> {
  private code = "";
  private hostId: string | null = null;
  private room: NetRoomConfig = { ...DEFAULT_ROOM };
  private inGame = false;
  private players = new Map<string, Attachment>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<{
        code: string;
        hostId: string | null;
        room: NetRoomConfig;
        inGame: boolean;
      }>("meta");
      if (stored) {
        this.code = stored.code;
        this.hostId = stored.hostId;
        this.room = stored.room;
        this.inGame = stored.inGame;
      }
      // Restore player attachments from hibernated sockets
      for (const ws of this.ctx.getWebSockets()) {
        const att = ws.deserializeAttachment() as Attachment | null;
        if (att?.playerId) this.players.set(att.playerId, att);
      }
    });
  }

  private async persist() {
    await this.ctx.storage.put("meta", {
      code: this.code,
      hostId: this.hostId,
      room: this.room,
      inGame: this.inGame,
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/info") {
      return Response.json(this.summary());
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    if (!this.code) {
      this.code = url.searchParams.get("code") || uid();
      await this.persist();
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      this.send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    try {
      await this.handle(ws, msg);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Server error";
      this.send(ws, { type: "error", message: text });
    }
  }

  async webSocketClose(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    this.players.delete(att.playerId);

    if (this.hostId === att.playerId) {
      const next = this.players.keys().next().value as string | undefined;
      this.hostId = next ?? null;
      if (this.hostId) {
        this.broadcast({ type: "host_changed", hostId: this.hostId });
      }
    }

    this.broadcast({ type: "peer_left", playerId: att.playerId });
    this.broadcastLobby();
    await this.persist();
    await this.syncLobby();

    if (this.players.size === 0) {
      this.inGame = false;
      await this.unregisterLobby();
      await this.ctx.storage.deleteAll();
    }
  }

  async webSocketError(ws: WebSocket) {
    try {
      ws.close(1011, "error");
    } catch {
      /* ignore */
    }
  }

  private async handle(ws: WebSocket, msg: ClientMessage) {
    switch (msg.type) {
      case "create":
        await this.onCreate(ws, msg);
        break;
      case "join":
        await this.onJoin(ws, msg);
        break;
      case "ready":
        this.onReady(ws, msg.ready);
        break;
      case "start":
        await this.onStart(ws);
        break;
      case "config":
        await this.onConfig(ws, msg.room);
        break;
      case "input":
        this.onInput(ws, msg.seq, msg.bits);
        break;
      case "snapshot":
        this.onSnapshot(ws, msg.snap);
        break;
      case "chat":
        this.onChat(ws, msg.text);
        break;
      case "end_match":
        await this.onEndMatch(ws);
        break;
      case "leave":
        ws.close(1000, "leave");
        break;
    }
  }

  private async onCreate(
    ws: WebSocket,
    msg: Extract<ClientMessage, { type: "create" }>,
  ) {
    if (this.players.size > 0) {
      this.send(ws, { type: "error", message: "Room already exists" });
      return;
    }
    this.room = { ...DEFAULT_ROOM, ...msg.room, bots: 0 };
    this.inGame = false;
    const player = this.attachPlayer(ws, msg.name, msg.guest, msg.skin);
    this.hostId = player.playerId;
    this.send(ws, {
      type: "welcome",
      playerId: player.playerId,
      code: this.code,
      isHost: true,
    });
    this.broadcastLobby();
    await this.persist();
    await this.syncLobby();
  }

  private async onJoin(
    ws: WebSocket,
    msg: Extract<ClientMessage, { type: "join" }>,
  ) {
    if (this.inGame) {
      this.send(ws, { type: "error", message: "Match already in progress" });
      ws.close(4000, "in game");
      return;
    }
    if (this.players.size >= this.room.maxPlayers) {
      this.send(ws, { type: "error", message: "Room is full" });
      ws.close(4001, "full");
      return;
    }
    if (!this.code) this.code = msg.code || uid();

    const player = this.attachPlayer(ws, msg.name, msg.guest, msg.skin);
    if (!this.hostId) this.hostId = player.playerId;

    this.send(ws, {
      type: "welcome",
      playerId: player.playerId,
      code: this.code,
      isHost: this.hostId === player.playerId,
    });
    this.broadcastLobby();
    await this.persist();
    await this.syncLobby();
  }

  private attachPlayer(
    ws: WebSocket,
    name: string,
    guest: boolean,
    skin: NetSkin,
  ): Attachment {
    const playerId = uid();
    const att: Attachment = {
      playerId,
      name: name.slice(0, 16) || `Guest${Math.floor(Math.random() * 900 + 100)}`,
      guest,
      skin,
      wins: 0,
      team: this.room.mode === "football" ? (this.players.size % 2 === 0 ? 2 : 3) : 1,
      ready: false,
    };
    ws.serializeAttachment(att);
    this.players.set(playerId, att);
    return att;
  }

  private onReady(ws: WebSocket, ready: boolean) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    att.ready = ready;
    ws.serializeAttachment(att);
    this.players.set(att.playerId, att);
    this.broadcastLobby();
  }

  private async onStart(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || att.playerId !== this.hostId) {
      this.send(ws, { type: "error", message: "Only the host can start" });
      return;
    }
    if (this.players.size < 1) {
      this.send(ws, { type: "error", message: "Need at least 1 player" });
      return;
    }
    this.inGame = true;
    const players = this.lobbyPlayers();
    this.broadcast({ type: "started", room: this.room, players });
    await this.persist();
    await this.syncLobby();
  }

  private async onConfig(ws: WebSocket, partial: Partial<NetRoomConfig>) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || att.playerId !== this.hostId) {
      this.send(ws, { type: "error", message: "Only the host can edit the room" });
      return;
    }
    if (this.inGame) return;
    this.room = { ...this.room, ...partial, bots: 0 };
    this.broadcastLobby();
    await this.persist();
    await this.syncLobby();
  }

  private onInput(ws: WebSocket, seq: number, bits: number) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || !this.inGame) return;
    // Relay inputs to host only (host applies them into the sim)
    if (!this.hostId) return;
    this.sendTo(this.hostId, {
      type: "input",
      playerId: att.playerId,
      seq,
      bits,
    });
  }

  private onSnapshot(ws: WebSocket, snap: GameSnapshot) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || att.playerId !== this.hostId || !this.inGame) return;
    this.broadcast({ type: "snapshot", snap }, att.playerId);
  }

  private onChat(ws: WebSocket, text: string) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    const clean = text.slice(0, 120);
    this.broadcast({ type: "chat", from: att.name, text: clean });
  }

  private async onEndMatch(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || att.playerId !== this.hostId) return;
    this.inGame = false;
    for (const p of this.players.values()) p.ready = false;
    for (const socket of this.ctx.getWebSockets()) {
      const a = socket.deserializeAttachment() as Attachment | null;
      if (a) {
        a.ready = false;
        socket.serializeAttachment(a);
      }
    }
    this.broadcastLobby();
    await this.persist();
    await this.syncLobby();
  }

  private lobbyPlayers(): NetPlayer[] {
    return [...this.players.values()].map((p) => ({
      id: p.playerId,
      name: p.name,
      guest: p.guest,
      skin: p.skin,
      wins: p.wins,
      team: p.team,
      ready: p.ready,
      isHost: p.playerId === this.hostId,
    }));
  }

  private broadcastLobby() {
    if (!this.hostId) return;
    this.broadcast({
      type: "lobby",
      players: this.lobbyPlayers(),
      room: this.room,
      hostId: this.hostId,
      inGame: this.inGame,
    });
  }

  private summary(): RoomSummary {
    return {
      code: this.code,
      name: this.room.name,
      mode: this.room.mode,
      mapId: this.room.mapId,
      players: this.players.size,
      maxPlayers: this.room.maxPlayers,
      inGame: this.inGame,
    };
  }

  private async syncLobby() {
    if (!this.code || this.players.size === 0) return;
    const id = this.env.LOBBY.idFromName("global");
    const stub = this.env.LOBBY.get(id);
    await stub.fetch("https://lobby/internal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "update", room: this.summary() }),
    });
  }

  private async unregisterLobby() {
    if (!this.code) return;
    const id = this.env.LOBBY.idFromName("global");
    const stub = this.env.LOBBY.get(id);
    await stub.fetch("https://lobby/internal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "unregister", code: this.code }),
    });
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* closed */
    }
  }

  private sendTo(playerId: string, msg: ServerMessage) {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att?.playerId === playerId) {
        this.send(ws, msg);
        return;
      }
    }
  }

  private broadcast(msg: ServerMessage, exceptPlayerId?: string) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (exceptPlayerId && att?.playerId === exceptPlayerId) continue;
      try {
        ws.send(data);
      } catch {
        /* closed */
      }
    }
  }
}
