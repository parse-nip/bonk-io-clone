import type { BonkEngine, EnginePlayer } from "./engine";
import { PLAYER_RADIUS } from "./engine";
import type { PhysBody } from "./physBody";

export class GameRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 780;
  h = 520;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
  }

  draw(engine: BonkEngine, localId: string) {
    const ctx = this.ctx;
    // Stretch the logical 780×520 world to the full canvas so the stage
    // (now 100vw×100vh) is actually used edge-to-edge.
    const sx = this.w / engine.width;
    const sy = this.h / engine.height;
    ctx.save();
    ctx.scale(sx, sy);

    // background field
    ctx.fillStyle = "#2c2c2c";
    ctx.fillRect(0, 0, engine.width, engine.height);

    // subtle vignette grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let x = 0; x < engine.width; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, engine.height);
      ctx.stroke();
    }

    // platforms
    for (const body of engine.platforms) {
      const color = body.fillColor || "#8fd14f";
      this.drawBody(body, color, true);
    }

    // goals
    for (const g of engine.goals) {
      ctx.fillStyle =
        g.team === "red" ? "rgba(231,76,60,0.35)" : "rgba(52,152,219,0.35)";
      const b = g.body.bounds;
      ctx.fillRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y);
    }

    // football
    if (engine.ball) {
      this.drawCircle(
        engine.ball.position.x,
        engine.ball.position.y,
        16,
        "#f5f5f5",
        true,
      );
      ctx.strokeStyle = "#222";
      ctx.beginPath();
      ctx.arc(
        engine.ball.position.x,
        engine.ball.position.y,
        16,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }

    // arrows
    for (const a of engine.arrows) {
      ctx.save();
      ctx.translate(a.body.position.x, a.body.position.y);
      ctx.rotate(a.body.angle);
      ctx.fillStyle = a.lethal ? "#ff3b3b" : "#f0e6c8";
      ctx.fillRect(-14, -4, 28, 8);
      ctx.fillStyle = a.lethal ? "#aa0000" : "#c4a574";
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(8, -6);
      ctx.lineTo(8, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // grapples
    for (const p of engine.players) {
      if (!p.alive || !p.grapplePoint) continue;
      ctx.strokeStyle = "rgba(240,230,200,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.body.position.x, p.body.position.y);
      ctx.lineTo(p.grapplePoint.x, p.grapplePoint.y);
      ctx.stroke();
    }

    // players
    for (const p of engine.players) {
      if (!p.alive) continue;
      this.drawPlayer(p, p.id === localId);
      if (p.aiming) {
        const len = 40 + p.charge * 70;
        const ang =
          Math.abs(p.aimAngle) < 0.001
            ? p.facing >= 0
              ? 0
              : Math.PI
            : p.aimAngle;
        ctx.strokeStyle = `rgba(255,220,120,${0.4 + p.charge * 0.5})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.body.position.x, p.body.position.y);
        ctx.lineTo(
          p.body.position.x + Math.cos(ang) * len,
          p.body.position.y + Math.sin(ang) * len,
        );
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawBody(
    body: PhysBody,
    color: string,
    rounded: boolean,
  ) {
    const ctx = this.ctx;
    // Prefer local verts + body transform. Using world-space `vertices` here
    // used to double-apply angle (translate/rotate AND already-rotated verts),
    // which broke angled platforms and offset-pivot rotation visually.
    const local = body.localVertices;
    const verts =
      local.length >= 3
        ? local
        : body.vertices.map((v) => ({
            x: v.x - body.position.x,
            y: v.y - body.position.y,
          }));
    if (verts.length < 3) return;

    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();
    if (rounded) {
      // soft highlight
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < Math.ceil(verts.length / 2); i++) {
        ctx.lineTo(verts[i].x, verts[i].y);
      }
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCircle(
    x: number,
    y: number,
    r: number,
    color: string,
    shade: boolean,
  ) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (shade) {
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.35)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawPlayer(p: EnginePlayer, isLocal: boolean) {
    const ctx = this.ctx;
    const { x, y } = p.body.position;
    const r = PLAYER_RADIUS;
    const heavy = p.input.heavy;

    if (heavy) {
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 3;
      ctx.arc(x, y, r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.drawCircle(x, y, r, p.skin.baseColor, true);
    ctx.strokeStyle = isLocal ? "#fff" : "rgba(0,0,0,0.45)";
    ctx.lineWidth = isLocal ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    if (p.skin.eyes) {
      ctx.fillStyle = "#111";
      const eyeY = y - 3;
      ctx.beginPath();
      ctx.arc(x - 5, eyeY, 2.2, 0, Math.PI * 2);
      ctx.arc(x + 5, eyeY, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(x - 5.5, eyeY - 0.6, 0.7, 0, Math.PI * 2);
      ctx.arc(x + 4.5, eyeY - 0.6, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (p.skin.mouth) {
      ctx.strokeStyle = p.skin.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y + 4, 5, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    // name
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = "bold 11px Nunito, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(p.name, x + 1, y - r - 7);
    ctx.fillStyle = "#f5e6c8";
    ctx.fillText(p.name, x, y - r - 8);
  }
}
