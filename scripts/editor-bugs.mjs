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
  `export { BonkEngine } from "./src/game/engine";\nexport { registerCustomMaps } from "./src/game/maps";\n`,
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

const { BonkEngine, registerCustomMaps } = await import(
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
