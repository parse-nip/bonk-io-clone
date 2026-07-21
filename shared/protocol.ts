/** Shared wire protocol between Vite client and Cloudflare Worker / Durable Objects. */

export type GameMode =
  | "classic"
  | "arrows"
  | "grapple"
  | "football"
  | "deatharrows";

export interface NetSkin {
  baseColor: string;
  eyes: boolean;
  mouth: boolean;
  accent: string;
}

export interface NetRoomConfig {
  name: string;
  mode: GameMode;
  mapId: string;
  roundsToWin: number;
  maxPlayers: number;
  teams: boolean;
  bots: number;
}

export interface NetPlayer {
  id: string;
  name: string;
  guest: boolean;
  skin: NetSkin;
  wins: number;
  team: number;
  ready: boolean;
  isBot?: boolean;
  isHost?: boolean;
}

export interface RoomSummary {
  code: string;
  name: string;
  mode: GameMode;
  mapId: string;
  players: number;
  maxPlayers: number;
  inGame: boolean;
}

/** Input bitfield matching DemystifyBonk / original bonk. */
export const INPUT_BITS = {
  left: 1,
  right: 2,
  up: 4,
  down: 8,
  heavy: 16,
  special: 32,
} as const;

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  heavy: boolean;
  special: boolean;
}

export function packInput(i: InputState): number {
  let bits = 0;
  if (i.left) bits |= INPUT_BITS.left;
  if (i.right) bits |= INPUT_BITS.right;
  if (i.up) bits |= INPUT_BITS.up;
  if (i.down) bits |= INPUT_BITS.down;
  if (i.heavy) bits |= INPUT_BITS.heavy;
  if (i.special) bits |= INPUT_BITS.special;
  return bits;
}

export function unpackInput(bits: number): InputState {
  return {
    left: (bits & INPUT_BITS.left) !== 0,
    right: (bits & INPUT_BITS.right) !== 0,
    up: (bits & INPUT_BITS.up) !== 0,
    down: (bits & INPUT_BITS.down) !== 0,
    heavy: (bits & INPUT_BITS.heavy) !== 0,
    special: (bits & INPUT_BITS.special) !== 0,
  };
}

export interface PlayerSnapshot {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  av: number;
  alive: boolean;
  wins: number;
  facing: number;
  aiming: boolean;
  aimAngle: number;
  charge: number;
  heavy: boolean;
  grapple: { x: number; y: number } | null;
}

export interface PlatformSnapshot {
  i: number;
  x: number;
  y: number;
  angle: number;
  av: number;
}

export interface GameSnapshot {
  t: number;
  countdown: number;
  roundActive: boolean;
  players: PlayerSnapshot[];
  platforms: PlatformSnapshot[];
  ball: { x: number; y: number; vx: number; vy: number } | null;
  banner?: string;
  /** Host-side lifecycle events so clients can leave/return with the host. */
  event?: "match_over" | "round_over" | "eliminated";
  eventPlayerId?: string;
}

// —— Client → Server ——
export type ClientMessage =
  | {
      type: "create";
      name: string;
      guest: boolean;
      skin: NetSkin;
      room: NetRoomConfig;
    }
  | {
      type: "join";
      name: string;
      guest: boolean;
      skin: NetSkin;
      code: string;
    }
  | { type: "ready"; ready: boolean }
  | { type: "start" }
  | { type: "config"; room: Partial<NetRoomConfig> }
  | { type: "input"; seq: number; bits: number }
  | { type: "snapshot"; snap: GameSnapshot }
  | { type: "chat"; text: string }
  | { type: "end_match" }
  | { type: "leave" };

// —— Server → Client ——
export type ServerMessage =
  | {
      type: "welcome";
      playerId: string;
      code: string;
      isHost: boolean;
    }
  | {
      type: "lobby";
      players: NetPlayer[];
      room: NetRoomConfig;
      hostId: string;
      inGame: boolean;
    }
  | { type: "started"; room: NetRoomConfig; players: NetPlayer[] }
  | { type: "input"; playerId: string; seq: number; bits: number }
  | { type: "snapshot"; snap: GameSnapshot }
  | { type: "chat"; from: string; text: string }
  | { type: "peer_left"; playerId: string }
  | { type: "host_changed"; hostId: string }
  | { type: "error"; message: string }
  | { type: "pong"; t: number };

export type LobbyMessage =
  | { type: "register"; room: RoomSummary }
  | { type: "update"; room: RoomSummary }
  | { type: "unregister"; code: string }
  | { type: "list" };

export type LobbyResponse =
  | { type: "rooms"; rooms: RoomSummary[] }
  | { type: "ok" };
