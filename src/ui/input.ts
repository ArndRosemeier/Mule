/** Keyboard state: held keys plus presses since the last frame. */
export class Keyboard {
  private held = new Set<string>();
  private pressed: string[] = [];

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = norm(e.key);
      if (['up', 'down', 'left', 'right', 'space'].includes(k)) e.preventDefault();
      if (!e.repeat) this.pressed.push(k);
      this.held.add(k);
    });
    target.addEventListener('keyup', (e) => this.held.delete(norm(e.key)));
    target.addEventListener('blur', () => this.held.clear());
  }

  down(...keys: string[]): boolean {
    return keys.some((k) => this.held.has(k));
  }

  /** Presses since the last call. */
  take(): string[] {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }

  axis(): { x: number; y: number } {
    const x = (this.down('right', 'd') ? 1 : 0) - (this.down('left', 'a') ? 1 : 0);
    const y = (this.down('down', 's') ? 1 : 0) - (this.down('up', 'w') ? 1 : 0);
    return { x, y };
  }
}

function norm(key: string): string {
  switch (key) {
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case ' ': case 'Spacebar': return 'space';
    case 'Enter': return 'enter';
    case 'Escape': return 'escape';
    default: return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  }
}
