import { SPECIES } from '../core/constants';
import type { Resource, Species } from '../core/types';

const BASE = `${import.meta.env.BASE_URL}assets/`;

export function assetUrl(path: string): string {
  return BASE + path;
}

export const IMAGE_PATHS = {
  title: 'title.webp',
  plain: 'terrain/plain.png',
  river: 'terrain/river.png',
  townTile: 'terrain/town.png',
  mountain1: 'terrain/mountain1.png',
  mountain2: 'terrain/mountain2.png',
  mountain3: 'terrain/mountain3.png',
  b_food: 'buildings/food.png',
  b_energy: 'buildings/energy.png',
  b_smithore: 'buildings/smithore.png',
  b_crystite: 'buildings/crystite.png',
  b_corral: 'buildings/corral.png',
  b_pub: 'buildings/pub.png',
  b_assay: 'buildings/assay.png',
  b_land: 'buildings/land.png',
  mule: 'sprites/mule.png',
  muleWalk: 'sprites/mule_walk.png',
  wampus: 'sprites/wampus.png',
  i_food: 'icons/food.png',
  i_energy: 'icons/energy.png',
  i_smithore: 'icons/smithore.png',
  i_crystite: 'icons/crystite.png',
  i_money: 'icons/money.png',
  ...Object.fromEntries(SPECIES.map((s) => [`s_${s}`, `species/${s}.png`])),
} as Record<string, string>;

export const images: Record<string, HTMLImageElement> = {};

export function loadImages(onProgress: (done: number, total: number) => void): Promise<void> {
  const entries = Object.entries(IMAGE_PATHS);
  let done = 0;
  return Promise.all(
    entries.map(
      ([key, path]) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = img.onerror = () => {
            done++;
            onProgress(done, entries.length);
            resolve();
          };
          img.src = assetUrl(path);
          images[key] = img;
        }),
    ),
  ).then(() => undefined);
}

export const speciesImg = (s: Species) => images[`s_${s}`]!;
export const iconImg = (r: Resource | 'money') => images[`i_${r}`]!;
export const speciesUrl = (s: Species) => assetUrl(`species/${s}.png`);
export const iconUrl = (r: Resource | 'money') => assetUrl(`icons/${r}.png`);
export const eventUrl = (type: string) => assetUrl(`events/${type}.webp`);

export const SPECIES_INFO: Record<Species, { label: string; blurb: string }> = {
  mechtron: { label: 'Mechtron', blurb: 'Efficient machine. $1000' },
  gollumer: { label: 'Gollumer', blurb: 'Patient grazer. $1000' },
  packer: { label: 'Packer', blurb: 'Sturdy hauler. $1000' },
  bonzoid: { label: 'Bonzoid', blurb: 'Jolly tusker. $1000' },
  spheroid: { label: 'Spheroid', blurb: 'Floating thinker. $1000' },
  flapper: { label: 'Flapper', blurb: 'Easy mode. $1600' },
  leggite: { label: 'Leggite', blurb: 'Many-legged. $1000' },
  humanoid: { label: 'Humanoid', blurb: 'Hard mode. $600' },
};

export const RESOURCE_COLORS: Record<Resource, string> = {
  food: '#8bd450', energy: '#ffd23f', smithore: '#c7cbd6', crystite: '#b58cff',
};
export const RESOURCE_LABEL: Record<Resource, string> = {
  food: 'Food', energy: 'Energy', smithore: 'Smithore', crystite: 'Crystite',
};
