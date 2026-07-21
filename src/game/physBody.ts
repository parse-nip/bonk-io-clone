import {
  type Body,
  type Fixture,
  type Vec2Value,
  Circle,
  Box,
  Polygon,
  Vec2,
} from "planck";

/**
 * Thin adapter so game/render code can keep a Matter-like body surface
 * while the sim runs on Box2D (Planck.js).
 */
export class PhysBody {
  raw: Body;
  fillColor?: string;
  label: string;
  /** Local-space polygon/box verts for rendering (Circle uses empty). */
  private localVerts: Vec2Value[];
  private shapeKind: "circle" | "polygon";
  radius = 0;

  constructor(
    raw: Body,
    opts: {
      label: string;
      fillColor?: string;
      localVerts?: Vec2Value[];
      shapeKind: "circle" | "polygon";
      radius?: number;
    },
  ) {
    this.raw = raw;
    this.label = opts.label;
    this.fillColor = opts.fillColor;
    this.localVerts = opts.localVerts ?? [];
    this.shapeKind = opts.shapeKind;
    this.radius = opts.radius ?? 0;
  }

  get position(): { x: number; y: number } {
    const p = this.raw.getPosition();
    return { x: p.x, y: p.y };
  }

  get velocity(): { x: number; y: number } {
    const v = this.raw.getLinearVelocity();
    return { x: v.x, y: v.y };
  }

  get angle(): number {
    return this.raw.getAngle();
  }

  get angularVelocity(): number {
    return this.raw.getAngularVelocity();
  }

  get mass(): number {
    return this.raw.getMass();
  }

  get isStatic(): boolean {
    return this.raw.getType() === "static";
  }

  get vertices(): { x: number; y: number }[] {
    const pos = this.raw.getPosition();
    const ang = this.raw.getAngle();
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    if (this.shapeKind === "circle") {
      const r = this.radius;
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        pts.push({ x: pos.x + Math.cos(a) * r, y: pos.y + Math.sin(a) * r });
      }
      return pts;
    }
    return this.localVerts.map((v) => ({
      x: pos.x + v.x * c - v.y * s,
      y: pos.y + v.x * s + v.y * c,
    }));
  }

  get bounds(): {
    min: { x: number; y: number };
    max: { x: number; y: number };
  } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const v of this.vertices) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
    }
    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
  }

  setPosition(x: number, y: number) {
    this.raw.setPosition(new Vec2(x, y));
    this.raw.setAwake(true);
  }

  setVelocity(x: number, y: number) {
    this.raw.setLinearVelocity(new Vec2(x, y));
    this.raw.setAwake(true);
  }

  setAngle(a: number) {
    this.raw.setAngle(a);
    this.raw.setAwake(true);
  }

  setAngularVelocity(w: number) {
    this.raw.setAngularVelocity(w);
    this.raw.setAwake(true);
  }

  setMass(mass: number) {
    if (mass <= 0) return;
    const md = { mass: 0, center: { x: 0, y: 0 }, I: 0 };
    this.raw.getMassData(md);
    const scale = mass / (md.mass || mass);
    md.mass = mass;
    md.I *= scale;
    this.raw.setMassData(md);
  }

  setDensity(density: number) {
    for (let f = this.raw.getFixtureList(); f; f = f.getNext()) {
      f.setDensity(density);
    }
    this.raw.resetMassData();
  }

  setStatic(isStatic: boolean) {
    this.raw.setType(isStatic ? "static" : "dynamic");
    if (!isStatic) this.raw.setAwake(true);
  }

  applyForce(fx: number, fy: number) {
    this.raw.applyForceToCenter(new Vec2(fx, fy), true);
  }

  fixture(): Fixture | null {
    return this.raw.getFixtureList();
  }
}

export function createCircleBody(
  body: Body,
  radius: number,
  fixture: {
    density: number;
    friction: number;
    restitution: number;
    isSensor?: boolean;
  },
  meta: { label: string; fillColor?: string },
): PhysBody {
  body.createFixture({
    shape: new Circle(radius),
    density: fixture.density,
    friction: fixture.friction,
    restitution: fixture.restitution,
    isSensor: !!fixture.isSensor,
  });
  return new PhysBody(body, {
    label: meta.label,
    fillColor: meta.fillColor,
    shapeKind: "circle",
    radius,
  });
}

export function createBoxBody(
  body: Body,
  hx: number,
  hy: number,
  fixture: {
    density: number;
    friction: number;
    restitution: number;
    isSensor?: boolean;
  },
  meta: { label: string; fillColor?: string },
): PhysBody {
  body.createFixture({
    shape: new Box(hx, hy),
    density: fixture.density,
    friction: fixture.friction,
    restitution: fixture.restitution,
    isSensor: !!fixture.isSensor,
  });
  return new PhysBody(body, {
    label: meta.label,
    fillColor: meta.fillColor,
    shapeKind: "polygon",
    localVerts: [
      { x: -hx, y: -hy },
      { x: hx, y: -hy },
      { x: hx, y: hy },
      { x: -hx, y: hy },
    ],
  });
}

export function createPolygonBody(
  body: Body,
  localVerts: Vec2Value[],
  fixture: {
    density: number;
    friction: number;
    restitution: number;
    isSensor?: boolean;
  },
  meta: { label: string; fillColor?: string },
): PhysBody {
  body.createFixture({
    shape: new Polygon(localVerts.map((v) => new Vec2(v.x, v.y))),
    density: fixture.density,
    friction: fixture.friction,
    restitution: fixture.restitution,
    isSensor: !!fixture.isSensor,
  });
  return new PhysBody(body, {
    label: meta.label,
    fillColor: meta.fillColor,
    shapeKind: "polygon",
    localVerts: localVerts.map((v) => ({ x: v.x, y: v.y })),
  });
}

export function bodiesOverlap(a: PhysBody, b: PhysBody): boolean {
  const ab = a.bounds;
  const bb = b.bounds;
  return !(
    ab.max.x < bb.min.x ||
    ab.min.x > bb.max.x ||
    ab.max.y < bb.min.y ||
    ab.min.y > bb.max.y
  );
}

export function distBetween(a: PhysBody, b: PhysBody): number {
  const dx = a.position.x - b.position.x;
  const dy = a.position.y - b.position.y;
  return Math.hypot(dx, dy);
}
