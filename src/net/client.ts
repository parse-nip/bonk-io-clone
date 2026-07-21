import type {
  ClientMessage,
  GameSnapshot,
  InputState,
  NetRoomConfig,
  NetSkin,
  ServerMessage,
} from "../../shared/protocol";
import { packInput } from "../../shared/protocol";

export type NetHandler = (msg: ServerMessage) => void;

function wsUrl(pathQuery: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${pathQuery}`;
}

export class NetClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<NetHandler>();
  private inputSeq = 0;
  private lastInputBits = -1;
  private reconnectTimer: number | null = null;
  playerId: string | null = null;
  code: string | null = null;
  isHost = false;
  connected = false;

  on(fn: NetHandler) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  private emit(msg: ServerMessage) {
    for (const fn of this.handlers) fn(msg);
  }

  private send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  create(name: string, guest: boolean, skin: NetSkin, room: NetRoomConfig) {
    return this.connect(`/ws?create=1`, () => {
      this.send({ type: "create", name, guest, skin, room });
    });
  }

  join(code: string, name: string, guest: boolean, skin: NetSkin) {
    const c = code.toUpperCase().trim();
    return this.connect(`/ws?code=${encodeURIComponent(c)}`, () => {
      this.send({ type: "join", name, guest, skin, code: c });
    });
  }

  private connect(pathQuery: string, onOpen: () => void): Promise<void> {
    this.disconnect();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl(pathQuery));
      this.ws = ws;
      let settled = false;

      ws.onopen = () => {
        this.connected = true;
        onOpen();
      };

      ws.onmessage = (ev) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === "welcome") {
          this.playerId = msg.playerId;
          this.code = msg.code;
          this.isHost = msg.isHost;
          if (!settled) {
            settled = true;
            resolve();
          }
        }
        if (msg.type === "host_changed") {
          this.isHost = msg.hostId === this.playerId;
        }
        if (msg.type === "error" && !settled) {
          settled = true;
          reject(new Error(msg.message));
        }
        this.emit(msg);
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket failed"));
        }
      };

      ws.onclose = () => {
        this.connected = false;
        if (!settled) {
          settled = true;
          reject(new Error("Connection closed"));
        }
      };
    });
  }

  setReady(ready: boolean) {
    this.send({ type: "ready", ready });
  }

  start() {
    this.send({ type: "start" });
  }

  updateConfig(room: Partial<NetRoomConfig>) {
    this.send({ type: "config", room });
  }

  /** Send input if bits changed, or every ~3 frames for keep-alive feel. */
  sendInput(input: InputState, force = false) {
    const bits = packInput(input);
    this.inputSeq += 1;
    if (!force && bits === this.lastInputBits && this.inputSeq % 4 !== 0) return;
    this.lastInputBits = bits;
    this.send({ type: "input", seq: this.inputSeq, bits });
  }

  sendSnapshot(snap: GameSnapshot) {
    this.send({ type: "snapshot", snap });
  }

  chat(text: string) {
    this.send({ type: "chat", text });
  }

  endMatch() {
    this.send({ type: "end_match" });
  }

  leave() {
    this.send({ type: "leave" });
    this.disconnect();
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.connected = false;
    this.playerId = null;
    this.code = null;
    this.isHost = false;
    this.lastInputBits = -1;
  }
}

export async function fetchRoomList(): Promise<
  import("../../shared/protocol").RoomSummary[]
> {
  try {
    const res = await fetch("/api/rooms");
    if (!res.ok) return [];
    const data = (await res.json()) as {
      type: string;
      rooms: import("../../shared/protocol").RoomSummary[];
    };
    return data.rooms ?? [];
  } catch {
    return [];
  }
}
