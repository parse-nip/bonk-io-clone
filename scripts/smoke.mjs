/**
 * Standalone Box2D (Planck) smoke: rotating platform + two thruster discs.
 */
import { World, Vec2, Circle, Box, RevoluteJoint } from "planck";

const PLAYER_RADIUS = 12;
const DISC_DENSITY = 0.001337;

const world = new World({ gravity: new Vec2(0, 20) });
const ground = world.createBody({ type: "static", position: new Vec2(0, 0) });

const platform = world.createBody({
  type: "dynamic",
  position: new Vec2(390, 300),
  angularDamping: 0.08,
});
platform.createFixture({
  shape: new Box(140, 24),
  density: 0.3,
  friction: 0.45,
  restitution: 0.55,
});
world.createJoint(
  new RevoluteJoint({}, ground, platform, new Vec2(390, 300)),
);

function makeDisc(x, y) {
  const body = world.createBody({
    type: "dynamic",
    position: new Vec2(x, y),
    bullet: true,
    linearDamping: 0.01,
    angularDamping: 3.4,
  });
  body.createFixture({
    shape: new Circle(PLAYER_RADIUS),
    density: DISC_DENSITY,
    friction: 0.1,
    restitution: 0.95,
  });
  return body;
}

const p1 = makeDisc(300, 180);
const p2 = makeDisc(480, 180);

const lightMass = DISC_DENSITY * Math.PI * PLAYER_RADIUS * PLAYER_RADIUS;
const thrust = lightMass * 20 * 0.78;

for (let i = 0; i < 240; i++) {
  p1.applyForceToCenter(new Vec2(thrust, 0), true);
  p2.applyForceToCenter(new Vec2(-thrust, 0), true);
  if (i % 40 < 10) {
    const md = { mass: 0, center: { x: 0, y: 0 }, I: 0 };
    p1.getMassData(md);
    md.mass = lightMass * 2;
    md.I *= 2;
    p1.setMassData(md);
  } else {
    p1.resetMassData();
  }
  world.step(1 / 60, 8, 3);
  world.clearForces();
}

// Spin the hinged platform for a few steps to prove the revolute joint works.
for (let i = 0; i < 30; i++) {
  platform.applyTorque(2e6);
  world.step(1 / 60, 8, 3);
  world.clearForces();
}

const result = {
  ok:
    Number.isFinite(p1.getPosition().x) &&
    Number.isFinite(p2.getPosition().x) &&
    p1.getPosition().x > 300 &&
    p2.getPosition().x < 480 &&
    Math.abs(platform.getAngle()) > 0.005,
  p1x: +p1.getPosition().x.toFixed(2),
  p2x: +p2.getPosition().x.toFixed(2),
  platformAngle: +platform.getAngle().toFixed(3),
  p1mass: +p1.getMass().toFixed(3),
};
console.log(JSON.stringify(result));
if (!result.ok) process.exit(1);
