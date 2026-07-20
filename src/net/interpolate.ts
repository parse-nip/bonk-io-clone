import type { GameSnapshot, PlayerSnapshot } from "../../shared/protocol";

/** Keep a short buffer of snapshots and sample ~INTERP_DELAY_MS in the past. */
const INTERP_DELAY_MS = 80;
const MAX_BUFFER = 12;

export class SnapshotBuffer {
  private buf: GameSnapshot[] = [];

  push(snap: GameSnapshot) {
    this.buf.push(snap);
    if (this.buf.length > MAX_BUFFER) this.buf.shift();
  }

  clear() {
    this.buf = [];
  }

  /** Latest raw snapshot (for UI events like banner). */
  latest(): GameSnapshot | null {
    return this.buf[this.buf.length - 1] ?? null;
  }

  /**
   * Interpolated snapshot for rendering.
   * Assumes snapshot `t` is host monotonic ms; newest ≈ "now" on host clock.
   */
  sample(): GameSnapshot | null {
    if (this.buf.length === 0) return null;
    if (this.buf.length === 1) return this.buf[0];

    const newest = this.buf[this.buf.length - 1];
    const hostTarget = newest.t - INTERP_DELAY_MS;

    let a = this.buf[0];
    let b = newest;
    for (let i = 0; i < this.buf.length - 1; i++) {
      if (this.buf[i].t <= hostTarget && this.buf[i + 1].t >= hostTarget) {
        a = this.buf[i];
        b = this.buf[i + 1];
        break;
      }
    }

    if (b.t === a.t) return b;
    const alpha = Math.min(1, Math.max(0, (hostTarget - a.t) / (b.t - a.t)));
    return lerpSnap(a, b, alpha);
  }
}

function lerpSnap(a: GameSnapshot, b: GameSnapshot, t: number): GameSnapshot {
  const players: PlayerSnapshot[] = b.players.map((bp) => {
    const ap = a.players.find((p) => p.id === bp.id) ?? bp;
    return {
      ...bp,
      x: lerp(ap.x, bp.x, t),
      y: lerp(ap.y, bp.y, t),
      vx: lerp(ap.vx, bp.vx, t),
      vy: lerp(ap.vy, bp.vy, t),
      angle: lerpAngle(ap.angle, bp.angle, t),
      av: lerp(ap.av, bp.av, t),
      aimAngle: lerpAngle(ap.aimAngle, bp.aimAngle, t),
      charge: lerp(ap.charge, bp.charge, t),
      grapple:
        bp.grapple && ap.grapple
          ? {
              x: lerp(ap.grapple.x, bp.grapple.x, t),
              y: lerp(ap.grapple.y, bp.grapple.y, t),
            }
          : bp.grapple,
    };
  });

  const platforms = b.platforms.map((bp) => {
    const ap = a.platforms.find((p) => p.i === bp.i) ?? bp;
    return {
      ...bp,
      x: lerp(ap.x, bp.x, t),
      y: lerp(ap.y, bp.y, t),
      angle: lerpAngle(ap.angle, bp.angle, t),
      av: lerp(ap.av, bp.av, t),
    };
  });

  let ball = b.ball;
  if (a.ball && b.ball) {
    ball = {
      x: lerp(a.ball.x, b.ball.x, t),
      y: lerp(a.ball.y, b.ball.y, t),
      vx: lerp(a.ball.vx, b.ball.vx, t),
      vy: lerp(a.ball.vy, b.ball.vy, t),
    };
  }

  return {
    t: lerp(a.t, b.t, t),
    countdown: b.countdown,
    roundActive: b.roundActive,
    players,
    platforms,
    ball,
    banner: b.banner ?? a.banner,
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number) {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
