/**
 * Exact bonk_v6 tutorial physics from the OSU college assignment draw() loop.
 * Constants and integration order match the reference sketch verbatim.
 */

export const TUTORIAL_MASS = 3.0;
export const TUTORIAL_DT = 0.1;
export const TUTORIAL_G = 9.8;
export const TUTORIAL_THRUST = 15;

export interface TutorialState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  deltaVx: number;
  deltaVy: number;
}

export interface TutorialInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export function createTutorialState(
  x = 0,
  y = 0,
  vx = 0,
  vy = 0,
): TutorialState {
  return { x, y, vx, vy, deltaVx: 0, deltaVy: 0 };
}

/**
 * One frame of the tutorial draw() physics — copied verbatim from bonk_v6.
 */
export function tutorialDrawStep(
  state: TutorialState,
  input: TutorialInput,
  mass: number = TUTORIAL_MASS,
  blobRadius: number,
  width: number,
): void {
  // Update velocity
  state.vx += state.deltaVx;
  state.vy += state.deltaVy;

  // Update location
  state.x += state.vx * TUTORIAL_DT;
  state.y += state.vy * TUTORIAL_DT;

  // Vertical forces
  let Fy = 0;
  if (input.down) {
    Fy = -TUTORIAL_THRUST;
  }
  if (input.up) {
    Fy = TUTORIAL_THRUST;
  }
  const Fnety = Fy - mass * TUTORIAL_G; // why the extra step?
  const ay = Fnety / mass;
  state.deltaVy = ay * TUTORIAL_DT;

  // Bounce
  if (state.y - blobRadius < 0 && state.x > 0 && state.x < width) {
    state.vy = -state.vy;
  }

  // Horizontal forces
  let Fx = 0;
  if (input.left) {
    Fx = -TUTORIAL_THRUST;
  }
  if (input.right) {
    Fx = TUTORIAL_THRUST;
  }
  const Fnetx = Fx; // why the extra step?
  const ax = Fnetx / mass;
  state.deltaVx = ax * TUTORIAL_DT;
}

/** Tutorial y-up coords → Matter.js (y-down) for the game canvas. */
export function tutorialToMatter(
  state: TutorialState,
  floorMatterY: number,
): { x: number; y: number } {
  return {
    x: state.x,
    y: floorMatterY - state.y,
  };
}

export function matterToTutorialY(matterY: number, floorMatterY: number): number {
  return floorMatterY - matterY;
}
