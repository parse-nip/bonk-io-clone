import Matter from "matter-js";
import type {
  GameMode,
  InputState,
  MapDef,
  PlayerProfile,
  Skin,
} from "../types";
import { getMap } from "./maps";
import {
  TUTORIAL_DT,
  TUTORIAL_G,
  TUTORIAL_MASS,
  createTutorialState,
  matterToTutorialY,
  tutorialDrawStep,
  tutorialToMatter,
  type TutorialInput,
  type TutorialState,
} from "./tutorialPhysics";

const PLAYER_RADIUS = 18;
const HEAVY_MASS_MULT = 2.4;

export interface EnginePlayer {
  id: string;
  name: string;
  skin: Skin;
  body: Matter.Body;
  alive: boolean;
  wins: number;
  isBot: boolean;
  input: InputState;
  facing: number;
  aiming: boolean;
  aimAngle: number;
  charge: number;
  grapple: Matter.Constraint | null;
  grapplePoint: { x: number; y: number } | null;
  team: number;
  score: number;
  /** OSU bonk_v6 kinematic state (y-up, floor at y=0). */
  tutorial: TutorialState;
}

export interface ArrowProj {
  body: Matter.Body;
  ownerId: string;
  lethal: boolean;
  life: number;
}

export type EngineEvent =
  | { type: "eliminated"; id: string; by?: string }
  | { type: "round_over"; winnerId: string | null }
  | { type: "match_over"; winnerId: string }
  | { type: "goal"; team: "red" | "blue" }
  | { type: "banner"; text: string };

export class BonkEngine {
  engine: Matter.Engine;
  world: Matter.World;
  map: MapDef;
  mode: GameMode;
  players: EnginePlayer[] = [];
  platforms: Matter.Body[] = [];
  arrows: ArrowProj[] = [];
  ball: Matter.Body | null = null;
  goals: { body: Matter.Body; team: "red" | "blue" }[] = [];
  roundsToWin: number;
  roundActive = false;
  countdown = 0;
  listeners: ((e: EngineEvent) => void)[] = [];
  width: number;
  height: number;
  private pivotConstraint: Matter.Constraint | null = null;
  private wasFreezing = false;
  /** Matter y of the tutorial floor line (tutorial y = 0). */
  private floorMatterY: number;

  constructor(mode: GameMode, mapId: string, roundsToWin = 3) {
    this.mode = mode;
    this.map = getMap(mapId);
    this.roundsToWin = roundsToWin;
    this.width = this.map.width;
    this.height = this.map.height;
    this.engine = Matter.Engine.create({
      // Tutorial physics integrates gravity (Fnety = Fy - mass*g) per player.
      gravity: { x: 0, y: 0, scale: 0 },
    });
    this.world = this.engine.world;
    this.buildMap();
    this.floorMatterY = this.computeFloorMatterY();
  }

  private computeFloorMatterY(): number {
    const staticPlats = this.platforms.filter((p) => p.isStatic);
    if (!staticPlats.length) return this.height - 40;
    let top = Infinity;
    for (const plat of staticPlats) {
      top = Math.min(top, plat.bounds.min.y);
    }
    return top - PLAYER_RADIUS;
  }

  on(fn: (e: EngineEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: EngineEvent) {
    for (const fn of this.listeners) fn(e);
  }

  private buildMap() {
    for (const shape of this.map.shapes) {
      let body: Matter.Body;
      const opts: Matter.IBodyDefinition = {
        isStatic: shape.static !== false && !shape.rotate,
        friction: shape.friction ?? 0.4,
        restitution: shape.restitution ?? 0.5,
        density: shape.density ?? 0.002,
        label: shape.death ? "death" : "platform",
        angle: ((shape.angle ?? 0) * Math.PI) / 180,
        frictionAir: 0.01,
      };

      if (shape.type === "circle") {
        body = Matter.Bodies.circle(shape.x, shape.y, shape.r ?? 30, opts);
      } else {
        body = Matter.Bodies.rectangle(
          shape.x,
          shape.y,
          shape.w ?? 100,
          shape.h ?? 30,
          opts,
        );
      }

      (body as Matter.Body & { fillColor?: string }).fillColor = shape.color;

      if (shape.rotate) {
        body.isStatic = false;
        body.frictionAir = 0.02;
        Matter.Body.setDensity(body, shape.density ?? 0.0008);
        this.pivotConstraint = Matter.Constraint.create({
          pointA: { x: shape.x, y: shape.y },
          bodyB: body,
          pointB: { x: 0, y: 0 },
          stiffness: 1,
          length: 0,
        });
        Matter.World.add(this.world, this.pivotConstraint);
        // soft angular damping via high inertia + air friction (Classic tilt feel)
        Matter.Body.setInertia(body, body.inertia * 3.4);
        body.frictionAir = 0.05;
      }

      this.platforms.push(body);
      Matter.World.add(this.world, body);
    }

    if (this.map.football && this.mode === "football") {
      const b = this.map.football.ball;
      this.ball = Matter.Bodies.circle(b.x, b.y, b.r, {
        restitution: 0.85,
        friction: 0.05,
        frictionAir: 0.01,
        density: 0.0012,
        label: "ball",
      });
      (this.ball as Matter.Body & { fillColor?: string }).fillColor = "#f5f5f5";
      Matter.World.add(this.world, this.ball);

      for (const g of this.map.football.goals) {
        const body = Matter.Bodies.rectangle(g.x, g.y, g.w, g.h, {
          isStatic: true,
          isSensor: true,
          label: `goal-${g.team}`,
        });
        this.goals.push({ body, team: g.team });
        Matter.World.add(this.world, body);
      }
    }
  }

  addPlayers(profiles: PlayerProfile[]) {
    this.players = profiles.map((p, i) => {
      const spawn = this.map.spawns[i % this.map.spawns.length];
      const body = Matter.Bodies.circle(spawn.x, spawn.y, PLAYER_RADIUS, {
        restitution: 0.55,
        friction: 0.35,
        frictionAir: 0.012,
        density: 0.002,
        label: `player:${p.id}`,
      });
      Matter.Body.setMass(body, TUTORIAL_MASS);
      Matter.World.add(this.world, body);
      const tutY = matterToTutorialY(spawn.y, this.floorMatterY);
      return {
        id: p.id,
        name: p.name,
        skin: p.skin,
        body,
        alive: true,
        wins: 0,
        isBot: !!p.isBot,
        input: emptyInput(),
        facing: 1,
        aiming: false,
        aimAngle: 0,
        charge: 0,
        grapple: null,
        grapplePoint: null,
        team: p.team,
        score: 0,
        tutorial: createTutorialState(spawn.x, tutY, 0, 0),
      };
    });
  }

  setInput(id: string, input: InputState) {
    const p = this.players.find((x) => x.id === id);
    if (p) p.input = { ...input };
  }

  startRound() {
    this.clearArrows();
    this.roundActive = false;
    this.countdown = 2.2;
    this.wasFreezing = false;
    this.emit({ type: "banner", text: "Get Ready!" });

    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      const spawn = this.map.spawns[i % this.map.spawns.length];
      p.alive = true;
      this.releaseGrapple(p);
      Matter.Body.setPosition(p.body, { x: spawn.x, y: spawn.y });
      Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(p.body, 0);
      Matter.Body.setMass(p.body, TUTORIAL_MASS);
      p.tutorial = createTutorialState(
        spawn.x,
        matterToTutorialY(spawn.y, this.floorMatterY),
        0,
        0,
      );
      p.charge = 0;
      p.aiming = false;
      if (p.body) {
        if (p.body.isStatic) Matter.Body.setStatic(p.body, false);
        // ensure in world
        if (!this.world.bodies.includes(p.body)) {
          Matter.World.add(this.world, p.body);
        }
      }
    }

    if (this.ball && this.map.football) {
      Matter.Body.setPosition(this.ball, {
        x: this.map.football.ball.x,
        y: this.map.football.ball.y,
      });
      Matter.Body.setVelocity(this.ball, { x: 0, y: 0 });
    }

    for (const plat of this.platforms) {
      if (!plat.isStatic) {
        Matter.Body.setAngle(plat, 0);
        Matter.Body.setAngularVelocity(plat, 0);
        const shape = this.map.shapes.find((s) => s.rotate);
        if (shape) {
          Matter.Body.setPosition(plat, { x: shape.x, y: shape.y });
          Matter.Body.setVelocity(plat, { x: 0, y: 0 });
        }
      }
    }
  }

  private clearArrows() {
    for (const a of this.arrows) {
      Matter.World.remove(this.world, a.body);
    }
    this.arrows = [];
  }

  private releaseGrapple(p: EnginePlayer) {
    if (p.grapple) {
      Matter.World.remove(this.world, p.grapple);
      p.grapple = null;
      p.grapplePoint = null;
    }
  }

  update(dt: number) {
    if (this.countdown > 0) {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.roundActive = true;
        this.emit({ type: "banner", text: "BONK!" });
      }
    }

    // During the "Get Ready" countdown, keep players pinned at their spawns so
    // they can't drift or fall off before the player gains control (on some maps
    // an unfrozen player would fall to its death before the round even starts).
    const freezing = this.countdown > 0;

    if (freezing) {
      this.freezePlayersAtSpawn();
    } else if (this.wasFreezing) {
      this.unfreezePlayers();
    }
    this.wasFreezing = freezing;

    if (!freezing) {
      for (const p of this.players) {
        if (!p.alive) continue;
        this.applyPlayerControl(p, dt);
      }
    }

    this.updateArrows(dt);
    this.applyWorldGravity(dt);

    Matter.Engine.update(this.engine, Math.min(dt, 0.033) * 1000);

    if (!freezing) {
      this.syncTutorialFromMatter();
    }

    if (this.roundActive) {
      this.checkEliminations();
      this.checkFootball();
      this.checkRoundEnd();
    }
  }

  private freezePlayersAtSpawn() {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive) continue;
      const spawn = this.map.spawns[i % this.map.spawns.length];
      if (!p.body.isStatic) Matter.Body.setStatic(p.body, true);
      Matter.Body.setPosition(p.body, { x: spawn.x, y: spawn.y });
      Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(p.body, 0);
      p.tutorial = createTutorialState(
        spawn.x,
        matterToTutorialY(spawn.y, this.floorMatterY),
        0,
        0,
      );
    }
  }

  private unfreezePlayers() {
    for (const p of this.players) {
      if (!p.alive || !p.body.isStatic) continue;
      Matter.Body.setStatic(p.body, false);
      Matter.Body.setVelocity(p.body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(p.body, 0);
    }
  }

  private applyWorldGravity(_dt: number) {
    if (this.ball) {
      const v = this.ball.velocity;
      Matter.Body.setVelocity(this.ball, {
        x: v.x,
        y: v.y + TUTORIAL_G * TUTORIAL_DT,
      });
    }
  }

  private syncTutorialFromMatter() {
    for (const p of this.players) {
      if (!p.alive) continue;
      p.tutorial.x = p.body.position.x;
      p.tutorial.y = matterToTutorialY(p.body.position.y, this.floorMatterY);
    }
  }

  private applyPlayerControl(p: EnginePlayer, dt: number) {
    const { input } = p;
    const heavy = input.heavy;
    const mass = heavy ? TUTORIAL_MASS * HEAVY_MASS_MULT : TUTORIAL_MASS;
    if (Math.abs(p.body.mass - mass) > 0.01) {
      Matter.Body.setMass(p.body, mass);
    }

    const tutInput: TutorialInput = {
      left: false,
      right: false,
      up: false,
      down: false,
    };

    if (this.mode === "arrows" || this.mode === "deatharrows") {
      if (input.special) {
        if (!p.aiming) {
          p.aimAngle = p.facing >= 0 ? 0 : Math.PI;
        }
        p.aiming = true;
        p.charge = Math.min(1, p.charge + dt * 0.9);
        if (input.left) p.aimAngle -= dt * 2.8;
        if (input.right) p.aimAngle += dt * 2.8;
        tutInput.up = input.up;
        tutInput.down = input.down;
      } else {
        if (p.aiming && p.charge > 0.08) {
          this.fireArrow(p);
        }
        p.aiming = false;
        p.charge = 0;
        tutInput.left = input.left;
        tutInput.right = input.right;
        tutInput.up = input.up;
        tutInput.down = input.down;
      }
    } else {
      tutInput.left = input.left;
      tutInput.right = input.right;
      tutInput.up = input.up;
      tutInput.down = input.down;
    }

    if (tutInput.left) p.facing = -1;
    if (tutInput.right) p.facing = 1;

    tutorialDrawStep(
      p.tutorial,
      tutInput,
      mass,
      PLAYER_RADIUS,
      this.width,
    );

    const matterPos = tutorialToMatter(p.tutorial, this.floorMatterY);
    Matter.Body.setPosition(p.body, matterPos);
    // Kinematic: tutorial already integrated x/y; zero vel so Matter won't double-integrate.
    Matter.Body.setVelocity(p.body, { x: 0, y: 0 });

    if (this.mode === "grapple") {
      if (input.special) {
        if (!p.grapple) this.attachGrapple(p);
      } else {
        this.releaseGrapple(p);
      }

      if (p.grapple) {
        for (const other of this.players) {
          if (other.id === p.id || !other.alive) continue;
          const d = Matter.Vector.magnitude(
            Matter.Vector.sub(p.body.position, other.body.position),
          );
          if (d < PLAYER_RADIUS * 2.05) {
            this.releaseGrapple(p);
            Matter.Body.applyForce(p.body, p.body.position, {
              x: (p.body.position.x - other.body.position.x) * 0.00008,
              y: -0.02,
            });
          }
        }
      }
    } else if (this.mode === "football" && heavy && this.ball) {
      const d = Matter.Vector.magnitude(
        Matter.Vector.sub(p.body.position, this.ball.position),
      );
      if (d < PLAYER_RADIUS + 22) {
        const dir = Matter.Vector.normalise(
          Matter.Vector.sub(this.ball.position, p.body.position),
        );
        Matter.Body.applyForce(this.ball, this.ball.position, {
          x: dir.x * 0.05,
          y: dir.y * 0.05,
        });
      }
    }
  }

  private attachGrapple(p: EnginePlayer) {
    let best: { x: number; y: number } | null = null;
    let bestDist = 180;
    for (const plat of this.platforms) {
      const bounds = plat.bounds;
      const cx = (bounds.min.x + bounds.max.x) / 2;
      const cy = (bounds.min.y + bounds.max.y) / 2;
      // sample nearest point toward platform center
      const dx = cx - p.body.position.x;
      const dy = cy - p.body.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        // attach to surface approx
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        best = {
          x: p.body.position.x + nx * Math.min(dist, 160),
          y: p.body.position.y + ny * Math.min(dist, 160),
        };
        // clamp to platform bounds roughly
        best.x = Math.max(bounds.min.x, Math.min(bounds.max.x, best.x));
        best.y = Math.max(bounds.min.y, Math.min(bounds.max.y, best.y));
      }
    }
    if (!best) return;
    p.grapplePoint = best;
    p.grapple = Matter.Constraint.create({
      pointA: best,
      bodyB: p.body,
      stiffness: 0.04,
      damping: 0.05,
      length: Math.max(40, bestDist * 0.85),
    });
    Matter.World.add(this.world, p.grapple);
  }

  private fireArrow(p: EnginePlayer) {
    const power = 8 + p.charge * 14;
    const dir = {
      x: Math.cos(p.aimAngle),
      y: Math.sin(p.aimAngle),
    };
    const body = Matter.Bodies.rectangle(
      p.body.position.x + dir.x * 28,
      p.body.position.y + dir.y * 28,
      28,
      8,
      {
        restitution: 0.2,
        friction: 0.1,
        density: 0.001,
        label: "arrow",
        angle: Math.atan2(dir.y, dir.x),
      },
    );
    Matter.Body.setVelocity(body, { x: dir.x * power, y: dir.y * power });
    Matter.World.add(this.world, body);
    this.arrows.push({
      body,
      ownerId: p.id,
      lethal: this.mode === "deatharrows",
      life: 3.5,
    });
  }

  private updateArrows(dt: number) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;
      if (a.life <= 0) {
        Matter.World.remove(this.world, a.body);
        this.arrows.splice(i, 1);
        continue;
      }
      for (const p of this.players) {
        if (!p.alive || p.id === a.ownerId) continue;
        const d = Matter.Vector.magnitude(
          Matter.Vector.sub(p.body.position, a.body.position),
        );
        if (d < PLAYER_RADIUS + 14) {
          if (a.lethal) {
            this.eliminate(p, a.ownerId);
          } else {
            const dir = Matter.Vector.normalise(
              Matter.Vector.sub(p.body.position, a.body.position),
            );
            Matter.Body.setVelocity(p.body, {
              x: p.body.velocity.x + dir.x * 12,
              y: p.body.velocity.y + dir.y * 10 - 2,
            });
          }
          Matter.World.remove(this.world, a.body);
          this.arrows.splice(i, 1);
          break;
        }
      }
    }
  }

  private eliminate(p: EnginePlayer, by?: string) {
    if (!p.alive) return;
    p.alive = false;
    this.releaseGrapple(p);
    Matter.World.remove(this.world, p.body);
    this.emit({ type: "eliminated", id: p.id, by });
  }

  private checkEliminations() {
    for (const p of this.players) {
      if (!p.alive) continue;
      const { x, y } = p.body.position;
      const pad = this.map.killPadding;
      if (
        y > this.map.killY ||
        y < -pad ||
        x < -pad ||
        x > this.map.width + pad
      ) {
        this.eliminate(p);
        continue;
      }
      // death platforms
      for (const plat of this.platforms) {
        if (plat.label !== "death") continue;
        const coll = Matter.Collision.collides(p.body, plat);
        if (coll) {
          this.eliminate(p);
          break;
        }
      }
    }
  }

  private checkFootball() {
    if (this.mode !== "football" || !this.ball) return;
    for (const g of this.goals) {
      const coll = Matter.Collision.collides(this.ball, g.body);
      if (coll) {
        this.emit({ type: "goal", team: g.team });
        // award opposite team... actually goal.team is the goal owner being scored on
        // Our map: left goal is blue's (red scores), right is red's (blue scores)
        const scorerTeam = g.team === "red" ? "blue" : "red";
        for (const p of this.players) {
          if (
            (scorerTeam === "red" && p.team === 2) ||
            (scorerTeam === "blue" && p.team === 3)
          ) {
            p.score += 1;
          }
        }
        this.roundActive = false;
        const winner =
          this.players.find(
            (p) =>
              (scorerTeam === "red" && p.team === 2) ||
              (scorerTeam === "blue" && p.team === 3),
          ) ?? null;
        if (winner) {
          winner.wins += 1;
          this.emit({ type: "banner", text: `GOAL!` });
          if (winner.wins >= this.roundsToWin) {
            this.emit({ type: "match_over", winnerId: winner.id });
          } else {
            this.emit({ type: "round_over", winnerId: winner.id });
            setTimeout(() => this.startRound(), 1600);
          }
        }
        break;
      }
    }
  }

  private checkRoundEnd() {
    if (this.mode === "football") return;
    const alive = this.players.filter((p) => p.alive);
    if (alive.length <= 1 && this.players.length > 1) {
      this.roundActive = false;
      const winner = alive[0] ?? null;
      if (winner) {
        winner.wins += 1;
        this.emit({ type: "banner", text: `${winner.name} wins!` });
        if (winner.wins >= this.roundsToWin) {
          this.emit({ type: "match_over", winnerId: winner.id });
        } else {
          this.emit({ type: "round_over", winnerId: winner.id });
          setTimeout(() => this.startRound(), 1800);
        }
      } else {
        this.emit({ type: "round_over", winnerId: null });
        setTimeout(() => this.startRound(), 1800);
      }
    }
  }

  destroy() {
    Matter.World.clear(this.world, false);
    Matter.Engine.clear(this.engine);
  }
}

export function emptyInput(): InputState {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    heavy: false,
    special: false,
  };
}
