/**
 * Headless smoke: spin Classic for a few seconds with bot inputs.
 */
import Matter from "matter-js";

const PLAYER_RADIUS = 18;

const engine = Matter.Engine.create({
  gravity: { x: 0, y: 1.15, scale: 0.001 },
});
const platform = Matter.Bodies.rectangle(390, 300, 280, 48, {
  isStatic: false,
  friction: 0.45,
  restitution: 0.55,
});
const pivot = Matter.Constraint.create({
  pointA: { x: 390, y: 300 },
  bodyB: platform,
  stiffness: 1,
  length: 0,
});
const p1 = Matter.Bodies.circle(300, 180, PLAYER_RADIUS, {
  restitution: 0.55,
  friction: 0.35,
  density: 0.002,
});
const p2 = Matter.Bodies.circle(480, 180, PLAYER_RADIUS, {
  restitution: 0.55,
  friction: 0.35,
  density: 0.002,
});
Matter.World.add(engine.world, [platform, pivot, p1, p2]);

let fell = 0;
for (let i = 0; i < 300; i++) {
  Matter.Body.applyForce(p1, p1.position, { x: 0.0012, y: 0 });
  Matter.Body.applyForce(p2, p2.position, { x: -0.0012, y: 0 });
  if (i % 40 < 10) Matter.Body.setMass(p1, 2.35);
  else Matter.Body.setMass(p1, 1);
  Matter.Engine.update(engine, 1000 / 60);
  if (p1.position.y > 560 || p2.position.y > 560) fell++;
}

console.log(
  JSON.stringify({
    ok: true,
    p1: { x: +p1.position.x.toFixed(1), y: +p1.position.y.toFixed(1) },
    p2: { x: +p2.position.x.toFixed(1), y: +p2.position.y.toFixed(1) },
    platformAngle: +platform.angle.toFixed(3),
    fellChecks: fell,
  }),
);
