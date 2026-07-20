// src/game/tutorialPhysics.ts
var TUTORIAL_MASS = 3;
var TUTORIAL_DT = 0.1;
var TUTORIAL_G = 9.8;
var TUTORIAL_THRUST = 15;
function createTutorialState(x = 0, y = 0, vx = 0, vy = 0) {
  return { x, y, vx, vy, deltaVx: 0, deltaVy: 0 };
}
function tutorialDrawStep(state, input, mass = TUTORIAL_MASS, blobRadius, width) {
  state.vx += state.deltaVx;
  state.vy += state.deltaVy;
  state.x += state.vx * TUTORIAL_DT;
  state.y += state.vy * TUTORIAL_DT;
  let Fy = 0;
  if (input.down) {
    Fy = -TUTORIAL_THRUST;
  }
  if (input.up) {
    Fy = TUTORIAL_THRUST;
  }
  const Fnety = Fy - mass * TUTORIAL_G;
  const ay = Fnety / mass;
  state.deltaVy = ay * TUTORIAL_DT;
  if (state.y - blobRadius < 0 && state.x > 0 && state.x < width) {
    state.vy = -state.vy;
  }
  let Fx = 0;
  if (input.left) {
    Fx = -TUTORIAL_THRUST;
  }
  if (input.right) {
    Fx = TUTORIAL_THRUST;
  }
  const Fnetx = Fx;
  const ax = Fnetx / mass;
  state.deltaVx = ax * TUTORIAL_DT;
}
function tutorialToMatter(state, floorMatterY) {
  return {
    x: state.x,
    y: floorMatterY - state.y
  };
}
function matterToTutorialY(matterY, floorMatterY) {
  return floorMatterY - matterY;
}
export {
  TUTORIAL_DT,
  TUTORIAL_G,
  TUTORIAL_MASS,
  TUTORIAL_THRUST,
  createTutorialState,
  matterToTutorialY,
  tutorialDrawStep,
  tutorialToMatter
};
