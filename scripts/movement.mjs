/**
 * Headless movement regression for thruster-based bonk physics:
 * spawn freeze, horizontal drive, vertical up/down thrusters, air control.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");

const out = path.join(root, "../.tmp-engine.mjs");
esbuild.buildSync({
  entryPoints: [path.join(root, "../src/game/engine.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: out,
});

const { BonkEngine, emptyInput } = await import(out);

function settle(eng, frames = 200) {
  for (let i = 0; i < frames; i++) {
    eng.setInput("p1", emptyInput());
    eng.update(1 / 60);
  }
}

function drive(eng, input, frames = 90) {
  for (let i = 0; i < frames; i++) {
    eng.setInput("p1", input);
    eng.update(1 / 60);
  }
}

function makeEngine(mapId = "flat") {
  const eng = new BonkEngine("classic", mapId, 3);
  eng.addPlayers([
    {
      id: "p1",
      name: "Human",
      guest: true,
      skin: { baseColor: "#e74c3c", eyes: true, mouth: true, accent: "#111" },
      wins: 0,
      team: 1,
      ready: true,
    },
  ]);
  eng.startRound();
  return eng;
}

// 1) Stay pinned during Get Ready on Orbit (previously fell to death).
const orbit = makeEngine("circles");
for (let i = 0; i < 120; i++) {
  orbit.setInput("p1", { ...emptyInput(), right: true });
  orbit.update(1 / 60);
}
const orbitAlive = orbit.players[0].alive;
const orbitPinned =
  Math.abs(orbit.players[0].body.position.x - 200) < 1 &&
  Math.abs(orbit.players[0].body.position.y - 200) < 1;

// 2) Horizontal thrusters after BONK on flat arena.
const flatRight = makeEngine("flat");
settle(flatRight);
const startX = flatRight.players[0].body.position.x;
drive(flatRight, { ...emptyInput(), right: true });
const dxRight = flatRight.players[0].body.position.x - startX;

const flatLeft = makeEngine("flat");
settle(flatLeft);
const startLeftX = flatLeft.players[0].body.position.x;
drive(flatLeft, { ...emptyInput(), left: true });
const dxLeft = flatLeft.players[0].body.position.x - startLeftX;

// 3) Up thruster lifts off the floor (tutorial Fnety = Fy - mass*g).
const up = makeEngine("flat");
settle(up);
const floorY = up.players[0].body.position.y;
let minY = floorY;
for (let i = 0; i < 90; i++) {
  up.setInput("p1", { ...emptyInput(), up: true });
  up.update(1 / 60);
  minY = Math.min(minY, up.players[0].body.position.y);
}
const lifted = floorY - minY > 15;

// 4) Down thruster increases downward speed while airborne.
const down = makeEngine("flat");
settle(down);
for (let i = 0; i < 30; i++) {
  down.setInput("p1", { ...emptyInput(), up: true });
  down.update(1 / 60);
}
const midY = down.players[0].body.position.y;
let maxY = midY;
for (let i = 0; i < 40; i++) {
  down.setInput("p1", { ...emptyInput(), down: true });
  down.update(1 / 60);
  maxY = Math.max(maxY, down.players[0].body.position.y);
}
const pressedDown = maxY - midY > 10;

// 5) Full air control: horizontal thrust while airborne.
const air = makeEngine("flat");
settle(air);
for (let i = 0; i < 40; i++) {
  air.setInput("p1", { ...emptyInput(), up: true });
  air.update(1 / 60);
}
const airX0 = air.players[0].body.position.x;
drive(air, { ...emptyInput(), left: true }, 60);
const airDx = air.players[0].body.position.x - airX0;

const result = {
  ok:
    orbitAlive &&
    orbitPinned &&
    dxRight > 150 &&
    dxLeft < -150 &&
    lifted &&
    pressedDown &&
    airDx < -80 &&
    !flatRight.players[0].body.isStatic,
  orbitAlive,
  orbitPinned,
  dxRight: +dxRight.toFixed(1),
  dxLeft: +dxLeft.toFixed(1),
  liftPx: +(floorY - minY).toFixed(1),
  lifted,
  downDropPx: +(maxY - midY).toFixed(1),
  pressedDown,
  airDx: +airDx.toFixed(1),
  playerStatic: flatRight.players[0].body.isStatic,
};

console.log(JSON.stringify(result));
if (!result.ok) process.exit(1);
