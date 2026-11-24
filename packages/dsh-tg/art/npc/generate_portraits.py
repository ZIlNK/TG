"""Generate dot-matrix NPC portraits for the dialogue panel.

Outputs 480x640 PNG plates at 32 colors into art/npc/<npcId>/<expression>.png.
Run with the bundled Python that has Pillow + numpy.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 4          # drawing supersample: 120x160 plate -> 480x640
CELL = 5       # dot pitch in supersampled pixels
DOT = 2.0      # dot radius

W, H = 120, 160
OUT = Path("art/npc")

INK = (38, 30, 34, 255)
SKIN = (233, 198, 170, 255)
SKIN_SHADE = (203, 157, 128, 255)
WHITE = (245, 239, 229, 255)
PUPIL = (28, 21, 23, 255)
LIP = (174, 103, 96, 255)
BLUSH = (214, 138, 130, 255)

LIN = dict(long=True, hair=(48, 37, 49, 255), hair_hi=(82, 60, 70, 255),
           cloth=(139, 151, 118, 255), cloth_dark=(108, 119, 92, 255),
           shirt=(232, 224, 212, 255), eye=(104, 74, 58, 255), accessories=True)
HUNTER = dict(long=False, hair=(35, 31, 36, 255), hair_hi=(66, 58, 64, 255),
              cloth=(62, 76, 94, 255), cloth_dark=(46, 57, 72, 255),
              shirt=(214, 208, 196, 255), eye=(72, 62, 50, 255), glasses=True)


def P(v):
    return v * S


def catmull(points, samples=14):
    pts = [points[-1]] + list(points) + [points[0], points[1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for j in range(samples):
            t = j / samples
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
                       (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                       (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
                       (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                       (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, y))
    return out


def shape(d, points, fill, outline=INK, width=1.3):
    pts = catmull(points)
    px = [(P(x), P(y)) for x, y in pts]
    d.polygon(px, fill=fill)
    if outline:
        d.line(px + [px[0]], fill=outline, width=max(1, int(round(P(width)))))


def ell(d, box, fill, outline=None, width=1.2):
    d.ellipse([P(box[0]), P(box[1]), P(box[2]), P(box[3])], fill=fill,
              outline=outline, width=max(1, int(round(P(width)))))


def line(d, pts, fill, width=1.3):
    d.line([(P(x), P(y)) for x, y in pts], fill=fill,
           width=max(1, int(round(P(width)))))


def arc(d, box, start, end, fill, width=1.5):
    d.arc([P(box[0]), P(box[1]), P(box[2]), P(box[3])], start, end,
          fill=fill, width=max(1, int(round(P(width)))))


def draw(character, face):
    c = character
    img = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # back hair
    if c["long"]:
        shape(d, [(36, 26), (22, 44), (16, 86), (14, 128), (24, 140), (38, 132),
                  (40, 96), (60, 88), (80, 96), (82, 132), (96, 140), (106, 128),
                  (104, 86), (98, 44), (84, 26)], c["hair"], None)
    else:
        shape(d, [(36, 26), (24, 40), (22, 66), (28, 78), (60, 84), (92, 78),
                  (98, 66), (96, 40), (84, 26)], c["hair"], None)

    # shoulders and clothes
    shape(d, [(8, 160), (14, 132), (26, 116), (44, 108), (60, 120), (76, 108),
              (94, 116), (106, 132), (112, 160)], c["cloth"])
    shape(d, [(48, 108), (60, 124), (72, 108), (68, 106), (60, 116), (52, 106)],
          c["shirt"], INK, 0.9)
    line(d, [(46, 110), (54, 126)], c["cloth_dark"], 1.6)
    line(d, [(74, 110), (66, 126)], c["cloth_dark"], 1.6)
    if c.get("accessories"):
        ell(d, (58.6, 134, 61.4, 137), c["cloth_dark"], None)
        ell(d, (58.6, 146, 61.4, 149), c["cloth_dark"], None)
        line(d, [(44, 118), (50, 124)], c["cloth_dark"], 1.0)
    else:
        line(d, [(54, 114), (53, 136)], c["shirt"], 1.3)
        line(d, [(66, 114), (67, 136)], c["shirt"], 1.3)
        ell(d, (52.4, 136, 54.2, 138), c["cloth_dark"], None)
        ell(d, (65.8, 136, 67.6, 138), c["cloth_dark"], None)
        line(d, [(28, 160), (86, 112)], (44, 39, 34, 255), 3.0)

    # neck
    shape(d, [(54, 90), (66, 90), (68, 108), (52, 108)], SKIN)
    shape(d, [(54, 90), (66, 90), (65, 100), (55, 100)], SKIN_SHADE, None)

    # face
    shape(d, [(38, 34), (32, 48), (31, 64), (34, 78), (41, 90), (50, 96),
              (56, 99), (64, 99), (70, 96), (79, 90), (86, 78), (89, 64),
              (88, 48), (82, 34)], SKIN)
    ell(d, (26, 56, 34, 72), SKIN, INK, 1.0)
    ell(d, (86, 56, 94, 72), SKIN, INK, 1.0)

    # jaw / temple shading
    shade = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    sd.ellipse([P(46), P(90), P(74), P(102)], fill=(140, 90, 76, 34))
    sd.ellipse([P(33), P(54), P(40), P(90)], fill=(160, 104, 86, 26))
    sd.ellipse([P(80), P(54), P(87), P(90)], fill=(160, 104, 86, 26))
    shade = shade.filter(ImageFilter.GaussianBlur(P(3)))
    img.alpha_composite(shade)
    d = ImageDraw.Draw(img)

    # hair top and bangs
    if c["long"]:
        shape(d, [(28, 50), (29, 32), (40, 19), (54, 14), (68, 17), (82, 27),
                  (91, 44), (93, 52), (82, 48), (70, 45), (60, 47), (50, 45),
                  (38, 48)], c["hair"], None)
        line(d, [(58, 15), (57, 26), (59, 38)], c["hair_hi"], 1.2)
        line(d, [(34, 50), (30, 76), (31, 104)], c["hair_hi"], 1.0)
        line(d, [(88, 52), (92, 80), (91, 106)], c["hair_hi"], 1.0)
        line(d, [(33, 40), (39, 43)], (198, 168, 110, 255), 1.8)
    else:
        shape(d, [(28, 48), (29, 32), (38, 20), (47, 23), (54, 15), (62, 21),
                  (70, 15), (80, 21), (90, 32), (92, 48), (80, 43), (71, 39),
                  (62, 42), (53, 39), (44, 43), (36, 45)], c["hair"], None)

    # brows
    by = face.get("brow_y", 0)
    ba = face.get("brow_angle", 0)
    bl = face.get("brow_l", ba)
    br = face.get("brow_r", ba)
    line(d, [(40, 52 + by + bl), (45, 50.6 + by), (51, 51 + by - bl)], INK, 2.2)
    line(d, [(69, 51 + by - br), (75, 50.6 + by), (80, 52 + by + br)], INK, 2.2)

    # eyes
    op = face.get("eye_open", 1.0)
    gx, gy = face.get("gaze", (0, 0))
    for ex in (47, 73):
        if face.get("eye_style") == "arc":
            arc(d, (ex - 6, 57, ex + 6, 67), 200, 340, INK, 1.7)
            continue
        top = 60 + (1 - op) * 3
        bottom = 66 - (1 - op) * 1.5
        shape(d, [(ex - 6, 63), (ex - 3.5, top), (ex + 3, top - 0.3), (ex + 6, 62.5),
                  (ex + 3, bottom), (ex - 3, bottom + 0.3)], WHITE, INK, 1.0)
        if op > 0.25:
            ell(d, (ex - 3.2 + gx, top + 1.1 + gy, ex + 3.2 + gx, bottom - 0.4 + gy), c["eye"], None)
            ell(d, (ex - 2.0 + gx, top + 2.2 + gy, ex + 1.8 + gx, bottom - 1.3 + gy), PUPIL, None)
            ell(d, (ex - 1.2 + gx, top + 1.8 + gy, ex + 0.2 + gx, top + 3.2 + gy), WHITE, None)
        arc(d, (ex - 6, top - 1.2, ex + 6, bottom + 1), 190, 350, INK, 1.5)
        line(d, [(ex - 5, top - 2.2), (ex + 5, top - 2.6)], SKIN_SHADE, 0.9)

    # lashes and glasses
    line(d, [(40.5, 62), (38, 59.5)], INK, 1.0)
    line(d, [(79.5, 62), (82, 59.5)], INK, 1.0)
    if c.get("glasses"):
        for ex in (47, 73):
            d.rounded_rectangle([P(ex - 9), P(56.5), P(ex + 9), P(68.5)],
                                radius=int(P(2)), outline=INK, width=int(P(1.1)))
        line(d, [(56, 61.5), (64, 61.5)], INK, 1.2)
        line(d, [(38, 60), (32, 58)], INK, 1.0)
        line(d, [(82, 60), (88, 58)], INK, 1.0)

    # nose
    line(d, [(60, 70), (58.6, 75), (61.6, 75.8)], SKIN_SHADE, 1.0)

    # mouth
    m = face.get("mouth", "line")
    if m == "smile":
        arc(d, (54, 78, 66, 88), 20, 160, LIP, 1.5)
    elif m == "frown":
        arc(d, (54, 82, 66, 90), 200, 340, LIP, 1.3)
    elif m == "open":
        ell(d, (55, 78, 65, 88), (120, 62, 62, 255), INK, 1.0)
        ell(d, (57, 82, 63, 87), (196, 120, 112, 255), None)
    elif m == "small":
        line(d, [(57, 83), (63, 83)], LIP, 1.3)
    else:
        line(d, [(56, 84), (64, 84)], LIP, 1.4)
    line(d, [(57, 87.5), (63, 87.5)], SKIN_SHADE, 0.8)

    # blush
    b = face.get("blush", 0)
    if b:
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        ell(od, (34, 66, 44, 74), BLUSH[:3] + (int(110 * b),), None)
        ell(od, (76, 66, 86, 74), BLUSH[:3] + (int(110 * b),), None)
        overlay = overlay.filter(ImageFilter.GaussianBlur(P(2.5)))
        img.alpha_composite(overlay)

    return img


def dotify(img):
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    for y in range(0, H * S, CELL):
        for x in range(0, W * S, CELL):
            block = img.crop((x, y, x + CELL, y + CELL)).resize((1, 1), Image.LANCZOS).getpixel((0, 0))
            if block[3] < 10:
                continue
            r = DOT * S / CELL
            cx, cy = x + CELL / 2, y + CELL / 2
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=block)
    return out


def backdrop():
    w, h = W * S, H * S
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = yy / h
    top = np.array([74, 82, 88], dtype=np.float32)
    bottom = np.array([38, 45, 51], dtype=np.float32)
    rgb = top[None, None, :] * (1 - t[..., None]) + bottom[None, None, :] * t[..., None]
    cx, cy = w * 0.5, h * 0.46
    dist = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (w * 0.62)
    glow = np.clip(1 - dist, 0, 1)[..., None] ** 2
    rgb = rgb + glow * np.array([30, 26, 20], dtype=np.float32)
    arr = np.clip(rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGB").convert("RGBA")


EXPR = {
    "neutral": {},
    "smile": {"eye_style": "arc", "mouth": "smile", "blush": 0.55},
    "shy": {"eye_open": 0.45, "gaze": (-1, 2), "mouth": "small", "blush": 1.1},
    "worried": {"brow_y": -1, "brow_angle": 2, "eye_open": 0.95, "mouth": "frown"},
    "sad": {"brow_y": -1, "brow_angle": 3, "eye_open": 0.65, "gaze": (0, 2), "mouth": "frown"},
    "surprised": {"eye_open": 1.4, "brow_y": -3, "mouth": "open"},
    "thinking": {"gaze": (2, -2), "brow_r": -2, "mouth": "small"},
    "look_away": {"gaze": (2.5, 0.5), "mouth": "small", "brow_angle": 1},
}


def render(character, folder, tag, face):
    img = draw(character, face)
    dots = dotify(img)
    out = backdrop()
    out.alpha_composite(dots)
    path = OUT / folder
    path.mkdir(parents=True, exist_ok=True)
    q = out.convert("RGB").quantize(colors=32, method=Image.MEDIANCUT)
    q.save(path / f"{tag}.png", optimize=True)
    return q


if __name__ == "__main__":
    tags = list(EXPR)
    for cid, char in (("linwanqing", LIN), ("hunter", HUNTER)):
        for tag in tags:
            render(char, cid, tag, EXPR[tag])
    cols = 4
    tw, th = 240, 320
    sheet = Image.new("RGB", (cols * tw, ((len(tags) * 2 + cols - 1) // cols) * th), (14, 18, 23))
    for i, (cid, char) in enumerate((("linwanqing", LIN), ("hunter", HUNTER))):
        for j, tag in enumerate(tags):
            im = Image.open(OUT / cid / f"{tag}.png").convert("RGB").resize((tw, th), Image.LANCZOS)
            n = i * len(tags) + j
            sheet.paste(im, ((n % cols) * tw, (n // cols) * th))
    Path("artifacts").mkdir(exist_ok=True)
    sheet.save(Path("artifacts/portraits-contact.png"))
    print("ok")