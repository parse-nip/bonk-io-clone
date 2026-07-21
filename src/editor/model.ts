import type { GameMode, MapDef, ShapeDef, SpawnDef } from "../types";

export type MoveType = "stationary" | "free" | "rotate";
export type ShapeKind = "box" | "circle" | "polygon";
export type ElementKind = "platform" | "spawn" | "capZone";

export interface EditorPlatform {
  id: string;
  kind: "platform";
  name: string;
  type: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  angle: number;
  color: string;
  vertices: { x: number; y: number }[];
  moveType: MoveType;
  /** Local-space offset of the rotate pivot from the platform center. */
  pivotX: number;
  pivotY: number;
  death: boolean;
  noPhysics: boolean;
  density: number;
  friction: number;
  restitution: number;
  fricPlayers: boolean;
  startSpeedX: number;
  startSpeedY: number;
  startSpin: number;
  fixedRotation: boolean;
  angularDamping: number;
}

export interface EditorSpawn {
  id: string;
  kind: "spawn";
  x: number;
  y: number;
  startSpeedX: number;
  startSpeedY: number;
  priority: number;
  ffa: boolean;
  red: boolean;
  blue: boolean;
  green: boolean;
  yellow: boolean;
}

export interface EditorCapZone {
  id: string;
  kind: "capZone";
  name: string;
  type: "box" | "circle";
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export type EditorElement = EditorPlatform | EditorSpawn | EditorCapZone;

export interface EditorDocument {
  id: string;
  name: string;
  author: string;
  modeHint: GameMode | "any";
  width: number;
  height: number;
  gravityX: number;
  gravityY: number;
  killY: number;
  killPadding: number;
  platforms: EditorPlatform[];
  spawns: EditorSpawn[];
  capZones: EditorCapZone[];
}

export type EditorSelection =
  | { kind: "platform"; id: string }
  | { kind: "spawn"; id: string }
  | { kind: "capZone"; id: string }
  | { kind: "map" }
  | null;

let idCounter = 0;
export function eid(prefix = "e"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

export function defaultPlatform(
  type: ShapeKind,
  x: number,
  y: number,
  color: string,
): EditorPlatform {
  const base: EditorPlatform = {
    id: eid("p"),
    kind: "platform",
    name: "Unnamed",
    type,
    x,
    y,
    w: 140,
    h: 28,
    r: 40,
    angle: 0,
    color,
    vertices: [],
    moveType: "stationary",
    pivotX: 0,
    pivotY: 0,
    death: false,
    noPhysics: false,
    density: 0.3,
    friction: 0.4,
    restitution: 0.5,
    fricPlayers: true,
    startSpeedX: 0,
    startSpeedY: 0,
    startSpin: 0,
    fixedRotation: false,
    angularDamping: 0.05,
  };
  if (type === "polygon") {
    base.vertices = [
      { x: -50, y: -30 },
      { x: 50, y: -30 },
      { x: 40, y: 30 },
      { x: -40, y: 30 },
    ];
  }
  return base;
}

export function defaultSpawn(x: number, y: number): EditorSpawn {
  return {
    id: eid("s"),
    kind: "spawn",
    x,
    y,
    startSpeedX: 0,
    startSpeedY: 0,
    priority: 0,
    ffa: true,
    red: true,
    blue: true,
    green: true,
    yellow: true,
  };
}

export function defaultCapZone(x: number, y: number): EditorCapZone {
  return {
    id: eid("c"),
    kind: "capZone",
    name: "Capture",
    type: "circle",
    x,
    y,
    w: 80,
    h: 80,
    r: 48,
  };
}

export function blankDocument(author: string): EditorDocument {
  return {
    id: eid("map"),
    name: "Unnamed",
    author,
    modeHint: "any",
    width: 780,
    height: 520,
    gravityX: 0,
    gravityY: 360,
    killY: 560,
    killPadding: 50,
    platforms: [
      defaultPlatform("box", 390, 340, "#8fd14f"),
    ],
    spawns: [
      defaultSpawn(300, 220),
      defaultSpawn(480, 220),
      defaultSpawn(390, 180),
      defaultSpawn(340, 200),
    ],
    capZones: [],
  };
}

export function cloneDoc(doc: EditorDocument): EditorDocument {
  return structuredClone(doc);
}

export function mapDefToDocument(map: MapDef): EditorDocument {
  return {
    id: map.id.startsWith("custom-") ? map.id : eid("map"),
    name: map.name,
    author: map.author,
    modeHint: map.modeHint,
    width: map.width,
    height: map.height,
    gravityX: map.gravity.x,
    gravityY: map.gravity.y,
    killY: map.killY,
    killPadding: map.killPadding,
    platforms: map.shapes.map((s, i) => shapeToPlatform(s, i)),
    spawns: map.spawns.map((s, i) => ({
      id: eid("s"),
      kind: "spawn" as const,
      x: s.x,
      y: s.y,
      startSpeedX: s.startSpeedX ?? 0,
      startSpeedY: s.startSpeedY ?? 0,
      priority: s.priority ?? i,
      ffa: s.ffa ?? true,
      red: s.red ?? true,
      blue: s.blue ?? true,
      green: s.green ?? true,
      yellow: s.yellow ?? true,
    })),
    capZones: (map.capZones ?? []).map((z) => ({
      id: eid("c"),
      kind: "capZone" as const,
      name: z.name ?? "Capture",
      type: z.type,
      x: z.x,
      y: z.y,
      w: z.w ?? 80,
      h: z.h ?? 80,
      r: z.r ?? 40,
    })),
  };
}

function shapeToPlatform(s: ShapeDef, index: number): EditorPlatform {
  const moveType: MoveType = s.rotate
    ? "rotate"
    : s.static === false
      ? "free"
      : "stationary";
  return {
    id: eid("p"),
    kind: "platform",
    name: s.name ?? `Platform ${index + 1}`,
    type: s.type,
    x: s.x,
    y: s.y,
    w: s.w ?? 100,
    h: s.h ?? 30,
    r: s.r ?? 40,
    angle: s.angle ?? 0,
    color: s.color,
    vertices: s.vertices ? s.vertices.map((v) => ({ ...v })) : [],
    moveType,
    pivotX: s.pivotX ?? 0,
    pivotY: s.pivotY ?? 0,
    death: !!s.death,
    noPhysics: !!s.noPhysics,
    density: s.density ?? 0.3,
    friction: s.friction ?? 0.4,
    restitution: s.restitution ?? 0.5,
    fricPlayers: s.fricPlayers !== false,
    startSpeedX: s.startSpeedX ?? 0,
    startSpeedY: s.startSpeedY ?? 0,
    startSpin: s.startSpin ?? 0,
    fixedRotation: !!s.fixedRotation,
    angularDamping: s.angularDamping ?? 0.05,
  };
}

export function documentToMapDef(doc: EditorDocument): MapDef {
  const spawns = [...doc.spawns].sort((a, b) => b.priority - a.priority);
  return {
    id: doc.id,
    name: doc.name || "Unnamed",
    author: doc.author || "Guest",
    modeHint: doc.modeHint,
    width: doc.width,
    height: doc.height,
    gravity: { x: doc.gravityX, y: doc.gravityY },
    killY: doc.killY,
    killPadding: doc.killPadding,
    shapes: doc.platforms.map(platformToShape),
    spawns: spawns.map(
      (s): SpawnDef => ({
        x: s.x,
        y: s.y,
        startSpeedX: s.startSpeedX,
        startSpeedY: s.startSpeedY,
        priority: s.priority,
        ffa: s.ffa,
        red: s.red,
        blue: s.blue,
        green: s.green,
        yellow: s.yellow,
      }),
    ),
    capZones: doc.capZones.map((z) => ({
      name: z.name,
      type: z.type,
      x: z.x,
      y: z.y,
      w: z.w,
      h: z.h,
      r: z.r,
    })),
  };
}

function platformToShape(p: EditorPlatform): ShapeDef {
  const shape: ShapeDef = {
    type: p.type,
    x: p.x,
    y: p.y,
    color: p.color,
    name: p.name,
    angle: p.angle,
    death: p.death || undefined,
    noPhysics: p.noPhysics || undefined,
    density: p.density,
    friction: p.friction,
    restitution: p.restitution,
    fricPlayers: p.fricPlayers,
    static: p.moveType === "stationary",
    rotate: p.moveType === "rotate" || undefined,
    pivotX: p.moveType === "rotate" && p.pivotX ? p.pivotX : undefined,
    pivotY: p.moveType === "rotate" && p.pivotY ? p.pivotY : undefined,
    startSpeedX: p.startSpeedX || undefined,
    startSpeedY: p.startSpeedY || undefined,
    startSpin: p.startSpin || undefined,
    fixedRotation: p.fixedRotation || undefined,
    angularDamping: p.angularDamping,
  };
  if (p.type === "circle") {
    shape.r = p.r;
  } else if (p.type === "box") {
    shape.w = p.w;
    shape.h = p.h;
  } else {
    shape.vertices = p.vertices.map((v) => ({ ...v }));
  }
  return shape;
}

export function findElement(
  doc: EditorDocument,
  sel: EditorSelection,
): EditorElement | null {
  if (!sel || sel.kind === "map") return null;
  if (sel.kind === "platform") {
    return doc.platforms.find((p) => p.id === sel.id) ?? null;
  }
  if (sel.kind === "spawn") {
    return doc.spawns.find((p) => p.id === sel.id) ?? null;
  }
  return doc.capZones.find((p) => p.id === sel.id) ?? null;
}

export function physicalShapeCount(doc: EditorDocument): number {
  return doc.platforms.filter((p) => !p.noPhysics).length;
}
