/**
 * Headless checks for map-editor bugs:
 * - draft round-trip must not multiply shapes
 * - rotate pivots must survive serialize + engine build
 * - editor dispose must drop window listeners (simulated)
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(root, "..");
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const modelOut = path.join(repo, ".tmp-editor-model.mjs");
const engineOut = path.join(repo, ".tmp-editor-engine.mjs");
const entry = path.join(repo, ".tmp-editor-entry.ts");

writeFileSync(
  entry,
  `export { BonkEngine } from "./src/game/engine";\nexport { registerCustomMaps, expandMapToViewport, getMap } from "./src/game/maps";\n`,
);

esbuild.buildSync({
  entryPoints: [path.join(repo, "src/editor/model.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: modelOut,
});

esbuild.buildSync({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: engineOut,
});

const {
  blankDocument,
  documentToMapDef,
  mapDefToDocument,
  defaultPlatform,
} = await import(pathToFileURL(modelOut).href);

const { BonkEngine, registerCustomMaps, expandMapToViewport, getMap } = await import(
  pathToFileURL(engineOut).href,
);

const results = [];

function assert(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail });
  if (!cond) console.error("FAIL", name, detail);
}

// 1) Round-trip does not multiply platforms / spawns
const doc = blankDocument("Tester");
doc.platforms.push(defaultPlatform("box", 100, 100, "#fff"));
const nPlat = doc.platforms.length;
const nSpawn = doc.spawns.length;
let round = doc;
for (let i = 0; i < 5; i++) {
  round = mapDefToDocument(documentToMapDef(round));
}
assert(
  "roundtrip-no-dup-platforms",
  round.platforms.length === nPlat,
  `got ${round.platforms.length} want ${nPlat}`,
);
assert(
  "roundtrip-no-dup-spawns",
  round.spawns.length === nSpawn,
  `got ${round.spawns.length} want ${nSpawn}`,
);

// 2) Pivot offsets survive serialize
const rotating = defaultPlatform("box", 390, 300, "#8fd14f");
rotating.moveType = "rotate";
rotating.pivotX = 40;
rotating.pivotY = -20;
const pivotDoc = blankDocument("Tester");
pivotDoc.id = "custom-pivot-test";
pivotDoc.platforms = [rotating];
pivotDoc.spawns = [{ ...pivotDoc.spawns[0], x: 300, y: 200 }];
const mapped = documentToMapDef(pivotDoc);
assert(
  "shape-has-pivot",
  mapped.shapes[0].pivotX === 40 && mapped.shapes[0].pivotY === -20,
);
const back = mapDefToDocument(mapped);
assert(
  "doc-restores-pivot",
  back.platforms[0].pivotX === 40 && back.platforms[0].pivotY === -20,
);

// 3) Engine builds rotate constraint with offset (no throw / stays near arena)
registerCustomMaps([mapped]);
const engine = new BonkEngine("classic", mapped.id, 3);
engine.addPlayers([
  {
    id: "local",
    name: "P1",
    guest: true,
    skin: { baseColor: "#e74c3c", eyes: true, mouth: true, accent: "#000" },
    wins: 0,
    team: 1,
    ready: true,
  },
]);
engine.startRound();
for (let i = 0; i < 45; i++) engine.update(1 / 60);
const plat = engine.platforms[0];
assert("engine-rotate-platform", !!plat);
assert(
  "engine-platform-stays-near-spawn",
  Math.hypot(plat.position.x - 390, plat.position.y - 300) < 120,
  `pos=${plat.position.x.toFixed(1)},${plat.position.y.toFixed(1)}`,
);

// 3b) Offset pivot stays fixed while the platform tips (post-countdown)
const tipMap = {
  id: "custom-pivot-tip",
  name: "Tip",
  author: "Tester",
  modeHint: "classic",
  width: 780,
  height: 520,
  gravity: { x: 0, y: 360 },
  killY: 900,
  killPadding: 80,
  shapes: [
    {
      type: "box",
      x: 390,
      y: 300,
      w: 280,
      h: 48,
      color: "#8fd14f",
      rotate: true,
      pivotX: 100,
      pivotY: 0,
      density: 0.3,
      friction: 0.5,
      restitution: 0.3,
      static: false,
      angularDamping: 0.02,
    },
  ],
  spawns: [{ x: 280, y: 250 }],
};
registerCustomMaps([tipMap]);
const tipEngine = new BonkEngine("classic", tipMap.id, 3);
tipEngine.addPlayers([
  {
    id: "local",
    name: "P1",
    guest: true,
    skin: { baseColor: "#e74c3c", eyes: true, mouth: true, accent: "#000" },
    wins: 0,
    team: 1,
    ready: true,
  },
]);
tipEngine.startRound();
for (let i = 0; i < 200; i++) tipEngine.update(1 / 60);
const tipPlat = tipEngine.platforms[0];
let maxDrift = 0;
let sawTip = false;
for (let i = 0; i < 120; i++) {
  tipEngine.update(1 / 60);
  const a = tipPlat.angle;
  if (Math.abs(a) > 0.05) sawTip = true;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pivX = tipPlat.position.x + 100 * cos;
  const pivY = tipPlat.position.y + 100 * sin;
  maxDrift = Math.max(maxDrift, Math.hypot(pivX - 490, pivY - 300));
}
assert("offset-pivot-tips", sawTip, "platform never rotated");
assert(
  "offset-pivot-hinge-stable",
  maxDrift < 1.5,
  `maxDrift=${maxDrift.toFixed(3)}`,
);

// 3c) Local verts + body angle must NOT be double-rotated for drawing
const local = tipPlat.localVertices;
assert("local-verts-present", local.length >= 4, `n=${local.length}`);
const ang = tipPlat.angle;
const c = Math.cos(ang);
const s = Math.sin(ang);
const drawn = local.map((v) => ({
  x: tipPlat.position.x + v.x * c - v.y * s,
  y: tipPlat.position.y + v.x * s + v.y * c,
}));
const world = tipPlat.vertices;
let maxVertErr = 0;
for (let i = 0; i < world.length; i++) {
  maxVertErr = Math.max(
    maxVertErr,
    Math.hypot(drawn[i].x - world[i].x, drawn[i].y - world[i].y),
  );
}
assert(
  "draw-transform-matches-physics",
  maxVertErr < 0.01,
  `err=${maxVertErr}`,
);

// 3d) Viewport expand keeps prop sizes, grows bounds, recenters layout
const classic = getMap("classic");
const plat0 = classic.shapes[0];
const expanded = expandMapToViewport(classic, 1600, 1000);
assert("expand-grows-width", expanded.width === 1600);
assert("expand-grows-height", expanded.height === 1000);
assert(
  "expand-keeps-platform-size",
  expanded.shapes[0].w === plat0.w && expanded.shapes[0].h === plat0.h,
);
assert(
  "expand-centers-platform",
  Math.abs(expanded.shapes[0].x - (plat0.x + (1600 - classic.width) / 2)) < 0.01 &&
    Math.abs(expanded.shapes[0].y - (plat0.y + (1000 - classic.height) / 2)) < 0.01,
  `got ${expanded.shapes[0].x},${expanded.shapes[0].y}`,
);
assert(
  "expand-killY-tracks-height",
  expanded.killY === 1000 + (classic.killY - classic.height),
);
const noOp = expandMapToViewport(classic, 100, 100);
assert("expand-noop-when-smaller", noOp.width === classic.width && noOp.height === classic.height);

const bigEngine = new BonkEngine("classic", "classic", 3, { w: 1400, h: 900 });
assert("engine-playspace-width", bigEngine.width === 1400);
assert("engine-playspace-height", bigEngine.height === 900);

// 4) Simulate listener leak vs dispose (the re-enter duplication root cause)
let live = 0;
const handlers = [];
function mountFake() {
  const onKey = () => {
    live += 1;
  };
  handlers.push(onKey);
  return () => {
    const i = handlers.indexOf(onKey);
    if (i >= 0) handlers.splice(i, 1);
  };
}
let dispose = mountFake();
dispose();
dispose = mountFake();
dispose();
dispose = mountFake();
for (const h of handlers) h();
assert(
  "dispose-prevents-stacked-handlers",
  live === 1 && handlers.length === 1,
  `live=${live} n=${handlers.length}`,
);

const failed = results.filter((r) => !r.ok);
const out = { ok: failed.length === 0, results };
writeFileSync("/tmp/editor-bugs-result.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(failed.length ? 1 : 0);
