import type { InputState } from "../types";
import { emptyInput } from "./engine";

export class InputManager {
  primary: InputState = emptyInput();
  secondary: InputState = emptyInput();
  private bound = false;
  twoPlayer = false;

  bind(twoPlayer = false) {
    this.twoPlayer = twoPlayer;
    if (this.bound) return;
    this.bound = true;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  unbind() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.bound = false;
    this.primary = emptyInput();
    this.secondary = emptyInput();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
      e.preventDefault();
    }
    this.apply(e.code, true);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.apply(e.code, false);
  };

  private apply(code: string, pressed: boolean) {
    const p = this.primary;
    const s = this.secondary;
    switch (code) {
      case "ArrowLeft":
        p.left = pressed;
        break;
      case "ArrowRight":
        p.right = pressed;
        break;
      case "ArrowUp":
        p.up = pressed;
        break;
      case "ArrowDown":
        p.down = pressed;
        break;
      case "KeyX":
      case "ShiftLeft":
      case "ShiftRight":
      case "Space":
        p.heavy = pressed;
        break;
      case "KeyZ":
      case "KeyY":
        p.special = pressed;
        break;
      case "KeyA":
        if (this.twoPlayer) s.left = pressed;
        else p.left = pressed;
        break;
      case "KeyD":
        if (this.twoPlayer) s.right = pressed;
        else p.right = pressed;
        break;
      case "KeyW":
        if (this.twoPlayer) s.up = pressed;
        else p.up = pressed;
        break;
      case "KeyS":
        if (this.twoPlayer) s.down = pressed;
        else p.down = pressed;
        break;
      case "KeyC":
        s.heavy = pressed;
        break;
      case "KeyV":
        s.special = pressed;
        break;
    }
  }
}
