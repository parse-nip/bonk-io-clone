import type { InputState } from "../types";
import { emptyInput } from "./engine";

export class InputManager {
  primary: InputState = emptyInput();
  secondary: InputState = emptyInput();
  private bound = false;

  bind() {
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
        s.left = pressed;
        break;
      case "KeyD":
        s.right = pressed;
        break;
      case "KeyW":
        s.up = pressed;
        break;
      case "KeyS":
        s.down = pressed;
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
