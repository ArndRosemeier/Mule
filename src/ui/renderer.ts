/**
 * Canvas renderer for the map, the town and the auction floor. It only reads
 * game state; anything purely visual (interpolation, the MULE trailing behind
 * its owner, floating text) lives here.
 */
import {
  MAP_COLS, PLOT_H, PLOT_W, SCENE_H, SCENE_W, TOWN_INDEX,
} from '../core/constants';
import { BUILDINGS, STREET_BOTTOM, STREET_MID, STREET_TOP, TOWN_RECT, DOOR_HALF_W } from '../core/town';
import { bestAsk, bestBid } from '../core/auction';
import type { DevTurn, GameState, GoodsAuction, Plot, Resource, Vec } from '../core/types';
import { images, iconImg, speciesImg, RESOURCE_COLORS } from './assets';
import { storeSellPrice } from '../core/economy';

interface FloatText { x: number; y: number; text: string; color: string; born: number; scene: 'map' | 'town' | 'any' }

export interface ViewInfo {
  /** The local human player, for assay markers and highlights. */
  localPlayer: number | null;
  now: number;
  /** 0..1 between the previous and the current tick. */
  alpha: number;
}

const DOOR_LABEL: Record<string, string> = {
  food: 'Food', energy: 'Energy', smithore: 'Smithore', crystite: 'Crystite',
  corral: 'MULE Corral', pub: 'Pub', land: 'Land Office', assay: 'Assay Office',
};

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private mapLayer: HTMLCanvasElement | null = null;
  private townLayer: HTMLCanvasElement | null = null;
  private mapKey = '';
  private prevPos: Vec | null = null;
  private curPos: Vec | null = null;
  private lastTurnKey = '';
  private mulePos: Vec | null = null;
  private walkPhase = 0;
  private floats: FloatText[] = [];
  private flashes: { a: number; b: number; born: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.mapLayer = null;
      this.townLayer = null;
    }
    this.scale = w / SCENE_W;
  }

  /** Call once per game tick so the avatar can be interpolated between ticks. */
  onTick(state: GameState): void {
    const turn = state.phase.kind === 'development' ? state.phase.turn : null;
    if (!turn) { this.prevPos = this.curPos = null; return; }
    const key = `${state.round}:${turn.playerId}:${turn.scene}`;
    if (key !== this.lastTurnKey) {
      this.lastTurnKey = key;
      this.prevPos = { ...turn.pos };
      this.curPos = { ...turn.pos };
      this.mulePos = null;
      return;
    }
    this.prevPos = this.curPos ?? { ...turn.pos };
    this.curPos = { ...turn.pos };
  }

  floatText(x: number, y: number, text: string, color = '#ffd25e', scene: FloatText['scene'] = 'any'): void {
    this.floats.push({ x, y, text, color, born: performance.now(), scene });
  }

  tradeFlash(a: number, b: number): void {
    this.flashes.push({ a, b, born: performance.now() });
  }

  draw(state: GameState, view: ViewInfo): void {
    this.resize();
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    const ph = state.phase;
    if (ph.kind === 'auction') {
      this.drawAuction(state, ph.auction, view);
    } else if (ph.kind === 'development' && ph.turn.scene === 'town' && ph.turn.stage !== 'intro') {
      this.drawTown(state, ph.turn, view);
    } else {
      this.drawMap(state, view);
    }
    this.drawFloats(ph.kind === 'development' ? ph.turn.scene : 'map');
  }

  // ---------------------------------------------------------------- map

  private buildMapLayer(state: GameState): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    g.imageSmoothingQuality = 'high';
    for (const p of state.map) {
      const x = p.col * PLOT_W, y = p.row * PLOT_H;
      const tile = p.terrain === 'river' ? images.river : p.terrain === 'town' ? images.townTile : images.plain;
      // Sample a different region of the plain texture per plot so the map doesn't look tiled.
      if (tile === images.plain && tile?.naturalWidth) {
        const s = tile.naturalWidth / 2;
        const ox = ((p.col * 37 + p.row * 71) % 2) * (s / 2);
        const oy = ((p.col * 13 + p.row * 29) % 2) * (s / 2);
        g.drawImage(tile, ox, oy, s, s, x, y, PLOT_W + 0.5, PLOT_H + 0.5);
      } else if (tile?.naturalWidth) {
        g.drawImage(tile, x, y, PLOT_W + 0.5, PLOT_H + 0.5);
      }
    }
    // Mountains, drawn back to front so peaks overlap nicely.
    for (const p of state.map) {
      if (!p.terrain.startsWith('mountain')) continue;
      const img = images[p.terrain];
      if (!img?.naturalWidth) continue;
      const w = p.terrain === 'mountain1' ? 78 : p.terrain === 'mountain2' ? 88 : 96;
      const h = (img.naturalHeight / img.naturalWidth) * w;
      g.drawImage(img, p.col * PLOT_W + (PLOT_W - w) / 2, p.row * PLOT_H + PLOT_H - h - 6, w, h);
    }
    // The town on its plot: a little cluster of the shop buildings.
    const tx = TOWN_RECT.x, ty = TOWN_RECT.y;
    g.fillStyle = 'rgba(30, 22, 40, 0.25)';
    g.fillRect(tx, ty, PLOT_W, PLOT_H);
    const minis: [string, number, number, number][] = [
      ['b_food', 6, 8, 30], ['b_energy', 36, 6, 30], ['b_smithore', 66, 8, 30],
      ['b_corral', 4, 54, 32], ['b_pub', 36, 56, 28], ['b_assay', 66, 54, 30],
    ];
    for (const [key, mx, my, w] of minis) {
      const img = images[key];
      if (!img?.naturalWidth) continue;
      g.drawImage(img, tx + mx, ty + my, w, (img.naturalHeight / img.naturalWidth) * w);
    }
    // Grid.
    g.strokeStyle = 'rgba(40, 18, 8, 0.28)';
    g.lineWidth = 1;
    for (let c2 = 1; c2 < MAP_COLS; c2++) { g.beginPath(); g.moveTo(c2 * PLOT_W, 0); g.lineTo(c2 * PLOT_W, SCENE_H); g.stroke(); }
    for (let r = 1; r < 5; r++) { g.beginPath(); g.moveTo(0, r * PLOT_H); g.lineTo(SCENE_W, r * PLOT_H); g.stroke(); }
    // Soft vignette.
    const vg = g.createRadialGradient(SCENE_W / 2, SCENE_H / 2, SCENE_H * 0.4, SCENE_W / 2, SCENE_H / 2, SCENE_W * 0.65);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(20,8,0,0.35)');
    g.fillStyle = vg;
    g.fillRect(0, 0, SCENE_W, SCENE_H);
    return c;
  }

  private drawMap(state: GameState, view: ViewInfo): void {
    const ctx = this.ctx;
    const key = `${this.canvas.width}x${this.canvas.height}:${state.config.seed}`;
    if (!this.mapLayer || this.mapKey !== key) {
      this.mapLayer = this.buildMapLayer(state);
      this.mapKey = key;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.mapLayer, 0, 0);
    ctx.restore();

    const ph = state.phase;
    const t = view.now / 1000;

    for (const p of state.map) this.drawPlotOverlay(state, p, view);

    if (ph.kind === 'landGrant' && !ph.done && ph.cursor >= 0) {
      const p = state.map[ph.cursor]!;
      const pulse = 0.55 + 0.45 * Math.sin(t * 10);
      ctx.save();
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 18;
      ctx.strokeStyle = `rgba(255,255,255,${0.7 + 0.3 * pulse})`;
      ctx.lineWidth = 4;
      roundRect(ctx, p.col * PLOT_W + 3, p.row * PLOT_H + 3, PLOT_W - 6, PLOT_H - 6, 8);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = `rgba(255,255,255,${0.08 + 0.08 * pulse})`;
      ctx.fillRect(p.col * PLOT_W, p.row * PLOT_H, PLOT_W, PLOT_H);
    }
    if (ph.kind === 'landAuction') {
      const p = state.map[ph.auction.plot]!;
      const pulse = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.save();
      ctx.shadowColor = '#ffb547';
      ctx.shadowBlur = 20;
      ctx.strokeStyle = `rgba(255,181,71,${0.6 + 0.4 * pulse})`;
      ctx.lineWidth = 4;
      roundRect(ctx, p.col * PLOT_W + 3, p.row * PLOT_H + 3, PLOT_W - 6, PLOT_H - 6, 8);
      ctx.stroke();
      ctx.restore();
    }
    if (ph.kind === 'production' && ph.colonyEvent) this.drawEventMarker(state, ph.colonyEvent, t);

    if (ph.kind === 'development') {
      const turn = ph.turn;
      if (ph.wampus?.visible) {
        const c = { x: (ph.wampus.plot % MAP_COLS) * PLOT_W + PLOT_W / 2, y: Math.floor(ph.wampus.plot / MAP_COLS) * PLOT_H + PLOT_H / 2 };
        const img = images.wampus;
        ctx.save();
        ctx.shadowColor = '#c08bff';
        ctx.shadowBlur = 24;
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 20);
        if (img?.naturalWidth) ctx.drawImage(img, c.x - 16, c.y - 30, 32, (img.naturalHeight / img.naturalWidth) * 32);
        ctx.restore();
      }
      if (turn.scene === 'map' && turn.stage !== 'intro') this.drawAvatar(state, turn, view, 46);
    }
  }

  private drawPlotOverlay(state: GameState, p: Plot, view: ViewInfo): void {
    const ctx = this.ctx;
    const x = p.col * PLOT_W, y = p.row * PLOT_H;
    if (p.index === TOWN_INDEX) return;
    if (p.owner !== null) {
      const color = state.players[p.owner]!.color;
      ctx.fillStyle = hexA(color, 0.14);
      ctx.fillRect(x, y, PLOT_W, PLOT_H);
      ctx.strokeStyle = hexA(color, 0.95);
      ctx.lineWidth = 3;
      roundRect(ctx, x + 2.5, y + 2.5, PLOT_W - 5, PLOT_H - 5, 6);
      ctx.stroke();
      // Corner flag.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + 2);
      ctx.lineTo(x + 20, y + 2);
      ctx.lineTo(x + 2, y + 20);
      ctx.closePath();
      ctx.fill();
    }
    if (p.mule) {
      const mule = images.mule;
      if (mule?.naturalWidth) {
        const w = 30;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        ctx.drawImage(mule, x + 8, y + PLOT_H - 8 - (mule.naturalHeight / mule.naturalWidth) * w, w, (mule.naturalHeight / mule.naturalWidth) * w);
        ctx.restore();
      }
      this.badgeIcon(p.mule, x + PLOT_W - 22, y + 20, 15);
      if (p.lastProduction !== null && (state.phase.kind === 'production' || state.phase.kind === 'auction')) {
        this.productionDots(p.lastProduction, x + 46, y + PLOT_H - 14, RESOURCE_COLORS[p.mule]);
      }
    }
    if (view.localPlayer !== null && state.players[view.localPlayer]!.assayed.includes(p.index)) {
      const lvl = p.crystite;
      ctx.fillStyle = 'rgba(20,10,40,0.7)';
      roundRect(ctx, x + 6, y + 26, 30, 16, 5);
      ctx.fill();
      ctx.fillStyle = '#d4b8ff';
      ctx.font = '700 10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`◆${lvl}`, x + 10, y + 34);
    }
  }

  private badgeIcon(r: Resource, cx: number, cy: number, radius: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(16,12,28,0.78)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = RESOURCE_COLORS[r];
    ctx.lineWidth = 2;
    ctx.stroke();
    const img = iconImg(r);
    if (img?.naturalWidth) ctx.drawImage(img, cx - radius * 0.75, cy - radius * 0.75, radius * 1.5, radius * 1.5);
  }

  private productionDots(n: number, x: number, y: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(16,12,28,0.75)';
    roundRect(ctx, x - 4, y - 8, 50, 16, 8);
    ctx.fill();
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i < n ? color : 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(x + 3 + i * 5.6, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawEventMarker(state: GameState, ev: NonNullable<Extract<GameState['phase'], { kind: 'production' }>['colonyEvent']>, t: number): void {
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    if (ev.plot !== undefined) {
      const p = state.map[ev.plot]!;
      ctx.strokeStyle = `rgba(255,90,90,${0.5 + 0.5 * pulse})`;
      ctx.lineWidth = 4;
      roundRect(ctx, p.col * PLOT_W + 4, p.row * PLOT_H + 4, PLOT_W - 8, PLOT_H - 8, 8);
      ctx.stroke();
    }
    if (ev.row !== undefined) {
      ctx.fillStyle = `rgba(120,200,255,${0.1 + 0.08 * pulse})`;
      ctx.fillRect(0, ev.row * PLOT_H, SCENE_W, PLOT_H);
    }
  }

  // ---------------------------------------------------------------- town

  private buildTownLayer(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    g.imageSmoothingQuality = 'high';
    // Ground.
    const tile = images.townTile;
    if (tile?.naturalWidth) {
      for (let x = 0; x < SCENE_W; x += 150) for (let y = 0; y < SCENE_H; y += 150) g.drawImage(tile, x, y, 150.5, 150.5);
    } else {
      g.fillStyle = '#d9c3a0';
      g.fillRect(0, 0, SCENE_W, SCENE_H);
    }
    g.fillStyle = 'rgba(60, 40, 30, 0.18)';
    g.fillRect(0, 0, SCENE_W, SCENE_H);
    // Street.
    const grad = g.createLinearGradient(0, STREET_TOP, 0, STREET_BOTTOM);
    grad.addColorStop(0, '#4a3c4f');
    grad.addColorStop(0.5, '#3d3144');
    grad.addColorStop(1, '#4a3c4f');
    g.fillStyle = grad;
    g.fillRect(0, STREET_TOP, SCENE_W, STREET_BOTTOM - STREET_TOP);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, STREET_TOP, SCENE_W, 3);
    g.fillRect(0, STREET_BOTTOM - 3, SCENE_W, 3);
    g.setLineDash([18, 16]);
    g.strokeStyle = 'rgba(255,220,150,0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, STREET_MID);
    g.lineTo(SCENE_W, STREET_MID);
    g.stroke();
    g.setLineDash([]);
    // Buildings.
    for (const b of BUILDINGS) {
      const img = images[`b_${b.kind}`];
      if (!img?.naturalWidth) continue;
      const maxW = b.w + 10, maxH = b.h - 6;
      let w = maxW;
      let h = (img.naturalHeight / img.naturalWidth) * w;
      if (h > maxH) { h = maxH; w = (img.naturalWidth / img.naturalHeight) * h; }
      const x = b.doorX - w / 2;
      const y = b.side === 'top' ? STREET_TOP - h - 4 : SCENE_H - h - 6;
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.35)';
      g.shadowBlur = 14;
      g.shadowOffsetY = 6;
      g.drawImage(img, x, y, w, h);
      g.restore();
    }
    // Exit arrows.
    g.font = '800 14px Inter, sans-serif';
    g.textBaseline = 'middle';
    for (const [x, label] of [[4, '◀'], [SCENE_W - 22, '▶']] as const) {
      g.fillStyle = 'rgba(16,12,28,0.6)';
      g.beginPath();
      g.roundRect(x, STREET_MID - 13, 18, 26, 6);
      g.fill();
      g.fillStyle = 'rgba(255,240,210,0.85)';
      g.textAlign = 'center';
      g.fillText(label, x + 9, STREET_MID + 1);
    }
    return c;
  }

  private drawTown(state: GameState, turn: DevTurn, view: ViewInfo): void {
    const ctx = this.ctx;
    if (!this.townLayer) this.townLayer = this.buildTownLayer();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.townLayer, 0, 0);
    ctx.restore();
    const t = view.now / 1000;
    const store = state.store;
    for (const b of BUILDINGS) {
      // Door pad.
      const y = b.side === 'top' ? STREET_TOP - 6 : STREET_BOTTOM - 6;
      const active = turn.inDoor === b.kind;
      const glow = 0.35 + 0.2 * Math.sin(t * 3 + b.doorX);
      ctx.fillStyle = active ? 'rgba(63,224,197,0.9)' : `rgba(63,224,197,${glow})`;
      roundRect(ctx, b.doorX - DOOR_HALF_W, y, DOOR_HALF_W * 2, 12, 6);
      ctx.fill();
      // Sign.
      let label = DOOR_LABEL[b.kind]!;
      let sub = '';
      if (b.kind === 'corral') sub = store.mules > 0 ? `$${store.mulePrice} · ${store.mules} left` : 'sold out';
      else if (b.kind === 'food' || b.kind === 'energy' || b.kind === 'smithore' || b.kind === 'crystite') {
        sub = b.kind === 'crystite' && state.config.difficulty === 'beginner' ? 'closed' : `outfit $${({ food: 25, energy: 50, smithore: 75, crystite: 100 } as const)[b.kind]}`;
        label = `${label} outfitter`;
      } else if (b.kind === 'pub') sub = 'gamble & end turn';
      else if (b.kind === 'assay') sub = 'bring a soil sample';
      else if (b.kind === 'land') sub = 'sell a plot';
      const sy = b.side === 'top' ? STREET_TOP + 14 : STREET_BOTTOM - 30;
      ctx.font = '800 11px Inter, sans-serif';
      const w = Math.max(ctx.measureText(label).width, (ctx.font = '600 10px Inter, sans-serif', ctx.measureText(sub).width)) + 18;
      ctx.fillStyle = 'rgba(16,12,28,0.78)';
      roundRect(ctx, b.doorX - w / 2, sy, w, 28, 7);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#fff3dd';
      ctx.font = '800 11px Inter, sans-serif';
      ctx.fillText(label, b.doorX, sy + 3);
      ctx.fillStyle = b.kind === 'corral' && store.mules === 0 ? '#ff8b8b' : '#9de8da';
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillText(sub, b.doorX, sy + 15);
    }
    if (turn.stage !== 'intro') this.drawAvatar(state, turn, view, 66);
  }

  // ---------------------------------------------------------------- avatar

  private drawAvatar(state: GameState, turn: DevTurn, view: ViewInfo, height: number): void {
    const ctx = this.ctx;
    const player = state.players[turn.playerId]!;
    const a = view.alpha;
    const pos = this.prevPos && this.curPos
      ? { x: this.prevPos.x + (this.curPos.x - this.prevPos.x) * a, y: this.prevPos.y + (this.curPos.y - this.prevPos.y) * a }
      : turn.pos;
    const moving = this.prevPos && this.curPos ? Math.hypot(this.curPos.x - this.prevPos.x, this.curPos.y - this.prevPos.y) > 0.3 : false;
    if (moving) this.walkPhase += 0.25;
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 3 : Math.sin(view.now / 400) * 0.8;

    // MULE trailing behind.
    if (turn.mule) {
      const target = { x: pos.x - turn.facing * height * 0.55, y: pos.y + 2 };
      if (!this.mulePos) this.mulePos = { ...target };
      this.mulePos.x += (target.x - this.mulePos.x) * 0.18;
      this.mulePos.y += (target.y - this.mulePos.y) * 0.18;
      const frame = moving && Math.floor(this.walkPhase / 1.6) % 2 === 1 ? images.muleWalk : images.mule;
      const base = images.mule;
      if (frame?.naturalWidth && base?.naturalWidth) {
        const mh = height * 0.78;
        const scale = mh / base.naturalHeight;
        const mw = frame.naturalWidth * scale;
        this.shadow(this.mulePos.x, this.mulePos.y, mw * 0.4);
        ctx.save();
        ctx.translate(this.mulePos.x, this.mulePos.y);
        if (turn.facing < 0) ctx.scale(-1, 1);
        ctx.drawImage(frame, -mw / 2, -frame.naturalHeight * scale, mw, frame.naturalHeight * scale);
        ctx.restore();
        if (turn.mule.outfit) this.badgeIcon(turn.mule.outfit, this.mulePos.x, this.mulePos.y - mh - 10, 10);
        else {
          ctx.fillStyle = 'rgba(16,12,28,0.8)';
          ctx.beginPath();
          ctx.arc(this.mulePos.x, this.mulePos.y - mh - 10, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = '800 11px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', this.mulePos.x, this.mulePos.y - mh - 10);
        }
      }
    } else {
      this.mulePos = null;
    }

    // Player ring.
    ctx.save();
    ctx.strokeStyle = player.color;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = player.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, height * 0.32, height * 0.11, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    this.shadow(pos.x, pos.y, height * 0.28);

    const img = speciesImg(player.species);
    if (img?.naturalWidth) {
      const h = height;
      const w = (img.naturalWidth / img.naturalHeight) * h;
      ctx.save();
      ctx.translate(pos.x, pos.y - bob);
      if (turn.facing < 0) ctx.scale(-1, 1);
      ctx.drawImage(img, -w / 2, -h, w, h);
      ctx.restore();
    }
    if (turn.sample !== null) {
      ctx.fillStyle = '#b58cff';
      ctx.beginPath();
      ctx.arc(pos.x + 12, pos.y - height - 4, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private shadow(x: number, y: number, rx: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------------------------------------------------------------- auction

  laneX(index: number, count: number): number {
    const left = 170, right = SCENE_W - 60;
    return count <= 1 ? (left + right) / 2 : left + ((right - left) * index) / (count - 1);
  }

  private drawAuction(state: GameState, a: GoodsAuction, view: ViewInfo): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, SCENE_H);
    g.addColorStop(0, '#2a1f3f');
    g.addColorStop(1, '#171224');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SCENE_W, SCENE_H);

    const top = 70, bottom = 440;
    const lo = a.floor - 8, hi = a.ceiling + 8;
    const yOf = (price: number) => bottom - ((price - lo) / (hi - lo)) * (bottom - top);

    // Price grid.
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const step = niceStep(hi - lo);
    for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
      const y = yOf(p);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(70, y);
      ctx.lineTo(SCENE_W - 20, y);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(`$${p}`, 62, y);
    }
    const color = RESOURCE_COLORS[a.resource];
    // Store lines.
    const storeHas = state.store.stock[a.resource] > 0;
    this.priceLine(yOf(a.storeSell), storeHas ? color : 'rgba(255,255,255,0.25)', storeHas ? `Store sells @ $${a.storeSell} · ${state.store.stock[a.resource]} left` : `Store sold out (was $${storeSellPrice(state, a.resource)})`, !storeHas);
    this.priceLine(yOf(a.floor), '#9de8da', `Store buys @ $${a.floor}`, false);

    // Resource icon watermark.
    const icon = iconImg(a.resource);
    if (icon?.naturalWidth) {
      ctx.globalAlpha = 0.08;
      ctx.drawImage(icon, SCENE_W / 2 - 120, SCENE_H / 2 - 120, 240, 240);
      ctx.globalAlpha = 1;
    }

    const n = a.participants.length;
    const ask = bestAsk(state, a);
    const bid = bestBid(state, a);
    for (let i = 0; i < n; i++) {
      const part = a.participants[i]!;
      const player = state.players[part.playerId]!;
      const x = this.laneX(i, n);
      // Lane.
      ctx.fillStyle = hexA(player.color, part.playerId === view.localPlayer ? 0.1 : 0.05);
      roundRect(ctx, x - 52, top - 30, 104, bottom - top + 60, 14);
      ctx.fill();
      const img = speciesImg(player.species);
      const have = player.goods[a.resource];
      if (part.role === 'none' || a.stage === 'status') {
        if (img?.naturalWidth) {
          ctx.globalAlpha = 0.35;
          const h = 54, w = (img.naturalWidth / img.naturalHeight) * h;
          ctx.drawImage(img, x - w / 2, (top + bottom) / 2 - h / 2, w, h);
          ctx.globalAlpha = 1;
        }
      } else {
        const y = yOf(part.price);
        const seller = part.role === 'seller';
        // Price bar.
        ctx.strokeStyle = player.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - 40, y);
        ctx.lineTo(x + 40, y);
        ctx.stroke();
        const touching = seller ? Math.abs(part.price - bid) < 0.6 : Math.abs(part.price - ask) < 0.6;
        if (img?.naturalWidth) {
          const h = 58, w = (img.naturalWidth / img.naturalHeight) * h;
          ctx.save();
          if (touching && a.stage === 'trading') { ctx.shadowColor = color; ctx.shadowBlur = 18; }
          if (seller) ctx.drawImage(img, x - w / 2, y - h - 4, w, h);
          else ctx.drawImage(img, x - w / 2, y + 4, w, h);
          ctx.restore();
        }
        ctx.fillStyle = 'rgba(14,10,24,0.85)';
        roundRect(ctx, x + 22, y - 10, 46, 20, 6);
        ctx.fill();
        ctx.fillStyle = '#ffd25e';
        ctx.font = '800 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`$${Math.round(part.price)}`, x + 45, y);
      }
      // Footer: name, role, units.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = player.color;
      ctx.font = '800 12px Inter, sans-serif';
      ctx.fillText(player.name, x, bottom + 14);
      ctx.fillStyle = '#d9cff0';
      ctx.font = '600 11px Inter, sans-serif';
      const roleText = part.role === 'seller' ? 'SELLING' : part.role === 'buyer' ? 'BUYING' : '—';
      ctx.fillText(`${roleText} · ${have} unit${have === 1 ? '' : 's'}`, x, bottom + 30);
      if (part.role === 'seller' && !part.override && part.stopAt > 0) {
        // Critical level marker.
        ctx.fillStyle = have <= part.stopAt ? '#ff8b8b' : 'rgba(255,255,255,0.45)';
        ctx.fillText(`keeps ${part.stopAt}`, x, top - 26);
      }
      if (part.traded > 0) {
        ctx.fillStyle = part.spent > 0 ? '#ff9b9b' : '#8ff0a8';
        ctx.fillText(`${part.role === 'buyer' ? 'bought' : 'sold'} ${part.traded} · ${part.spent > 0 ? '-' : '+'}$${Math.abs(part.spent)}`, x, top - 12);
      }
    }

    // Trade flashes.
    const now = performance.now();
    this.flashes = this.flashes.filter((f) => now - f.born < 350);
    for (const f of this.flashes) {
      const k = 1 - (now - f.born) / 350;
      const ia = a.participants.findIndex((p) => p.playerId === f.a);
      const ib = a.participants.findIndex((p) => p.playerId === f.b);
      const xa = ia >= 0 ? this.laneX(ia, n) : 70;
      const xb = ib >= 0 ? this.laneX(ib, n) : 70;
      const y = a.lastPrice !== null ? yOf(a.lastPrice) : SCENE_H / 2;
      ctx.strokeStyle = hexA('#ffd25e', k);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(xa, y);
      ctx.lineTo(xb, y);
      ctx.stroke();
    }

    // Clock.
    if (a.stage === 'trading') {
      const frac = a.clock / 14000;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      roundRect(ctx, 70, 18, SCENE_W - 90, 10, 5);
      ctx.fill();
      ctx.fillStyle = frac < 0.25 ? '#ff6b6b' : color;
      roundRect(ctx, 70, 18, Math.max(0, (SCENE_W - 90) * frac), 10, 5);
      ctx.fill();
    }
  }

  private priceLine(y: number, color: string, label: string, dashed: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (dashed) ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(70, y);
    ctx.lineTo(SCENE_W - 20, y);
    ctx.stroke();
    ctx.restore();
    ctx.font = '700 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = color;
    ctx.fillText(label, 76, y - 3);
  }

  // ---------------------------------------------------------------- floats

  private drawFloats(scene: 'map' | 'town'): void {
    const ctx = this.ctx;
    const now = performance.now();
    this.floats = this.floats.filter((f) => now - f.born < 1600);
    for (const f of this.floats) {
      if (f.scene !== 'any' && f.scene !== scene) continue;
      const k = (now - f.born) / 1600;
      ctx.globalAlpha = 1 - k * k;
      ctx.font = '800 18px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(10,6,20,0.8)';
      ctx.strokeText(f.text, f.x, f.y - k * 40);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - k * 40);
      ctx.globalAlpha = 1;
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function niceStep(range: number): number {
  for (const s of [5, 10, 20, 25, 50, 100]) if (range / s <= 10) return s;
  return 200;
}
