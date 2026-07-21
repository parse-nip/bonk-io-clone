import {
  World,
  Vec2,
  RevoluteJoint,
  DistanceJoint,
  Settings,
  type Joint,
  type Contact,
} from "planck";
import type {
  GameMode,
  InputState,
  MapDef,
  PlayerProfile,
  Skin,
  SpawnDef,
} from "../types";
import { getMap } from "./maps";
import type { GameSnapshot } from "../../shared/protocol";
import {
  PhysBody,
  bodiesOverlap,
  createBoxBody,
  createCircleBody,
  createPolygonBody,
  distBetween,
} from "./physBody";

/**
 * Tutorial physics (bonk_v6):
 *   mass=3, g=9.8, thruster ±15 every arrow, dt=0.1,
 *   blob_radius=25, floor `vy = -vy`, **no speed cap**.
 *   Fnety = Fy - mass*g (explicit net force).
 *
 * We keep the same ratios and map gravity (~350-380) so horizontal travel
 * feels like the sketch (~200 px / 1.5 s).
 */

Settings.maxTranslation = 12; // allow fast knockback

export const PLAYER_RADIUS = 25;
export const PLAYER_MASS = 3; // tutorial light mass

const DISC_DENSITY = PLAYER_MASS / (Math.PI * PLAYER_RADIUS * PLAYER_RADIUS);
const HEAVY_DENSITY = DISC_DENSITY * 2; // wiki heavy

const PLAYER_RESTITUTION = 0.94; // near-elastic (tutorial floor bounce)
const PLAYER_FRICTION = 0.08;    // low — keeps coasts alive
const PLAYER_LINEAR_DAMPING = 0.01;
const PLAYER_ANGULAR_DAMPING = 3.4;

const THRUST_VS_WEIGHT = 15 / (PLAYER_MASS * 9.8); // ~0.51
const HEAVY_THRUST_VS_LIGHT_WEIGHT = THRUST_VS_WEIGHT * 0.5;

const ZERO_G_MOVE_FORCE = PLAYER_MASS * (THRUST_VS_WEIGHT * 350);
const ZERO_G_HEAVY_MOVE_FORCE = ZERO_G_MOVE_FORCE * 0.35;

/** Punchy hop — snappy pop; buffer/coyote handle “responsive” timing. */
const JUMP_SPEED = 195;
const HEAVY_JUMP_SPEED = 135;

const HOP_CLEARANCE_PX = 4;
/** Frames to honor an early Up press before landing (input buffer). */
const JUMP_BUFFER_FRAMES = 10;
/** Frames after leaving a ledge where Up still hops (coyote time). */
const COYOTE_FRAMES = 6;

const DEFAULT_PLATFORM_DENSITY = 0.3;
const DEFAULT_PLATFORM_FRICTION = 0.3;
const DEFAULT_PLATFORM_RESTITUTION = 0.8;

const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;

export interface EnginePlayer {
  id: string;
  name: string;
  skin: Skin;
  body: PhysBody;
  alive: boolean;
  wins: number;
  isBot: boolean;
  input: InputState;
  facing: number;
  aiming: boolean;
  aimAngle: number;
  charge: number;
  grapple: Joint | null;
  grapplePoint: { x: number; y: number } | null;
  team: number;
  score: number;
  /** Prior-frame grounded flag for bunny-hop / land bounce. */
  wasGrounded: boolean;
  prevUp: boolean;
  /** Max downward speed since last grounded (for land-bounce threshold). */
  impactVy: number;
  /** Hop speed queued during control; applied after world.step. */
  pendingHop: number | null;
  /** Remaining frames to accept a pre-land Up press. */
  jumpBuffer: number;
  /** Remaining frames after leaving ground where Up still hops. */
  coyote: number;
}

export interface ArrowProj {
  body: PhysBody;
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
  world: World;
  map: MapDef;
  mode: GameMode;
  players: EnginePlayer[] = [];
  platforms: PhysBody[] = [];
  arrows: ArrowProj[] = [];
  ball: PhysBody | null = null;
  goals: { body: PhysBody; team: "red" | "blue" }[] = [];
  roundsToWin: number;
  roundActive = false;
  countdown = 0;
  listeners: ((e: EngineEvent) => void)[] = [];
  width: number;
  height: number;
  private pivotJoints: Joint[] = [];
  private wasFreezing = false;
  private platformMeta = new Map<
    number,
    {
      x: number;
      y: number;
      angle: number;
      startSpeedX: number;
      startSpeedY: number;
      startSpin: number;
      dynamic: boolean;
    }
  >();
  /** Static anchor body for revolute pivots / grapples. */
  private ground: PhysBody;

  constructor(mode: GameMode, mapId: string, roundsToWin = 3) {
    this.mode = mode;
    this.map = getMap(mapId);
    this.roundsToWin = roundsToWin;
    this.width = this.map.width;
    this.height = this.map.height;
    this.world = new World({
      gravity: new Vec2(this.map.gravity.x, this.map.gravity.y),
    });
    const groundRaw = this.world.createBody({
      type: "static",
      position: new Vec2(0, 0),
    });
    this.ground = new PhysBody(groundRaw, {
      label: "ground",
      shapeKind: "polygon",
      localVerts: [],
    });
    this.buildMap();
  }

  on(fn: (e: EngineEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: EngineEvent) {
    if (e.type === "match_over") {
      this.snapEvent = "match_over";
      this.snapEventPlayerId = e.winnerId;
    } else if (e.type === "round_over") {
      this.snapEvent = "round_over";
      this.snapEventPlayerId = e.winnerId ?? undefined;
    } else if (e.type === "eliminated") {
      this.snapEvent = "eliminated";
      this.snapEventPlayerId = e.id;
    }
    for (const fn of this.listeners) fn(e);
  }

  private buildMap() {
    this.platformMeta.clear();
    for (const shape of this.map.shapes) {
      const isRotate = !!shape.rotate;
      const isDynamic = shape.static === false || isRotate;
      const density = shape.density ?? DEFAULT_PLATFORM_DENSITY;
      const friction = shape.friction ?? DEFAULT_PLATFORM_FRICTION;
      const restitution = shape.restitution ?? DEFAULT_PLATFORM_RESTITUTION;
      const angle = ((shape.angle ?? 0) * Math.PI) / 180;
      const label = shape.death && !shape.noPhysics ? "death" : "platform";

      const raw = this.world.createBody({
        type: isDynamic ? "dynamic" : "static",
        position: new Vec2(shape.x, shape.y),
        angle,
        bullet: isDynamic,
        fixedRotation: !!shape.fixedRotation,
        linearDamping: isDynamic ? 0.01 : 0,
        angularDamping: shape.angularDamping ?? (isRotate ? 0.05 : 0),
        gravityScale: 1,
      });

      const fixture = {
        density: isDynamic ? density : 0,
        friction,
        restitution,
        isSensor: !!shape.noPhysics,
      };

      let body: PhysBody;
      if (shape.type === "circle") {
        body = createCircleBody(raw, shape.r ?? 30, fixture, {
          label,
          fillColor: shape.color,
        });
      } else if (
        shape.type === "polygon" &&
        shape.vertices &&
        shape.vertices.length >= 3
      ) {
        body = createPolygonBody(raw, shape.vertices, fixture, {
          label,
          fillColor: shape.color,
        });
      } else {
        const hx = (shape.w ?? 100) / 2;
        const hy = (shape.h ?? 30) / 2;
        body = createBoxBody(raw, hx, hy, fixture, {
          label,
          fillColor: shape.color,
        });
      }

      if (isRotate) {
        // Pivot is a local-space offset from the body origin. Ground is at
        // identity, so its local anchor equals the world hinge point.
        const px = shape.pivotX ?? 0;
        const py = shape.pivotY ?? 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const worldAnchor = new Vec2(
          shape.x + px * cos - py * sin,
          shape.y + px * sin + py * cos,
        );
        const joint = this.world.createJoint(
          new RevoluteJoint({
            collideConnected: false,
            enableMotor: false,
            bodyA: this.ground.raw,
            bodyB: raw,
            localAnchorA: worldAnchor,
            localAnchorB: new Vec2(px, py),
            referenceAngle: angle,
          }),
        );
        if (joint) this.pivotJoints.push(joint);
        // Match prior Matter inertia bump for a slower, bonk-like tip.
        const md = { mass: 0, center: { x: 0, y: 0 }, I: 0 };
        raw.getMassData(md);
        md.I *= 3.4;
        raw.setMassData(md);
      }

      const idx = this.platforms.length;
      this.platformMeta.set(idx, {
        x: shape.x,
        y: shape.y,
        angle,
        startSpeedX: shape.startSpeedX ?? 0,
        startSpeedY: shape.startSpeedY ?? 0,
        startSpin: shape.startSpin ?? 0,
        dynamic: isDynamic,
      });

      this.platforms.push(body);
    }

    if (this.map.football && this.mode === "football") {
      const b = this.map.football.ball;
      const ballRaw = this.world.createBody({
        type: "dynamic",
        position: new Vec2(b.x, b.y),
        bullet: true,
        linearDamping: 0.01,
        angularDamping: 0.05,
      });
      this.ball = createCircleBody(
        ballRaw,
        b.r,
        {
          density: 0.0012,
          friction: 0.05,
          restitution: 0.85,
        },
        { label: "ball", fillColor: "#f5f5f5" },
      );

      for (const g of this.map.football.goals) {
        const goalRaw = this.world.createBody({
          type: "static",
          position: new Vec2(g.x, g.y),
        });
        const body = createBoxBody(
          goalRaw,
          g.w / 2,
          g.h / 2,
          {
            density: 0,
            friction: 0,
            restitution: 0,
            isSensor: true,
          },
          { label: `goal-${g.team}` },
        );
        this.goals.push({ body, team: g.team });
      }
    }
  }

  private pickSpawn(index: number, team: number) {
    const usable = this.map.spawns.filter((s) => spawnAllowsTeam(s, team));
    const pool = usable.length ? usable : this.map.spawns;
    const ordered = [...pool].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );
    return ordered[index % ordered.length] ?? { x: this.width / 2, y: 120 };
  }

  private makePlayerBody(x: number, y: number, id: string): PhysBody {
    const raw = this.world.createBody({
      type: "dynamic",
      position: new Vec2(x, y),
      bullet: true,
      linearDamping: PLAYER_LINEAR_DAMPING,
      angularDamping: PLAYER_ANGULAR_DAMPING,
      fixedRotation: false,
    });
    return createCircleBody(
      raw,
      PLAYER_RADIUS,
      {
        density: DISC_DENSITY,
        friction: PLAYER_FRICTION,
        restitution: PLAYER_RESTITUTION,
      },
      { label: `player:${id}` },
    );
  }

  addPlayers(profiles: PlayerProfile[]) {
    this.players = profiles.map((p, i) => {
      const spawn = this.pickSpawn(i, p.team);
      const body = this.makePlayerBody(spawn.x, spawn.y, p.id);
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
        wasGrounded: false,
        prevUp: false,
        impactVy: 0,
        pendingHop: null,
        jumpBuffer: 0,
        coyote: 0,
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
      const spawn = this.pickSpawn(i, p.team);
      p.alive = true;
      this.releaseGrapple(p);
      if (!p.body.raw.isActive()) {
        p.body.raw.setActive(true);
      }
      p.body.setStatic(false);
      p.body.setDensity(DISC_DENSITY);
      p.body.setPosition(spawn.x, spawn.y);
      p.body.setVelocity(spawn.startSpeedX ?? 0, spawn.startSpeedY ?? 0);
      p.body.setAngularVelocity(0);
      p.charge = 0;
      p.aiming = false;
    }

    if (this.ball && this.map.football) {
      this.ball.setPosition(this.map.football.ball.x, this.map.football.ball.y);
      this.ball.setVelocity(0, 0);
      this.ball.setAngularVelocity(0);
    }

    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      const meta = this.platformMeta.get(i);
      if (!meta || !meta.dynamic) continue;
      plat.setPosition(meta.x, meta.y);
      plat.setAngle(meta.angle);
      plat.setVelocity(meta.startSpeedX, meta.startSpeedY);
      plat.setAngularVelocity(meta.startSpin);
    }
  }

  private clearArrows() {
    for (const a of this.arrows) {
      this.world.destroyBody(a.body.raw);
    }
    this.arrows = [];
  }

  private releaseGrapple(p: EnginePlayer) {
    if (p.grapple) {
      this.world.destroyJoint(p.grapple);
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

    const freezing = this.countdown > 0;

    if (freezing) {
      this.freezePlayersAtSpawn();
      this.freezeDynamicPlatforms();
    } else if (this.wasFreezing) {
      this.unfreezePlayers();
      this.releaseDynamicPlatforms();
    }
    this.wasFreezing = freezing;

    if (!freezing) {
      for (const p of this.players) {
        if (!p.alive) continue;
        this.applyPlayerControl(p, dt);
      }
    }

    this.updateArrows(dt);

    const step = Math.min(dt, 0.033);
    this.world.step(step, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    this.world.clearForces();

    // Joint solvers can nudge offset-pivot platforms during the countdown
    // freeze; snap them again after the step so the hinge pose stays exact.
    if (freezing) {
      this.freezeDynamicPlatforms();
      this.freezePlayersAtSpawn();
    }

    // Apply hops after the step, then destroy stale floor contacts. Box2D
    // runs the velocity solver BEFORE updating contacts, so leftover ground
    // manifolds would otherwise clamp most of the upward velocity next frame
    // (that read as a mushy / floaty hop).
    if (!freezing) {
      for (const p of this.players) {
        if (!p.alive || p.pendingHop == null) continue;
        const hop = p.pendingHop;
        p.pendingHop = null;
        const pos = p.body.position;
        const v = p.body.velocity;
        p.body.setPosition(pos.x, pos.y - HOP_CLEARANCE_PX);
        p.body.setVelocity(v.x, -hop);
        this.destroyBodyContacts(p.body);
        p.body.raw.setAwake(true);
        p.wasGrounded = false;
        p.impactVy = 0;
      }
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
      const spawn = this.pickSpawn(i, p.team);
      if (!p.body.isStatic) p.body.setStatic(true);
      p.body.setPosition(spawn.x, spawn.y);
      p.body.setVelocity(0, 0);
      p.body.setAngularVelocity(0);
    }
  }

  private unfreezePlayers() {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (!p.alive || !p.body.isStatic) continue;
      const spawn = this.pickSpawn(i, p.team);
      p.body.setStatic(false);
      p.body.setVelocity(spawn.startSpeedX ?? 0, spawn.startSpeedY ?? 0);
      p.body.setAngularVelocity(0);
    }
  }

  private freezeDynamicPlatforms() {
    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      const meta = this.platformMeta.get(i);
      if (!meta || !meta.dynamic) continue;
      plat.setPosition(meta.x, meta.y);
      plat.setAngle(meta.angle);
      plat.setVelocity(0, 0);
      plat.setAngularVelocity(0);
    }
  }

  private releaseDynamicPlatforms() {
    for (let i = 0; i < this.platforms.length; i++) {
      const plat = this.platforms[i];
      const meta = this.platformMeta.get(i);
      if (!meta || !meta.dynamic) continue;
      plat.setPosition(meta.x, meta.y);
      plat.setAngle(meta.angle);
      plat.setVelocity(meta.startSpeedX, meta.startSpeedY);
      plat.setAngularVelocity(meta.startSpin);
    }
  }

  /** Drop every contact edge on a body (safe after a teleport / hop). */
  private destroyBodyContacts(body: PhysBody) {
    const world = this.world as World & {
      destroyContact(contact: Contact): void;
    };
    let edge = body.raw.getContactList();
    while (edge) {
      const contact = edge.contact;
      edge = edge.next;
      world.destroyContact(contact);
    }
  }

  /**
   * Tutorial-style thrusters: same |F| on every axis (Fx/Fy = ±15 sketch).
   * Force is vs *light* weight so heavy (2× mass) accelerates ~half as hard.
   */
  private thrusterForces(heavy: boolean): { hx: number; hy: number } {
    const gy = Math.abs(this.map.gravity.y);
    if (gy < 1e-6) {
      const f = heavy ? ZERO_G_HEAVY_MOVE_FORCE : ZERO_G_MOVE_FORCE;
      return { hx: f, hy: f };
    }
    const lightWeight = PLAYER_MASS * gy;
    const ratio = heavy ? HEAVY_THRUST_VS_LIGHT_WEIGHT : THRUST_VS_WEIGHT;
    const f = lightWeight * ratio;
    const scale = this.mode === "football" ? 1.25 : 1;
    return { hx: f * scale, hy: f * scale };
  }

  private applyPlayerControl(p: EnginePlayer, dt: number) {
    const { input } = p;
    const heavy = input.heavy;
    const targetDensity = heavy ? HEAVY_DENSITY : DISC_DENSITY;
    const f = p.body.fixture();
    if (f && Math.abs(f.getDensity() - targetDensity) > 1e-8) {
      p.body.setDensity(targetDensity);
    }

    const { hx, hy } = this.thrusterForces(heavy);
    const grounded = this.isPlayerGrounded(p);
    if (!grounded) {
      p.impactVy = Math.max(p.impactVy, p.body.velocity.y);
    }

    if (this.mode === "arrows" || this.mode === "deatharrows") {
      if (input.special) {
        if (!p.aiming) {
          p.aimAngle = p.facing >= 0 ? 0 : Math.PI;
        }
        p.aiming = true;
        p.charge = Math.min(1, p.charge + dt * 0.9);
        if (input.left) p.aimAngle -= dt * 2.8;
        if (input.right) p.aimAngle += dt * 2.8;
        this.applyThrusterForce(p, hx, hy, {
          horizontal: false,
          vertical: true,
        });
      } else {
        if (p.aiming && p.charge > 0.08) {
          this.fireArrow(p);
        }
        p.aiming = false;
        p.charge = 0;
        this.applyThrusterForce(p, hx, hy);
      }
    } else if (this.mode === "grapple") {
      this.applyThrusterForce(p, hx, hy);

      if (input.special) {
        if (!p.grapple) this.attachGrapple(p);
      } else {
        this.releaseGrapple(p);
      }

      if (p.grapple) {
        for (const other of this.players) {
          if (other.id === p.id || !other.alive) continue;
          const d = distBetween(p.body, other.body);
          if (d < PLAYER_RADIUS * 2.05) {
            this.releaseGrapple(p);
            p.body.applyForce(
              (p.body.position.x - other.body.position.x) * 0.8,
              -20,
            );
          }
        }
      }
    } else if (this.mode === "football") {
      this.applyThrusterForce(p, hx, hy);
      if (heavy && this.ball) {
        const d = distBetween(p.body, this.ball);
        if (d < PLAYER_RADIUS + 22) {
          const dx = this.ball.position.x - p.body.position.x;
          const dy = this.ball.position.y - p.body.position.y;
          const len = Math.hypot(dx, dy) || 1;
          this.ball.applyForce((dx / len) * 50, (dy / len) * 50);
        }
      }
    } else {
      this.applyThrusterForce(p, hx, hy);
    }

    // Queue hop AFTER world.step so ground contacts don't eat the impulse.
    // Buffer + coyote make Up feel responsive (early press / late ledge).
    // Landing while holding Up also hops — tutorial "start bouncing" feel.
    p.pendingHop = null;
    if (input.up && !p.prevUp) p.jumpBuffer = JUMP_BUFFER_FRAMES;
    else if (p.jumpBuffer > 0) p.jumpBuffer -= 1;

    if (grounded) p.coyote = COYOTE_FRAMES;
    else if (p.coyote > 0) p.coyote -= 1;

    const canHop = grounded || p.coyote > 0;
    if (input.up && canHop && this.map.gravity.y > 1e-6) {
      const justLanded = grounded && !p.wasGrounded;
      const upPressed = !p.prevUp;
      const buffered = p.jumpBuffer > 0;
      if (upPressed || justLanded || buffered) {
        const hop = heavy ? HEAVY_JUMP_SPEED : JUMP_SPEED;
        if (p.body.velocity.y > -hop * 0.55) {
          p.pendingHop = hop;
          p.jumpBuffer = 0;
          p.coyote = 0;
        }
      }
    }
    if (grounded && p.pendingHop == null) p.impactVy = 0;
    p.wasGrounded = grounded;
    p.prevUp = input.up;
    // No horizontal speed cap — tutorial / wiki momentum: velocity only
    // changes via F/m thrusters and collisions (soft-caps killed coasts).
  }

  /** True when the disc is sitting on / grazing a solid platform. */
  private isPlayerGrounded(p: EnginePlayer): boolean {
    const pos = p.body.position;
    const footY = pos.y + PLAYER_RADIUS + 3;
    for (const plat of this.platforms) {
      if (plat.label === "death") continue;
      const f = plat.fixture();
      if (f?.isSensor()) continue;
      const b = plat.bounds;
      if (pos.x < b.min.x - 4 || pos.x > b.max.x + 4) continue;
      // Feet near the top surface (Y+ down).
      if (footY >= b.min.y - 2 && pos.y < b.max.y) {
        return true;
      }
    }
    return false;
  }

  /**
   * Continuous directional thrusters (Box2D ApplyForceToCenter).
   * Matches tutorial: same magnitude on every arrow; net vertical is
   * Fy - weight inside the integrator (we apply Fy, world applies gravity).
   */
  private applyThrusterForce(
    p: EnginePlayer,
    forceX: number,
    forceY: number,
    axes: { horizontal?: boolean; vertical?: boolean } = {
      horizontal: true,
      vertical: true,
    },
  ) {
    const { input } = p;
    let fx = 0;
    let fy = 0;

    if (axes.horizontal !== false) {
      if (input.left) {
        fx -= forceX;
        p.facing = -1;
      }
      if (input.right) {
        fx += forceX;
        p.facing = 1;
      }
    }
    if (axes.vertical !== false) {
      // Y+ is down (canvas / bonk client), so Up applies a negative force.
      if (input.up) fy -= forceY;
      if (input.down) fy += forceY;
    }

    if (fx !== 0 || fy !== 0) {
      p.body.applyForce(fx, fy);
    }
  }

  private attachGrapple(p: EnginePlayer) {
    let best: { x: number; y: number } | null = null;
    let bestDist = 180;
    for (const plat of this.platforms) {
      const bounds = plat.bounds;
      const cx = (bounds.min.x + bounds.max.x) / 2;
      const cy = (bounds.min.y + bounds.max.y) / 2;
      const dx = cx - p.body.position.x;
      const dy = cy - p.body.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        best = {
          x: p.body.position.x + nx * Math.min(dist, 160),
          y: p.body.position.y + ny * Math.min(dist, 160),
        };
        best.x = Math.max(bounds.min.x, Math.min(bounds.max.x, best.x));
        best.y = Math.max(bounds.min.y, Math.min(bounds.max.y, best.y));
      }
    }
    if (!best) return;
    p.grapplePoint = best;
    const joint = this.world.createJoint(
      new DistanceJoint(
        {
          collideConnected: true,
          frequencyHz: 4,
          dampingRatio: 0.5,
          length: Math.max(40, bestDist * 0.85),
        },
        this.ground.raw,
        p.body.raw,
        new Vec2(best.x, best.y),
        p.body.raw.getWorldCenter(),
      ),
    );
    p.grapple = joint;
  }

  private fireArrow(p: EnginePlayer) {
    const power = 8 + p.charge * 14;
    const dir = {
      x: Math.cos(p.aimAngle),
      y: Math.sin(p.aimAngle),
    };
    const raw = this.world.createBody({
      type: "dynamic",
      position: new Vec2(
        p.body.position.x + dir.x * 28,
        p.body.position.y + dir.y * 28,
      ),
      angle: Math.atan2(dir.y, dir.x),
      bullet: true,
      linearDamping: 0.01,
    });
    const body = createBoxBody(
      raw,
      14,
      4,
      {
        density: 0.001,
        friction: 0.1,
        restitution: 0.2,
      },
      { label: "arrow" },
    );
    body.setVelocity(dir.x * power, dir.y * power);
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
        this.world.destroyBody(a.body.raw);
        this.arrows.splice(i, 1);
        continue;
      }
      for (const p of this.players) {
        if (!p.alive || p.id === a.ownerId) continue;
        const d = distBetween(p.body, a.body);
        if (d < PLAYER_RADIUS + 14) {
          if (a.lethal) {
            this.eliminate(p, a.ownerId);
          } else {
            const dx = p.body.position.x - a.body.position.x;
            const dy = p.body.position.y - a.body.position.y;
            const len = Math.hypot(dx, dy) || 1;
            p.body.setVelocity(
              p.body.velocity.x + (dx / len) * 12,
              p.body.velocity.y + (dy / len) * 10 - 2,
            );
          }
          this.world.destroyBody(a.body.raw);
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
    p.body.raw.setActive(false);
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
      for (const plat of this.platforms) {
        if (plat.label !== "death") continue;
        if (bodiesOverlap(p.body, plat)) {
          // tighter circle vs AABB: require center near platform
          const b = plat.bounds;
          const cx = Math.max(b.min.x, Math.min(b.max.x, x));
          const cy = Math.max(b.min.y, Math.min(b.max.y, y));
          if (Math.hypot(x - cx, y - cy) < PLAYER_RADIUS + 2) {
            this.eliminate(p);
            break;
          }
        }
      }
    }
  }

  private checkFootball() {
    if (this.mode !== "football" || !this.ball) return;
    for (const g of this.goals) {
      if (!bodiesOverlap(this.ball, g.body)) continue;
      this.emit({ type: "goal", team: g.team });
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

  private snapEvent: GameSnapshot["event"];
  private snapEventPlayerId?: string;

  /** Host: pack authoritative world state for clients. */
  getSnapshot(banner?: string): GameSnapshot {
    const event = this.snapEvent;
    const eventPlayerId = this.snapEventPlayerId;
    this.snapEvent = undefined;
    this.snapEventPlayerId = undefined;
    return {
      t: performance.now(),
      countdown: this.countdown,
      roundActive: this.roundActive,
      players: this.players.map((p) => ({
        id: p.id,
        x: p.body.position.x,
        y: p.body.position.y,
        vx: p.body.velocity.x,
        vy: p.body.velocity.y,
        angle: p.body.angle,
        av: p.body.angularVelocity,
        alive: p.alive,
        wins: p.wins,
        facing: p.facing,
        aiming: p.aiming,
        aimAngle: p.aimAngle,
        charge: p.charge,
        heavy: p.input.heavy,
        grapple: p.grapplePoint ? { ...p.grapplePoint } : null,
      })),
      platforms: this.platforms.map((body, i) => ({
        i,
        x: body.position.x,
        y: body.position.y,
        angle: body.angle,
        av: body.angularVelocity,
      })),
      ball: this.ball
        ? {
            x: this.ball.position.x,
            y: this.ball.position.y,
            vx: this.ball.velocity.x,
            vy: this.ball.velocity.y,
          }
        : null,
      banner,
      event,
      eventPlayerId,
    };
  }

  /** Client: apply authoritative snapshot (no local physics step). */
  applySnapshot(snap: GameSnapshot) {
    this.countdown = snap.countdown;
    this.roundActive = snap.roundActive;

    for (const sp of snap.players) {
      const p = this.players.find((x) => x.id === sp.id);
      if (!p) continue;
      p.wins = sp.wins;
      p.facing = sp.facing;
      p.aiming = sp.aiming;
      p.aimAngle = sp.aimAngle;
      p.charge = sp.charge;
      p.input.heavy = sp.heavy;

      if (sp.alive && !p.alive) {
        p.alive = true;
        p.body.raw.setActive(true);
        p.body.setStatic(false);
      }

      if (!sp.alive && p.alive) {
        p.alive = false;
        this.releaseGrapple(p);
        p.body.raw.setActive(false);
        continue;
      }

      if (!sp.alive) continue;

      if (snap.countdown > 0) {
        if (!p.body.isStatic) p.body.setStatic(true);
      } else if (p.body.isStatic) {
        p.body.setStatic(false);
      }

      p.body.setPosition(sp.x, sp.y);
      p.body.setVelocity(sp.vx, sp.vy);
      p.body.setAngle(sp.angle);
      p.body.setAngularVelocity(sp.av);
      p.body.setDensity(sp.heavy ? HEAVY_DENSITY : DISC_DENSITY);

      if (sp.grapple) {
        if (
          !p.grapplePoint ||
          p.grapplePoint.x !== sp.grapple.x ||
          p.grapplePoint.y !== sp.grapple.y
        ) {
          this.releaseGrapple(p);
          p.grapplePoint = { ...sp.grapple };
          p.grapple = this.world.createJoint(
            new DistanceJoint(
              {
                collideConnected: true,
                frequencyHz: 4,
                dampingRatio: 0.5,
                length: Math.hypot(sp.x - sp.grapple.x, sp.y - sp.grapple.y),
              },
              this.ground.raw,
              p.body.raw,
              new Vec2(sp.grapple.x, sp.grapple.y),
              p.body.raw.getWorldCenter(),
            ),
          );
        }
      } else {
        this.releaseGrapple(p);
      }
    }

    for (const sp of snap.platforms) {
      const body = this.platforms[sp.i];
      const meta = this.platformMeta.get(sp.i);
      if (!body || !meta?.dynamic) continue;
      body.setPosition(sp.x, sp.y);
      body.setAngle(sp.angle);
      body.setAngularVelocity(sp.av);
      body.setVelocity(0, 0);
    }

    if (this.ball && snap.ball) {
      this.ball.setPosition(snap.ball.x, snap.ball.y);
      this.ball.setVelocity(snap.ball.vx, snap.ball.vy);
    }
  }

  destroy() {
    // Planck worlds are GC'd with their bodies; drop refs.
    this.players = [];
    this.platforms = [];
    this.arrows = [];
    this.ball = null;
    this.goals = [];
    this.pivotJoints = [];
  }
}

function spawnAllowsTeam(spawn: SpawnDef, team: number): boolean {
  if (team <= 1) return spawn.ffa !== false;
  if (team === 2) return spawn.red !== false;
  if (team === 3) return spawn.blue !== false;
  if (team === 4) return spawn.green !== false;
  if (team === 5) return spawn.yellow !== false;
  return true;
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
