#!/usr/bin/env python3
"""Generate raw art + music for the M.U.L.E. remake via OpenRouter.

Raw model outputs are written to tools/assets/raw/ (git-ignored); run
process.py afterwards to key, trim, resize and export into public/assets/.

Usage:
  OPEN_ROUTER_KEY=... python3 tools/assets/generate.py            # everything missing
  python3 tools/assets/generate.py species/ buildings/pub          # only ids matching these prefixes
  python3 tools/assets/generate.py --force icons/money             # regenerate even if present
  python3 tools/assets/generate.py --list                          # show the asset table

Existing raw files are skipped, so re-running only fills gaps. Delete a raw
file (or pass --force) to reroll it. Each call's cost is appended to
tools/assets/raw/costs.log.
"""
import base64
import json
import os
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
API = "https://openrouter.ai/api/v1/chat/completions"

IMAGE_MODEL = "google/gemini-3.1-flash-image"
HERO_MODEL = "google/gemini-3-pro-image"
MUSIC_MODEL = "google/lyria-3-pro-preview"

STYLE = (
    " Art style: bright, clean, stylized sci-fi illustration with soft shading, "
    "slightly retro-futurist 1980s pulp sci-fi colours reimagined with modern polish, "
    "like a premium indie strategy game. Setting: the warm ochre and rust alien planet Irata, "
    "with teal and violet accents. Crisp clean outlines, cheerful and readable. "
    "Absolutely no text, no letters, no numbers, no logos, no signature, no watermark."
)
SPRITE = (
    " Show exactly one subject, complete and fully inside the frame with generous empty margin on all sides, "
    "centered, on a perfectly flat solid pure magenta #FF00FF background. The background must be one uniform "
    "flat colour: no gradient, no floor, no ground, no cast shadow, no vignette, no other objects. "
    "Do not use magenta or pink anywhere on the subject itself."
)
TOPDOWN = (
    " Strictly orthographic top-down view looking straight down from directly above, "
    "a flat seamless game map texture filling the entire square frame edge to edge, evenly lit, "
    "no horizon, no perspective, no objects, no buildings, no characters, no border, no frame."
)

# id -> (kind, aspect, prompt[, model, size])
# kind: sprite (magenta key) | opaque
A = []


def add(id, kind, aspect, prompt, model=IMAGE_MODEL, size=None, ref=None):
    """ref: id of another raw image passed to the model as a reference (for consistent frames)."""
    A.append(dict(id=id, kind=kind, aspect=aspect, prompt=prompt, model=model, size=size, ref=ref))


# 1. Title key art
add("title", "opaque", "16:9",
    "Wide cinematic key art for a sci-fi frontier colony trading game. Vast warm ochre alien plains under a "
    "pale teal sky, layered rust-red mesas and mountains in the distance, a small cosy frontier colony town of "
    "domed and boxy prefab buildings with antennas in the middle distance. In the foreground lower third, a "
    "small group of friendly colonists of diverse alien species (a sleek robot, a round tusked creature, a "
    "small winged bird-like alien, a human in a jumpsuit) each leading a boxy four-legged robot pack mule with "
    "antenna ears. A huge elegant mothership hangs high in the sky at the upper left. Keep the upper-middle "
    "area of the sky calm, empty and uncluttered (space reserved for a logo). Golden hour light, epic but "
    "warm and inviting." + STYLE, model=HERO_MODEL, size="2K")

# 2. Terrain
add("terrain/plain", "opaque", "1:1",
    "Game map tile texture of dry alien ground: warm rust and ochre soil with subtle cracks, small pebbles, "
    "faint wind-swept dust and tiny sparse dry tufts. Very uniform overall colour and brightness with only "
    "subtle fine-grained variation, no large bands, stripes or blotches, low contrast so it tiles well." + TOPDOWN + STYLE)
add("terrain/river", "opaque", "1:1",
    "Game map tile texture of warm rust and ochre alien soil with a single winding-but-mostly-straight teal "
    "river running vertically from the exact top edge to the exact bottom edge through the horizontal center "
    "of the square, the river about one fifth of the tile wide, bordered on both sides by lush green grassy "
    "fertile banks that fade into the ochre soil." + TOPDOWN + STYLE)
add("terrain/town", "opaque", "1:1",
    "Seamless tileable game map texture of paved colony ground: an exactly regular grid of 4 by 4 large square "
    "weathered sand-coloured and pale grey paving plates, all the same size, with thin teal light strips in "
    "the seams, the grid aligned to the image edges so the tile repeats perfectly, a little rust dust, "
    "subtle wear, clean and futuristic, low contrast." + TOPDOWN + STYLE)
for n, desc in [(1, "a single rocky mountain peak"),
                (2, "a small rocky mountain ridge with two peaks side by side"),
                (3, "a rocky mountain range with three peaks side by side, the middle one tallest")]:
    add(f"terrain/mountain{n}", "sprite", "4:3",
        f"Game map overlay sprite of {desc}, seen from above at a steep high-angle three-quarter view as on a "
        "strategy game map, rust red and ochre rock with violet shadows and pale dusty highlights, wide flat "
        "base, compact silhouette." + SPRITE + STYLE)

# 3. Town buildings
BUILD = (" A single small sci-fi frontier shop building in a three-quarter front view, prefab modular "
         "construction, inviting open doorway facing the viewer, isolated object.")
for bid, desc in [
    ("food", "a greenhouse farm supply store: glass dome greenhouse with leafy green crops visible inside, crates of vegetables by the door"),
    ("energy", "a power supply store: solar panel arrays on the roof, a glowing teal energy cell tower and power conduits"),
    ("smithore", "a mining and ore shop: sturdy industrial building with a small ore hopper, conveyor and a pile of dark grey-blue metallic ore"),
    ("crystite", "a crystal mining shop: angular building with large glowing violet and teal crystals jutting out beside it and a crystal display window"),
    ("corral", "a robot mule stable and corral: one single barn-like hangar with an attached small fenced paddock and charging stalls for robot pack animals, no animals visible, no other buildings"),
    ("pub", "a cosy cantina pub: rounded saloon-style building with warm glowing windows, swinging doors, a barrel and a neon-like abstract glowing bottle shape (no text)"),
    ("assay", "an assay laboratory: compact lab building with a big satellite dish antenna on the roof, sample tubes visible in the window"),
    ("land", "a land office: tidy administrative building with a tall flagpole flying a plain teal and violet flag with no symbols, a map table visible through the window"),
]:
    add(f"buildings/{bid}", "sprite", "1:1", f"Game sprite of {desc}." + BUILD + SPRITE + STYLE)

# 4. Species
SPEC = (" Full body character, standing, three-quarter view facing to the right, friendly and characterful, "
        "colonist on a frontier planet, wearing a small teal and violet colonist utility accessory "
        "(belt, scarf or harness), mascot-like proportions.")
for sid, desc in [
    ("mechtron", "a sleek elegant humanoid robot with a smooth polished white and teal shell, glowing visor eyes"),
    ("gollumer", "a blobby, soft, long-necked creature with a small head, big kind eyes, squat round body and stubby feet, olive and mint skin"),
    ("packer", "a stocky, sturdy pack-animal-like alien with broad shoulders, hooves, shaggy tan fur and a big backpack"),
    ("bonzoid", "a round, plump, cheerful creature with two small tusks, tiny legs and a big grin, coral orange skin"),
    ("spheroid", "a floating sphere-shaped being made of smooth luminous material with a single big friendly eye, small hovering energy rings below it, no legs"),
    ("flapper", "a small bird-like alien with stubby colourful wings, a beak, big eyes and spindly legs, bright yellow and teal feathers"),
    ("leggite", "a tall slender insectoid alien with many thin legs, a long thorax, antennae and compound eyes, lavender and amber carapace"),
    ("humanoid", "a human colonist in a practical sand-coloured jumpsuit with teal trim, boots and tool belt, confident smile"),
]:
    add(f"species/{sid}", "sprite", "3:4", f"Game character sprite of {desc}." + SPEC + SPRITE + STYLE)

# 5-6. Sprites
MULE = ("a boxy four-legged robot pack mule: rectangular cargo-box body in clean light sand-coloured metal with "
        "teal panels and violet trim, a small boxy head with two tall antenna ears tipped with glowing teal lights, "
        "four jointed mechanical legs with pad feet, a single round camera eye")
add("sprites/mule", "sprite", "4:3",
    f"Game sprite of {MULE}, strict side view facing right, standing with all four legs straight." + SPRITE + STYLE)
add("sprites/mule_walk", "sprite", "4:3",
    "Using the attached robot pack mule as the exact character reference (identical design, colours, proportions, "
    "head, antennas, size and side view facing right), draw the same robot mule walking mid-stride with an exaggerated, clearly readable stride: "
    "front-left and back-right legs swung far forward, the other two swung far back, like a trotting horse. Keep everything else identical." + SPRITE + STYLE,
    ref="sprites/mule")
add("sprites/wampus", "sprite", "1:1",
    "Game sprite of a small mischievous mountain creature: a furry little imp with big glowing teal eyes, "
    "pointy ears, a sly grin and a softly glowing violet aura around it, crouching playfully." + SPRITE + STYLE)

# 7. Icons
ICON = " Single centered game resource icon, bold simple readable silhouette, chunky and glossy, isolated."
for iid, desc in [
    ("food", "a bundle of fresh alien vegetables and a leafy green crop"),
    ("energy", "a glowing teal energy power cell battery with a small lightning-like spark"),
    ("smithore", "a chunk of dark blue-grey metallic ore with shiny silver veins"),
    ("crystite", "a cluster of glowing violet crystals"),
    ("money", "a short stack of golden coins with a plain engraved star (no letters)"),
]:
    add(f"icons/{iid}", "sprite", "1:1", f"Game icon of {desc}." + ICON + SPRITE + STYLE)

# 8. Event vignettes
EVT = (" Illustrated scene for a random event card in a colony strategy game, clear focal point. Full-bleed "
       "rectangular illustration filling the whole canvas edge to edge: no frame, no border, no rounded corners, "
       "no porthole, no circular or oval vignette, no inset panel.")
for eid, desc in [
    ("pests", "a swarm of small cute-but-annoying alien crop pests munching through a colony greenhouse vegetable field"),
    ("pirates", "a sleek space pirate ship swooping low over a colony at night, beaming up glowing violet crystals with a tractor beam"),
    ("acidrain", "a green-tinted acid rainstorm pouring from dark clouds over rust plains and small colony farm plots"),
    ("sunspot", "a huge blazing sun with dramatic sunspot flares above the alien plains, solar panels glowing brightly"),
    ("meteorite", "a fiery meteorite streaking down and crashing into the ochre plains, throwing up dust and glowing crystals"),
    ("quake", "a planetquake splitting the ground with cracks running through a small mining site, rocks tumbling"),
    ("radiation", "an eerie glowing teal radiation cloud drifting over a colony plot, a robot pack mule fleeing"),
    ("fire", "a fire breaking out in a frontier colony warehouse, orange flames and smoke, crates of goods"),
]:
    add(f"events/{eid}", "opaque", "16:9", f"{desc}." + EVT + STYLE)

# 9. Music: (id, prompt)
MUSIC = [
    ("music/title",
     "Instrumental only, no vocals, no singing. An original, upbeat and catchy retro-synth frontier anthem for the "
     "title screen of a cheerful sci-fi colony trading game. Bright analog synth lead with a memorable hummable "
     "melody, bouncy synth bass, punchy 80s drum machine, sparkling arpeggios and a hint of twangy western "
     "guitar, optimistic and adventurous, major key, about 120 BPM."),
    ("music/game",
     "Instrumental only, no vocals, no singing. Relaxed, warm, loopable background music for a sci-fi frontier "
     "colony management game: mellow analog synth pads, gentle plucked arpeggios, soft electric piano, light "
     "laid-back drum machine groove, a dusty western-desert feel, calm and steady with no big climax, even "
     "energy throughout so it loops seamlessly, about 95 BPM."),
    ("music/auction",
     "Instrumental only, no vocals, no singing. Tense, bouncy, loopable auction music for a sci-fi trading game: "
     "staccato synth bass ostinato, ticking hi-hats, plucky chiptune-flavoured synth stabs, rising suspense "
     "but playful and comic, like a fast-paced bidding war, constant energy throughout so it loops seamlessly, "
     "minor key, about 140 BPM."),
]

_lock = threading.Lock()


def log_cost(id, model, cost):
    with _lock:
        with open(RAW / "costs.log", "a") as f:
            f.write(f"{id}\t{model}\t{cost}\n")


def curl(payload, stream=False):
    key = os.environ["OPEN_ROUTER_KEY"]
    cmd = ["curl", "-sS", "--max-time", "600", API, "-H", f"Authorization: Bearer {key}",
           "-H", "Content-Type: application/json", "--data-binary", "@-"]
    if stream:
        cmd.insert(2, "-N")
    r = subprocess.run(cmd, input=json.dumps(payload).encode(), capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode()[:500])
    return r.stdout.decode()


def gen_image(a, out):
    payload = {
        "model": a["model"],
        "modalities": ["image", "text"],
        "messages": [{"role": "user", "content": "Generate an image. " + a["prompt"]}],
        "image_config": {"aspect_ratio": a["aspect"]},
    }
    if a.get("ref"):
        ref = (RAW / f"{a['ref']}.png").read_bytes()
        payload["messages"][0]["content"] = [
            {"type": "text", "text": "Generate an image. " + a["prompt"]},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(ref).decode()}},
        ]
    if a["size"]:
        payload["image_config"]["image_size"] = a["size"]
    for attempt in range(3):
        d = json.loads(curl(payload))
        if "error" in d:
            print(f"  {a['id']}: error {d['error']}")
            continue
        cost = d.get("usage", {}).get("cost", 0)
        log_cost(a["id"], a["model"], cost)
        imgs = d["choices"][0]["message"].get("images") or []
        if not imgs:
            print(f"  {a['id']}: no image returned (attempt {attempt + 1})")
            continue
        url = imgs[0]["image_url"]["url"]
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(base64.b64decode(url.split(",", 1)[1]))
        print(f"  {a['id']}: ok (${cost:.3f})")
        return
    print(f"  {a['id']}: FAILED")


def gen_music(id, prompt, out):
    payload = {"model": MUSIC_MODEL, "modalities": ["text", "audio"], "stream": True,
               "messages": [{"role": "user", "content": prompt}]}
    body = curl(payload, stream=True)
    chunks, cost = [], 0
    for line in body.splitlines():
        if not line.startswith("data: ") or line.strip() == "data: [DONE]":
            continue
        d = json.loads(line[6:])
        if "error" in d:
            print(f"  {id}: error {d['error']}")
            return
        for c in d.get("choices", []):
            au = c.get("delta", {}).get("audio")
            if au and au.get("data"):
                chunks.append(au["data"])
        if d.get("usage"):
            cost = d["usage"].get("cost", 0)
    log_cost(id, MUSIC_MODEL, cost)
    if not chunks:
        print(f"  {id}: no audio returned")
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(b"".join(base64.b64decode(c) for c in chunks))
    print(f"  {id}: ok (${cost:.3f})")


def main():
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    force = "--force" in sys.argv
    if "--list" in sys.argv:
        for a in A:
            print(a["id"], a["kind"], a["aspect"], a["model"])
        for id, _ in MUSIC:
            print(id, "music")
        return
    RAW.mkdir(exist_ok=True)
    want = lambda id: not args or any(id.startswith(p) for p in args)
    jobs, later = [], []
    for a in A:
        out = RAW / f"{a['id']}.png"
        if want(a["id"]) and (force or not out.exists()):
            (later if a.get("ref") else jobs).append(lambda a=a, out=out: gen_image(a, out))
    for id, prompt in MUSIC:
        out = RAW / f"{id}.mp3"
        if want(id) and (force or not out.exists()):
            jobs.append(lambda id=id, prompt=prompt, out=out: gen_music(id, prompt, out))
    print(f"{len(jobs) + len(later)} job(s)")
    for wave in (jobs, later):  # reference-based images run after their references
        with ThreadPoolExecutor(6) as ex:
            for f in [ex.submit(j) for j in wave]:
                try:
                    f.result()
                except Exception as e:  # keep going on individual failures
                    print("  job failed:", e)


if __name__ == "__main__":
    main()
