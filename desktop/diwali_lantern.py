"""
Diwali Lantern — a Diwali desktop overlay for Windows
Doneology Labs (OPC) Private Limited · MIT License · https://github.com/arunkw/diwali-lantern

A transparent layer that floats over your apps (the same window technique as Dussehra Garland):
* frameless, translucent, "tool" window above the taskbar that never takes keyboard focus,
  so typing, Alt+Tab, Ctrl+Shift+Esc and every other shortcut keep working normally;
* clicks pass straight through to the app underneath everywhere except on the kandil,
  the diya, the bulbs and the resize handles;
* no global keyboard or mouse hooks: the pointer is read by polling, like any app.

Scene: a 3D kandil (Akash Kandil of translucent colour paper, thermacol Star Kandil, pleated
Paper Globe) on a cord, a laddi of string lights along the top of the screen, a clay diya on
the taskbar, crackers and a phuljhadi, all with Verlet physics.

Run:   python diwali_lantern.py          Needs: pip install PySide6 numpy
"""

import argparse
import json
import math
import os
import random
import sys
import time

import numpy as np
from PySide6.QtCore import QDir, QElapsedTimer, QLockFile, QPointF, QRect, QRectF, Qt, QTimer, QUrl
from PySide6.QtGui import (QAction, QActionGroup, QBrush, QColor, QCursor, QDesktopServices, QFont,
                           QFontMetricsF, QGuiApplication, QIcon, QImage, QLinearGradient, QPainter,
                           QPainterPath, QPen, QPixmap, QPolygonF, QRadialGradient, QRegion, QTransform)
from PySide6.QtWidgets import QApplication, QMenu, QSystemTrayIcon, QWidget

APP_NAME = "DiwaliLantern"
APP_VERSION = "2.0.0"
SITE = "https://arunkw6.wixsite.com/doneology-labs"
REPO = "https://github.com/arunkw/diwali-lantern"
WEB = "https://arunkw.github.io/diwali-lantern/"
TAU = math.tau
FMT = QImage.Format.Format_ARGB32_Premultiplied
PLUS = QPainter.CompositionMode.CompositionMode_Plus
OVER = QPainter.CompositionMode.CompositionMode_SourceOver
NOPEN = Qt.PenStyle.NoPen

# ----------------------------------------------------------------------------- config

DEFAULTS = {"lantern": 0, "lights": 0, "diya": 0, "lanternScale": 1.0, "diyaScale": 1.3,
            "ambient": True, "sparklerAlways": False}


def config_path():
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    folder = os.path.join(base, APP_NAME)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, "config.json")


def load_config():
    cfg = dict(DEFAULTS)
    try:
        with open(config_path(), "r", encoding="utf-8") as f:
            cfg.update(json.load(f))
    except (OSError, ValueError):
        pass
    return cfg


def save_config(cfg):
    try:
        with open(config_path(), "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
    except OSError:
        pass

# ----------------------------------------------------------------------------- small helpers


def clamp(v, a, b):
    return a if v < a else b if v > b else v


def lerp(a, b, t):
    return a + (b - a) * t


rand = random.uniform


def pick(seq):
    return seq[random.randrange(len(seq))]


_RGB = {}


def hex2rgb(h):
    r = _RGB.get(h)
    if r is None:
        n = int(h[1:], 16)
        r = _RGB[h] = ((n >> 16) & 255, (n >> 8) & 255, n & 255)
    return r


def shade_rgb(rgb, f):
    if f >= 1:
        k = min(f - 1, 1.0)
        return tuple(int(v + (255 - v) * k) for v in rgb)
    return tuple(int(clamp(v * f, 0, 255)) for v in rgb)


def shade(h, f, a=1.0):
    r, g, b = shade_rgb(hex2rgb(h) if isinstance(h, str) else h, f)
    return QColor(r, g, b, int(clamp(a, 0, 1) * 255))


def mix_rgb(a, b, t):
    a = hex2rgb(a) if isinstance(a, str) else a
    b = hex2rgb(b) if isinstance(b, str) else b
    return tuple(int(clamp(lerp(a[i], b[i], t), 0, 255)) for i in range(3))


def qc(h, a=1.0):
    r, g, b = hex2rgb(h) if isinstance(h, str) else h
    return QColor(r, g, b, int(clamp(a, 0, 1) * 255))


def hsl_hex(h):
    s, l = 0.9, 0.6
    a = s * min(l, 1 - l)

    def f(n):
        k = (n + h / 30) % 12
        return l - a * max(-1, min(k - 3, min(9 - k, 1)))
    return "#%02x%02x%02x" % (round(f(0) * 255), round(f(8) * 255), round(f(4) * 255))


def ellipse_arc(path, cx, cy, rx, ry, t0, t1, ccw=False):
    """Canvas-style ellipse arc (angles clockwise from 3 o'clock, y down) appended to a QPainterPath."""
    if not ccw and t1 < t0:
        t1 += TAU
    if ccw and t1 > t0:
        t1 -= TAU
    path.arcTo(QRectF(cx - rx, cy - ry, 2 * rx, 2 * ry), -math.degrees(t0), -math.degrees(t1 - t0))


def ell_path(x, y, rx, ry):
    p = QPainterPath()
    p.addEllipse(QPointF(x, y), max(0.1, rx), max(0.1, ry))
    return p

# ----------------------------------------------------------------------------- sprites & textures


_GLOW = {}


def glow_img(col):
    img = _GLOW.get(col)
    if img is None:
        img = QImage(128, 128, FMT)
        img.fill(Qt.GlobalColor.transparent)
        p = QPainter(img)
        r, g, b = hex2rgb(col)
        gr = QRadialGradient(64, 64, 64)
        gr.setColorAt(0, QColor(r, g, b, 242))
        gr.setColorAt(0.18, QColor(r, g, b, 140))
        gr.setColorAt(0.45, QColor(r, g, b, 41))
        gr.setColorAt(1, QColor(r, g, b, 0))
        p.fillRect(img.rect(), gr)
        p.end()
        _GLOW[col] = img
    return img


def glow(p, x, y, r, col, a=1.0):
    if a <= 0.01 or r <= 0.5:
        return
    p.setOpacity(min(1.0, a))
    p.drawImage(QRectF(x - r, y - r, 2 * r, 2 * r), glow_img(col))
    p.setOpacity(1.0)


_TEX = {}


def _wrap(n, x, y, r, fn):
    for ox in (-n, 0, n):
        for oy in (-n, 0, n):
            if -r < x + ox < n + r and -r < y + oy < n + r:
                fn(x + ox, y + oy)


def texture(name):
    img = _TEX.get(name)
    if img is not None:
        return img
    rng = random.Random(20261105 + len(name))
    n = {"paper": 128, "foam": 64, "clay": 96}[name]
    img = QImage(n, n, FMT)
    img.fill(Qt.GlobalColor.transparent)
    p = QPainter(img)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    if name == "paper":
        for _ in range(700):
            x, y, l, a = rng.random() * n, rng.random() * n, 4 + rng.random() * 12, rng.random() * math.pi
            col = QColor(255, 255, 255, 128) if rng.random() < 0.5 else QColor(0, 0, 0, 115)
            p.setPen(QPen(col, 0.5 + rng.random() * 0.6))

            def fibre(px, py, l=l, a=a):
                path = QPainterPath(QPointF(px, py))
                path.quadTo(px + math.cos(a + 0.4) * l * 0.5, py + math.sin(a + 0.4) * l * 0.5,
                            px + math.cos(a) * l, py + math.sin(a) * l)
                p.drawPath(path)
            _wrap(n, x, y, l, fibre)
        p.setPen(NOPEN)
        for _ in range(3000):
            p.fillRect(QRectF(rng.random() * n, rng.random() * n, 1, 1),
                       QColor(255, 255, 255, 77) if rng.random() < 0.5 else QColor(0, 0, 0, 77))
    elif name == "foam":
        p.fillRect(img.rect(), QColor(110, 110, 110, 90))
        p.setPen(NOPEN)
        for _ in range(230):
            x, y, r = rng.random() * n, rng.random() * n, 2.2 + rng.random() * 2.8

            def bead(px, py, r=r):
                gr = QRadialGradient(QPointF(px, py), r, QPointF(px - r * 0.35, py - r * 0.35))
                gr.setColorAt(0, QColor(255, 255, 255, 242))
                gr.setColorAt(0.75, QColor(235, 235, 235, 128))
                gr.setColorAt(1, QColor(100, 100, 100, 153))
                p.setBrush(gr)
                p.drawEllipse(QPointF(px, py), r, r)
            _wrap(n, x, y, r, bead)
    else:  # clay
        p.setPen(NOPEN)
        for _ in range(3200):
            v = rng.random()
            col = QColor(40, 10, 0, int((0.12 + v * 0.35) * 255)) if v < 0.55 else QColor(255, 215, 170, int((v - 0.55) * 0.5 * 255))
            sz = 1 if rng.random() < 0.88 else 2
            p.fillRect(QRectF(rng.random() * n, rng.random() * n, sz, sz), col)
        p.setPen(QPen(QColor(60, 20, 5, 64), 0.6))
        for _ in range(40):
            x, y = rng.random() * n, rng.random() * n
            p.drawLine(QPointF(x, y), QPointF(x + rng.random() * 14 - 7, y + rng.random() * 3))
    p.end()
    _TEX[name] = img
    return img

# ----------------------------------------------------------------------------- physics primitives


class Pt:
    __slots__ = ("x", "y", "px", "py", "im", "pinned")

    def __init__(self, x, y, im=1.0):
        self.x = self.px = x
        self.y = self.py = y
        self.im = im
        self.pinned = False


class Part:
    __slots__ = ("x", "y", "vx", "vy", "life", "max", "g", "drag", "size", "type", "col", "qc", "add",
                 "seed", "spin", "floor", "trail")


class Pointer:
    def __init__(self):
        self.x = self.y = -999.0
        self.lx = self.ly = -999.0
        self.vx = self.vy = 0.0
        self.inside = False
        self.down = False
        self.hist = []

# ----------------------------------------------------------------------------- 3D kandil models

PITCH = 0.22
_L = np.array([-0.45, -0.55, 0.7]); LDIR = _L / np.linalg.norm(_L)
_H = LDIR + np.array([0, 0, 1.0]); HV = _H / np.linalg.norm(_H)

LANTERN_STYLES = [("Akash Kandil", "#ffb347"), ("Star Kandil", "#ffc870"), ("Paper Globe", "#ffa04a")]
LIGHT_STYLES = [
    {"name": "Rangoli Mini Bulbs", "wire": "#1f4d2b", "colors": ["#ff2a2a", "#22d34a", "#2f7bff", "#ffd400", "#ff3dd6", "#ff8a00"]},
    {"name": "Warm Fairy LEDs", "wire": "#b07a3a", "colors": ["#ffd9a0", "#ffe7bf", "#ffcf86"]},
    {"name": "Twinkle Stars", "wire": "#d8d0e8", "colors": ["#ff5e5e", "#ffd34d", "#6bff95", "#5ec8ff", "#c77dff"]},
]
DIYA_STYLES = ["Classic Terracotta", "Painted Diya", "Lotus Diya"]
DIYA_H = [39, 39, 46]


class Model:
    def __init__(self, translucent=False, seam=False):
        self.verts, self.faces = [], []
        self.translucent, self.seam = translucent, seam
        self.u = 1.0

    def v(self, x, y, z):
        self.verts.append((x, y, z))
        return len(self.verts) - 1

    def f(self, idx, **o):
        o["v"] = list(idx)
        self.faces.append(o)

    def finalize(self):
        rng = random.Random(7)
        P = self.verts
        c = self.center
        for f in self.faces:
            a, b, d = (np.array(P[i]) for i in f["v"][:3])
            e1, e2 = b - a, d - a
            n = np.cross(e1, e2)
            cen = np.mean([P[i] for i in f["v"]], axis=0)
            ref = np.array(f.get("out", cen - np.array(c)))
            f["sg"] = 1.0 if float(np.dot(n, ref)) >= 0 else -1.0
            u1 = e1 / (np.linalg.norm(e1) or 1)
            nn = n / (np.linalg.norm(n) or 1)
            u2 = np.cross(nn, u1)
            f["t"] = [(float(np.dot(np.array(P[i]) - a, u1)), float(np.dot(np.array(P[i]) - a, u2))) for i in f["v"]]
            xs = [q[0] for q in f["t"]]
            ys = [q[1] for q in f["t"]]
            f["tc"] = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)
            f["rgb"] = hex2rgb(f["col"])
            for dc in f.get("decals") or []:
                if dc.get("bary"):
                    dc["p"] = (sum(w * f["t"][k][0] for k, w in enumerate(dc["bary"])),
                               sum(w * f["t"][k][1] for k, w in enumerate(dc["bary"])))
                else:
                    dc["p"] = f["tc"]
            if f.get("glitter"):
                f["gl"] = [(rng.random(), rng.random(), rng.random() * TAU) for _ in range(4)]
        self.V = np.array(P, dtype=np.float64)
        F = len(self.faces)
        self.i0 = np.array([f["v"][0] for f in self.faces])
        self.i1 = np.array([f["v"][1] for f in self.faces])
        self.i2 = np.array([f["v"][2] for f in self.faces])
        self.sg = np.array([f["sg"] for f in self.faces])
        self.zb = np.array([f.get("zb", 0.0) for f in self.faces])
        self.avg = np.zeros((F, len(P)))
        for k, f in enumerate(self.faces):
            self.avg[k, f["v"]] = 1.0 / len(f["v"])
        self.C = np.array(c, dtype=np.float64)
        return self


def akash_model(u):
    md = Model(translucent=True)
    N, W, H = 6, 122 * u, 180 * u
    R = W / 2
    y1, y2, y3, y4, a0 = 12 * u, H * 0.3, H * 0.64, H * 0.9, math.pi / 6
    md.center = (0, (y2 + y3) / 2, 0)
    md.w, md.h, md.glowR, md.hookY = W, y4 + 2 * u, W * 1.05, y1

    def ring(r, y):
        return [md.v(math.cos(a0 + i * TAU / N) * r, y, math.sin(a0 + i * TAU / N) * r) for i in range(N)]
    r1, r2, r3, r4 = ring(R * 0.24, y1), ring(R, y2), ring(R, y3), ring(R * 0.16, y4)
    pal = ["#ff2b2b", "#ffc400", "#ff2e93", "#ff7300", "#1fbf62", "#2f8cff"]
    bamboo = "#6a4422"
    for i in range(N):
        j = (i + 1) % N
        md.f([r1[i], r1[j], r2[j], r2[i]], mat="tpaper", col=pal[(i + 3) % N], tex="paper", texA=0.22, edge=bamboo)
        md.f([r2[i], r2[j], r3[j], r3[i]], mat="tpaper", col=pal[i], tex="paper", texA=0.22, edge=bamboo,
             decals=[{"shape": "diamond", "r": 14 * u, "col": pal[(i + 2) % N]}, {"shape": "diamond", "r": 5.5 * u, "col": "#fff1a8"}])
        md.f([r3[i], r3[j], r4[j], r4[i]], mat="tpaper", col=pal[(i + 3) % N], tex="paper", texA=0.22, edge=bamboo)
    md.f(r1, mat="gold", col="#e0b040", out=(0, -1, 0))
    md.f(r4, mat="gold", col="#e0b040", out=(0, 1, 0))

    def frill(ids, y, drop, length, col):
        for i in range(N):
            A, B = md.verts[ids[i]], md.verts[ids[(i + 1) % N]]
            for k in range(4):
                f0, f1 = k / 4, (k + 1) / 4
                fm = (f0 + f1) / 2
                pm = (lerp(A[0], B[0], fm), y, lerp(A[2], B[2], fm))
                ol = math.hypot(pm[0], pm[2]) or 1
                md.f([md.v(lerp(A[0], B[0], f0), y, lerp(A[2], B[2], f0)), md.v(lerp(A[0], B[0], f1), y, lerp(A[2], B[2], f1)),
                      md.v(pm[0] + pm[0] / ol * length * 0.55, y + drop, pm[2] + pm[2] / ol * length * 0.55)],
                     mat="tpaper", col=col, out=(pm[0], 0, pm[2]), zb=0.6)
    frill(r2, y2, 8 * u, 10 * u, "#ffd23f")
    frill(r3, y3, 13 * u, 12 * u, "#ffd23f")
    return md


def star_model(u):
    md = Model()
    R, r, t, d = 80 * u, 35 * u, 7 * u, 22 * u
    cy = 16 * u + R
    md.center = (0, cy, 0)
    md.w, md.h, md.glowR, md.hookY = R * 2, cy + R * 0.82, R * 1.5, cy - R
    oF, oB = [], []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 else R
        oF.append(md.v(math.cos(a) * rr, cy + math.sin(a) * rr, t))
        oB.append(md.v(math.cos(a) * rr, cy + math.sin(a) * rr, -t))
    aF, aB = md.v(0, cy, t + d), md.v(0, cy, -t - d)
    foil = ["#e8b02a", "#d7263d"]
    for i in range(10):
        j = (i + 1) % 10
        tip1 = i % 2 == 0
        holes = [{"shape": "hole", "bary": [0.3, 0.35, 0.35], "r": 3.6 * u},
                 {"shape": "hole", "bary": [0.12, 0.7, 0.18] if tip1 else [0.12, 0.18, 0.7], "r": 2.3 * u},
                 {"shape": "hole", "bary": [0.66, 0.17, 0.17], "r": 2 * u}]
        md.f([aF, oF[i], oF[j]], mat="foam", col="#f4f1ea", tex="foam", texA=0.6, decals=holes, edge="#968c7d", edgeA=0.4, edgeW=0.7 * u)
        md.f([aB, oB[j], oB[i]], mat="foam", col="#f4f1ea", tex="foam", texA=0.6)
        md.f([oF[i], oB[i], oB[j], oF[j]], mat="foil", col=foil[i % 2], glitter=True)
    return md


def globe_model(u):
    md = Model(seam=True)
    R = 64 * u
    ry = R * 0.9
    cy = 22 * u + ry
    md.center = (0, cy, 0)
    md.w, md.R, md.ry, md.glowR = R * 2, R, ry, R * 1.9
    nLat, nLon, lat1 = 12, 18, 1.2
    grid = []
    for k in range(nLat + 1):
        ph = lerp(lat1, -lat1, k / nLat)
        rr = R * math.cos(ph) * (0.965 if k % 2 else 1)
        y = cy - ry * math.sin(ph)
        grid.append([md.v(math.cos(i * TAU / nLon) * rr, y, math.sin(i * TAU / nLon) * rr) for i in range(nLon)])
    for k in range(nLat):
        for i in range(nLon):
            j = (i + 1) % nLon
            eq = k in (5, 6)
            md.f([grid[k][i], grid[k][j], grid[k + 1][j], grid[k + 1][i]], mat="gpaper", col="#f0b232" if eq else "#d8262d",
                 edge="#500c0a", edgeA=0.5, edgeW=0.9 * u, edgeSeg=(grid[k][i], grid[k][j]),
                 decals=[{"shape": "dot", "r": 2.8 * u, "col": "#b3121e"}] if eq and i % 2 == 0 else None)
    yT, yB = cy - ry * math.sin(lat1), cy + ry * math.sin(lat1)
    rc = R * math.cos(lat1) * 1.04

    def cap(ya, yb, top):
        a, b = [], []
        for i in range(0, nLon, 2):
            an = i * TAU / nLon
            a.append(md.v(math.cos(an) * rc, ya, math.sin(an) * rc))
            b.append(md.v(math.cos(an) * rc, yb, math.sin(an) * rc))
        for i in range(len(a)):
            j = (i + 1) % len(a)
            md.f([a[i], a[j], b[j], b[i]], mat="card", col="#2a1c14", out=(md.verts[a[i]][0], 0, md.verts[a[i]][2]))
        md.f(a if top else b, mat="gold", col="#c99a2e", out=(0, -1 if top else 1, 0))
    cap(yT - 5 * u, yT + 2 * u, True)
    cap(yB - 2 * u, yB + 6 * u, False)
    md.hookY, md.h = yT - 5 * u, yB + 6 * u
    return md


_MODELS = {}


def lantern_model(style, u):
    u = round(u * 200) / 200
    key = (style, u)
    md = _MODELS.get(key)
    if md is None:
        if len(_MODELS) > 30:
            _MODELS.clear()
        md = (akash_model, star_model, globe_model)[style](u)
        md.u = u
        md.finalize()
        _MODELS[key] = md
    return md


def face_color(f, n, lvl, flick):
    lam = max(0.0, n[0] * LDIR[0] + n[1] * LDIR[1] + n[2] * LDIR[2])
    front = n[2] > 0
    m, rgb = f["mat"], f["rgb"]
    if m == "tpaper":
        ext = 0.25 + 0.6 * lam if front else 0.16
        em = lvl * flick * (0.6 + 0.48 * n[2] if front else 0.95)
        return shade(rgb, ext * (1 - 0.55 * lvl) + em)
    if m == "foam":
        base = mix_rgb(rgb, "#ffe2b0", 0.42 * lvl) if lvl > 0.01 else rgb
        return shade(base, 0.48 + 0.58 * lam + 0.2 * lvl * flick)
    spec = lambda pw: max(0.0, n[0] * HV[0] + n[1] * HV[1] + n[2] * HV[2]) ** pw
    if m == "foil":
        return shade(rgb, 0.42 + 0.5 * lam + 1.2 * spec(14) + 0.2 * lvl)
    if m == "gpaper":
        ext = 0.28 + 0.5 * lam
        em = lvl * flick * (0.22 + 0.95 * max(0.0, n[2]) ** 1.6)
        return shade(rgb, ext * (1 - 0.5 * lvl) + em)
    if m == "gold":
        return shade(rgb, 0.4 + 0.55 * lam + 0.9 * spec(10) + 0.15 * lvl)
    return shade(rgb, 0.3 + 0.6 * lam + 0.1 * lvl)


def tex_affine(P, f):
    i0, i1, i2 = f["v"][:3]
    (u0, v0), (ua, va), (ub, vb) = f["t"][:3]
    du1, dv1, du2, dv2 = ua - u0, va - v0, ub - u0, vb - v0
    det = du1 * dv2 - du2 * dv1
    if abs(det) < 1e-6:
        return None
    x0, y0 = P[i0][0], P[i0][1]
    dx1, dy1, dx2, dy2 = P[i1][0] - x0, P[i1][1] - y0, P[i2][0] - x0, P[i2][1] - y0
    a = (dx1 * dv2 - dx2 * dv1) / det
    c = (dx2 * du1 - dx1 * du2) / det
    b = (dy1 * dv2 - dy2 * dv1) / det
    d = (dy2 * du1 - dy1 * du2) / det
    if abs(a * d - b * c) < 1e-4:
        return None
    return QTransform(a, b, c, d, x0 - a * u0 - c * v0, y0 - b * u0 - d * v0)


def draw_decal(p, dc, lvl, flick, alpha):
    x, y = dc["p"]
    r = dc["r"]
    p.setPen(NOPEN)
    if dc["shape"] == "diamond":
        p.setOpacity(alpha * 0.85)
        p.setBrush(face_color({"mat": "tpaper", "rgb": hex2rgb(dc["col"])}, (0, 0, 1), lvl, flick))
        p.drawPolygon(QPolygonF([QPointF(x, y - r * 1.45), QPointF(x + r, y), QPointF(x, y + r * 1.45), QPointF(x - r, y)]))
    elif dc["shape"] == "hole":
        p.setOpacity(alpha)
        p.setBrush(shade("#ffd06a", 0.65 + 0.6 * lvl * flick) if lvl > 0.02 else qc("#3b2e24"))
        p.setPen(QPen(QColor(80, 60, 40, 115), r * 0.25))
        p.drawEllipse(QPointF(x, y), r, r)
        if lvl > 0.05:
            p.setCompositionMode(PLUS)
            glow(p, x, y, r * 3, "#ffc860", lvl * 0.8)
            p.setCompositionMode(OVER)
    elif dc["shape"] == "dot":
        p.setOpacity(alpha)
        p.setBrush(face_color({"mat": "gpaper", "rgb": hex2rgb(dc["col"])}, (0, 0, 1), lvl, flick))
        p.drawEllipse(QPointF(x, y), r, r)
    p.setOpacity(alpha)


def draw_model(p, md, yaw, lvl, t, light, flick=1.0):
    c = md.C
    V = md.V - c
    cyw, syw, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(PITCH), math.sin(PITCH)
    x1 = V[:, 0] * cyw + V[:, 2] * syw
    z1 = -V[:, 0] * syw + V[:, 2] * cyw
    Px = x1 + c[0]
    Py = V[:, 1] * cp - z1 * sp + c[1]
    Pz = V[:, 1] * sp + z1 * cp
    P3 = np.stack([Px, Py, Pz], axis=1)
    e1 = P3[md.i1] - P3[md.i0]
    e2 = P3[md.i2] - P3[md.i0]
    N = np.cross(e1, e2)
    nrm = np.linalg.norm(N, axis=1)
    nrm[nrm == 0] = 1.0
    N = N / nrm[:, None] * md.sg[:, None]
    Z = md.avg @ Pz + md.zb * md.u
    order = np.argsort(Z)
    P = P3.tolist()
    Nl = N.tolist()
    seam_pen = None

    def draw_face(k, alpha):
        f, n = md.faces[k], Nl[k]
        poly = QPolygonF([QPointF(P[i][0], P[i][1]) for i in f["v"]])
        col = face_color(f, n, lvl, flick)
        p.setOpacity(alpha)
        p.setBrush(col)
        p.setPen(QPen(col, 0.9) if md.seam else NOPEN)
        p.drawPolygon(poly)
        tr = None
        if f.get("tex") or f.get("decals"):
            tr = tex_affine(P, f)
        if tr is not None and f.get("tex"):
            br = QBrush(texture(f["tex"]))
            br.setTransform(tr)
            p.setOpacity(alpha * f["texA"])
            p.setPen(NOPEN)
            p.setBrush(br)
            p.drawPolygon(poly)
            p.setOpacity(alpha)
        if tr is not None and f.get("decals") and n[2] > -0.05:
            p.save()
            p.setTransform(tr, True)
            for dc in f["decals"]:
                draw_decal(p, dc, lvl, flick, alpha)
            p.restore()
        if f.get("gl"):
            A, B, C2 = P[f["v"][0]], P[f["v"][1]], P[f["v"][2]]
            p.setCompositionMode(PLUS)
            for (a, q, ph) in f["gl"]:
                s = max(0.0, math.sin(t * 3.1 + ph)) ** 10
                if s < 0.05:
                    continue
                x = A[0] + (B[0] - A[0]) * a + (C2[0] - B[0]) * q * a
                y = A[1] + (B[1] - A[1]) * a + (C2[1] - B[1]) * q * a
                glow(p, x, y, 4 * md.u, "#fff6d0", s)
            p.setCompositionMode(OVER)
            p.setOpacity(alpha)
        if f.get("edge"):
            p.setOpacity(alpha * (1 if n[2] > 0 else 0.55) * f.get("edgeA", 1.0))
            p.setPen(QPen(qc(f["edge"]), f.get("edgeW", 1.2 * md.u), Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin))
            p.setBrush(Qt.BrushStyle.NoBrush)
            if f.get("edgeSeg"):
                a, b = f["edgeSeg"]
                p.drawLine(QPointF(P[a][0], P[a][1]), QPointF(P[b][0], P[b][1]))
            else:
                p.drawPolygon(poly)
        p.setOpacity(1.0)

    if md.translucent:
        for k in order:
            if Nl[k][2] <= 0:
                draw_face(k, 0.97)
        if lvl > 0.01 and light:
            r = md.glowR * 0.6
            p.setCompositionMode(PLUS)
            glow(p, c[0], c[1], r * 0.4, "#fff2c8", lvl * flick * 0.9)
            glow(p, c[0], c[1], r, light, lvl * flick * 0.9)
            p.setCompositionMode(OVER)
        for k in order:
            if Nl[k][2] > 0:
                draw_face(k, 0.8 - 0.12 * lvl if lvl > 0.01 else 0.93)
    else:
        for k in order:
            if Nl[k][2] > 0.001:
                draw_face(k, 1.0)


def draw_lantern_model(p, style, md, yaw, lvl, t):
    """Kandil in its local frame (hook at 0,0). Glows that flicker are drawn by the caller."""
    u, c = md.u, md.C
    p.setPen(QPen(qc("#8c7a5a"), 1.4 * u, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
    p.setBrush(Qt.BrushStyle.NoBrush)
    p.drawLine(QPointF(0, 0), QPointF(0, md.hookY))
    p.drawEllipse(QPointF(0, 2.5 * u), 2.5 * u, 2.5 * u)
    draw_model(p, md, yaw, lvl, t, LANTERN_STYLES[style][1])
    if style == 2:  # paper grain over the globe
        p.save()
        p.setClipPath(ell_path(c[0], c[1], md.R * 0.99, md.ry))
        p.setOpacity(0.16)
        p.fillRect(QRectF(c[0] - md.R, c[1] - md.ry, md.R * 2, md.ry * 2), QBrush(texture("paper")))
        p.restore()

# ----------------------------------------------------------------------------- diya drawing


CLAY = [
    {"lit": "#d8834a", "mid": "#b05628", "dark": "#56220c", "lip1": "#dc8d55", "lip2": "#7a3414", "inner": "#6a2a10", "painted": False},
    {"lit": "#e2493a", "mid": "#b4241c", "dark": "#560c08", "lip1": "#f6cf5c", "lip2": "#a3751a", "inner": "#5a1a10", "painted": True},
]


def diya_wick(style, s):
    return (0.0, -33 * s) if style == 2 else (0.0, -11 * s)


def draw_wick(p, x, yb, yt, s):
    p.setPen(QPen(qc("#ece0c4"), 2.3 * s, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
    p.drawLine(QPointF(x, yb), QPointF(x, yt + 1.2 * s))
    p.setPen(QPen(qc("#22140c"), 2.3 * s, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
    p.drawLine(QPointF(x, yt + 1.2 * s), QPointF(x, yt))


def painted_motifs(p, s, rimY, rx):
    p.setBrush(Qt.BrushStyle.NoBrush)
    p.setPen(QPen(qc("#f2c14e"), 1.7 * s))
    for cy, erx, ery, a0, a1 in ((rimY + 3.5 * s, rx * 0.97, 12 * s, 0.06, 0.94), (rimY + 13 * s, rx * 0.66, 8 * s, 0.1, 0.9)):
        path = QPainterPath(QPointF(erx * math.cos(a0 * math.pi), cy + ery * math.sin(a0 * math.pi)))
        ellipse_arc(path, 0, cy, erx, ery, a0 * math.pi, a1 * math.pi)
        p.drawPath(path)
    p.setPen(NOPEN)
    p.setBrush(qc("#fff6e0"))
    for i in range(15):
        a = lerp(0.1, 0.9, i / 14) * math.pi
        sz = (0.45 + 0.55 * math.sin(a)) * 1.4 * s
        p.drawEllipse(QPointF(math.cos(a) * rx * 0.86, rimY + 8.5 * s + math.sin(a) * 10 * s), sz, sz)
    p.setBrush(qc("#2fae66"))
    for i in range(9):
        a = lerp(0.15, 0.85, i / 8) * math.pi
        sq = math.sin(a)
        p.save()
        p.translate(math.cos(a) * rx * 0.62, rimY + 17 * s + math.sin(a) * 4.5 * s)
        p.rotate(math.degrees(-math.cos(a) * 0.7))
        p.drawEllipse(QPointF(0, 0), 3.4 * s * sq + 0.6 * s, 1.5 * s)
        p.restore()


def clay_diya(p, s, pal, lvl):
    rimY, rx, ry, fy, fx = -25 * s, 38 * s, 12.5 * s, -5 * s, 17 * s
    p.setPen(NOPEN)
    p.setBrush(QColor(0, 0, 0, 115))
    p.drawEllipse(QPointF(0, 0.5 * s), 45 * s, 6.5 * s)
    body = QPainterPath(QPointF(-rx, rimY))
    body.cubicTo(-rx * 0.97, rimY + 15 * s, -fx * 1.35, fy, -fx, fy)
    ellipse_arc(body, 0, fy, fx, fx * 0.3, math.pi, 0, ccw=True)
    body.cubicTo(fx * 1.35, fy, rx * 0.97, rimY + 15 * s, rx, rimY)
    ellipse_arc(body, 0, rimY, rx, ry, 0, math.pi)
    body.closeSubpath()
    gr = QLinearGradient(-rx, 0, rx, 0)
    gr.setColorAt(0, qc(pal["lit"]))
    gr.setColorAt(0.42, qc(pal["mid"]))
    gr.setColorAt(1, qc(pal["dark"]))
    p.setBrush(gr)
    p.drawPath(body)
    p.save()
    p.setClipPath(body)
    area = QRectF(-rx, rimY - ry, rx * 2, 40 * s)
    vg = QLinearGradient(0, rimY, 0, 1 * s)
    vg.setColorAt(0, QColor(0, 0, 0, 0))
    vg.setColorAt(1, QColor(0, 0, 0, 107))
    p.fillRect(area, vg)
    hl = QRadialGradient(QPointF(-rx * 0.55, rimY + 8 * s), 16 * s)
    hl.setColorAt(0, QColor(255, 230, 200, 56))
    hl.setColorAt(1, QColor(255, 230, 200, 0))
    p.fillRect(area, hl)
    if pal["painted"]:
        painted_motifs(p, s, rimY, rx)
    p.setOpacity(0.28 if pal["painted"] else 0.5)
    p.fillRect(area, QBrush(texture("clay")))
    p.setOpacity(1.0)
    if lvl > 0.02:
        p.setCompositionMode(PLUS)
        fl = QRadialGradient(QPointF(0, -12 * s), 34 * s)
        fl.setColorAt(0, QColor(255, 150, 60, int(51 * lvl)))
        fl.setColorAt(1, QColor(255, 150, 60, 0))
        p.fillRect(area, fl)
        p.setCompositionMode(OVER)
    p.restore()
    rxi, ryi = rx - 4.6 * s, ry - 1.7 * s
    ring = QPainterPath()
    ring.setFillRule(Qt.FillRule.OddEvenFill)
    ring.addEllipse(QPointF(0, rimY), rx, ry)
    ring.addEllipse(QPointF(0, rimY + 0.4 * s), rxi, ryi)
    lg = QLinearGradient(-rx, 0, rx, 0)
    lg.setColorAt(0, qc(pal["lip1"]))
    lg.setColorAt(1, qc(pal["lip2"]))
    p.setPen(NOPEN)
    p.setBrush(lg)
    p.drawPath(ring)
    if pal["painted"]:
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.setPen(QPen(QColor(255, 240, 200, 128), 0.8 * s))
        p.drawEllipse(QPointF(0, rimY), rx - 2.2 * s, ry - 0.8 * s)
        p.setPen(NOPEN)
    ig = QLinearGradient(0, rimY - ryi, 0, rimY + ryi)
    ig.setColorAt(0, qc(mix_rgb(pal["inner"], "#e07a30", 0.35 * lvl)))
    ig.setColorAt(1, qc("#1c0a04"))
    p.setBrush(ig)
    p.drawEllipse(QPointF(0, rimY + 0.4 * s), rxi, ryi)
    og = QRadialGradient(QPointF(0, rimY + 3.2 * s), rxi * 0.8, QPointF(0, rimY + 6 * s))
    og.setColorAt(0, qc(mix_rgb("#8a5e18", "#ffd27a", 0.6 * lvl)))
    og.setColorAt(1, qc("#3e2806"))
    p.setBrush(og)
    p.drawEllipse(QPointF(0, rimY + 3.2 * s), rxi * 0.8, ryi * 0.62)
    if lvl > 0.05:
        p.setBrush(QColor(255, 236, 170, int(140 * lvl)))
        p.drawEllipse(QPointF(0, rimY + 6 * s), 5 * s, 1.3 * s)
    spout = QPainterPath(QPointF(-13 * s, -13.6 * s))
    spout.quadTo(-7 * s, -6.2 * s, 0, -4.6 * s)
    spout.quadTo(7 * s, -6.2 * s, 13 * s, -13.6 * s)
    spout.closeSubpath()
    sg = QLinearGradient(0, -14 * s, 0, -4.6 * s)
    sg.setColorAt(0, qc(pal["lip1"]))
    sg.setColorAt(1, qc(pal["mid"]))
    p.setBrush(sg)
    p.drawPath(spout)
    under = QPainterPath(QPointF(-12 * s, -12.4 * s))
    under.quadTo(-7 * s, -5.6 * s, 0, -4.2 * s)
    under.quadTo(7 * s, -5.6 * s, 12 * s, -12.4 * s)
    p.setBrush(Qt.BrushStyle.NoBrush)
    p.setPen(QPen(QColor(40, 12, 2, 140), 1.2 * s))
    p.drawPath(under)
    ch = QPainterPath(QPointF(-6.5 * s, -13.4 * s))
    ch.quadTo(-3 * s, -8 * s, 0, -7.2 * s)
    ch.quadTo(3 * s, -8 * s, 6.5 * s, -13.4 * s)
    ch.closeSubpath()
    p.setPen(NOPEN)
    p.setBrush(qc(mix_rgb("#5a3c0e", "#c08a30", 0.5 * lvl)))
    p.drawPath(ch)
    draw_wick(p, 0, -7.4 * s, -11 * s, s)


def lotus_diya(p, s, lvl):
    p.setPen(NOPEN)
    p.setBrush(QColor(0, 0, 0, 115))
    p.drawEllipse(QPointF(0, 0.5 * s), 42 * s, 6.5 * s)
    p.setBrush(qc("#2b5420"))
    p.drawEllipse(QPointF(0, -2 * s), 37 * s, 9 * s)
    pg = QLinearGradient(-36 * s, 0, 36 * s, 0)
    pg.setColorAt(0, qc("#79b84c"))
    pg.setColorAt(1, qc("#3d6e28"))
    p.setBrush(pg)
    p.drawEllipse(QPointF(0, -4 * s), 35.5 * s, 8.4 * s)
    p.setPen(QPen(QColor(30, 60, 20, 128), 0.7 * s))
    for i in range(12):
        a = i * TAU / 12
        p.drawLine(QPointF(0, -4 * s), QPointF(math.cos(a) * 33 * s, -4 * s + math.sin(a) * 7.8 * s))
    K, petals = 0.34, []

    def ring(n, R0, yb, ln, wid, off, cb, ct):
        for i in range(n):
            th = off + i * TAU / n
            petals.append((math.sin(th) * R0, th, R0, yb, ln, wid, cb, ct))
    ring(10, 22 * s, -6 * s, 30 * s, 11 * s, 0.1, "#d23f78", "#ffd3e4")
    ring(8, 13 * s, -12 * s, 25 * s, 9 * s, 0.1 + TAU / 16, "#e2588e", "#fff0f5")
    petals.sort(key=lambda q: q[0])

    def petal(q):
        _z, th, R0, yb, ln, wid, cb, ct = q
        c, sn = math.cos(th), math.sin(th)
        R1 = R0 + ln * 0.42
        bx, by, tx, ty = c * R0, yb + sn * R0 * K, c * R1, yb - ln * 0.88 + sn * R1 * K
        wv = wid * (0.3 + 0.7 * abs(sn)) + wid * 0.12
        dx, dy = tx - bx, ty - by
        dl = math.hypot(dx, dy) or 1
        nx, ny = -dy / dl, dx / dl
        path = QPainterPath(QPointF(bx, by))
        path.cubicTo(bx + nx * wv, by + ny * wv, tx + nx * wv * 0.55 - dx * 0.15, ty + ny * wv * 0.55 - dy * 0.15, tx, ty)
        path.cubicTo(tx - nx * wv * 0.55 - dx * 0.15, ty - ny * wv * 0.55 - dy * 0.15, bx - nx * wv, by - ny * wv, bx, by)
        f = 0.68 + 0.15 * math.cos(th - math.pi) + 0.15 + (0.22 if sn < 0 else 0.06) * lvl
        gr = QLinearGradient(bx, by, tx, ty)
        gr.setColorAt(0, shade(cb, f * 0.85))
        gr.setColorAt(1, shade(ct, f))
        p.setBrush(gr)
        p.setPen(QPen(shade(cb, 0.55), 0.7 * s))
        p.drawPath(path)
        rib = QPainterPath(QPointF(bx, by))
        rib.quadTo((bx + tx) / 2 + nx * wv * 0.1, (by + ty) / 2, tx, ty)
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.setPen(QPen(QColor(255, 255, 255, 71), 0.7 * s))
        p.drawPath(rib)
    for q in petals:
        if q[0] < 0:
            petal(q)
    cup = QPainterPath(QPointF(-14 * s, -30 * s))
    cup.cubicTo(-13 * s, -24 * s, -7 * s, -20.5 * s, 0, -20.5 * s)
    cup.cubicTo(7 * s, -20.5 * s, 13 * s, -24 * s, 14 * s, -30 * s)
    ellipse_arc(cup, 0, -30 * s, 14 * s, 4.8 * s, 0, math.pi)
    cup.closeSubpath()
    bg = QLinearGradient(-14 * s, 0, 14 * s, 0)
    bg.setColorAt(0, qc("#f6d57a"))
    bg.setColorAt(0.35, qc("#d9a640"))
    bg.setColorAt(1, qc("#6b4710"))
    p.setPen(NOPEN)
    p.setBrush(bg)
    p.drawPath(cup)
    rim = QPainterPath()
    rim.setFillRule(Qt.FillRule.OddEvenFill)
    rim.addEllipse(QPointF(0, -30 * s), 14 * s, 4.8 * s)
    rim.addEllipse(QPointF(0, -29.8 * s), 11.6 * s, 3.7 * s)
    rg = QLinearGradient(-14 * s, 0, 14 * s, 0)
    rg.setColorAt(0, qc("#fff0b0"))
    rg.setColorAt(1, qc("#a8761c"))
    p.setBrush(rg)
    p.drawPath(rim)
    ig = QLinearGradient(0, -33.5 * s, 0, -26 * s)
    ig.setColorAt(0, qc(mix_rgb("#6b4a14", "#ffb04a", 0.5 * lvl)))
    ig.setColorAt(1, qc("#1c1004"))
    p.setBrush(ig)
    p.drawEllipse(QPointF(0, -29.8 * s), 11.6 * s, 3.7 * s)
    p.setBrush(qc(mix_rgb("#7a5416", "#ffd27a", 0.55 * lvl)))
    p.drawEllipse(QPointF(0, -28.6 * s), 8.6 * s, 2.3 * s)
    draw_wick(p, 0, -28.8 * s, -33 * s, s)
    for q in petals:
        if q[0] >= 0:
            petal(q)


def draw_diya_body(p, style, s, lvl):
    if style == 2:
        lotus_diya(p, s, lvl)
    else:
        clay_diya(p, s, CLAY[style], lvl)


def draw_flame(p, x, y, u, lvl, lean, t):
    if lvl < 0.02:
        return
    fl = 1 + math.sin(t * 11.3) * 0.06 + math.sin(t * 17.9 + 1) * 0.05 + math.sin(t * 5.1) * 0.04
    h, w = 30 * u * lvl * fl, 8 * u * lvl
    tipX = x + lean * h * 0.8 + math.sin(t * 7.7) * 0.8 * u
    p.setCompositionMode(PLUS)
    glow(p, x, y - h * 0.6, 75 * u, "#ff9d2e", 0.5 * lvl)
    glow(p, x, y - h * 0.6, 26 * u, "#ffd27a", 0.42 * lvl)
    p.setCompositionMode(OVER)
    p.setPen(NOPEN)
    p.setOpacity(lvl)
    for sc, col in ((1, QColor(255, 120, 20, 217)), (0.78, QColor(255, 190, 50, 242)), (0.5, QColor(255, 245, 200, 255))):
        path = QPainterPath(QPointF(x - w * sc, y))
        path.cubicTo(x - w * sc * 1.15, y - h * sc * 0.45, lerp(x, tipX, 0.6) - w * sc * 0.3, y - h * sc * 0.75, lerp(x, tipX, sc), y - h * sc)
        path.cubicTo(lerp(x, tipX, 0.6) + w * sc * 0.3, y - h * sc * 0.75, x + w * sc * 1.15, y - h * sc * 0.45, x + w * sc, y)
        path.quadTo(x, y + w * sc * 0.7, x - w * sc, y)
        p.setBrush(col)
        p.drawPath(path)
    p.setBrush(QColor(90, 140, 255, 140))
    p.drawEllipse(QPointF(x, y - 1.5 * u), w * 0.45, w * 0.35)
    p.setOpacity(1.0)

# ----------------------------------------------------------------------------- the scene


class Scene:
    """All state and behaviour; drawing goes to any QPainter (window or test image)."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.W = self.H = 1
        self.U, self.floorY, self.dpr = 1.0, 1.0, 1.0
        self.M = Pointer()
        self.parts, self.crackers = [], []
        self.lantern = self.lights = self.diya = None
        self.press = None
        self.last_tap = (0.0, 0.0, 0.0)
        self.sparkler_until = 0.0
        self.shake = 0.0
        self.t = 0.0
        self.hint = None
        self.rs = {"lan": 0.0, "diya": 0.0, "active": None, "start": None}
        self.lan_cache = None
        self.diya_cache = None

    # ---------------------------------------------------------------- setup
    def resize(self, W, H, dpr=1.0):
        self.W, self.H, self.dpr = W, H, dpr
        self.U = clamp(min(W / 560, H / 770), 0.62, 1.25)
        self.floorY = H - 1
        on = self.lantern["on"] if self.lantern else True
        self.lantern = None
        self.build_lantern()
        self.lantern["on"] = on
        self.build_lights()
        self.build_diya()

    def now(self):
        return time.perf_counter()

    def show_hint(self, text, secs=3.5):
        self.hint = (text, self.now() + secs)

    # ---------------------------------------------------------------- verlet
    def integrate(self, p, damp=0.992, g=None):
        if p.pinned:
            return
        g = 0.32 * self.U if g is None else g
        vx, vy = (p.x - p.px) * damp, (p.y - p.py) * damp
        p.px, p.py = p.x, p.y
        p.x += vx
        p.y += vy + g

    @staticmethod
    def solve(c):
        a, b, ln, rope = c
        dx, dy = b.x - a.x, b.y - a.y
        d = math.hypot(dx, dy) or 1e-4
        if rope and d < ln:
            return
        wa = 0 if a.pinned else a.im
        wb = 0 if b.pinned else b.im
        sm = wa + wb
        if not sm:
            return
        k = (d - ln) / d / sm
        a.x += dx * k * wa
        a.y += dy * k * wa
        b.x -= dx * k * wb
        b.y -= dy * k * wb

    def collide(self, p, r, fric=0.82, bounce=0.28):
        if p.pinned:
            return
        if p.y > self.floorY - r:
            vy, vx = p.y - p.py, p.x - p.px
            p.y = self.floorY - r
            p.py = p.y + vy * bounce
            p.px = p.x - vx * fric
        if p.x < r:
            vx = p.x - p.px
            p.x = r
            p.px = p.x + vx * 0.4
        if p.x > self.W - r:
            vx = p.x - p.px
            p.x = self.W - r
            p.px = p.x + vx * 0.4

    def hand_touch(self, p, reach, strength=0.55):
        M = self.M
        if not M.inside or p.pinned:
            return
        dx, dy = p.x - M.x, p.y - M.y
        d = math.hypot(dx, dy)
        if d > reach or d < 1e-3:
            return
        f = 1 - d / reach
        if math.hypot(M.vx, M.vy) > 0.2:
            p.x += clamp(M.vx, -40, 40) * f * strength
            p.y += clamp(M.vy, -40, 40) * f * strength * 0.8
        push = reach * 0.35 - d
        if push > 0:
            p.x += dx / d * push * 0.25
            p.y += dy / d * push * 0.25

    # ---------------------------------------------------------------- particles
    def add_p(self, x, y, vx=0.0, vy=0.0, mx=1.0, g=0.0, drag=0.98, size=2.0, typ="dot", col="#ffd36b",
              add=True, seed=0.0, spin=0.0, floor=False, trail=0.0):
        if len(self.parts) >= 900:
            return
        q = Part()
        q.x, q.y, q.vx, q.vy, q.life, q.max, q.g, q.drag, q.size = x, y, vx, vy, 0.0, mx, g, drag, size
        q.type, q.col, q.qc, q.add, q.seed, q.spin, q.floor, q.trail = typ, col, qc(col), add, seed, spin, floor, trail
        self.parts.append(q)

    def sparkle_burst(self, x, y, n=18):
        U = self.U
        for _ in range(n):
            a, v = rand(0, TAU), rand(1.2, 4.2) * U
            self.add_p(x, y, math.cos(a) * v, math.sin(a) * v - 0.6 * U, rand(0.45, 0.95), 0.06 * U, size=rand(1.4, 3.2) * U,
                       typ="star" if random.random() < 0.45 else "spark", col=pick(["#fff3b0", "#ffd36b", "#ffb03a", "#ffffff", "#ffe08a"]))
        self.add_p(x, y, mx=0.35, typ="ring", size=4 * U, col="#ffe7a3")
        self.add_p(x, y, mx=0.22, typ="flash", size=26 * U, col="#ffd36b")

    def smoke(self, x, y, n, spread=1.0, big=1.0):
        U = self.U
        for _ in range(int(n)):
            self.add_p(x + rand(-4, 4) * U * spread, y, rand(-0.3, 0.3) * U * spread, rand(-0.9, -0.3) * U, rand(1.6, 3.2),
                       -0.004 * U, 0.985, rand(4, 9) * U * big, "smoke", "#bfb8c8", add=False, seed=rand(0, 10))

    def update_parts(self):
        U = self.U
        keep = []
        for q in self.parts:
            q.life += 1 / 60
            if q.life >= q.max:
                continue
            q.vx *= q.drag
            q.vy = q.vy * q.drag + q.g
            if q.type == "smoke":
                q.vx += math.sin(q.life * 3 + q.seed) * 0.02 * U
            q.x += q.vx
            q.y += q.vy
            if q.floor and q.y > self.floorY - 1:
                q.y = self.floorY - 1
                q.vy *= -0.3
                q.vx *= 0.6
            if q.trail and random.random() < q.trail and len(self.parts) + len(keep) < 900:
                t = Part()
                t.x, t.y, t.vx, t.vy, t.life, t.max, t.g, t.drag, t.size = q.x, q.y, 0, 0, 0, 0.35, 0.01 * U, 0.98, q.size * 0.6
                t.type, t.col, t.qc, t.add, t.seed, t.spin, t.floor, t.trail = "dot", q.col, q.qc, True, 0, 0, False, 0
                keep.append(t)
            keep.append(q)
        self.parts = keep

    def draw_parts(self, p, additive):
        U = self.U
        for q in self.parts:
            if q.add != additive:
                continue
            k = q.life / q.max
            a = 1 - k
            t = q.type
            if t == "smoke":
                p.setOpacity(0.22 * a * min(1, q.life * 4))
                p.setPen(NOPEN)
                p.setBrush(q.qc)
                r = q.size * (1 + k * 2.4)
                p.drawEllipse(QPointF(q.x, q.y), r, r)
            elif t == "paper":
                p.setOpacity(min(1.0, a * 2.5))
                p.save()
                p.translate(q.x, q.y)
                p.rotate(math.degrees(q.life * q.spin))
                p.fillRect(QRectF(-q.size, -q.size * 0.5, q.size * 2, q.size), q.qc)
                p.restore()
            elif t == "spark":
                p.setOpacity(a)
                p.setPen(QPen(q.qc, max(1.0, q.size * 0.6), Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
                p.drawLine(QPointF(q.x, q.y), QPointF(q.x - q.vx * 2.2, q.y - q.vy * 2.2))
            elif t == "star":
                s = q.size * (1.6 - k)
                p.setOpacity(a)
                p.setPen(QPen(q.qc, 1.2))
                p.drawLine(QPointF(q.x - s * 2, q.y), QPointF(q.x + s * 2, q.y))
                p.drawLine(QPointF(q.x, q.y - s * 2), QPointF(q.x, q.y + s * 2))
                glow(p, q.x, q.y, s * 3, q.col, a * 0.8)
            elif t == "ring":
                p.setOpacity(a * 0.7)
                p.setPen(QPen(q.qc, 1.5))
                p.setBrush(Qt.BrushStyle.NoBrush)
                r = q.size + k * 26 * U
                p.drawEllipse(QPointF(q.x, q.y), r, r)
            elif t == "flash":
                glow(p, q.x, q.y, q.size * (1 + k), q.col, a)
            elif t == "shock":
                p.setOpacity(a * 0.5)
                p.setPen(QPen(q.qc, max(0.5, 3 * U * a)))
                p.setBrush(Qt.BrushStyle.NoBrush)
                r = q.size * k
                p.drawArc(QRectF(q.x - r, q.y - r, 2 * r, 2 * r), 0, 180 * 16)
            else:
                p.setOpacity(a)
                p.setPen(NOPEN)
                p.setBrush(q.qc)
                r = q.size * (1 - k * 0.5)
                p.drawEllipse(QPointF(q.x, q.y), r, r)
        p.setOpacity(1.0)

    # ---------------------------------------------------------------- string lights
    def build_lights(self):
        W, U, style = self.W, self.U, self.cfg["lights"]
        st = LIGHT_STYLES[style]
        spans = max(2, round(W / 430))
        per = int(clamp(round(W / spans / (26 if style == 1 else 34) / U), 8, 22))
        prev_on = [b["on"] for b in self.lights["bulbs"]] if self.lights else None
        pts = []
        for s in range(spans):
            x0, x1 = 2 + s * (W - 4) / spans, 2 + (s + 1) * (W - 4) / spans
            sag = clamp((x1 - x0) * 0.09, 22 * U, 64 * U)
            for i in range(0 if s == 0 else 1, per + 1):
                f = i / per
                p = Pt(lerp(x0, x1, f), 4 + 4 * sag * f * (1 - f))
                p.pinned = i in (0, per)
                pts.append(p)
        cons = [[pts[i], pts[i + 1], math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y), True] for i in range(len(pts) - 1)]
        bulbs = []
        for p in pts:
            if p.pinned:
                continue
            b = Pt(p.x, p.y + 8 * U, 0.9)
            cons.append([p, b, (5 if style == 1 else 8) * U, False])
            i = len(bulbs)
            bulbs.append({"p": p, "b": b, "on": prev_on[i] if prev_on and i < len(prev_on) else True, "lvl": 1.0,
                          "color": st["colors"][i % len(st["colors"])], "phase": rand(0, TAU), "idx": i, "tw": rand(0.6, 1.6), "cur": "#ffffff"})
        self.lights = {"style": style, "pts": pts, "cons": cons, "bulbs": bulbs}

    def update_lights(self):
        L, U = self.lights, self.U
        for p in L["pts"]:
            self.integrate(p, 0.985)
            self.hand_touch(p, 40 * U, 0.55)
        for b in L["bulbs"]:
            self.integrate(b["b"], 0.985)
            self.hand_touch(b["b"], 30 * U, 0.6)
        for _ in range(10):
            for c in L["cons"]:
                self.solve(c)

    @staticmethod
    def bulb_level(b, style, t):
        if not b["on"]:
            return 0.0
        if style == 0:
            return 0.62 + 0.38 * math.sin(t * 3.2 - b["idx"] * 0.9)
        if style == 1:
            return 0.55 + 0.45 * (0.5 + 0.5 * math.sin(t * b["tw"] * 2.2 + b["phase"])) ** 2
        return 0.5 + 0.5 * math.sin(t * 1.4 * b["tw"] + b["phase"])

    def draw_bulb(self, p, style, x, y, ang, col, lvl, u, t, phase):
        p.save()
        p.translate(x, y)
        p.rotate(math.degrees(ang))
        p.setPen(NOPEN)
        if style == 0:
            p.fillRect(QRectF(-2.2 * u, -2 * u, 4.4 * u, 5 * u), qc("#1f4d2b"))
            path = QPainterPath(QPointF(-2.6 * u, 3 * u))
            path.quadTo(-3.6 * u, 9 * u, 0, 13 * u)
            path.quadTo(3.6 * u, 9 * u, 2.6 * u, 3 * u)
            path.closeSubpath()
            p.setBrush(shade(col, 0.7 + 0.5 * lvl) if lvl > 0.05 else shade(col, 0.35))
            p.drawPath(path)
            if lvl > 0.05:
                p.setBrush(QColor(255, 255, 255, int(140 * lvl)))
                p.drawEllipse(QPointF(-0.8 * u, 7 * u), 0.8 * u, 2.4 * u)
        elif style == 1:
            p.setBrush(shade(col, 0.8 + 0.4 * lvl) if lvl > 0.05 else qc("#6b5a44"))
            p.drawEllipse(QPointF(0, 2 * u), 2.3 * u, 2.3 * u)
        else:
            p.translate(0, 6 * u)
            p.rotate(math.degrees(math.sin(t + phase) * 0.2))
            r, rr = 6 * u, 2.6 * u
            p.setBrush(shade(col, 0.75 + 0.45 * lvl) if lvl > 0.05 else shade(col, 0.3))
            p.drawPolygon(QPolygonF([QPointF(math.cos(-math.pi / 2 + i * math.pi / 5) * (rr if i % 2 else r),
                                             math.sin(-math.pi / 2 + i * math.pi / 5) * (rr if i % 2 else r)) for i in range(10)]))
        p.restore()

    def draw_lights(self, p):
        L, U, t = self.lights, self.U, self.t
        st = LIGHT_STYLES[L["style"]]
        p.setPen(QPen(qc(st["wire"]), (1 if L["style"] == 1 else 1.8) * U, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.drawPolyline(QPolygonF([QPointF(q.x, q.y) for q in L["pts"]]))
        thin = QPen(qc(st["wire"]), 1 * U)
        for b in L["bulbs"]:
            b["lvl"] = lerp(b["lvl"], self.bulb_level(b, L["style"], t), 0.25)
            col = b["color"]
            if L["style"] == 2 and b["on"]:
                col = hsl_hex(round(((t * 20 + b["idx"] * 23) % 360) / 12) * 12 % 360)
            b["cur"] = col
            p.setPen(thin)
            p.drawLine(QPointF(b["p"].x, b["p"].y), QPointF(b["b"].x, b["b"].y))
            ang = math.atan2(-(b["b"].x - b["p"].x), b["b"].y - b["p"].y)
            self.draw_bulb(p, L["style"], b["b"].x, b["b"].y, ang, col, b["lvl"], U, t, b["phase"])
        p.setCompositionMode(PLUS)
        off = {0: 8, 1: 2, 2: 6}[L["style"]]
        for b in L["bulbs"]:
            if b["lvl"] < 0.03:
                continue
            ang = math.atan2(-(b["b"].x - b["p"].x), b["b"].y - b["p"].y)
            glow(p, b["b"].x - math.sin(ang) * off * U, b["b"].y + math.cos(ang) * off * U, (16 if L["style"] == 1 else 24) * U, b["cur"], b["lvl"] * 0.85)
        p.setCompositionMode(OVER)

    def bulb_at(self, x, y):
        best, bd = None, 16 * self.U
        for b in self.lights["bulbs"]:
            d = math.hypot(b["b"].x - x, b["b"].y + 4 * self.U - y)
            if d < bd:
                best, bd = b, d
        return best

    # ---------------------------------------------------------------- kandil
    def scale_max(self, style, rope_len):
        md1 = lantern_model(style, self.U)
        return max(0.5, min(2.6, (self.floorY - 24 * self.U - rope_len) / md1.h, (self.W * 0.85) / md1.w))

    def build_lantern(self):
        U, W, H = self.U, self.W, self.H
        style = self.cfg["lantern"]
        rope_len = clamp(H * 0.17, 50 * U, 220 * U)
        sc = clamp(self.cfg.get("lanternScale", 1.0), 0.5, self.scale_max(style, rope_len))
        md = lantern_model(style, U * sc)
        ax = clamp(W * (0.5 if W < 700 else 0.24), md.w * 0.7, W - md.w * 0.7)
        n = 10
        seg = rope_len / n
        rope = [Pt(ax, i * seg) for i in range(n + 1)]
        rope[0].pinned = True
        top, bot = Pt(ax, rope_len + 2, 0.14), Pt(ax, rope_len + md.h, 0.14)
        cons = [[rope[i], rope[i + 1], seg, True] for i in range(n)] + [[rope[n], top, 2, True]]
        self.lantern = {"style": style, "sc": sc, "md": md, "rope": rope, "top": top, "bot": bot, "cons": cons,
                        "body": [top, bot, md.h, False], "attached": True, "on": True, "lvl": 1.0, "ropeLen": rope_len,
                        "drag": None, "yaw": 0.45, "yawV": 0.006}
        self.lan_cache = None

    def set_lantern_scale(self, sc):
        L = self.lantern
        sc = clamp(sc, 0.5, self.scale_max(L["style"], L["ropeLen"]))
        L["sc"] = sc
        self.cfg["lanternScale"] = sc
        L["md"] = lantern_model(L["style"], self.U * sc)
        L["body"][2] = L["md"].h

    def frame(self):
        L = self.lantern
        dx, dy = L["bot"].x - L["top"].x, L["bot"].y - L["top"].y
        d = math.hypot(dx, dy) or 1
        return dx / d, dy / d

    def to_world(self, lx, ly):
        L = self.lantern
        ux, uy = self.frame()
        return L["top"].x + lx * uy + ly * ux, L["top"].y - lx * ux + ly * uy

    def to_local(self, x, y):
        L = self.lantern
        ux, uy = self.frame()
        rx, ry = x - L["top"].x, y - L["top"].y
        return rx * uy - ry * ux, rx * ux + ry * uy

    def lantern_hit(self, x, y):
        L = self.lantern
        if not L:
            return False
        lx, ly = self.to_local(x, y)
        return abs(lx) < L["md"].w * 0.5 and L["md"].hookY - 4 * self.U < ly < L["md"].h + 2 * self.U

    def lantern_box(self):
        L = self.lantern
        md = L["md"]
        w, pad = md.w * 0.52, 6
        pts = [self.to_world(lx, ly) for lx, ly in ((-w, md.hookY), (w, md.hookY), (w, md.h), (-w, md.h))]
        xs, ys = [q[0] for q in pts], [q[1] for q in pts]
        return {"x0": min(xs) - pad, "y0": min(ys) - pad, "x1": max(xs) + pad, "y1": max(ys) + pad, "hx": max(xs) + pad, "hy": max(ys) + pad}

    @staticmethod
    def dist_seg(px, py, a, b):
        vx, vy = b.x - a.x, b.y - a.y
        t = clamp(((px - a.x) * vx + (py - a.y) * vy) / (vx * vx + vy * vy or 1), 0, 1)
        return math.hypot(px - (a.x + vx * t), py - (a.y + vy * t))

    def cord_at(self, x, y):
        L = self.lantern
        if not L or not L["attached"]:
            return False
        pts = L["rope"] + [L["top"]]
        return any(self.dist_seg(x, y, pts[i], pts[i + 1]) < 7 * self.U for i in range(1, len(pts) - 1))

    def snap_lantern(self, why=None):
        L = self.lantern
        if not L or not L["attached"]:
            return
        L["attached"] = False
        L["cons"] = [c for c in L["cons"] if c[1] is not L["top"]]
        U = self.U
        for _ in range(8):
            self.add_p(L["top"].x, L["top"].y, rand(-2, 2) * U, rand(-2, 1) * U, 0.5, 0.1 * U, size=1.5 * U, typ="spark", col="#fff2c0")
        if why:
            self.show_hint(why, 2.2)

    def update_lantern(self):
        L, U, M = self.lantern, self.U, self.M
        L["lvl"] = lerp(L["lvl"], 1.0 if L["on"] else 0.0, 0.12)
        for p in L["rope"]:
            self.integrate(p, 0.985)
            self.hand_touch(p, 26 * U, 0.4)
        top, bot = L["top"], L["bot"]
        if not L["drag"]:
            self.integrate(top, 0.996)
            self.integrate(bot, 0.996)
        else:
            self.integrate(bot, 0.99)
            dr = L["drag"]
            tx, ty = M.x - dr["ox"], M.y - dr["oy"]
            if L["attached"]:
                ax, ay = L["rope"][0].x, L["rope"][0].y
                dx, dy = tx - ax, ty - ay
                d = math.hypot(dx, dy) or 1
                maxR = L["ropeLen"] * 1.05
                over = d - maxR
                downward = dy > L["ropeLen"] * 0.9 and abs(dx) < dy * 0.9
                if (downward and over > L["ropeLen"] * 0.55) or over > L["ropeLen"] * 3.2:
                    self.snap_lantern("Plucked! It falls to the floor.")
                elif over > 0:
                    tx = ax + dx / d * (maxR + over * 0.08)
                    ty = ay + dy / d * (maxR + over * 0.08)
                    if over > L["ropeLen"] * 0.3 and not dr.get("hinted"):
                        dr["hinted"] = True
                        self.show_hint("Pull straight down harder to pluck the kandil.", 1.8)
            dr["tx"], dr["ty"] = tx, ty
            top.px, top.py, top.x, top.y = top.x, top.y, tx, ty
        if not L["drag"] and L["attached"]:
            self.hand_touch(bot, L["md"].w * 0.45, 0.06)
        r = L["md"].w * 0.5
        for _ in range(14):
            self.solve(L["body"])
            for c in L["cons"]:
                self.solve(c)
            if L["drag"] and "tx" in L["drag"]:
                top.x, top.y = L["drag"]["tx"], L["drag"]["ty"]
            self.collide(top, r * (0.6 if L["attached"] else 0.9))
            self.collide(bot, r)
        for p in L["rope"]:
            self.collide(p, 1)
        vxb = bot.x - bot.px
        on_floor = bot.y > self.floorY - L["md"].w * 0.55
        L["yawV"] += -0.0004 * (L["yaw"] - 0.45) + vxb * 0.00022 + math.sin(self.t * 0.37) * 0.00003
        if M.inside and not L["drag"] and self.lantern_hit(M.x, M.y):
            L["yawV"] += clamp(M.vx, -30, 30) * 0.0005
        L["yawV"] *= 0.9 if (on_floor and not L["attached"]) else 0.995
        L["yaw"] += L["yawV"]

    def lantern_image(self):
        """The kandil body is re-rendered only when it turns, resizes or dims; the flicker lives in the glows."""
        L = self.lantern
        md, yaw, lvl = L["md"], L["yaw"], L["lvl"]
        c = self.lan_cache
        if c and c["md"] is md and abs(c["yaw"] - yaw) < 0.004 and abs(c["lvl"] - lvl) < 0.012:
            return c
        padx, pady = md.w * 0.35 + 10, 10
        iw, ih = md.w + padx * 2, md.h + pady * 2
        img = QImage(int(iw * self.dpr) + 1, int(ih * self.dpr) + 1, FMT)
        img.setDevicePixelRatio(self.dpr)
        img.fill(Qt.GlobalColor.transparent)
        p = QPainter(img)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.translate(iw / 2, pady)
        draw_lantern_model(p, L["style"], md, yaw, lvl, 0.0)
        p.end()
        self.lan_cache = {"md": md, "yaw": yaw, "lvl": lvl, "img": img, "ox": iw / 2, "oy": pady, "w": iw, "h": ih}
        return self.lan_cache

    def draw_lantern(self, p):
        L, U, t = self.lantern, self.U, self.t
        md = L["md"]
        rope_pen = QPen(QColor(220, 200, 160, 230), 1.6 * U, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap, Qt.PenJoinStyle.RoundJoin)
        p.setPen(rope_pen)
        p.setBrush(Qt.BrushStyle.NoBrush)
        pts = L["rope"] + ([L["top"]] if L["attached"] else [])
        p.drawPolyline(QPolygonF([QPointF(q.x, q.y) for q in pts]))
        ux, uy = self.frame()
        ang = math.degrees(math.atan2(-ux, uy))
        light = LANTERN_STYLES[L["style"]][1]
        flick = 1 + math.sin(t * 9.1) * 0.03 + math.sin(t * 13.7) * 0.02
        c = md.C
        cache = self.lantern_image()
        p.save()
        p.translate(L["top"].x, L["top"].y)
        p.rotate(ang)
        lvl = L["lvl"]
        if not md.translucent and lvl > 0.01:
            p.setCompositionMode(PLUS)
            glow(p, c[0], c[1], md.glowR, light, lvl * flick * (0.75 if L["style"] == 1 else 0.5))
            p.setCompositionMode(OVER)
        p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform, True)
        p.drawImage(QRectF(-cache["ox"], -cache["oy"], cache["w"], cache["h"]), cache["img"])
        if lvl > 0.01:
            p.setCompositionMode(PLUS)
            glow(p, c[0], c[1], md.glowR * 1.15, light, lvl * flick * (0.42 if md.translucent else 0.3))
            p.setCompositionMode(OVER)
        p.restore()
        if lvl > 0.05:
            cx, _ = self.to_world(0, md.h * 0.5)
            p.setCompositionMode(PLUS)
            p.setOpacity(0.18 * lvl)
            p.drawImage(QRectF(cx - 200 * U, self.floorY - 30 * U, 400 * U, 60 * U), glow_img(light))
            p.setOpacity(1.0)
            p.setCompositionMode(OVER)

    # ---------------------------------------------------------------- diya
    def dS(self):
        return self.U * self.cfg.get("diyaScale", 1.3)

    def build_diya(self):
        s = self.dS()
        d = self.diya
        x = clamp(d["x"], 44 * s, self.W - 44 * s) if d else self.W - 72 * s
        self.diya = {"x": x, "lit": d["lit"] if d else True, "lvl": d["lvl"] if d else 1.0, "lean": 0.0, "wind": 0.0,
                     "drag": None, "vx": 0.0, "smoke": [], "emit": 0.0, "ember": 0.0, "newRib": False}
        self.diya_cache = None

    def diya_box(self):
        s = self.dS()
        hh, pad, x = DIYA_H[self.cfg["diya"]] * s, 6, self.diya["x"]
        return {"x0": x - 43 * s - pad, "x1": x + 43 * s + pad, "y0": self.floorY - hh - pad, "y1": self.floorY + 2,
                "hx": x + 43 * s + pad, "hy": self.floorY - hh - pad}

    def diya_hit(self, x, y):
        b = self.diya_box()
        return b["x0"] < x < b["x1"] and b["y0"] < y < b["y1"] + 4

    def set_diya_scale(self, sc):
        self.cfg["diyaScale"] = clamp(sc, 0.5, min(3.0, self.H * 0.35 / (DIYA_H[self.cfg["diya"]] * self.U)))
        s = self.dS()
        self.diya["x"] = clamp(self.diya["x"], 44 * s, self.W - 44 * s)

    def put_out_diya(self, why=None):
        d = self.diya
        if not d["lit"]:
            return
        d["lit"], d["emit"], d["ember"], d["newRib"] = False, 4.0, 1.0, True
        if why:
            self.show_hint(why, 2.4)

    def light_diya(self):
        d, s = self.diya, self.dS()
        wx, wy = diya_wick(self.cfg["diya"], s)
        d["lit"], d["emit"] = True, 0.0
        self.add_p(d["x"] + wx, self.floorY + wy - 10 * s, mx=0.3, typ="flash", size=50 * s, col="#ffcf70")

    def update_diya(self, dt):
        d, s, U, M, t = self.diya, self.dS(), self.U, self.M, self.t
        d["lvl"] = lerp(d["lvl"], 1.0 if d["lit"] else 0.0, 0.08 if d["lit"] else 0.3)
        if d["drag"]:
            nx = clamp(M.x - d["drag"]["ox"], 44 * s, self.W - 44 * s)
            d["vx"] = nx - d["x"]
            d["x"] = nx
        else:
            d["vx"] *= 0.85
        wx, wy = diya_wick(self.cfg["diya"], s)
        fx, fy = d["x"] + wx, self.floorY + wy
        wind = -d["vx"] * 0.05
        if M.inside:
            dd = math.hypot(M.x - fx, M.y - (fy - 20 * s))
            if dd < 160 * U:
                wind += clamp(M.vx, -30, 30) * 0.02 * (1 - dd / (160 * U))
        d["wind"] = lerp(d["wind"], wind, 0.2)
        d["lean"] = clamp(lerp(d["lean"], d["wind"] * 0.6, 0.15), -0.3, 0.3)
        if d["lit"] and abs(d["wind"]) > 0.75 and not d["drag"]:
            self.put_out_diya("Whoosh! Too much wind. Click the diya to light it again.")
        d["ember"] = max(0.0, d["ember"] - dt * 0.42)
        if d["emit"] > 0:
            d["emit"] -= dt
            d["smoke"].append({"x": fx + d["vx"] * 0.2, "y": fy - 1.5 * s, "vx": d["vx"] * 0.3 + rand(-0.03, 0.03) * U,
                               "vy": -0.75 * U * (0.7 + 0.3 * self.cfg.get("diyaScale", 1.3)), "age": 0.0,
                               "str": clamp(d["emit"] / 4, 0, 1), "brk": d["newRib"], "w": s})
            d["newRib"] = False
        keep = []
        for q in d["smoke"]:
            q["age"] += dt
            if q["age"] > 4.2:
                continue
            curl = min(1.0, q["age"] * 1.2)
            q["vy"] = q["vy"] * 0.994 - 0.004 * U
            q["vx"] = q["vx"] * 0.95 + (math.sin(q["y"] * 0.045 / U + t * 1.3 + q["age"] * 1.7) * 0.014 + math.sin(q["y"] * 0.12 / U - t * 2.1) * 0.008) * U * curl + d["wind"] * 0.012 * U
            q["x"] += q["vx"]
            q["y"] += q["vy"]
            keep.append(q)
        if keep and len(keep) < len(d["smoke"]):
            keep[0]["brk"] = True
        d["smoke"] = keep
        if d["lit"] and random.random() < 0.02:
            self.add_p(fx, fy - 22 * s, rand(-0.2, 0.2), -rand(0.4, 0.8) * U, 0.7, -0.005, size=0.9 * s, col="#ffcf70")

    def diya_image(self):
        d, s, style = self.diya, self.dS(), self.cfg["diya"]
        c = self.diya_cache
        if c and c["s"] == s and c["style"] == style and abs(c["lvl"] - d["lvl"]) < 0.02:
            return c
        w, h = 100 * s, (DIYA_H[style] + 14) * s
        img = QImage(int(w * self.dpr) + 1, int(h * self.dpr) + 1, FMT)
        img.setDevicePixelRatio(self.dpr)
        img.fill(Qt.GlobalColor.transparent)
        p = QPainter(img)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.translate(w / 2, h - 8 * s)
        draw_diya_body(p, style, s, d["lvl"])
        p.end()
        self.diya_cache = {"s": s, "style": style, "lvl": d["lvl"], "img": img, "w": w, "h": h, "ox": w / 2, "oy": h - 8 * s}
        return self.diya_cache

    def draw_diya(self, p):
        d, s, t = self.diya, self.dS(), self.t
        wx, wy = diya_wick(self.cfg["diya"], s)
        fx, fy = d["x"] + wx, self.floorY + wy
        if d["lvl"] > 0.03:
            p.setCompositionMode(PLUS)
            p.setOpacity(0.5 * d["lvl"])
            p.drawImage(QRectF(d["x"] - 120 * s, self.floorY - 26 * s, 240 * s, 40 * s), glow_img("#ff9d2e"))
            p.setOpacity(1.0)
            p.setCompositionMode(OVER)
        c = self.diya_image()
        p.drawImage(QRectF(d["x"] - c["ox"], self.floorY - c["oy"], c["w"], c["h"]), c["img"])
        draw_flame(p, fx, fy, s, d["lvl"], d["lean"], t)
        if not d["lit"] and d["ember"] > 0.01:
            e = d["ember"] * (0.75 + 0.25 * math.sin(t * 23))
            p.setCompositionMode(PLUS)
            glow(p, fx, fy - 0.5 * s, 7 * s, "#ff5a1f", e)
            p.setCompositionMode(OVER)
            p.setPen(NOPEN)
            p.setBrush(QColor(255, int(90 + 90 * d["ember"]), 40, int(255 * d["ember"])))
            p.drawEllipse(QPointF(fx, fy - 0.5 * s), 1.3 * s, 1.3 * s)
        self.draw_diya_smoke(p)

    def draw_diya_smoke(self, p):
        pts = self.diya["smoke"]
        if len(pts) < 2:
            return
        spr = glow_img("#cfcac4")
        for i in range(1, len(pts)):
            q, r0 = pts[i], pts[i - 1]
            life = (1 - q["age"] / 4.2) ** 1.3 * (0.35 + 0.65 * q["str"]) * min(1.0, q["age"] * 5 + 0.3)
            r = (1.6 + q["age"] * 7.5) * q["w"]
            gap = r if q["brk"] else math.hypot(q["x"] - r0["x"], q["y"] - r0["y"])
            a = 0.75 * life * min(1.0, (gap + 0.4) / (r * 0.45))
            if a < 0.004:
                continue
            p.setOpacity(min(1.0, a))
            p.drawImage(QRectF(q["x"] - r, q["y"] - r, 2 * r, 2 * r), spr)
        for i in range(1, len(pts)):
            q, r0 = pts[i], pts[i - 1]
            if q["brk"] or q["age"] > 1.6:
                continue
            g = int(lerp(90, 190, q["age"] / 1.6))
            p.setOpacity(0.55 * (1 - q["age"] / 1.6) * (0.4 + 0.6 * q["str"]))
            p.setPen(QPen(QColor(g, g - 4, g - 8), (0.9 + q["age"] * 1.4) * q["w"], Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
            p.drawLine(QPointF(r0["x"], r0["y"]), QPointF(q["x"], q["y"]))
        p.setOpacity(1.0)

    # ---------------------------------------------------------------- crackers
    def drop_cracker(self, x, y, typ=None):
        U = self.U
        typ = typ or pick(["anar", "bomb", "ladi", "rocket"])
        c = {"type": typ, "x": clamp(x, 30 * U, self.W - 30 * U), "y": min(y, self.floorY - 10 * U), "vy": 0.0,
             "vx": rand(-0.6, 0.6) * U, "rot": rand(-0.3, 0.3), "state": "fall", "t": 0.0, "fade": 1.0}
        if typ == "ladi":
            c.update(n=14, popped=0, hops=[0] * 14, dir=1 if random.random() < 0.5 else -1)
        if typ == "rocket":
            c.update(ry=0.0, rvy=0.0, wob=rand(0, TAU), rx=c["x"], rY=c["y"], flown=False)
        self.crackers.append(c)
        if len(self.crackers) > 14:
            self.crackers.pop(0)

    def fuse_point(self, c):
        U = self.U
        if c["type"] == "anar":
            return c["x"], c["y"] - 36 * U
        if c["type"] == "bomb":
            return c["x"] + 6 * U, c["y"] - 26 * U
        if c["type"] == "rocket":
            return c["x"], c["y"] - 38 * U
        k = c["popped"]
        f = k if c["dir"] > 0 else c["n"] - 1 - k
        return c["x"] + (f - c["n"] / 2) * 8.5 * U, c["y"] - 4 * U

    def shockwave(self, x, y, power):
        U = self.U
        R = 240 * U * power

        def kick(p):
            if p.pinned:
                return
            dx, dy = p.x - x, p.y - y
            d = math.hypot(dx, dy) or 1
            if d > R:
                return
            f = (1 - d / R) * 14 * U * power
            p.x += dx / d * f
            p.y += dy / d * f - f * 0.3
        L = self.lantern
        if L:
            for p in L["rope"]:
                kick(p)
            kick(L["bot"])
            L["yawV"] += rand(-0.03, 0.03) * power
        for p in self.lights["pts"]:
            kick(p)
        for b in self.lights["bulbs"]:
            kick(b["b"])
        d = self.diya
        if abs(d["x"] - x) < R:
            d["wind"] += (1 if d["x"] > x else -1) * 1.5 * power * (1 - abs(d["x"] - x) / R)
            if abs(d["wind"]) > 0.75:
                self.put_out_diya("The blast blew out the diya. Click it to light it again.")
        self.shake = max(self.shake, 10 * U * power)
        self.add_p(x, y, mx=0.5, typ="shock", size=R, col="#ffe0a0")

    def firework(self, x, y):
        U = self.U
        pal = pick([("#ff4d6d", "#ffd166"), ("#06d6a0", "#ffffff"), ("#4cc9f0", "#f72585"), ("#ffd23f", "#ff7b00"), ("#c77dff", "#80ffdb")])
        n = 70
        for i in range(n):
            a, v = i / n * TAU + rand(-0.05, 0.05), rand(2.4, 4.2) * U
            self.add_p(x, y, math.cos(a) * v, math.sin(a) * v, rand(1.1, 1.8), 0.045 * U, 0.975, 1.8 * U, "spark", pal[i % 2], trail=0.25)
        self.add_p(x, y, mx=0.4, typ="flash", size=80 * U, col=pal[0])

    def boom_fx(self, x, y, power):
        U = self.U
        self.add_p(x, y, mx=0.35, typ="flash", size=160 * U * power, col="#fff1c4")
        self.add_p(x, y, mx=0.6, typ="flash", size=90 * U * power, col="#ff7a1a")
        for _ in range(int(46 * power)):
            a, v = rand(math.pi, TAU), rand(2, 9) * U * power
            self.add_p(x, y, math.cos(a) * v, math.sin(a) * v, rand(0.3, 0.9), 0.2 * U, size=1.6 * U, typ="spark",
                       col=pick(["#fff4c2", "#ffd36b", "#ff8a2a"]), floor=True)
        for _ in range(int(18 * power)):
            a, v = rand(math.pi, TAU), rand(1, 5) * U
            self.add_p(x, y, math.cos(a) * v, math.sin(a) * v, rand(1.5, 2.6), 0.12 * U, 0.97, rand(1.5, 3) * U, "paper",
                       pick(["#c62828", "#8d6e63", "#f5f5dc", "#2e7d32"]), add=False, spin=rand(-12, 12), floor=True)
        self.smoke(x, y, 14 * power, 3, 1.6)
        self.shockwave(x, y, power)

    def update_crackers(self, dt):
        U = self.U
        keep = []
        for c in self.crackers:
            if c["state"] == "fall":
                c["vy"] += 0.32 * U * 1.2
                c["y"] += c["vy"]
                c["x"] += c["vx"]
                if c["y"] >= self.floorY:
                    c["y"] = self.floorY
                    if abs(c["vy"]) > 3 * U:
                        c["vy"] *= -0.3
                    else:
                        c.update(vy=0.0, state="fuse", t=0.0, rot=0.0)
                keep.append(c)
                continue
            c["t"] += dt
            fuse_len = {"bomb": 1.6, "rocket": 1.1}.get(c["type"], 0.8)
            if c["state"] == "fuse":
                fx, fy = self.fuse_point(c)
                if random.random() < 0.8:
                    self.add_p(fx, fy, rand(-1.2, 1.2) * U, rand(-2, 0.3) * U, rand(0.2, 0.45), 0.08 * U, size=1.2 * U, typ="spark", col=pick(["#fff4c2", "#ffb347"]))
                if random.random() < 0.15:
                    self.smoke(fx, fy, 1, 0.5, 0.5)
                if c["t"] >= fuse_len:
                    c["state"], c["t"] = "live", 0.0
                    if c["type"] == "bomb":
                        self.boom_fx(c["x"], c["y"] - 12 * U, 1)
                        c["state"] = "spent"
                    if c["type"] == "rocket":
                        c["rvy"] = -2 * U
            elif c["state"] == "live":
                self.live_cracker(c, dt)
            if c["state"] == "spent":
                c["fade"] -= dt / 7
                if c["fade"] <= 0:
                    continue
            keep.append(c)
        self.crackers = keep

    def live_cracker(self, c, dt):
        U = self.U
        if c["type"] == "anar":
            dur = 4.5
            k = c["t"] / dur
            inten = k / 0.15 if k < 0.15 else (1 - k) / 0.2 if k > 0.8 else 1
            for _ in range(int(9 * inten)):
                v, a = rand(4.5, 9.5) * U * (0.6 + 0.6 * inten), -math.pi / 2 + rand(-0.32, 0.32)
                self.add_p(c["x"], c["y"] - 34 * U, math.cos(a) * v, math.sin(a) * v, rand(0.6, 1.2), 0.16 * U, 0.985, 1.4 * U,
                           "spark" if random.random() < 0.85 else "star", pick(["#fff6d5", "#ffe08a", "#ffc04d", "#ffffff", "#ffd0ff"]), floor=True)
            if random.random() < 0.15:
                self.smoke(c["x"], c["y"] - 34 * U, 1, 1, 0.8)
            if c["t"] > dur:
                c["state"] = "spent"
        elif c["type"] == "ladi":
            while c["popped"] < c["n"] and c["t"] > c["popped"] * 0.085 + rand(0, 0.02):
                f = c["popped"] if c["dir"] > 0 else c["n"] - 1 - c["popped"]
                x, y = c["x"] + (f - c["n"] / 2) * 8.5 * U, c["y"] - 4 * U
                c["hops"][f] = 1
                self.add_p(x, y, mx=0.18, typ="flash", size=40 * U, col="#fff0b0")
                for _ in range(8):
                    self.add_p(x, y, rand(-3, 3) * U, rand(-4, -0.5) * U, rand(0.2, 0.5), 0.2 * U, size=1.3 * U, typ="spark", col="#ffe08a")
                for _ in range(3):
                    self.add_p(x, y, rand(-2, 2) * U, rand(-3, -1) * U, rand(1.2, 2), 0.12 * U, 0.97, rand(1.2, 2.2) * U, "paper",
                               pick(["#d32f2f", "#f5f5dc"]), add=False, spin=rand(-14, 14), floor=True)
                self.smoke(x, y, 2, 1, 0.7)
                L = self.lantern
                if L and L["bot"].y > self.floorY - 80 * U and math.hypot(L["bot"].x - x, L["bot"].y - y) < 70 * U:
                    L["bot"].y -= 3 * U
                self.shake = max(self.shake, 2 * U)
                c["popped"] += 1
            if c["popped"] >= c["n"]:
                c["state"] = "spent"
        elif c["type"] == "rocket":
            c["rvy"] = (c["rvy"] - 0.32 * U) * 0.985
            c["ry"] += c["rvy"]
            c["wob"] += dt * 9
            rx = c["x"] + math.sin(c["wob"]) * 2 * U * min(1, c["t"] * 2)
            ry = c["y"] - 38 * U + c["ry"]
            for _ in range(4):
                self.add_p(rx + rand(-1.5, 1.5) * U, ry + 10 * U, rand(-0.6, 0.6) * U, rand(1, 3) * U, rand(0.3, 0.7), 0.05 * U,
                           size=1.3 * U, typ="spark", col=pick(["#ffe8a0", "#ffb347", "#ffffff"]))
            if random.random() < 0.4:
                self.smoke(rx, ry + 12 * U, 1, 0.5, 0.6)
            c["rx"], c["rY"] = rx, ry
            if ry < max(self.H * 0.18, 90 * U) or c["t"] > 2.6:
                self.firework(rx, ry)
                c["state"], c["flown"] = "spent", True

    def draw_rocket(self, p, x, y):
        U = self.U
        p.setPen(QPen(qc("#c8a46a"), 1.4 * U))
        p.drawLine(QPointF(x + 2.5 * U, y - 4 * U), QPointF(x + 2.5 * U, y + 30 * U))
        p.setPen(NOPEN)
        p.fillRect(QRectF(x - 3 * U, y - 6 * U, 5 * U, 16 * U), qc("#e53935"))
        p.setBrush(qc("#ffd34d"))
        p.drawPolygon(QPolygonF([QPointF(x - 3 * U, y - 6 * U), QPointF(x - 0.5 * U, y - 13 * U), QPointF(x + 2 * U, y - 6 * U)]))

    def draw_crackers(self, p):
        U = self.U
        for c in self.crackers:
            spent = c["state"] == "spent"
            burn = 0.35 if spent else 1.0
            p.save()
            p.setOpacity(clamp(c["fade"], 0, 1) if spent else 1.0)
            p.translate(c["x"], c["y"])
            p.rotate(math.degrees(c["rot"]))
            p.setPen(NOPEN)
            if c["type"] == "anar":
                p.setBrush(shade("#2e7d32", burn))
                p.drawPolygon(QPolygonF([QPointF(-13 * U, 0), QPointF(13 * U, 0), QPointF(4 * U, -32 * U), QPointF(-4 * U, -32 * U)]))
                for y in (-8, -18, -26):
                    hw = 13 - 9 * (-y / 32)
                    p.fillRect(QRectF(-hw * U, (y - 1.5) * U, hw * 2 * U, 3 * U), shade("#ffcc33", burn))
                p.setBrush(shade("#c62828", burn))
                p.drawEllipse(QPointF(0, -32 * U), 4.5 * U, 2.2 * U)
                p.setBrush(shade("#9e6b3b", burn))
                p.drawEllipse(QPointF(0, -34 * U), 3 * U, 1.8 * U)
            elif c["type"] == "bomb":
                if not spent:
                    p.setBrush(qc("#9c6b3a"))
                    p.drawEllipse(QPointF(0, -12 * U), 12 * U, 12 * U)
                    p.setPen(QPen(qc("#6d4520"), 1 * U))
                    p.setBrush(Qt.BrushStyle.NoBrush)
                    for k in range(-3, 4):
                        p.save()
                        p.translate(0, -12 * U)
                        p.rotate(math.degrees(k * 0.5))
                        p.drawEllipse(QPointF(0, 0), 12 * U, abs(k) * 3.6 * U + 1)
                        p.restore()
                    p.setPen(NOPEN)
                    p.fillRect(QRectF(-7 * U, -15 * U, 14 * U, 6 * U), qc("#c62828"))
                    fk = clamp(1 - c["t"] / 1.6, 0, 1) if c["state"] == "fuse" else 1
                    p.setPen(QPen(qc("#d7c49e"), 1.4 * U))
                    path = QPainterPath(QPointF(0, -24 * U))
                    path.quadTo(3 * U, -24 * U - 6 * U * fk, 6 * U * fk, -24 * U - 2 * U * fk)
                    p.drawPath(path)
                else:
                    p.setBrush(QColor(40, 30, 25, 204))
                    p.drawEllipse(QPointF(0, -1 * U), 18 * U, 3 * U)
            elif c["type"] == "ladi":
                p.setPen(QPen(shade("#d7c49e", burn), 1 * U))
                p.drawLine(QPointF(-c["n"] / 2 * 8.5 * U, -4 * U), QPointF(c["n"] / 2 * 8.5 * U, -4 * U))
                p.setPen(NOPEN)
                for f in range(c["n"]):
                    if c["hops"][f]:
                        continue
                    p.save()
                    p.translate((f - c["n"] / 2) * 8.5 * U, -4 * U)
                    p.rotate(math.degrees(0.5 if f % 2 else -0.5))
                    p.fillRect(QRectF(-2.2 * U, -5 * U, 4.4 * U, 10 * U), qc("#d32f2f"))
                    p.fillRect(QRectF(-2.2 * U, -1 * U, 4.4 * U, 1.6 * U), qc("#ffeb3b"))
                    p.restore()
            else:
                path = QPainterPath(QPointF(-8 * U, 0))
                path.lineTo(-8 * U, -18 * U)
                path.quadTo(-8 * U, -24 * U, -3 * U, -26 * U)
                path.lineTo(-3 * U, -32 * U)
                path.lineTo(3 * U, -32 * U)
                path.lineTo(3 * U, -26 * U)
                path.quadTo(8 * U, -24 * U, 8 * U, -18 * U)
                path.lineTo(8 * U, 0)
                path.closeSubpath()
                p.setBrush(QColor(70, 170, 110, 140))
                p.setPen(QPen(QColor(190, 255, 210, 153), 1 * U))
                p.drawPath(path)
                if not c["flown"] and c["state"] != "live":
                    self.draw_rocket(p, 0, -38 * U)
            p.restore()
            if c["type"] == "rocket" and c["state"] == "live":
                self.draw_rocket(p, c["rx"], c["rY"])

    # ---------------------------------------------------------------- sparkler (phuljhadi)
    def sparkler_active(self):
        return self.cfg.get("sparklerAlways") or self.now() < self.sparkler_until

    def update_sparkler(self):
        M, U = self.M, self.U
        if not (self.sparkler_active() and M.inside):
            return
        for _ in range(5):
            a, v = rand(0, TAU), rand(1.5, 4.5) * U
            self.add_p(M.x, M.y, math.cos(a) * v + M.vx * 0.2, math.sin(a) * v + M.vy * 0.2, rand(0.12, 0.32), 0.02 * U, 0.92,
                       1.1 * U, "spark", pick(["#fffbe8", "#fff1b8", "#ffd36b", "#ffffff"]))

    def draw_sparkler(self, p):
        M, U = self.M, self.U
        if not (self.sparkler_active() and M.inside):
            return
        left = 1.0 if self.cfg.get("sparklerAlways") else clamp((self.sparkler_until - self.now()) / 30, 0, 1)
        ln, ang = 80 * U, 0.75
        ex, ey = M.x + math.cos(ang) * ln, M.y + math.sin(ang) * ln
        p.setPen(QPen(qc("#6e6e78"), 1.6 * U, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
        p.drawLine(QPointF(M.x, M.y), QPointF(ex, ey))
        cl = ln * 0.75 * left
        p.setPen(QPen(qc("#5a4b3c"), 3.4 * U, Qt.PenStyle.SolidLine, Qt.PenCapStyle.RoundCap))
        p.drawLine(QPointF(M.x + math.cos(ang) * 2, M.y + math.sin(ang) * 2), QPointF(M.x + math.cos(ang) * cl, M.y + math.sin(ang) * cl))
        p.setCompositionMode(PLUS)
        glow(p, M.x, M.y, 34 * U, "#ffe7a3", 0.9)
        glow(p, M.x, M.y, 10 * U, "#ffffff", 1)
        p.setCompositionMode(OVER)

    # ---------------------------------------------------------------- resize handles
    def handle_at(self, x, y):
        r = 13
        if self.lantern and self.rs["lan"] > 0.3:
            b = self.lantern_box()
            if math.hypot(x - b["hx"], y - b["hy"]) < r:
                return "lantern"
        if self.rs["diya"] > 0.3:
            b = self.diya_box()
            if math.hypot(x - b["hx"], y - b["hy"]) < r:
                return "diya"
        return None

    @staticmethod
    def in_box(b, x, y, pad):
        return b["x0"] - pad < x < b["x1"] + pad and b["y0"] - pad < y < b["y1"] + pad

    def update_handles(self):
        M, rs = self.M, self.rs
        L, d = self.lantern, self.diya
        lan_drag = L and L["drag"] and not L["drag"].get("pending")
        diya_drag = d["drag"] and not d["drag"].get("pending")
        wantL = rs["active"] == "lantern" or (not rs["active"] and not lan_drag and M.inside and L and self.in_box(self.lantern_box(), M.x, M.y, 18))
        wantD = rs["active"] == "diya" or (not rs["active"] and not diya_drag and M.inside and self.in_box(self.diya_box(), M.x, M.y, 18))
        rs["lan"] = lerp(rs["lan"], 1.0 if wantL else 0.0, 0.18)
        rs["diya"] = lerp(rs["diya"], 1.0 if wantD else 0.0, 0.18)

    def draw_handle(self, p, b, a, down):
        if a < 0.02:
            return
        p.setOpacity(a)
        p.setBrush(Qt.BrushStyle.NoBrush)
        p.setPen(QPen(QColor(255, 225, 160, 102), 1, Qt.PenStyle.DashLine))
        p.drawRect(QRectF(b["x0"], b["y0"], b["x1"] - b["x0"], b["y1"] - b["y0"]))
        r, x, y = 10, b["hx"], b["hy"]
        p.setBrush(QColor(30, 16, 46, 224))
        p.setPen(QPen(qc("#ffcf5a"), 1.5))
        p.drawEllipse(QPointF(x, y), r, r)
        k, sy = r * 0.48, 1 if down else -1
        p.setBrush(Qt.BrushStyle.NoBrush)
        for (x0, y0, x1, y1) in ((x - k, y - k * sy, x + k, y + k * sy), (x + k, y + k * sy, x + k * 0.1, y + k * sy),
                                 (x + k, y + k * sy, x + k, y + k * sy * 0.1), (x - k, y - k * sy, x - k * 0.1, y - k * sy),
                                 (x - k, y - k * sy, x - k, y - k * sy * 0.1)):
            p.drawLine(QPointF(x0, y0), QPointF(x1, y1))
        p.setOpacity(1.0)

    # ---------------------------------------------------------------- input
    def interactive_at(self, x, y):
        if self.handle_at(x, y):
            return True
        if self.lantern and (self.lantern_hit(x, y) or self.cord_at(x, y)):
            return True
        if self.diya_hit(x, y):
            return True
        return bool(self.bulb_at(x, y))

    def on_press(self, x, y):
        M = self.M
        M.x, M.y, M.down, M.inside = x, y, True, True
        M.hist = []
        self.press = {"x": x, "y": y, "target": None, "moved": False}
        h = self.handle_at(x, y)
        if h:
            self.press["target"] = "resize"
            self.rs["active"] = h
            ax, ay = (self.lantern["top"].x, self.lantern["top"].y) if h == "lantern" else (self.diya["x"], self.floorY)
            self.rs["start"] = {"ax": ax, "ay": ay, "d0": max(20.0, math.hypot(x - ax, y - ay)),
                                "scale": self.lantern["sc"] if h == "lantern" else self.cfg.get("diyaScale", 1.3)}
            return
        if self.diya_hit(x, y):
            self.press["target"] = "diya"
            self.diya["drag"] = {"ox": x - self.diya["x"], "pending": True}
        elif self.lantern and self.lantern_hit(x, y):
            self.press["target"] = "lantern"
            L = self.lantern
            L["drag"] = {"ox": x - L["top"].x, "oy": y - L["top"].y, "pending": True}

    def on_move(self, x, y):
        pr = self.press
        if pr and math.hypot(x - pr["x"], y - pr["y"]) > 6:
            pr["moved"] = True
            if self.lantern["drag"]:
                self.lantern["drag"]["pending"] = False
            if self.diya["drag"]:
                self.diya["drag"]["pending"] = False
        if pr and pr["target"] == "resize":
            st = self.rs["start"]
            sc = round(st["scale"] * math.hypot(x - st["ax"], y - st["ay"]) / st["d0"], 2)
            if self.rs["active"] == "lantern":
                self.set_lantern_scale(sc)
            else:
                self.set_diya_scale(sc)

    def on_release(self, x, y):
        pr, self.press = self.press, None
        self.M.down = False
        if not pr:
            return
        if pr["target"] == "resize":
            self.rs["active"] = self.rs["start"] = None
            save_config(self.cfg)
            return
        L = self.lantern
        if L["drag"]:
            if pr["moved"] and not L["drag"].get("pending"):
                h = self.M.hist[-4:]
                if h:
                    vx = clamp(sum(v[0] for v in h) / len(h), -45, 45)
                    vy = clamp(sum(v[1] for v in h) / len(h), -45, 45)
                    L["top"].px, L["top"].py = L["top"].x - vx, L["top"].y - vy
            L["drag"] = None
        if self.diya["drag"]:
            self.diya["drag"] = None
        if not pr["moved"]:
            self.tap(x, y, pr["target"])

    def tap(self, x, y, target):
        t = self.now()
        lt, lx, ly = self.last_tap
        double = t - lt < 0.4 and math.hypot(x - lx, y - ly) < 30
        self.last_tap = (0.0, 0.0, 0.0) if double else (t, x, y)
        self.sparkle_burst(x, y, 10 if double else 18)
        if double:
            self.drop_cracker(x, y)
            self.sparkler_until = self.now() + 30
            return
        if target == "diya":
            if self.diya["lit"]:
                self.put_out_diya()
            else:
                self.light_diya()
            return
        if target == "lantern":
            self.lantern["on"] = not self.lantern["on"]
            return
        if self.cord_at(x, y):
            self.snap_lantern("You cut the cord. The kandil drops.")
            return
        b = self.bulb_at(x, y)
        if b:
            b["on"] = not b["on"]

    # ---------------------------------------------------------------- loop
    def step(self):
        M = self.M
        if M.lx < -900:
            M.lx, M.ly = M.x, M.y
        M.vx, M.vy = M.x - M.lx, M.y - M.ly
        M.lx, M.ly = M.x, M.y
        M.hist.append((M.vx, M.vy))
        del M.hist[:-12]
        self.update_lights()
        self.update_lantern()
        self.update_diya(1 / 60)
        self.update_crackers(1 / 60)
        self.update_sparkler()
        self.update_parts()
        self.update_handles()
        self.t += 1 / 60

    def busy(self):
        L = self.lantern
        return bool(self.press or self.parts or self.crackers or self.diya["smoke"] or self.sparkler_active() or self.shake > 0.2
                    or abs(L["bot"].x - L["bot"].px) + abs(L["bot"].y - L["bot"].py) > 0.05 or abs(L["yawV"]) > 0.0008
                    or self.rs["lan"] > 0.02 or self.rs["diya"] > 0.02 or (self.hint and self.now() < self.hint[1] + 0.5)
                    or abs(self.M.vx) + abs(self.M.vy) > 0.5)

    def dirty_rects(self):
        U, W = self.U, self.W
        rects = []
        lb = max((b["b"].y for b in self.lights["bulbs"]), default=60)
        rects.append(QRect(0, 0, W, int(lb + 40 * U)))
        L = self.lantern
        md = L["md"]
        b = self.lantern_box()
        g = md.glowR * 1.2
        cx, cy = self.to_world(0, md.C[1])
        x0, y0 = min(b["x0"], cx - g, min(q.x for q in L["rope"])) - 16, 0
        x1, y1 = max(b["x1"], cx + g, max(q.x for q in L["rope"])) + 16, max(b["y1"], cy + g) + 16
        rects.append(QRect(int(x0), int(y0), int(x1 - x0), int(y1 - y0)))
        rects.append(QRect(int(cx - 210 * U), int(self.floorY - 40 * U), int(420 * U), int(42 * U)))  # floor light pool
        s = self.dS()
        d = self.diya
        top = self.floorY - 150 * s
        if d["smoke"]:
            top = min(top, min(q["y"] for q in d["smoke"]) - 40 * s)
        rects.append(QRect(int(d["x"] - 125 * s), int(top), int(250 * s), int(self.floorY - top + 2)))
        if self.parts or self.crackers:
            xs = [q.x for q in self.parts] + [c["x"] for c in self.crackers] + [c.get("rx", c["x"]) for c in self.crackers]
            ys = [q.y for q in self.parts] + [c["y"] for c in self.crackers] + [c.get("rY", c["y"]) for c in self.crackers]
            pad = 170 * U
            rects.append(QRect(int(min(xs) - pad), int(min(ys) - pad), int(max(xs) - min(xs) + 2 * pad), int(max(ys) - min(ys) + 2 * pad)))
        if self.sparkler_active():
            rects.append(QRect(int(self.M.x - 60 * U), int(self.M.y - 60 * U), int(160 * U), int(160 * U)))
        if self.hint:
            rects.append(QRect(int(W / 2 - 330), int(self.H * 0.42 - 70), 660, 140))
        return rects

    def draw(self, p):
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        if self.shake > 0.2:
            p.translate(rand(-self.shake, self.shake), rand(-self.shake, self.shake))
            self.shake *= 0.86
        else:
            self.shake = 0.0
        self.draw_parts(p, False)
        self.draw_crackers(p)
        self.draw_diya(p)
        self.draw_lantern(p)
        self.draw_lights(p)
        p.setCompositionMode(PLUS)
        self.draw_parts(p, True)
        p.setCompositionMode(OVER)
        if self.lantern:
            self.draw_handle(p, self.lantern_box(), self.rs["lan"], True)
        self.draw_handle(p, self.diya_box(), self.rs["diya"], False)
        self.draw_sparkler(p)
        self.draw_hint(p)

    def draw_hint(self, p):
        if not self.hint:
            return
        text, until = self.hint
        a = clamp((until - self.now()) / 0.5, 0, 1)
        if a <= 0:
            self.hint = None
            return
        f = QFont("Segoe UI", 10)
        p.setFont(f)
        fm = QFontMetricsF(f)
        box = fm.boundingRect(QRectF(0, 0, 560, 400), int(Qt.TextFlag.TextWordWrap | Qt.AlignmentFlag.AlignCenter), text)
        w, h = box.width() + 32, box.height() + 20
        r = QRectF(self.W / 2 - w / 2, self.H * 0.42 - h / 2, w, h)
        p.setOpacity(a)
        p.setPen(QPen(QColor(255, 207, 90, 70), 1))
        p.setBrush(QColor(20, 10, 34, 215))
        p.drawRoundedRect(r, 12, 12)
        p.setPen(qc("#fff6e3"))
        p.drawText(r.adjusted(16, 10, -16, -10), int(Qt.TextFlag.TextWordWrap | Qt.AlignmentFlag.AlignCenter), text)
        p.setOpacity(1.0)

# ----------------------------------------------------------------------------- Windows helpers (no hooks)


class Win32:
    """Click-through toggling and a polled left-button state. Nothing system-wide is hooked or intercepted."""

    def __init__(self):
        self.ok = False
        self.through = None
        if sys.platform != "win32":
            return
        try:
            import ctypes
            from ctypes import wintypes
            u = ctypes.windll.user32
            self.get = u.GetWindowLongPtrW
            self.get.restype = ctypes.c_ssize_t
            self.get.argtypes = [wintypes.HWND, ctypes.c_int]
            self.set = u.SetWindowLongPtrW
            self.set.restype = ctypes.c_ssize_t
            self.set.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
            self.gaks = u.GetAsyncKeyState
            self.gaks.argtypes = [ctypes.c_int]
            self.gaks.restype = ctypes.c_short
            self.metrics = u.GetSystemMetrics
            self.ok = True
        except Exception:
            self.ok = False

    def set_through(self, hwnd, on):
        """WS_EX_TRANSPARENT on our layered window: the whole window lets clicks fall through to the app below."""
        if not self.ok or on == self.through:
            return
        try:
            ex = self.get(hwnd, -20)
            if not ex & 0x80000:      # not a layered window: leave Windows' per-pixel hit-testing alone
                return
            self.set(hwnd, -20, (ex | 0x20) if on else (ex & ~0x20))
            self.through = on
        except Exception:
            self.ok = False

    def left_down(self):
        if not self.ok:
            return False
        vk = 0x02 if self.metrics(23) else 0x01   # SM_SWAPBUTTON
        return bool(self.gaks(vk) & 0x8000)

# ----------------------------------------------------------------------------- the overlay window


class OverlayWindow(QWidget):
    def __init__(self, cfg):
        super().__init__(None)
        self.cfg = cfg
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint | Qt.WindowType.WindowStaysOnTopHint | Qt.WindowType.Tool |
                            Qt.WindowType.WindowDoesNotAcceptFocus | Qt.WindowType.NoDropShadowWindowHint)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setAttribute(Qt.WidgetAttribute.WA_ShowWithoutActivating)
        self.setAttribute(Qt.WidgetAttribute.WA_NoSystemBackground)
        self.setWindowTitle("Diwali Lantern")
        self.setMouseTracking(True)
        self.scene = Scene(cfg)
        self.w32 = Win32()
        self.cursor_override = None      # for automated tests
        self.menu_open = False
        self.prev_down = False
        self.last_rects = []
        self.screen_ref = QGuiApplication.primaryScreen()
        self._setup_geometry()
        self.screen_ref.availableGeometryChanged.connect(lambda _r: self._setup_geometry())
        self.clock = QElapsedTimer()
        self.clock.start()
        self.acc = 0.0
        self.timer = QTimer(self)
        self.timer.setTimerType(Qt.TimerType.PreciseTimer)
        self.timer.timeout.connect(self.tick)
        self.timer.start(16)

    def _setup_geometry(self):
        geo = self.screen_ref.availableGeometry()
        self.setGeometry(geo)
        self.scene.resize(geo.width(), geo.height(), self.screen_ref.devicePixelRatio())
        self.update()

    def cursor(self):
        if self.cursor_override is not None:
            return self.cursor_override
        p = self.mapFromGlobal(QCursor.pos())
        return float(p.x()), float(p.y())

    def tick(self):
        sc = self.scene
        dt = min(self.clock.restart() / 1000.0, 0.1)
        x, y = self.cursor()
        inside = 0 <= x <= sc.W and 0 <= y <= sc.H
        sc.M.inside = inside and self.isVisible()
        if sc.press is None:
            sc.M.x, sc.M.y = x, y
        hwnd = int(self.winId())
        # a click that went to another app still leaves a sparkle (polled, not hooked)
        down = self.w32.left_down()
        if (down and not self.prev_down and self.w32.through and inside and self.isVisible() and not self.menu_open
                and self.cfg.get("ambient", True)):
            sc.tap(x, y, None)
        self.prev_down = down
        # the window only catches the mouse over the kandil, diya, bulbs and handles
        over = sc.press is not None or self.menu_open or (inside and not (down and sc.press is None) and sc.interactive_at(x, y))
        self.w32.set_through(hwnd, not over)
        self.acc += dt
        n = 0
        while self.acc >= 1 / 60 and n < 4:
            sc.step()
            self.acc -= 1 / 60
            n += 1
        if n == 4:
            self.acc = 0.0
        if sc.press is not None:
            sc.on_move(sc.M.x, sc.M.y)
        if sc.shake > 0.2:
            self.update()
            self.last_rects = []
        else:
            rects = sc.dirty_rects()
            reg = QRegion()
            for r in rects + self.last_rects:
                reg = reg.united(QRegion(r))
            self.update(reg)
            self.last_rects = rects
        want = 16 if sc.busy() else 33
        if self.timer.interval() != want:
            self.timer.setInterval(want)

    def paintEvent(self, ev):
        p = QPainter(self)
        p.setCompositionMode(QPainter.CompositionMode.CompositionMode_Source)
        for r in ev.region():
            p.fillRect(r, Qt.GlobalColor.transparent)
        p.setCompositionMode(OVER)
        p.setClipRegion(ev.region())
        self.scene.draw(p)
        p.end()

    # mouse events arrive only while the pointer is over something interactive
    def mousePressEvent(self, ev):
        x, y = ev.position().x(), ev.position().y()
        sc = self.scene
        if ev.button() == Qt.MouseButton.RightButton:
            self.show_menu(ev.globalPosition().toPoint())
            return
        if ev.button() == Qt.MouseButton.LeftButton:
            sc.on_press(x, y)

    def mouseDoubleClickEvent(self, ev):
        self.mousePressEvent(ev)

    def mouseMoveEvent(self, ev):
        sc = self.scene
        x, y = ev.position().x(), ev.position().y()
        sc.M.x, sc.M.y = x, y
        if sc.press is not None:
            sc.on_move(x, y)

    def mouseReleaseEvent(self, ev):
        if ev.button() == Qt.MouseButton.LeftButton:
            self.scene.on_release(ev.position().x(), ev.position().y())

    # ---------------------------------------------------------------- menu (right-click the kandil/diya, or the tray icon)
    def build_menu(self):
        m = QMenu()
        sc, cfg = self.scene, self.cfg

        def radio(title, key, names, apply):
            sub = m.addMenu(title)
            grp = QActionGroup(sub)
            acts = []
            for i, nm in enumerate(names):
                a = QAction(nm, sub, checkable=True)
                a.triggered.connect(lambda _c=False, i=i: (cfg.__setitem__(key, i), apply(), save_config(cfg)))
                grp.addAction(a)
                sub.addAction(a)
                acts.append(a)
            return acts
        self._acts_lan = radio("Kandil", "lantern", [s[0] for s in LANTERN_STYLES], self.apply_lantern)
        self._acts_lit = radio("String lights", "lights", [s["name"] for s in LIGHT_STYLES], sc.build_lights)
        self._acts_diya = radio("Diya", "diya", DIYA_STYLES, lambda: setattr(sc, "diya_cache", None))
        m.addSeparator()
        m.addAction("Re-hang the kandil", self.rehang)
        m.addAction("All lights on / off", self.all_lights)
        m.addAction("Reset sizes", self.reset_sizes)
        m.addAction("Sweep the floor", lambda: (sc.crackers.clear(), sc.parts.clear()))
        m.addSeparator()
        self._act_amb = QAction("Sparkles and crackers when clicking in other apps", m, checkable=True)
        self._act_amb.toggled.connect(lambda v: (cfg.__setitem__("ambient", bool(v)), save_config(cfg)))
        self._act_amb.setEnabled(self.w32.ok)
        m.addAction(self._act_amb)
        self._act_spk = QAction("Sparkler pointer stays on", m, checkable=True)
        self._act_spk.toggled.connect(lambda v: (cfg.__setitem__("sparklerAlways", bool(v)), save_config(cfg)))
        m.addAction(self._act_spk)
        self._act_auto = QAction("Start with Windows", m, checkable=True)
        self._act_auto.setEnabled(sys.platform == "win32")
        self._act_auto.toggled.connect(set_autostart)
        m.addAction(self._act_auto)
        self._act_vis = m.addAction("Hide", self.toggle_visible)
        m.addSeparator()
        m.addAction("Happy Diwali from Doneology Labs", lambda: QDesktopServices.openUrl(QUrl(SITE)))
        m.addAction("Play it in a browser / share the link", lambda: QDesktopServices.openUrl(QUrl(WEB)))
        m.addAction(f"Source code on GitHub (v{APP_VERSION})", lambda: QDesktopServices.openUrl(QUrl(REPO)))
        m.addSeparator()
        m.addAction("Quit", QApplication.instance().quit)
        m.aboutToShow.connect(self.sync_menu)
        m.aboutToShow.connect(lambda: setattr(self, "menu_open", True))
        m.aboutToHide.connect(lambda: setattr(self, "menu_open", False))
        self._menu = m
        return m

    def menu(self):
        return getattr(self, "_menu", None) or self.build_menu()

    def sync_menu(self):
        cfg = self.cfg
        for acts, key in ((self._acts_lan, "lantern"), (self._acts_lit, "lights"), (self._acts_diya, "diya")):
            acts[cfg[key]].setChecked(True)
        for act, val in ((self._act_amb, bool(cfg.get("ambient", True))), (self._act_spk, bool(cfg.get("sparklerAlways"))),
                         (self._act_auto, autostart_enabled())):
            act.blockSignals(True)
            act.setChecked(val)
            act.blockSignals(False)
        self._act_vis.setText("Hide" if self.isVisible() else "Show")

    def show_menu(self, pos):
        self.menu().popup(pos)

    def apply_lantern(self):
        sc = self.scene
        on = sc.lantern["on"] if sc.lantern else True
        sc.build_lantern()
        sc.lantern["on"] = on

    def rehang(self):
        self.apply_lantern()

    def all_lights(self):
        sc = self.scene
        anyon = any(b["on"] for b in sc.lights["bulbs"])
        for b in sc.lights["bulbs"]:
            b["on"] = not anyon
        sc.lantern["on"] = not anyon
        if anyon:
            sc.put_out_diya()
        else:
            sc.light_diya()

    def reset_sizes(self):
        sc = self.scene
        sc.set_lantern_scale(1.0)
        sc.set_diya_scale(1.3)
        save_config(self.cfg)

    def toggle_visible(self):
        if self.isVisible():
            self.hide()
        else:
            self.show()

# ----------------------------------------------------------------------------- icon, tray, autostart


def make_icon_pixmap(size=64):
    pm = QPixmap(size, size)
    pm.fill(Qt.GlobalColor.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)
    md0 = lantern_model(0, 1.0)
    s = (size - 6) / max(md0.h, md0.w)
    md = lantern_model(0, s)
    p.setCompositionMode(PLUS)
    glow(p, size / 2, size / 2, size * 0.55, "#ffb347", 0.6)
    p.setCompositionMode(OVER)
    p.translate(size / 2, (size - md.h) / 2)
    draw_model(p, md, 0.45, 1.0, 0.0, "#ffb347")
    p.end()
    return pm


def make_tray(app, win, icon):
    tray = QSystemTrayIcon(icon, app)
    tray.setToolTip("Diwali Lantern — Happy Diwali from Doneology Labs")
    tray.setContextMenu(win.menu())
    tray.activated.connect(lambda reason: win.toggle_visible() if reason == QSystemTrayIcon.ActivationReason.DoubleClick else None)
    tray.show()
    return tray


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def _launch_command():
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"'
    pyw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    return f'"{pyw if os.path.exists(pyw) else sys.executable}" "{os.path.abspath(__file__)}"'


def autostart_enabled():
    if sys.platform != "win32":
        return False
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            winreg.QueryValueEx(k, APP_NAME)
            return True
    except OSError:
        return False


def set_autostart(on):
    if sys.platform != "win32":
        return
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            if on:
                winreg.SetValueEx(k, APP_NAME, 0, winreg.REG_SZ, _launch_command())
            else:
                winreg.DeleteValue(k, APP_NAME)
    except OSError:
        pass


def main():
    ap = argparse.ArgumentParser(description="Diwali kandil, lights and diya floating over your Windows desktop")
    ap.add_argument("--version", action="version", version=APP_VERSION)
    ap.parse_args()
    QGuiApplication.setHighDpiScaleFactorRoundingPolicy(Qt.HighDpiScaleFactorRoundingPolicy.PassThrough)
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    lock = QLockFile(os.path.join(QDir.tempPath(), APP_NAME + ".lock"))
    if not lock.tryLock(100):
        return
    cfg = load_config()
    win = OverlayWindow(cfg)
    icon = QIcon(make_icon_pixmap(64))
    app.setWindowIcon(icon)
    win.show()
    win.tray = make_tray(app, win, icon) if QSystemTrayIcon.isSystemTrayAvailable() else None
    win.scene.show_hint("Diwali Lantern is floating over your apps — keep working as usual. Click or drag the kandil, "
                        "bulbs and diya; double-click anywhere for a cracker. Right-click the kandil or diya for options.", 8)
    if win.tray:
        win.tray.showMessage("Diwali Lantern", "Floating over your apps. Right-click the kandil or diya, or this icon, for options and Quit.", icon, 6000)
    code = app.exec()
    lock.unlock()
    sys.exit(code)


if __name__ == "__main__":
    main()
