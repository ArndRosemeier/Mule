/** Screens around the game: loading, title, new-game setup, help and settings. */
import { SPECIES } from '../core/constants';
import type { Difficulty, PlayerSetup, Species } from '../core/types';
import { assetUrl, loadImages, SPECIES_INFO, speciesUrl } from './assets';
import { audio } from './audio';
import { clear, h } from './dom';
import { GameView } from './gameview';
import { LocalSession } from './session';

const AI_NAMES = ['Zorb', 'Quixa', 'Tobble', 'Mirelle', 'Grunt', 'Vexa', 'Pim', 'Orla'];
const PREFS_KEY = 'mule.prefs';

interface Prefs {
  name: string;
  species: Species;
  difficulty: Difficulty;
  ai: 'easy' | 'normal' | 'hard';
}

function loadPrefs(): Prefs {
  const d: Prefs = { name: 'You', species: 'humanoid', difficulty: 'standard', ai: 'normal' };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }; } catch { return d; }
}
function savePrefs(p: Prefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export class App {
  private root: HTMLElement;
  private game: GameView | null = null;
  private modal: HTMLElement | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
    window.addEventListener('keydown', () => audio.unlock(), { capture: true });
  }

  async boot(): Promise<void> {
    const fill = h('i', { style: { width: '0%' } });
    this.root.append(h('div.loading', h('div', { style: { textAlign: 'center' } }, 'Loading Irata…', h('div.bar', fill))));
    await loadImages((done, total) => { fill.style.width = `${(done / total) * 100}%`; });
    this.title();
  }

  private swap(el: HTMLElement): void {
    this.game?.destroy();
    this.game = null;
    this.closeModal();
    clear(this.root);
    this.root.append(el);
  }

  title(): void {
    audio.music('title');
    const hasSave = LocalSession.hasSave();
    const screen = h('div.title-screen', { style: { backgroundImage: `url(${assetUrl('title.webp')})` } },
      h('div.logo', 'M.U.L.E.'),
      h('div.tagline', 'Colony of Irata'),
      h('div.title-menu',
        hasSave ? h('button.btn.primary.big', { onclick: () => this.resume() }, 'Continue game') : null,
        h(`button.btn.big${hasSave ? '' : '.primary'}`, { onclick: () => { audio.sfx('select'); this.setup(); } }, 'New game'),
        h('button.btn.big', { onclick: () => this.help() }, 'How to play'),
        h('button.btn.big', { onclick: () => this.settings() }, 'Sound'),
      ),
      h('div.title-foot', 'A tribute to the 1983 classic · press any key for sound'),
    );
    this.swap(screen);
  }

  private resume(): void {
    const session = LocalSession.load();
    if (!session) return this.setup();
    audio.sfx('select');
    this.play(session);
  }

  setup(): void {
    const prefs = loadPrefs();
    const nameInput = h('input', { type: 'text', value: prefs.name, maxlength: 12, 'aria-label': 'Your name' }) as HTMLInputElement;
    const speciesGrid = h('div.species-grid');
    const diffSeg = h('div.seg');
    const aiSeg = h('div.seg');
    const oppList = h('div.opponents');

    const render = () => {
      clear(speciesGrid);
      for (const s of SPECIES) {
        speciesGrid.append(h(`div.species${s === prefs.species ? '.selected' : ''}`, {
          role: 'button', tabindex: 0,
          onclick: () => { prefs.species = s; audio.sfx('blip'); render(); },
        }, h('img', { src: speciesUrl(s), alt: '' }), h('b', SPECIES_INFO[s].label), h('span', SPECIES_INFO[s].blurb)));
      }
      clear(diffSeg);
      const diffs: [Difficulty, string, string][] = [
        ['beginner', 'Beginner', '6 rounds, no crystite'],
        ['standard', 'Standard', '12 rounds, the full game'],
        ['tournament', 'Tournament', '12 rounds, sharper wampus'],
      ];
      for (const [d, label, sub] of diffs) {
        diffSeg.append(h(`button.btn${prefs.difficulty === d ? '.selected' : ''}`, { onclick: () => { prefs.difficulty = d; audio.sfx('blip'); render(); } }, label, h('small', sub)));
      }
      clear(aiSeg);
      const levels: [Prefs['ai'], string, string][] = [
        ['easy', 'Relaxed', 'Forgiving opponents'], ['normal', 'Competitive', 'Solid traders'], ['hard', 'Cutthroat', 'They know where the crystite is'],
      ];
      for (const [l, label, sub] of levels) {
        aiSeg.append(h(`button.btn${prefs.ai === l ? '.selected' : ''}`, { onclick: () => { prefs.ai = l; audio.sfx('blip'); render(); } }, label, h('small', sub)));
      }
      clear(oppList);
      for (const o of opponents()) {
        oppList.append(h('div.opponent', h('img', { src: speciesUrl(o.species), alt: '' }), h('div.grow', o.name, h('small', `${SPECIES_INFO[o.species].label} · computer`))));
      }
    };
    const opponents = (): PlayerSetup[] => {
      const pool = SPECIES.filter((s) => s !== prefs.species && s !== 'flapper' && s !== 'humanoid');
      return [0, 1, 2].map((i) => ({ name: AI_NAMES[(i * 3 + SPECIES.indexOf(prefs.species)) % AI_NAMES.length]!, species: pool[(i * 2) % pool.length]!, ai: prefs.ai }));
    };
    render();

    const start = () => {
      prefs.name = nameInput.value.trim().slice(0, 12) || 'You';
      savePrefs(prefs);
      audio.sfx('fanfare');
      const setups: PlayerSetup[] = [{ name: prefs.name, species: prefs.species, ai: null }, ...opponents()];
      const session = LocalSession.create(setups, { difficulty: prefs.difficulty, seed: (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0 });
      LocalSession.clearSave();
      this.play(session);
    };

    const screen = h('div.screen.backdrop',
      h('div.card.setup',
        h('h1', 'New colony'),
        h('p.sub', 'Four colonists land on Irata with a little money and a lot of empty land. Whoever builds the most wealth is the First Founder, but if the colony as a whole fails, everyone loses.'),
        h('div.setup-grid',
          h('div', h('div.label', 'Your name'), nameInput),
          h('div', h('div.label', 'Your species'), speciesGrid),
          h('div', h('div.label', 'Game'), diffSeg),
          h('div', h('div.label', 'Opponents'), aiSeg, h('div', { style: { height: '8px' } }), oppList),
        ),
        h('div.actions',
          h('button.btn', { onclick: () => { audio.sfx('back'); this.title(); } }, 'Back'),
          h('button.btn.primary.big', { onclick: start }, 'Land on Irata')),
      ),
    );
    this.swap(screen);
    nameInput.focus();
  }

  private play(session: LocalSession): void {
    const view = new GameView(session, {
      onQuit: () => { session.save(); this.title(); },
      onNewGame: () => this.setup(),
      showHelp: () => this.help(),
      showSettings: () => this.settings(),
    });
    this.swap(view.el);
    this.game = view;
    view.start();
  }

  private closeModal(): void {
    this.modal?.remove();
    this.modal = null;
  }

  private showModal(card: HTMLElement): void {
    this.closeModal();
    const close = () => { audio.sfx('back'); this.closeModal(); };
    card.append(h('div.actions', h('button.btn.primary', { onclick: close }, 'Close')));
    this.modal = h('div.overlay.dim', { style: { zIndex: '50', position: 'fixed' }, onclick: (e: Event) => { if (e.target === this.modal) close(); } }, card);
    document.body.append(this.modal);
  }

  help(): void {
    this.showModal(h('div.card', { style: { width: 'min(700px, 100%)' } },
      h('h1', 'How to play'),
      h('div.help', { html: `
        <p>You are one of four colonists on the planet Irata. Over the rounds you claim land, put <b>MULEs</b> (Multiple Use Labor Elements) to work on it, and trade what they produce. The richest colonist wins, but everyone depends on everyone else for food and energy.</p>
        <h3>Each round</h3>
        <ul>
          <li><b>Land grant.</b> A cursor sweeps the map. Press <kbd>Space</kbd> (or click) to claim the highlighted plot. One free plot each.</li>
          <li><b>Development.</b> On your turn, walk with the arrow keys. In town: enter the <b>corral</b> to buy a MULE, then an <b>outfitter</b> (food, energy, smithore, crystite) to equip it. Leave town and stand on your own plot, then press <kbd>Space</kbd> to install it. Visit the <b>pub</b> to gamble away the rest of your turn for cash. Catch the <b>wampus</b> in the mountains for a bounty.</li>
          <li><b>Production.</b> MULEs produce. Every non-energy MULE uses one unit of energy, so without energy they idle. Food spoils by half, energy by a quarter, minerals above 50.</li>
          <li><b>Auctions.</b> Smithore, crystite, food, energy. Choose to buy or sell, then hold <kbd>↑</kbd>/<kbd>↓</kbd> to move your price. When a buyer and seller meet, units trade. The store buys at the bottom line and sells at the top line while it has stock.</li>
        </ul>
        <h3>Tips</h3>
        <ul>
          <li>Food decides how long your next turn is. Starving colonists barely have time to move.</li>
          <li>Rivers grow the most food, plains make the most energy, mountains hold smithore. Crystite hides anywhere: take a soil sample (<kbd>Space</kbd> on a plot) and bring it to the assay office.</li>
          <li>Neighbouring plots making the same thing get a bonus, and so does every set of three.</li>
          <li>Smithore becomes MULEs. If nobody sells smithore to the store, MULEs get scarce and expensive.</li>
          <li><kbd>F</kbd> fast-forwards computer turns. <kbd>Esc</kbd> pauses. The game saves at the start of every round.</li>
        </ul>` }),
    ));
  }

  settings(): void {
    const row = (label: string, key: 'music' | 'sfx') => {
      const val = h('span', String(Math.round(audio.settings[key] * 100)));
      const input = h('input', { type: 'range', min: 0, max: 100, value: Math.round(audio.settings[key] * 100) }) as HTMLInputElement;
      input.addEventListener('input', () => {
        audio.settings[key] = Number(input.value) / 100;
        val.textContent = input.value;
        audio.save();
      });
      input.addEventListener('change', () => audio.sfx('coin'));
      return h('div.slider-row', h('b', label), input, val);
    };
    this.showModal(h('div.card', { style: { width: 'min(420px, 100%)' } }, h('h2', 'Sound'), row('Music', 'music'), row('Effects', 'sfx')));
  }
}
