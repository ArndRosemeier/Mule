# Generated assets

All art and music in `public/assets/` is generated with OpenRouter models and post-processed locally.
Everything is an original design (no sprites, logo or music from the 1983 game).

| Step | Script | Output |
| --- | --- | --- |
| Generate raw images and music | `generate.py` | `tools/assets/raw/**` (git-ignored) |
| Key, trim, resize, tile, encode, normalise | `process.py` | `public/assets/**` and `public/assets/manifest.json` |

## Models

- Images: `google/gemini-3.1-flash-image` (about $0.067 per image)
- Title key art: `google/gemini-3-pro-image` at 2K (about $0.14)
- Music: `google/lyria-3-pro-preview` (about $0.08 per track; it requires `stream: true`, the audio arrives as base64 MP3 in `delta.audio.data`)

## Regenerate

```sh
export OPEN_ROUTER_KEY=...
python3 tools/assets/generate.py              # generate whatever raw file is missing
python3 tools/assets/generate.py species/     # only ids starting with these prefixes
python3 tools/assets/generate.py --force icons/money   # reroll even if the raw file exists
python3 tools/assets/generate.py --list       # list every asset id
python3 tools/assets/process.py               # rebuild public/assets from raw (free, about 1.5 min)
python3 tools/assets/process.py buildings/    # only some ids
```

Requirements: Python 3 with Pillow and numpy, plus `curl` and `ffmpeg`/`ffprobe`.

To reroll one asset, delete its raw file (or pass `--force <id>`), run `generate.py <id>`, look at the result,
then run `process.py <id>`. Every API call's cost is appended to `raw/costs.log`.

## Conventions

- Every prompt ends with the shared `STYLE` suffix in `generate.py`, which keeps the art direction consistent.
- Sprites are requested on a flat `#FF00FF` background. `process.py` keys out magenta using a score that
  separates magenta from the violet accents, unmixes the edge colours, despills, feathers the edge slightly
  and trims to the content.
- `sprites/mule_walk` is generated with `sprites/mule` as a reference image and is processed at the same
  scale, so the two frames line up (bottom-align them; the walk frame is wider).
- Terrain: `plain` and `town` tile in both directions, and `river` tiles vertically. `process.py` cross-fades
  only the edges that don't already match.
- Music is normalised with single-pass `loudnorm` (target -16 LUFS; the output measures about -15) and gets a
  2.5 s fade-out. `game` and `auction` are meant to loop but are not seamless loops, so crossfade them or
  restart them after the fade.
