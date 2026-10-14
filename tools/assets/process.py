#!/usr/bin/env python3
"""Post-process raw generations (tools/assets/raw/) into game-ready files in public/assets/.

- sprites: magenta chroma key (tolerant) + colour unmixing/despill + light edge feather,
  trimmed to content and resized to the target size, saved as PNG with alpha
- terrain: resized to 512x512 and blended to tile seamlessly (river tiles vertically only)
- title / events: cover-cropped and saved as WebP
- music: loudness-normalised (EBU R128, -16 LUFS) and encoded to .mp3 (112 kbps)

Then writes public/assets/manifest.json. Always reprocesses everything (it is fast and free).
Usage: python3 tools/assets/process.py [id-prefix ...]
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
OUT = ROOT.parent.parent / "public" / "assets"

KEY = np.array([255.0, 0.0, 255.0])

# id -> (mode, params)
JOBS = {"title": ("cover", (1920, 1080), "webp")}
for t in ("plain", "town"):
    JOBS[f"terrain/{t}"] = ("tile", "xy")
JOBS["terrain/river"] = ("tile", "y")
for n in (1, 2, 3):
    JOBS[f"terrain/mountain{n}"] = ("sprite", ("w", 512))
for b in ("food", "energy", "smithore", "crystite", "corral", "pub", "assay", "land"):
    JOBS[f"buildings/{b}"] = ("sprite", ("w", 400))
for s in ("mechtron", "gollumer", "packer", "bonzoid", "spheroid", "flapper", "leggite", "humanoid"):
    JOBS[f"species/{s}"] = ("sprite", ("h", 320))
JOBS["sprites/mule"] = ("sprite", ("w", 256))
JOBS["sprites/mule_walk"] = ("sprite", ("like", "sprites/mule"))  # same scale as the standing frame
JOBS["sprites/wampus"] = ("sprite", ("max", 200))
for i in ("food", "energy", "smithore", "crystite", "money"):
    JOBS[f"icons/{i}"] = ("sprite", ("square", 128))
for e in ("pests", "pirates", "acidrain", "sunspot", "meteorite", "quake", "radiation", "fire"):
    JOBS[f"events/{e}"] = ("cover", (768, 432), "webp")
MUSIC = {"music/title": False, "music/game": True, "music/auction": True}  # value: loop track


def chroma_key(img):
    """Return RGBA float array with the magenta background removed."""
    a = np.asarray(img.convert("RGB")).astype(np.float64)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    # Magenta-ness: high R and B, low G, R~B. Violet/purple subject colours score much lower
    # because they are darker and/or have R far from B.
    score = np.minimum(R, B) - G - 0.5 * np.abs(R - B)
    lo, hi = 70.0, 135.0
    alpha = np.clip((hi - score) / (hi - lo), 0.0, 1.0)

    # Estimate the actual key colour from the border (models drift from pure #FF00FF).
    border = np.concatenate([a[:4].reshape(-1, 3), a[-4:].reshape(-1, 3), a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)])
    bmask = (np.minimum(border[:, 0], border[:, 2]) - border[:, 1]) > 100
    key = np.median(border[bmask], axis=0) if bmask.sum() > 50 else KEY

    # Unmix partial pixels: C = aF + (1-a)K  =>  F = (C - (1-a)K) / a
    part = (alpha > 0.02) & (alpha < 0.999)
    ap = alpha[part][:, None]
    a[part] = (a[part] - (1 - ap) * key) / ap
    a = np.clip(a, 0, 255)

    # Despill a thin band around the edge: pull residual magenta tint toward neutral.
    am = Image.fromarray((alpha * 255).astype(np.uint8))
    near = np.asarray(am.filter(ImageFilter.MinFilter(5))) < 250
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    spill = np.clip(np.minimum(R, B) - G - 0.6 * np.abs(R - B), 0, None) * near
    a[..., 0] -= spill * 0.7
    a[..., 2] -= spill * 0.7
    a = np.clip(a, 0, 255)

    # Light feather: soften and very slightly erode the alpha edge.
    soft = np.asarray(am.filter(ImageFilter.GaussianBlur(0.8))).astype(np.float64) / 255
    alpha = np.minimum(alpha, soft * 1.15)
    alpha[alpha < 0.03] = 0
    return np.dstack([a, alpha * 255]).astype(np.uint8)


def trim(rgba, pad=4):
    al = rgba[..., 3]
    rows = np.where((al > 40).sum(1) >= 3)[0]
    cols = np.where((al > 40).sum(0) >= 3)[0]
    y0, y1 = max(rows[0] - pad, 0), min(rows[-1] + pad + 1, al.shape[0])
    x0, x1 = max(cols[0] - pad, 0), min(cols[-1] + pad + 1, al.shape[1])
    return rgba[y0:y1, x0:x1]


def resize_rgba(im, size):
    # premultiply to avoid dark/colour fringes when downsampling
    a = np.asarray(im).astype(np.float64)
    al = a[..., 3:4] / 255
    pm = Image.fromarray(np.dstack([a[..., :3] * al, a[..., 3]]).astype(np.uint8), "RGBA")
    pm = pm.resize(size, Image.LANCZOS)
    b = np.asarray(pm).astype(np.float64)
    al = b[..., 3:4] / 255
    rgb = np.where(al > 0, b[..., :3] / np.maximum(al, 1e-6), 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), b[..., 3]]).astype(np.uint8), "RGBA")


SCALES = {}  # id -> scale used, so animation frames can share it


def do_sprite(id, img, rule):
    rgba = trim(chroma_key(img))
    h, w = rgba.shape[:2]
    kind, n = rule
    if kind == "like":
        s = SCALES[n]
        size = (round(w * s), round(h * s))
    elif kind == "w":
        size = (n, round(h * n / w))
    elif kind == "h":
        size = (round(w * n / h), n)
    else:  # max / square
        inner = n if kind == "max" else round(n * 0.92)
        s = inner / max(w, h)
        size = (round(w * s), round(h * s))
    SCALES[id] = size[0] / w
    im = resize_rgba(Image.fromarray(rgba, "RGBA"), size)
    if kind == "square":
        canvas = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        canvas.paste(im, ((n - size[0]) // 2, (n - size[1]) // 2))
        im = canvas
    return im


def make_tileable(img, axes, band=0.14):
    """Make opposite edges match by cross-fading a band near each edge with a half-offset copy.

    Axes whose edges already match (the model often returns seamless tiles) are left alone,
    so regular patterns like paving don't get ghosted.
    """
    a = np.asarray(img.convert("RGB")).astype(np.float64)
    h, w = a.shape[:2]
    for ax in axes:
        axis = 0 if ax == "y" else 1
        n = a.shape[axis]
        first, last = np.take(a, 0, axis), np.take(a, n - 1, axis)
        neighbour = np.abs(np.take(a, n // 2, axis) - np.take(a, n // 2 + 1, axis)).mean()
        if np.abs(first - last).mean() <= 1.5 * neighbour + 2:
            continue  # already seamless on this axis
        rolled = np.roll(a, n // 2, axis=axis)
        d = np.minimum(np.arange(n), n - 1 - np.arange(n)) / (n * band)  # 0 at edges
        wgt = np.clip(d, 0, 1)
        wgt = wgt * wgt * (3 - 2 * wgt)  # smoothstep
        wgt = wgt[:, None, None] if axis == 0 else wgt[None, :, None]
        a = a * wgt + rolled * (1 - wgt)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def do_cover(img, size):
    tw, th = size
    w, h = img.size
    s = max(tw / w, th / h)
    img = img.convert("RGB").resize((round(w * s), round(h * s)), Image.LANCZOS)
    x0 = (img.width - tw) // 2
    y0 = (img.height - th) // 2
    return img.crop((x0, y0, x0 + tw, y0 + th))


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    return round(float(r.stdout.strip()), 2)


def do_music(id, loop):
    src = RAW / f"{id}.mp3"
    if not src.exists():
        return
    dst = OUT / id
    dst.parent.mkdir(parents=True, exist_ok=True)
    dur = duration(src)
    # short fade-out on every track; loop tracks get a tiny fade-in so the seam clicks less
    fades = f"afade=t=out:st={dur - 2.5:.2f}:d=2.5"
    fades = ("afade=t=in:d=0.05," if loop else "") + fades
    filt = f"{fades},loudnorm=I=-16:TP=-1.5:LRA=11"
    for ext, codec in (("mp3", ["-c:a", "libmp3lame", "-b:a", "112k"]),):
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-af", filt, "-ar", "44100", *codec,
                        str(dst) + "." + ext], check=True)
    print(f"  {id}: {dur}s")


def manifest():
    files = {}
    for p in sorted(OUT.rglob("*")):
        if not p.is_file() or p.name == "manifest.json":
            continue
        rel = p.relative_to(OUT).as_posix()
        if p.suffix in (".png", ".webp"):
            w, h = Image.open(p).size
            files[rel] = {"width": w, "height": h, "bytes": p.stat().st_size}
        elif p.suffix in (".ogg", ".mp3"):
            files[rel] = {"duration": duration(p), "bytes": p.stat().st_size,
                          "loop": MUSIC.get(rel.rsplit(".", 1)[0], False)}
    (OUT / "manifest.json").write_text(json.dumps(
        {"generatedBy": "tools/assets/generate.py + process.py", "files": files}, indent=2) + "\n")
    print(f"manifest: {len(files)} files")


def main():
    args = sys.argv[1:]
    want = lambda id: not args or any(id.startswith(p) for p in args)
    for id, job in JOBS.items():
        src = RAW / f"{id}.png"
        if not want(id) or not src.exists():
            continue
        img = Image.open(src)
        mode = job[0]
        if mode == "sprite":
            out, ext = do_sprite(id, img, job[1]), "png"
        elif mode == "tile":
            out, ext = make_tileable(img, job[1]).resize((512, 512), Image.LANCZOS), "png"
        else:
            out, ext = do_cover(img, job[1]), job[2]
        dst = OUT / f"{id}.{ext}"
        dst.parent.mkdir(parents=True, exist_ok=True)
        if ext == "webp":
            out.save(dst, "WEBP", quality=88, method=6)
        else:
            out.save(dst, optimize=True)
        print(f"  {id}: {out.size}")
    for id, loop in MUSIC.items():
        if want(id):
            do_music(id, loop)
    manifest()


if __name__ == "__main__":
    main()
