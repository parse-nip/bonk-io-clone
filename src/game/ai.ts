import type { BonkEngine, EnginePlayer } from "./engine";
import { emptyInput } from "./engine";
import type { InputState } from "../types";

/** Simple reactive bot that chases nearest foe and times heavy near contact. */
export function botThink(engine: BonkEngine, bot: EnginePlayer): InputState {
  const input = emptyInput();
  if (!bot.alive) return input;

  const foe = nearestAlive(engine, bot);
  const pos = bot.body.position;

  if (engine.mode === "football" && engine.ball) {
    const ball = engine.ball.position;
    const dx = ball.x - pos.x;
    const dy = ball.y - pos.y;
    if (dx < -8) input.left = true;
    if (dx > 8) input.right = true;
    if (dy < -8) input.up = true;
    if (dy > 8) input.down = true;
    if (Math.hypot(dx, dy) < 40) input.heavy = true;
    return input;
  }

  if (!foe) {
    // wander to center
    if (pos.x < engine.width * 0.45) input.right = true;
    else if (pos.x > engine.width * 0.55) input.left = true;
    if (Math.random() < 0.01) input.up = true;
    return input;
  }

  const fpos = foe.body.position;
  const dx = fpos.x - pos.x;
  const dy = fpos.y - pos.y;
  const dist = Math.hypot(dx, dy);

  if (engine.mode === "arrows" || engine.mode === "deatharrows") {
    if (dist < 260 && Math.random() < 0.7) {
      input.special = true;
      const ang = Math.atan2(dy, dx);
      // adjust aim
      if (ang < bot.aimAngle - 0.05) input.left = true;
      if (ang > bot.aimAngle + 0.05) input.right = true;
      bot.aimAngle = ang;
      if (bot.charge > 0.55 + Math.random() * 0.3) {
        // release next frame by not holding — handled by toggling
        // keep special this frame; randomly drop
        if (bot.charge > 0.85) input.special = false;
      }
    } else {
      if (dx < -10) input.left = true;
      if (dx > 10) input.right = true;
      if (dy < -20 && Math.random() < 0.05) input.up = true;
    }
    return input;
  }

  if (engine.mode === "grapple") {
    if (pos.y > 280 || dist > 140) input.special = true;
    if (dx < -6) input.left = true;
    if (dx > 6) input.right = true;
    if (Math.random() < 0.03) input.up = true;
    if (dist < 45) input.heavy = true;
    return input;
  }

  // classic chase
  const predict = foe.body.velocity.x * 0.18;
  const targetX = fpos.x + predict;
  if (pos.x < targetX - 6) input.right = true;
  if (pos.x > targetX + 6) input.left = true;

  // jump if below or stuck
  if (dy < -25 && Math.random() < 0.08) input.up = true;
  if (Math.abs(bot.body.velocity.x) < 0.4 && Math.random() < 0.04) input.up = true;

  // edge awareness — back off if near kill zone
  if (pos.x < 80) input.right = true;
  if (pos.x > engine.width - 80) input.left = true;
  if (pos.y > engine.map.killY - 120) {
    input.up = true;
    if (pos.x < engine.width / 2) input.right = true;
    else input.left = true;
  }

  // heavy timing ~200-300ms before contact
  if (dist < 55 && dist > 18) {
    input.heavy = true;
  }

  // sometimes dodge
  if (dist < 70 && Math.random() < 0.08) {
    input.left = dx > 0;
    input.right = dx < 0;
    input.heavy = false;
  }

  return input;
}

function nearestAlive(engine: BonkEngine, self: EnginePlayer): EnginePlayer | null {
  let best: EnginePlayer | null = null;
  let bestD = Infinity;
  for (const p of engine.players) {
    if (!p.alive || p.id === self.id) continue;
    // in teams mode avoid teammates
    if (self.team >= 2 && p.team === self.team) continue;
    const d = Math.hypot(
      p.body.position.x - self.body.position.x,
      p.body.position.y - self.body.position.y,
    );
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
