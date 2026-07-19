export type GameMode = "classic" | "arrows" | "grapple" | "football" | "deatharrows";

export type TeamId = 0 | 1 | 2 | 3 | 4 | 5;
// 0 spectator, 1 FFA, 2 red, 3 blue, 4 green, 5 yellow

export type Screen =
  | "login"
  | "menu"
  | "quickplay"
  | "rooms"
  | "lobby"
  | "skin"
  | "editor"
  | "game"
  | "settings";

export interface Skin {
  baseColor: string;
  eyes: boolean;
  mouth: boolean;
  accent: string;
}

export interface PlayerProfile {
  id: string;
  name: string;
  guest: boolean;
  skin: Skin;
  wins: number;
  isBot?: boolean;
  team: TeamId;
  ready: boolean;
}

export interface ShapeDef {
  type: "box" | "circle";
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  angle?: number;
  color: string;
  death?: boolean;
  static?: boolean;
  density?: number;
  friction?: number;
  restitution?: number;
  rotate?: boolean;
  angularDamping?: number;
}

export interface SpawnDef {
  x: number;
  y: number;
}

export interface MapDef {
  id: string;
  name: string;
  author: string;
  modeHint: GameMode | "any";
  width: number;
  height: number;
  gravity: { x: number; y: number };
  killY: number;
  killPadding: number;
  shapes: ShapeDef[];
  spawns: SpawnDef[];
  football?: {
    ball: { x: number; y: number; r: number };
    goals: { x: number; y: number; w: number; h: number; team: "red" | "blue" }[];
  };
}

export interface RoomConfig {
  name: string;
  mode: GameMode;
  mapId: string;
  roundsToWin: number;
  maxPlayers: number;
  teams: boolean;
  bots: number;
}

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  heavy: boolean;
  special: boolean;
}

export const TEAM_COLORS: Record<TeamId, string> = {
  0: "#888888",
  1: "#ffffff",
  2: "#e74c3c",
  3: "#3498db",
  4: "#2ecc71",
  5: "#f1c40f",
};

export const DEFAULT_SKIN: Skin = {
  baseColor: "#e74c3c",
  eyes: true,
  mouth: true,
  accent: "#2c3e50",
};

export const COLOR_PALETTE = [
  "#e74c3c",
  "#e67e22",
  "#f1c40f",
  "#2ecc71",
  "#1abc9c",
  "#3498db",
  "#9b59b6",
  "#e91e63",
  "#ffffff",
  "#bdc3c7",
  "#7f8c8d",
  "#34495e",
  "#8fd14f",
  "#ff6b6b",
  "#4ecdc4",
  "#ffe66d",
];
