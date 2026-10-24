// Keyboard + mouse → InputMsg (PRD 4.2). WASD is rotated 45° so "up" on the
// keyboard is "up" on the isometric screen.

import type { InputMsg } from "../shared/types";

const INV = Math.SQRT1_2;

export class InputController {
  private keys = new Set<string>();
  private lmb = false;
  private rmb = false;
  private clickQueued = false;
  private parryQueued = false;
  private pickupQueued = false;
  private useQueued = -1;
  private seq = 0;
  mouseX = 0;
  mouseY = 0;
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    el.addEventListener("mousemove", this.onMove);
    el.addEventListener("mousedown", this.onDown);
    window.addEventListener("mouseup", this.onUp);
    el.addEventListener("contextmenu", this.prevent);
  }

  private prevent = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.code;
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(k)) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(k);
    if (k === "Space") this.parryQueued = true;
    if (k === "KeyF" || k === "KeyE") this.pickupQueued = true;
    const m = /^Digit([1-6])$/.exec(k);
    if (m) this.useQueued = Number(m[1]) - 1;
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => { this.keys.clear(); this.lmb = this.rmb = false; };
  private onMove = (e: MouseEvent) => { this.mouseX = e.clientX; this.mouseY = e.clientY; };
  private onDown = (e: MouseEvent) => {
    this.mouseX = e.clientX; this.mouseY = e.clientY;
    if (e.button === 0) { this.lmb = true; this.clickQueued = true; }
    if (e.button === 2) this.rmb = true;
  };
  private onUp = (e: MouseEvent) => {
    if (e.button === 0) this.lmb = false;
    if (e.button === 2) this.rmb = false;
  };

  /** Queue a bag-slot use from the HUD (clicking a slot). */
  queueUse(slot: number) { this.useQueued = slot; }

  build(aim: { x: number; z: number }): InputMsg {
    const k = this.keys;
    const up = k.has("KeyW") || k.has("ArrowUp") ? 1 : 0;
    const down = k.has("KeyS") || k.has("ArrowDown") ? 1 : 0;
    const left = k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0;
    const right = k.has("KeyD") || k.has("ArrowRight") ? 1 : 0;
    const sy = up - down, sx = right - left;
    // Screen up = world (-1, -1)/√2, screen right = world (1, -1)/√2.
    const mx = (sx - sy) * INV;
    const mz = (-sx - sy) * INV;
    const msg: InputMsg = {
      seq: ++this.seq,
      mx, mz,
      ax: aim.x, az: aim.z,
      attack: this.lmb || this.clickQueued,
      defend: this.rmb || k.has("ShiftLeft"),
      parry: this.parryQueued,
      interact: k.has("KeyF") || k.has("KeyE"),
      pickup: this.pickupQueued,
      use: this.useQueued,
    };
    this.clickQueued = this.parryQueued = this.pickupQueued = false;
    this.useQueued = -1;
    return msg;
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.el.removeEventListener("mousemove", this.onMove);
    this.el.removeEventListener("mousedown", this.onDown);
    window.removeEventListener("mouseup", this.onUp);
    this.el.removeEventListener("contextmenu", this.prevent);
  }
}
