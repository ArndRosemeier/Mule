/**
 * The in-game screen: HUD, the canvas stage, phase overlays, input, sound
 * and the fixed-timestep loop that feeds ticks into the session.
 */
import { RESOURCES, SCENE_H, SCENE_W, TICK_MS, foodRequired } from '../core/constants';
import { colonyRating, colonyScore, criticalLevel, playerScore, ranking } from '../core/economy';
import { plotAt, plotCentre } from '../core/development';
import { crystiteLabel } from '../core/map';
import { highBid } from '../core/land';
import type { GameEvent, GameState, Phase, Resource } from '../core/types';
import { audio, type Sfx } from './audio';
import { eventUrl, iconUrl, RESOURCE_COLORS, RESOURCE_LABEL, speciesUrl } from './assets';
import { clear, h, money } from './dom';
import { Keyboard } from './input';
import { Renderer } from './renderer';
import { LocalSession } from './session';

const TERRAIN_LABEL: Record<string, string> = {
  plain: 'Plains', river: 'River', mountain1: 'Mountain (1 peak)', mountain2: 'Mountains (2 peaks)', mountain3: 'Mountains (3 peaks)', town: 'Town',
};

const PHASE_LABEL: Record<Phase['kind'], string> = {
  roundIntro: 'Status', landGrant: 'Land grant', landAuction: 'Land auction', development: 'Development',
  production: 'Production', auction: 'Trading', gameOver: 'Game over',
};

/** `?speed=8` runs the whole game faster, for testing. */
const DEBUG_SPEED = Math.min(Math.max(Number(new URLSearchParams(location.search).get('speed')) || 1, 1), 32);

export interface GameViewHooks {
  onQuit(): void;
  onNewGame(): void;
  showHelp(): void;
  showSettings(): void;
}

export class GameView {
  readonly el: HTMLElement;
  private session: LocalSession;
  private hooks: GameViewHooks;
  private renderer: Renderer;
  private kb = new Keyboard();
  private hud: HTMLElement;
  private hudCards: { el: HTMLElement; money: HTMLElement; goods: Record<Resource, HTMLElement>; id: number }[] = [];
  private hudRound: HTMLElement;
  private overlay: HTMLElement;
  private stageExtras: HTMLElement;
  private footerMsg: HTMLElement;
  private footerKeys: HTMLElement;
  private fastBtn: HTMLElement;
  private overlayKey = '';
  private updaters: (() => void)[] = [];
  private extrasKey = '';
  private extraUpdaters: (() => void)[] = [];
  private raf = 0;
  private last = 0;
  private acc = 0;
  private paused = false;
  private fast = false;
  private lastSeq: number;
  private lastMove = { x: 0, y: 0 };
  private lastAuctionDir = 0;
  private lastRaise = false;
  private clickTarget: { x: number; y: number; act: boolean } | null = null;
  private toast: { text: string; until: number } | null = null;
  private lastTurnMessage: string | null = null;
  private lastTimerSecond = -1;
  private pointerRaise = false;
  private pointerDir = 0;
  private savedRound = 0;
  private pauseEl: HTMLElement | null = null;
  private fit: ResizeObserver;

  constructor(session: LocalSession, hooks: GameViewHooks) {
    this.session = session;
    this.hooks = hooks;
    this.lastSeq = session.state.eventSeq;

    this.hudRound = h('div.hud-round');
    this.hud = h('div.hud', this.hudRound);
    for (const p of session.state.players) {
      const goods = {} as Record<Resource, HTMLElement>;
      const goodsEl = h('div.goods');
      for (const r of RESOURCES) {
        goods[r] = h('b', '0');
        goodsEl.append(h('span', { title: RESOURCE_LABEL[r] }, h('img', { src: iconUrl(r), alt: '' }), goods[r]));
      }
      const moneyEl = h('div.money', '$0');
      const card = h('div.pcard', { style: { '--pc': p.color } },
        h('div.avatar', h('img', { src: speciesUrl(p.species), alt: '' })),
        h('div.who', h('div.name', h('i'), p.name, h('em', p.ai ? `CPU` : 'You')), moneyEl, goodsEl),
      );
      card.style.setProperty('--pc', p.color);
      this.hud.append(card);
      this.hudCards.push({ el: card, money: moneyEl, goods, id: p.id });
    }

    const canvas = h('canvas') as HTMLCanvasElement;
    this.renderer = new Renderer(canvas);
    this.stageExtras = h('div');
    this.overlay = h('div.overlay');
    const wrap = h('div.canvas-wrap', canvas, this.stageExtras, this.overlay);
    canvas.addEventListener('pointerdown', (e) => this.onCanvasPointer(e, canvas));

    this.footerMsg = h('div.msg');
    this.footerKeys = h('div.keys');
    this.fastBtn = h('button.icon-btn', { title: 'Fast-forward computer turns (F)', onclick: () => this.toggleFast() }, '⏩ Fast');
    const footer = h('div.footer', this.footerMsg, this.footerKeys, this.fastBtn,
      h('button.icon-btn', { title: 'Pause (Esc)', onclick: () => this.setPaused(true) }, '❚❚ Menu'));

    const stage = h('div.stage', wrap);
    this.el = h('div.game', this.hud, stage, footer);
    // Keep the 9:5 stage as large as fits.
    this.fit = new ResizeObserver(() => {
      const pad = 20;
      const w = Math.max(0, stage.clientWidth - pad), hh = Math.max(0, stage.clientHeight - pad);
      const width = Math.min(w, hh * (SCENE_W / SCENE_H));
      wrap.style.width = `${width}px`;
      wrap.style.height = `${width * (SCENE_H / SCENE_W)}px`;
      this.renderer.resize();
    });
    this.fit.observe(stage);
    window.addEventListener('resize', this.onResize);
  }

  start(): void {
    // Test hook: end-to-end tests read the state and send actions through this.
    (window as unknown as { __mule?: unknown }).__mule = { session: this.session, view: this };
    audio.music(this.session.state.phase.kind === 'auction' ? 'auction' : 'game');
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.fit.disconnect();
    window.removeEventListener('resize', this.onResize);
  }

  private onResize = () => this.renderer.resize();

  private get state(): GameState {
    return this.session.state;
  }

  private get me(): number {
    return this.session.localPlayers[0] ?? -1;
  }

  private send = (a: Parameters<LocalSession['send']>[0]) => this.session.send(a);

  // ------------------------------------------------------------------ loop

  private frame(now: number): void {
    const dt = Math.min(now - this.last, 250);
    this.last = now;
    this.handleInput();
    if (!this.paused) {
      const speed = (this.fast && this.aiIsActing() ? 4 : 1) * DEBUG_SPEED;
      this.acc += dt * speed;
      let n = 0;
      while (this.acc >= TICK_MS && n < 40 * DEBUG_SPEED) {
        this.send({ type: 'tick', ms: TICK_MS });
        this.renderer.onTick(this.state);
        this.acc -= TICK_MS;
        n++;
      }
      if (n >= 40 * DEBUG_SPEED) this.acc = 0;
      this.processEvents();
      this.autosave();
    }
    this.renderer.draw(this.state, { localPlayer: this.me >= 0 ? this.me : null, now, alpha: Math.min(1, this.acc / TICK_MS) });
    this.updateHud();
    this.updateOverlay();
    this.updateExtras(now);
  }

  /** Nothing waits on the human right now, so fast-forward makes sense. */
  private aiIsActing(): boolean {
    const ph = this.state.phase;
    if (ph.kind === 'development') return this.state.players[ph.turn.playerId]!.ai !== null;
    if (ph.kind === 'landGrant') return ph.claims[this.me] !== null && !ph.done;
    if (ph.kind === 'auction') {
      const p = ph.auction.participants.find((q) => q.playerId === this.me);
      return ph.auction.stage === 'trading' && (!p || p.role === 'none');
    }
    if (ph.kind === 'landAuction') return ph.auction.seller === this.me;
    return false;
  }

  private toggleFast(): void {
    this.fast = !this.fast;
    this.fastBtn.classList.toggle('on', this.fast);
    audio.sfx('blip');
  }

  private autosave(): void {
    const s = this.state;
    if (s.phase.kind === 'roundIntro' && s.round !== this.savedRound) {
      this.savedRound = s.round;
      this.session.save();
    }
    if (s.phase.kind === 'gameOver' && this.savedRound !== -1) {
      this.savedRound = -1;
      LocalSession.clearSave();
    }
  }

  setPaused(p: boolean): void {
    if (this.paused === p) return;
    this.paused = p;
    if (p) {
      audio.sfx('back');
      this.pauseEl = h('div.overlay.dim', { style: { zIndex: '20' } },
        h('div.card', { style: { width: 'min(380px, 100%)' } },
          h('h2', 'Paused'),
          h('p.sub', `Round ${this.state.round} of ${this.state.config.rounds}. Your game is saved at the start of every round.`),
          h('div.menu-list',
            h('button.btn.primary', { onclick: () => this.setPaused(false) }, 'Resume'),
            h('button.btn', { onclick: () => this.hooks.showHelp() }, 'How to play'),
            h('button.btn', { onclick: () => this.hooks.showSettings() }, 'Sound settings'),
            h('button.btn', { onclick: () => this.hooks.onQuit() }, 'Quit to title'),
          ),
        ),
      );
      this.el.querySelector('.canvas-wrap')!.append(this.pauseEl);
    } else {
      this.pauseEl?.remove();
      this.pauseEl = null;
      this.last = performance.now();
    }
  }

  // ------------------------------------------------------------------ input

  private handleInput(): void {
    const presses = this.kb.take();
    if (presses.length) audio.unlock();
    if (presses.includes('escape')) {
      this.setPaused(!this.paused);
      return;
    }
    if (this.paused) return;
    if (presses.includes('f')) this.toggleFast();
    const s = this.state;
    const ph = s.phase;
    const me = this.me;
    const confirm = presses.includes('space') || presses.includes('enter');

    switch (ph.kind) {
      case 'roundIntro':
      case 'production':
        if (confirm) this.ready();
        break;
      case 'landGrant':
        if (confirm && !ph.done) this.send({ type: 'claim', playerId: me });
        else if (confirm) this.ready();
        break;
      case 'landAuction': {
        const raising = (this.kb.down('space', 'up', 'w') || this.pointerRaise) && ph.auction.stage === 'bidding';
        if (raising !== this.lastRaise) {
          this.lastRaise = raising;
          this.send({ type: 'landBid', playerId: me, raising });
        }
        if (confirm && ph.auction.stage !== 'bidding') this.ready();
        break;
      }
      case 'development': {
        const turn = ph.turn;
        const mine = turn.playerId === me;
        if (!mine) break;
        if (turn.stage === 'intro') {
          if (confirm) { this.ready(); audio.sfx('turn'); }
          break;
        }
        if (turn.stage !== 'active') break;
        if (turn.menu) {
          if (presses.includes('escape') || presses.includes('backspace')) this.send({ type: 'sellPlot', playerId: me, plot: null });
          break;
        }
        if (presses.includes('space')) this.send({ type: 'interact', playerId: me });
        if (presses.includes('e')) this.send({ type: 'endTurn', playerId: me });
        let axis = this.kb.axis();
        if (axis.x !== 0 || axis.y !== 0) this.clickTarget = null;
        else if (this.clickTarget) {
          const dx = this.clickTarget.x - turn.pos.x, dy = this.clickTarget.y - turn.pos.y;
          const d = Math.hypot(dx, dy);
          if (d < 4) {
            if (this.clickTarget.act) this.send({ type: 'interact', playerId: me });
            this.clickTarget = null;
          } else {
            const k = Math.min(1, d / 10) / d;
            axis = { x: dx * k, y: dy * k };
          }
        }
        if (axis.x !== this.lastMove.x || axis.y !== this.lastMove.y || (turn.input.x === 0 && turn.input.y === 0 && (axis.x || axis.y))) {
          this.lastMove = axis;
          this.send({ type: 'move', playerId: me, x: axis.x, y: axis.y });
        }
        break;
      }
      case 'auction': {
        const a = ph.auction;
        if (a.stage === 'declare') {
          if (presses.includes('up') || presses.includes('w')) { this.send({ type: 'auctionRole', playerId: me, role: 'seller' }); audio.sfx('blip'); }
          if (presses.includes('down') || presses.includes('s')) { this.send({ type: 'auctionRole', playerId: me, role: 'buyer' }); audio.sfx('blip'); }
          if (confirm) this.ready();
        } else if (a.stage === 'trading') {
          const dir = (this.kb.down('up', 'w') ? 1 : 0) - (this.kb.down('down', 's') ? 1 : 0) || this.pointerDir;
          if (dir !== this.lastAuctionDir) {
            this.lastAuctionDir = dir;
            this.send({ type: 'auctionMove', playerId: me, dir: dir as -1 | 0 | 1 });
          }
        } else if (confirm) {
          this.ready();
        }
        break;
      }
      case 'gameOver':
        break;
    }
  }

  private ready(): void {
    this.send({ type: 'ready', playerId: this.me });
    audio.sfx('select');
  }

  private onCanvasPointer(e: PointerEvent, canvas: HTMLCanvasElement): void {
    audio.unlock();
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SCENE_W;
    const y = ((e.clientY - rect.top) / rect.height) * SCENE_H;
    const ph = this.state.phase;
    if (ph.kind === 'landGrant' && !ph.done) {
      if (plotAt({ x, y }) === ph.cursor) this.send({ type: 'claim', playerId: this.me });
      return;
    }
    if (ph.kind === 'development' && ph.turn.playerId === this.me && ph.turn.stage === 'active') {
      const turn = ph.turn;
      if (turn.scene === 'map') {
        const plot = plotAt({ x, y });
        const p = this.state.map[plot]!;
        // Tapping one of your plots while leading a MULE walks there and installs it.
        const act = !!turn.mule && p.owner === this.me;
        this.clickTarget = act ? { ...plotCentre(plot), act } : { x, y, act: false };
      } else {
        this.clickTarget = { x, y, act: false };
      }
    }
  }

  // ------------------------------------------------------------------ events → sound & effects

  private processEvents(): void {
    const s = this.state;
    if (s.eventSeq === this.lastSeq) return;
    const fresh = s.events.filter((e) => e.seq > this.lastSeq);
    this.lastSeq = s.eventSeq;
    let traded = false;
    for (const e of fresh) this.onEvent(e, () => { traded = true; });
    if (traded) audio.sfx('trade');
  }

  private onEvent(e: GameEvent, traded: () => void): void {
    const s = this.state;
    const r = this.renderer;
    const turnPos = () => (s.phase.kind === 'development' ? s.phase.turn.pos : { x: SCENE_W / 2, y: SCENE_H / 2 });
    const play = (x: Sfx) => audio.sfx(x);
    switch (e.type) {
      case 'phase':
        if (e.phase === 'auction') audio.music('auction');
        else if (e.phase === 'gameOver') { audio.music('title'); play('fanfare'); }
        else if (e.phase === 'production') { audio.music('game'); play('install'); }
        else audio.music('game');
        if (e.phase === 'landGrant') play('turn');
        break;
      case 'claim': {
        play('claim');
        const c = plotCentre(e.plot);
        r.floatText(c.x, c.y, s.players[e.playerId]!.name, s.players[e.playerId]!.color, 'map');
        break;
      }
      case 'buyMule': play('buy'); r.floatText(turnPos().x, turnPos().y - 70, `-$${e.price}`, '#ff9b9b', 'town'); break;
      case 'outfit': play('outfit'); r.floatText(turnPos().x, turnPos().y - 70, `-$${e.cost}`, '#ff9b9b', 'town'); break;
      case 'install': { play('install'); const c = plotCentre(e.plot); r.floatText(c.x, c.y - 30, RESOURCE_LABEL[e.resource], RESOURCE_COLORS[e.resource], 'map'); break; }
      case 'muleLost': play('lost'); break;
      case 'pub': play('coin'); r.floatText(turnPos().x, turnPos().y - 70, `+$${e.amount}`, '#ffd25e', 'town'); break;
      case 'wampus': play('wampus'); r.floatText(turnPos().x, turnPos().y - 60, `+$${e.amount}`, '#d4b8ff', 'map'); break;
      case 'assay': play('select'); break;
      case 'trade':
        traded();
        r.tradeFlash(e.buyer ?? -1, e.seller ?? -1);
        break;
      case 'landSold': play('gavel'); break;
      case 'personal': play(e.good ? 'good' : 'bad'); break;
      case 'colony': play('event'); break;
      case 'log': break;
    }
  }

  // ------------------------------------------------------------------ HUD

  private updateHud(): void {
    const s = this.state;
    const ph = s.phase;
    const active = ph.kind === 'development' ? ph.turn.playerId : null;
    this.hudRound.innerHTML = `<b>Round ${s.round}<small style="opacity:.55;font-size:13px">/${s.config.rounds}</small></b><span>${PHASE_LABEL[ph.kind]}</span>`;
    for (const c of this.hudCards) {
      const p = s.players[c.id]!;
      c.el.classList.toggle('active', active === c.id);
      const m = money(p.money);
      if (c.money.textContent !== m) c.money.textContent = m;
      for (const r of RESOURCES) {
        const v = String(p.goods[r]);
        if (c.goods[r].textContent !== v) c.goods[r].textContent = v;
      }
    }
    // Footer hint.
    const { msg, keys } = this.hints();
    if (this.footerMsg.textContent !== msg) this.footerMsg.textContent = msg;
    if (this.footerKeys.innerHTML !== keys) this.footerKeys.innerHTML = keys;
  }

  private hints(): { msg: string; keys: string } {
    const s = this.state;
    const ph = s.phase;
    const me = this.me;
    const k = (key: string, what: string) => `<span><kbd>${key}</kbd> ${what}</span>`;
    switch (ph.kind) {
      case 'roundIntro': return { msg: `Round ${s.round} begins.`, keys: k('Space', 'continue') };
      case 'landGrant':
        if (ph.done) return { msg: 'The land grant is over.', keys: '' };
        return ph.claims[me] === null
          ? { msg: 'Free land! Claim the highlighted plot when it lands on one you like.', keys: k('Space', 'claim') + k('Click', 'claim') }
          : { msg: `You claimed your plot. Waiting for the others…`, keys: k('F', 'fast-forward') };
      case 'landAuction': return { msg: 'Land auction.', keys: k('Space / ↑', 'hold to bid') };
      case 'development': {
        const t = ph.turn;
        const p = s.players[t.playerId]!;
        if (t.playerId !== me) return { msg: `${p.name} is developing.`, keys: k('F', 'fast-forward') };
        if (t.stage === 'intro') return { msg: 'Your turn is about to start.', keys: k('Space', 'go') };
        if (t.scene === 'town') return { msg: t.mule ? (t.mule.outfit ? 'Lead your MULE out of town to one of your plots.' : 'Walk into an outfitter to equip your MULE.') : 'Walk into a building to use it.', keys: k('Arrows', 'walk') + k('E', 'end turn') };
        return { msg: t.mule ? 'Stand on your plot and press Space to install the MULE.' : 'Space on any plot takes a soil sample for the assay office.', keys: k('Arrows', 'walk') + k('Space', 'act') + k('E', 'end turn') };
      }
      case 'production': return { msg: 'Production results.', keys: k('Space', 'continue') };
      case 'auction': {
        const a = ph.auction;
        if (a.stage === 'declare') return { msg: `Do you want to buy or sell ${a.resource}?`, keys: k('↑', 'sell') + k('↓', 'buy') + k('Space', 'ready') };
        if (a.stage === 'trading') return { msg: 'Move your price until it meets someone else’s.', keys: k('↑ / ↓', 'hold to move') + k('F', 'fast-forward') };
        return { msg: `${RESOURCE_LABEL[a.resource]} auction.`, keys: k('Space', 'continue') };
      }
      case 'gameOver': return { msg: 'The ship has returned. The game is over.', keys: '' };
    }
  }

  // ------------------------------------------------------------------ stage extras (timer, banners, toasts)

  private updateExtras(now: number): void {
    const s = this.state;
    const ph = s.phase;
    // Turn messages become toasts.
    if (ph.kind === 'development') {
      const t = ph.turn;
      if (t.message && t.message !== this.lastTurnMessage && t.stage !== 'intro') {
        this.toast = { text: t.message, until: now + 3500 };
        if (t.playerId === this.me && /can't|need|already|No MULEs|isn't|closed|empty|confused|ran away|Bring/.test(t.message)) audio.sfx('error');
      }
      this.lastTurnMessage = t.message;
      if (t.playerId === this.me && t.stage === 'active') {
        const sec = Math.ceil(t.timeLeft / 1000);
        if (sec <= 5 && sec !== this.lastTimerSecond) audio.sfx('tick');
        this.lastTimerSecond = sec;
      }
    } else {
      this.lastTurnMessage = null;
      this.toast = null;
    }
    if (this.toast && now > this.toast.until) this.toast = null;

    let key = ph.kind;
    if (ph.kind === 'development') key += `:${ph.turn.playerId}:${ph.turn.stage}:${!!ph.turn.mule}:${ph.turn.mule?.outfit}:${ph.turn.sample}`;
    if (ph.kind === 'landGrant') key += `:${ph.done}`;
    key += `:${this.toast?.text ?? ''}`;
    if (key !== this.extrasKey) {
      this.extrasKey = key;
      clear(this.stageExtras);
      this.extraUpdaters = [];
      this.buildExtras();
    }
    for (const u of this.extraUpdaters) u();
  }

  private buildExtras(): void {
    const s = this.state;
    const ph = s.phase;
    const box = this.stageExtras;
    if (ph.kind === 'development' && ph.turn.stage !== 'intro') {
      const t = ph.turn;
      const p = s.players[t.playerId]!;
      const isMe = t.playerId === this.me;
      box.append(h('div.banner', { style: { '--pc': p.color } }, h('span.dot'), isMe ? 'Your turn' : `${p.name}'s turn`));
      // Timer ring.
      const circ = 2 * Math.PI * 26;
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ring.setAttribute('viewBox', '0 0 64 64');
      ring.innerHTML = `<circle cx="32" cy="32" r="26" fill="rgba(16,12,28,.8)" stroke="rgba(255,255,255,.12)" stroke-width="6"/><circle class="arc" cx="32" cy="32" r="26" fill="none" stroke="${p.color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="0"/>`;
      const label = h('div.t', '');
      box.append(h('div.timer', ring, label));
      const arc = ring.querySelector('.arc') as SVGCircleElement;
      this.extraUpdaters.push(() => {
        if (this.state.phase.kind !== 'development') return;
        const turn = this.state.phase.turn;
        const frac = turn.timeLeft / turn.timeTotal;
        arc.setAttribute('stroke-dashoffset', String(circ * (1 - frac)));
        arc.setAttribute('stroke', turn.timeLeft < 8000 ? '#ff6b6b' : p.color);
        label.textContent = String(Math.ceil(turn.timeLeft / 1000));
      });
      if (t.mule || t.sample !== null) {
        const items: (Node | string)[] = [];
        if (t.mule) {
          items.push(h('img', { src: t.mule.outfit ? iconUrl(t.mule.outfit) : `${import.meta.env.BASE_URL}assets/sprites/mule.png`, alt: '' }));
          items.push(t.mule.outfit ? `${RESOURCE_LABEL[t.mule.outfit]} MULE` : 'MULE (not outfitted)');
        }
        if (t.sample !== null) items.push(h('img', { src: iconUrl('crystite'), alt: '' }), 'Soil sample');
        box.append(h('div.carry', ...items));
      }
    }
    if (this.toast) box.append(h('div.toast', this.toast.text));
  }

  // ------------------------------------------------------------------ overlays

  private updateOverlay(): void {
    const key = this.overlayKeyFor();
    if (key !== this.overlayKey) {
      this.overlayKey = key;
      clear(this.overlay);
      this.overlay.className = 'overlay';
      this.updaters = [];
      this.buildOverlay();
    }
    for (const u of this.updaters) u();
  }

  private overlayKeyFor(): string {
    const s = this.state;
    const ph = s.phase;
    switch (ph.kind) {
      case 'roundIntro': return `ri:${s.round}:${ph.ready.includes(this.me)}`;
      case 'landGrant': return `lg:${s.round}:${ph.done}`;
      case 'landAuction': return `la:${ph.auction.plot}:${ph.auction.stage}`;
      case 'development': return `dev:${ph.index}:${ph.turn.playerId}:${ph.turn.stage}:${ph.turn.menu}`;
      case 'production': return `pr:${s.round}`;
      case 'auction': return `au:${ph.auction.resource}:${ph.auction.stage}:${ph.auction.stage === 'declare' ? ph.auction.participants.find((p) => p.playerId === this.me)?.role : ''}`;
      case 'gameOver': return 'go';
    }
  }

  private buildOverlay(): void {
    const s = this.state;
    const ph = s.phase;
    switch (ph.kind) {
      case 'roundIntro': return this.roundIntroCard();
      case 'landGrant': return this.landGrantBanner(ph);
      case 'landAuction': return this.landAuctionPanel(ph.auction);
      case 'development': return this.devOverlay(ph);
      case 'production': return this.productionCard(ph);
      case 'auction': return this.auctionOverlay(ph.auction);
      case 'gameOver': return this.gameOverCard();
    }
  }

  private card(...children: (Node | string | null | false)[]): HTMLElement {
    this.overlay.classList.add('dim');
    const c = h('div.card', ...children);
    this.overlay.append(c);
    return c;
  }

  private continueButton(label = 'Continue'): HTMLElement {
    return h('button.btn.primary', { onclick: () => this.ready() }, label, ' ', h('kbd', 'Space'));
  }

  private scoreBars(): HTMLElement {
    const s = this.state;
    const rows = ranking(s);
    const max = Math.max(1, ...rows.map((p) => playerScore(s, p).total));
    return h('div.score-bars', ...rows.map((p) => {
      const sc = playerScore(s, p);
      return h('div.score-bar',
        h('span', h('span.swatch', { style: { background: p.color } }), p.name),
        h('div.track', h('div.fill', { style: { width: `${(sc.total / max) * 100}%`, background: p.color } })),
        h('span.v', money(sc.total)),
      );
    }));
  }

  private roundIntroCard(): void {
    const s = this.state;
    const food = foodRequired(s.round);
    const waiting = (s.phase as { ready: number[] }).ready.includes(this.me);
    this.card(
      h('h1', `Round ${s.round}`, h('span', { style: { color: 'var(--muted)', fontSize: '18px' } }, ` of ${s.config.rounds}`)),
      h('p.sub', s.round === 1
        ? 'Welcome to Irata! Each round: claim free land, develop it with MULEs, collect what they produce, and trade at the auction.'
        : `Each colonist needs ${food} food this round. Short on food means less time to develop.`),
      this.scoreBars(),
      h('div.stat-row',
        h('div.stat', h('small', 'MULEs in corral'), h('b', `${s.store.mules} @ ${money(s.store.mulePrice)}`)),
        h('div.stat', h('small', 'Food needed'), h('b', `${food} / colonist`)),
        h('div.stat', h('small', 'Colony value'), h('b', money(colonyScore(s)))),
      ),
      h('div.actions', waiting ? h('span.hint', 'Waiting for other players…') : null, this.continueButton()),
    );
  }

  private landGrantBanner(ph: Extract<Phase, { kind: 'landGrant' }>): void {
    if (ph.done) {
      this.overlay.append(h('div.banner', 'Land grant complete'));
      return;
    }
    const info = h('div', { style: { fontSize: '13px', color: 'var(--muted)', fontWeight: '600' } });
    const banner = h('div.banner', { style: { flexDirection: 'column', gap: '2px', borderRadius: '16px', alignItems: 'center' } },
      h('div', 'Land grant: one free plot each'), info);
    this.overlay.append(banner);
    const claimBtn = h('button.btn.primary.small', { onclick: () => this.send({ type: 'claim', playerId: this.me }) }, 'Claim this plot');
    const panel = h('div', { style: { position: 'absolute', bottom: '14px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '8px', alignItems: 'center' } }, claimBtn);
    this.overlay.append(panel);
    this.updaters.push(() => {
      const p2 = this.state.phase;
      if (p2.kind !== 'landGrant' || p2.done || p2.cursor < 0) return;
      const plot = this.state.map[p2.cursor]!;
      const known = this.state.players[this.me]?.assayed.includes(plot.index);
      const txt = `${TERRAIN_LABEL[plot.terrain]}${known ? ` · crystite ${crystiteLabel(plot.crystite).toLowerCase()}` : ''}`;
      if (info.textContent !== txt) info.textContent = txt;
      claimBtn.style.display = p2.claims[this.me] === null ? '' : 'none';
    });
  }

  private landAuctionPanel(a: Extract<Phase, { kind: 'landAuction' }>['auction']): void {
    const s = this.state;
    const plot = s.map[a.plot]!;
    const seller = a.seller === null ? 'the colony' : s.players[a.seller]!.name;
    if (a.stage === 'intro') {
      this.card(
        h('h2', 'Land auction'),
        h('p.sub', `A ${TERRAIN_LABEL[plot.terrain].toLowerCase()} plot is up for sale by ${seller}. Bidding starts at ${money(a.minBid)}. Hold Space (or the Bid button) to raise your bid; the highest bid when time runs out wins.`),
        h('div.actions', this.continueButton('Start bidding')),
      );
      return;
    }
    const rows = h('div.score-bars');
    const timer = h('b');
    const high = h('b');
    const bidBtn = h('button.btn.primary', {}, 'Hold to bid');
    const set = (v: boolean) => { this.pointerRaise = v; };
    bidBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); set(true); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) bidBtn.addEventListener(ev, () => set(false));
    // Sit on the side of the map away from the plot being sold.
    const side = plot.col >= 5 ? { left: '12px' } : { right: '12px' };
    const panel = h('div.card', { style: { position: 'absolute', ...side, top: '12px', width: 'min(340px, calc(100% - 24px))', padding: '16px' } },
      h('h2', a.stage === 'result' ? 'Sold!' : 'Land auction'),
      h('p.sub', `${TERRAIN_LABEL[plot.terrain]} · seller: ${seller}`),
      h('div.stat-row', h('div.stat', h('small', 'High bid'), high), h('div.stat', h('small', 'Time'), timer)),
      rows,
      a.stage === 'bidding' && a.seller !== this.me ? h('div.actions', bidBtn) : null,
      a.stage === 'result' ? h('div.actions', this.continueButton()) : null,
    );
    this.overlay.append(panel);
    const max = () => Math.max(a.minBid * 2, ...Object.values((this.state.phase as Extract<Phase, { kind: 'landAuction' }>).auction.bids));
    this.updaters.push(() => {
      const p2 = this.state.phase;
      if (p2.kind !== 'landAuction') return;
      const au = p2.auction;
      const hb = highBid(au);
      high.textContent = hb ? `${money(hb)} ${au.leader !== null ? `(${this.state.players[au.leader]!.name})` : ''}` : '—';
      timer.textContent = au.stage === 'bidding' ? `${(au.timer / 1000).toFixed(1)}s` : au.winner !== null ? `${this.state.players[au.winner]!.name} won` : 'No sale';
      clear(rows);
      const m = max();
      for (const p of this.state.players) {
        if (p.id === au.seller) continue;
        const bid = au.bids[p.id] ?? 0;
        rows.append(h('div.score-bar', { style: { gridTemplateColumns: '70px 1fr 64px' } },
          h('span', p.name),
          h('div.track', h('div.fill', { style: { width: `${(bid / m) * 100}%`, background: p.color, transition: 'none' } })),
          h('span.v', bid ? money(bid) : '—')));
      }
    });
  }

  private devOverlay(ph: Extract<Phase, { kind: 'development' }>): void {
    const s = this.state;
    const t = ph.turn;
    const p = s.players[t.playerId]!;
    if (t.stage === 'intro') {
      const isMe = t.playerId === this.me;
      if (!isMe) {
        // Computer turns: a light card that dismisses itself.
        if (t.message) this.overlay.append(h('div.card.turn-card', { style: { padding: '16px 18px' } },
          h('img.portrait', { src: speciesUrl(p.species), alt: '', style: { width: '72px', height: '72px' } }),
          h('h2', `${p.name}'s turn`), h('div.luck', t.message)));
        else this.overlay.append(h('div.banner', { style: { '--pc': p.color } }, h('span.dot'), `${p.name}'s turn`));
        return;
      }
      const good = s.events.slice().reverse().find((e) => e.type === 'personal' && e.playerId === p.id);
      const goodCls = good && good.type === 'personal' && t.message?.startsWith(good.text) ? (good.good ? 'good' : 'bad') : '';
      this.card(
        h('div.turn-card',
          h('img.portrait', { src: speciesUrl(p.species), alt: '' }),
          h('h1', 'Your turn'),
          h('p.sub', `You have ${Math.round(t.timeTotal / 1000)} seconds. Buy a MULE at the corral, outfit it, and install it on one of your plots.`),
          t.message ? h(`div.luck${goodCls ? '.' + goodCls : ''}`, t.message) : null,
          h('div.actions', { style: { justifyContent: 'center' } }, h('button.btn.primary.big', { onclick: () => { this.ready(); audio.sfx('turn'); } }, 'Go! ', h('kbd', 'Space'))),
        ),
      );
      this.overlay.querySelector('.card')!.classList.add('turn-card');
      return;
    }
    if (t.menu === 'land' && t.playerId === this.me) {
      const plots = s.map.filter((q) => q.owner === this.me);
      this.card(
        h('h2', 'Land office'),
        h('p.sub', 'Put a plot up for auction at the start of next round. The MULE on it is sold with the land. Your turn clock keeps running.'),
        h('div.menu-list', ...plots.map((q) => h('button.btn', {
          onclick: () => this.send({ type: 'sellPlot', playerId: this.me, plot: q.index }),
        }, `${TERRAIN_LABEL[q.terrain]} at column ${q.col + 1}, row ${q.row + 1}${q.mule ? ` · ${RESOURCE_LABEL[q.mule]} MULE` : ''}`))),
        h('div.actions', h('button.btn', { onclick: () => this.send({ type: 'sellPlot', playerId: this.me, plot: null }) }, 'Never mind')),
      );
    }
  }

  private productionCard(ph: Extract<Phase, { kind: 'production' }>): void {
    const s = this.state;
    const ev = ph.colonyEvent;
    const table = h('table.data',
      h('tr', h('th', 'Colonist'), ...RESOURCES.map((r) => h('th', h('img', { src: iconUrl(r), alt: r, style: { width: '18px', verticalAlign: 'middle' } }))), h('th', 'Notes')),
      ...s.players.map((p) => {
        const rep = ph.report.perPlayer[p.id]!;
        const notes: string[] = [];
        if (rep.shortEnergy > 0) notes.push(`${rep.shortEnergy} MULE${rep.shortEnergy > 1 ? 's' : ''} had no energy`);
        const spoiled = RESOURCES.filter((r) => rep.spoiled[r] > 0).map((r) => `${rep.spoiled[r]} ${r}`);
        if (spoiled.length) notes.push(`spoiled ${spoiled.join(', ')}`);
        return h('tr',
          h('td', h('span.swatch', { style: { background: p.color } }), p.name),
          ...RESOURCES.map((r) => h('td', rep.produced[r] ? h('b', { style: { color: RESOURCE_COLORS[r] } }, `+${rep.produced[r]}`) : h('span', { style: { color: 'var(--dim)' } }, '0'))),
          h('td', { style: { fontSize: '12px', color: 'var(--muted)' } }, notes.join('; ') || '—'),
        );
      }),
    );
    this.card(
      h('h2', 'Production'),
      ev ? h('img.event-art', { src: eventUrl(ev.type), alt: '' }) : null,
      ev ? h('p.sub', { style: { color: 'var(--text)', fontWeight: '600' } }, ev.text) : h('p.sub', 'A quiet season on Irata. Your MULEs worked their plots.'),
      table,
      h('div.actions', this.continueButton('To the auctions')),
    ).style.width = 'min(640px, 100%)';
  }

  private auctionOverlay(a: Extract<Phase, { kind: 'auction' }>['auction']): void {
    const s = this.state;
    const r = a.resource;
    const title = h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
      h('img', { src: iconUrl(r), alt: '', style: { width: '30px', height: '30px' } }),
      h('span', { style: { fontFamily: 'var(--display)', fontSize: '20px' } }, `${RESOURCE_LABEL[r]} auction`));
    if (a.stage === 'status') {
      const rep = s.lastReport;
      const table = h('table.data',
        h('tr', h('th', 'Colonist'), h('th', 'Had'), h('th', 'Used'), h('th', 'Spoiled'), h('th', 'Made'), h('th', 'Now'), h('th', 'Needs')),
        ...s.players.map((p) => {
          const pr = rep?.perPlayer[p.id];
          const used = r === 'food' ? p.foodUsed : pr?.usage[r] ?? 0;
          const need = criticalLevel(s, p.id, r);
          const now = p.goods[r];
          return h('tr',
            h('td', h('span.swatch', { style: { background: p.color } }), p.name),
            h('td', String((pr?.before[r] ?? 0) + (r === 'food' ? p.foodUsed : 0))),
            h('td', used ? `-${used}` : '0'),
            h('td', pr?.spoiled[r] ? h('span.neg', `-${pr.spoiled[r]}`) : '0'),
            h('td', pr?.produced[r] ? h('span.pos', `+${pr.produced[r]}`) : '0'),
            h('td', h('b', String(now))),
            h('td', need ? h('span', { class: now < need ? 'neg' : 'pos' }, `${need}${now < need ? ` (short ${need - now})` : ''}`) : '—'),
          );
        }),
      );
      this.card(title,
        h('p.sub', { style: { marginTop: '8px' } }, `The store buys at ${money(a.storeBuy)} and sells at ${money(a.storeSell)}${s.store.stock[r] ? ` (${s.store.stock[r]} in stock)` : ' but is sold out'}.`),
        table,
        h('div.actions', this.continueButton('Open the floor')),
      ).style.width = 'min(640px, 100%)';
      return;
    }
    if (a.stage === 'declare') {
      const mine = a.participants.find((p) => p.playerId === this.me);
      const left = h('b');
      const pick = (role: 'buyer' | 'seller') => { this.send({ type: 'auctionRole', playerId: this.me, role }); audio.sfx('blip'); };
      this.overlay.append(h('div.card', { style: { textAlign: 'center', width: 'min(420px, 100%)' } },
        title,
        h('p.sub', { style: { margin: '10px 0' } }, `You have ${s.players[this.me]?.goods[r] ?? 0} ${r}. Will you buy or sell?`),
        h('div.row', { style: { justifyContent: 'center' } },
          h(`button.btn${mine?.role === 'seller' ? '.selected' : ''}`, { onclick: () => pick('seller') }, '↑ Sell'),
          h(`button.btn${mine?.role === 'buyer' ? '.selected' : ''}`, { onclick: () => pick('buyer') }, '↓ Buy'),
        ),
        h('div.actions', { style: { justifyContent: 'space-between' } }, h('span.hint', 'Starts in ', left), this.continueButton('Ready')),
      ));
      this.updaters.push(() => {
        const p2 = this.state.phase;
        if (p2.kind === 'auction') left.textContent = `${Math.max(0, Math.ceil(p2.auction.timer / 1000))}s`;
      });
      return;
    }
    if (a.stage === 'trading') {
      const mine = a.participants.find((p) => p.playerId === this.me);
      this.overlay.append(h('div.banner', { style: { top: '38px', left: '12px', transform: 'none', padding: '6px 14px' } }, title));
      if (mine && mine.role !== 'none') {
        const mk = (dir: -1 | 1, label: string) => {
          const b = h('button.btn', { style: { width: '64px', height: '56px', fontSize: '22px' } }, label);
          b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.pointerDir = dir; });
          for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { this.pointerDir = 0; });
          return b;
        };
        this.overlay.append(h('div', { style: { position: 'absolute', left: '10px', bottom: '10px', display: 'flex', flexDirection: 'column', gap: '6px' } }, mk(1, '▲'), mk(-1, '▼')));
      }
      return;
    }
    // Result.
    const lines = a.participants.filter((p) => p.traded > 0).map((p) => `${s.players[p.playerId]!.name} ${p.role === 'buyer' ? 'bought' : 'sold'} ${p.traded}`);
    this.overlay.append(h('div.card', { style: { textAlign: 'center', width: 'min(420px, 100%)' } },
      title,
      h('p.sub', { style: { margin: '10px 0 0' } }, a.tradesCount ? `${a.tradesCount} units changed hands${a.lastPrice ? `, last at ${money(a.lastPrice)}` : ''}. ${lines.join(' · ')}` : 'No trades this time.'),
      h('div.actions', { style: { justifyContent: 'center' } }, this.continueButton()),
    ));
  }

  private gameOverCard(): void {
    const s = this.state;
    const total = colonyScore(s);
    const order = ranking(s);
    const winner = order[0]!;
    const chart = this.historyChart();
    const table = h('table.data',
      h('tr', h('th', 'Colonist'), h('th', 'Money'), h('th', 'Land'), h('th', 'Goods'), h('th', 'Total')),
      ...order.map((p) => {
        const sc = playerScore(s, p);
        return h('tr',
          h('td', h('span.swatch', { style: { background: p.color } }), p.name, p.id === winner.id ? ' 🏆' : ''),
          h('td', money(sc.money)), h('td', money(sc.land)), h('td', money(sc.goods)), h('td', h('b', money(sc.total))));
      }),
    );
    this.card(
      h('h1', winner.id === this.me ? 'You are the First Founder!' : `${winner.name} is the First Founder`),
      h('p.sub', `The colony is worth ${money(total)}. ${colonyRating(total)}`),
      chart,
      table,
      h('div.actions',
        h('button.btn', { onclick: () => this.hooks.onQuit() }, 'Title screen'),
        h('button.btn.primary', { onclick: () => this.hooks.onNewGame() }, 'New game')),
    ).style.width = 'min(700px, 100%)';
  }

  private historyChart(): HTMLElement {
    const s = this.state;
    const W = 620, H = 160, pad = 28;
    const rounds = s.history.length;
    const max = Math.max(1, ...s.history.flatMap((r) => Object.values(r.scores)));
    const x = (i: number) => pad + (rounds <= 1 ? 0 : ((W - pad * 2) * i) / (rounds - 1));
    const y = (v: number) => H - pad + 6 - ((H - pad * 2) * v) / max;
    let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;margin:6px 0 10px">`;
    for (let i = 0; i <= 4; i++) {
      const v = (max * i) / 4;
      svg += `<line x1="${pad}" x2="${W - pad}" y1="${y(v)}" y2="${y(v)}" stroke="rgba(255,255,255,.07)"/>`;
      svg += `<text x="${pad - 4}" y="${y(v) + 3}" fill="rgba(255,255,255,.4)" font-size="9" text-anchor="end">${Math.round(v / 1000)}k</text>`;
    }
    for (const p of s.players) {
      const pts = s.history.map((r, i) => `${x(i)},${y(r.scores[p.id] ?? 0)}`).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="${p.color}" stroke-width="2.5" stroke-linejoin="round"/>`;
    }
    svg += '</svg>';
    return h('div', { html: svg });
  }
}
