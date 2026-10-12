"""Render the four README concept figures as animated SVG.

    python -m scripts.readme_figures

Writes ``docs/images/highlights/0N-<name>.svg`` (dark) and
``0N-<name>-light.svg`` for each figure. Text is converted to outlines with
fontTools, so a figure looks the same in GitHub's ``<img>`` sandbox, which
loads no web fonts. Motion is SMIL: every element's timing is a fraction of
one loop, and a viewer without SMIL shows the finished state.

Figures are 1600 px wide and shown at about 900 px, so no text is smaller
than 20 px. Fonts: Instrument Sans (Regular, Bold) and Geist Mono (Regular),
looked up in ``~/Library/Fonts``, ``/Library/Fonts`` or
``$OPENPROGRAM_FIGURE_FONTS``.
"""
from __future__ import annotations

import os
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "images" / "highlights"
W = 1600

FONT_FILES = {
    "sans": "InstrumentSans-Regular.ttf",
    "bold": "InstrumentSans-Bold.ttf",
    "mono": "GeistMono-Regular.ttf",
}

# The App icon's palette: indigo tile, violet and sky discs.
THEMES = {
    "light": {
        "bg": "#F7F6FD", "grid": "#ECEAF8", "card": "#FFFFFF", "border": "#DCD8F3",
        "text": "#1B1A2E", "muted": "#5F5C7A", "accent": "#4F46E5",
        "user": "#4F46E5", "model": "#8B5CF6", "fn": "#0EA5E9",
        "line": "#C9C4EC", "arrow": "#8E8AB0",
        "green": "#10B981", "green_text": "#047857", "green_deep": "#065F46",
        "band": "#E8F7EF", "band_border": "#C6EBD8",
        "red": "#DC2626", "red_text": "#B91C1C",
        "amber": "#B45309", "amber_text": "#92400E", "amber_bg": "#FFF8EB",
        "diamond": "#E4E0FD", "diamond_text": "#23214F",
        "hl_model": "#8B5CF6", "hl_fn": "#0EA5E9", "hl_alpha": 0.12,
        "halo": "#4F46E5", "halo_alpha": 0.16,
        "bus": "#4F46E5", "bus_sub": "#E0DDFB",
        "kw": "#7C3AED", "call": "#0369A1", "str": "#047857",
        "shadow": 0.07,
    },
    "dark": {
        "bg": "#0E0D19", "grid": "#18172C", "card": "#161528", "border": "#2C2A47",
        "text": "#EEEDFB", "muted": "#A3A0C2", "accent": "#A5B4FC",
        "user": "#6366F1", "model": "#A78BFA", "fn": "#38BDF8",
        "line": "#3A3762", "arrow": "#7A77A0",
        "green": "#34D399", "green_text": "#6EE7B7", "green_deep": "#A7F3D0",
        "band": "#0F2A22", "band_border": "#1D4A3A",
        "red": "#F87171", "red_text": "#FCA5A5",
        "amber": "#FBBF24", "amber_text": "#FCD34D", "amber_bg": "#2A1F0C",
        "diamond": "#2A2350", "diamond_text": "#E9E3FF",
        "hl_model": "#A78BFA", "hl_fn": "#38BDF8", "hl_alpha": 0.18,
        "halo": "#818CF8", "halo_alpha": 0.24,
        "bus": "#4F46E5", "bus_sub": "#E0DDFB",
        "kw": "#C4B5FD", "call": "#7DD3FC", "str": "#86EFAC",
        "shadow": 0.0,
    },
}


def _font_dirs() -> list[Path]:
    extra = os.environ.get("OPENPROGRAM_FIGURE_FONTS")
    dirs = [Path(extra)] if extra else []
    return dirs + [Path.home() / "Library" / "Fonts", Path("/Library/Fonts")]


class Font:
    def __init__(self, key: str, filename: str):
        path = next((d / filename for d in _font_dirs() if (d / filename).exists()), None)
        if path is None:
            raise SystemExit(f"missing font {filename}; set OPENPROGRAM_FIGURE_FONTS")
        self.key = key
        self.tt = TTFont(path)
        self.upm = self.tt["head"].unitsPerEm
        self.cmap = self.tt.getBestCmap()
        self.glyphs = self.tt.getGlyphSet()
        self.hmtx = self.tt["hmtx"]

    def glyph(self, ch: str) -> str:
        return self.cmap.get(ord(ch)) or self.cmap.get(ord("?"))

    def advance(self, ch: str) -> int:
        return self.hmtx[self.glyph(ch)][0]

    def outline(self, name: str) -> str:
        pen = SVGPathPen(self.glyphs)
        self.glyphs[name].draw(pen)
        return pen.getCommands()

    def width(self, text: str, size: float, spacing: float = 0) -> float:
        return sum(self.advance(c) for c in text) * size / self.upm + spacing * max(len(text) - 1, 0)


FONTS = {key: Font(key, name) for key, name in FONT_FILES.items()}
FADE = 0.025


def _times(*points: float) -> str:
    return ";".join(f"{min(max(p, 0), 1):.4f}" for p in points)


class Figure:
    """One SVG. Coordinates are pixels; times are fractions of the loop."""

    def __init__(self, height: int, theme: str, seconds: float):
        self.h = height
        self.c = THEMES[theme]
        self.theme = theme
        self.dur = f"{seconds}s"
        self.body: list[str] = []
        self.used: dict[str, str] = {}
        self.markers: set[str] = set()

    def col(self, name: str) -> str:
        return self.c.get(name, name)

    # -- timing -----------------------------------------------------------
    def _fade(self, t_in: float, t_out: float) -> str:
        a, b = t_in, min(t_in + FADE, t_out)
        c, d = t_out, min(t_out + FADE, 1)
        return (f'<animate attributeName="opacity" dur="{self.dur}" repeatCount="indefinite" '
                f'values="0;0;1;1;0;0" keyTimes="{_times(0, a, b, c, d, 1)}"/>')

    def add(self, inner: str, t_in: float | None = None, t_out: float = 0.95) -> None:
        """Append markup; with t_in it is shown from t_in to t_out of each loop."""
        self.body.append(f"<g>{self._fade(t_in, t_out)}{inner}</g>" if t_in is not None else inner)

    # -- text -------------------------------------------------------------
    def text(self, x: float, y: float, s: str, *, font: str = "sans", size: float = 20,
             fill: str = "text", anchor: str = "start", spacing: float = 0) -> str:
        """Outlined text with its baseline at y."""
        f = FONTS[font]
        scale = size / f.upm
        width = f.width(s, size, spacing)
        if anchor == "middle":
            x -= width / 2
        elif anchor == "end":
            x -= width
        uses, cursor = [], 0.0
        for ch in s:
            if ch != " ":
                gid = f"{f.key}-{f.glyph(ch)}"
                if gid not in self.used:
                    self.used[gid] = f.outline(f.glyph(ch))
                uses.append(f'<use href="#{gid}" x="{cursor:.0f}"/>')
            cursor += f.advance(ch) + spacing / scale
        return (f'<g fill="{self.col(fill)}" transform="translate({x:.1f} {y:.1f}) scale({scale:.5f} {-scale:.5f})">'
                + "".join(uses) + "</g>")

    def line_text(self, x, top, lh, s, **kw) -> str:
        """Text centred in a line box of height lh starting at top."""
        size = kw.get("size", 20)
        return self.text(x, top + lh / 2 + size * 0.35, s, **kw)

    def runs(self, x: float, baseline: float, parts: list[tuple[str, str]], *, font="mono", size=22) -> str:
        out, cursor = [], x
        for s, fill in parts:
            out.append(self.text(cursor, baseline, s, font=font, size=size, fill=fill))
            cursor += FONTS[font].width(s, size)
        return "".join(out)

    # -- shapes -----------------------------------------------------------
    def rect(self, x, y, w, h, *, rx=16, fill="card", stroke=None, width=1.5, opacity=None,
             shadow=False, dash=None) -> str:
        s = f' stroke="{self.col(stroke)}" stroke-width="{width}"' if stroke else ""
        d = f' stroke-dasharray="{dash}"' if dash else ""
        o = f' opacity="{opacity}"' if opacity is not None else ""
        f = ' filter="url(#shadow)"' if shadow and self.c["shadow"] else ""
        return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{self.col(fill)}"{s}{d}{o}{f}/>'

    def disc(self, cx, cy, r, fill, opacity=None) -> str:
        o = f' opacity="{opacity}"' if opacity is not None else ""
        return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{self.col(fill)}"{o}/>'

    def ring(self, cx, cy, r, stroke, width=3, fill="bg") -> str:
        return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{self.col(fill)}" stroke="{self.col(stroke)}" '
                f'stroke-width="{width}"/>')

    def seg(self, x1, y1, x2, y2, *, stroke="line", width=3, dash=None, head=False,
            draw: tuple[float, float] | None = None) -> str:
        """A straight segment; ``draw`` reveals it from x1,y1 between two times."""
        color = self.col(stroke)
        m = ""
        if head:
            self.markers.add(stroke)
            m = f' marker-end="url(#head-{stroke})"'
        dd = f' stroke-dasharray="{dash}"' if dash else ""
        line = (f'<path d="M{x1} {y1} L{x2} {y2}" fill="none" stroke="{color}" stroke-width="{width}" '
                f'stroke-linecap="round"{dd}{m}/>')
        if draw is None:
            return line
        a, b = draw
        mask_id = f"m{len(self.body)}_{x1}_{y1}".replace(".", "_")
        reveal = (f'<animate attributeName="stroke-dashoffset" dur="{self.dur}" repeatCount="indefinite" '
                  f'values="1;1;0;0" keyTimes="{_times(0, a, b, 1)}"/>')
        return (f'<mask id="{mask_id}" maskUnits="userSpaceOnUse"><path d="M{x1} {y1} L{x2} {y2}" pathLength="1" '
                f'fill="none" stroke="#fff" stroke-width="{width + 16}" stroke-dasharray="1 1">{reveal}</path></mask>'
                f'<g mask="url(#{mask_id})">{line}</g>')

    def dot(self, points: list[tuple[float, float]], t0: float, t1: float, *, fill="accent", r=7) -> str:
        """A dot that travels the polyline between t0 and t1, hidden otherwise."""
        d = "M" + " L".join(f"{x} {y}" for x, y in points)
        color = self.col(fill)
        motion = (f'<animateMotion dur="{self.dur}" repeatCount="indefinite" path="{d}" calcMode="linear" '
                  f'keyPoints="0;0;1;1" keyTimes="{_times(0, t0, t1, 1)}"/>')
        a, b = t0, min(t0 + 0.008, t1)
        c, e = max(t1 - 0.008, b), t1
        fade = (f'<animate attributeName="opacity" dur="{self.dur}" repeatCount="indefinite" '
                f'values="0;0;1;1;0;0" keyTimes="{_times(0, a, b, c, e, 1)}"/>')
        return (f'<g opacity="0">{fade}<circle r="{r * 2.2}" fill="{color}" opacity="0.2"/>'
                f'<circle r="{r}" fill="{color}"/>{motion}</g>')

    def card(self, x, y, w, h, lines: list[tuple[str, str, float, float, str]], *, fill="card",
             stroke="border", width=1.5, pad=24, align="start", rx=16, shadow=True) -> str:
        """A card whose text lines (text, font, size, line height, colour) are centred vertically."""
        out = [self.rect(x, y, w, h, rx=rx, fill=fill, stroke=stroke, width=width, shadow=shadow)]
        total = sum(lh for _, _, _, lh, _ in lines)
        top = y + (h - total) / 2
        for s, font, size, lh, color in lines:
            tx = x + w / 2 if align == "middle" else x + pad
            out.append(self.line_text(tx, top, lh, s, font=font, size=size, fill=color, anchor=align))
            top += lh
        return "".join(out)

    def header(self, eyebrow: str, line1: str, line2: str) -> None:
        self.add(self.line_text(64, 64, 24, eyebrow, font="mono", size=20, fill="accent", spacing=3.2))
        self.add(self.line_text(64, 104, 68, line1, font="bold", size=60, fill="text", spacing=-1.2))
        self.add(self.line_text(64, 172, 68, line2, font="bold", size=60, fill="accent", spacing=-1.2))
        self.add(self.disc(1456, 80, 12, "user") + self.disc(1488, 80, 12, "model") + self.disc(1520, 80, 12, "fn"))

    def legend(self, x, y, items: list[tuple[str, str]]) -> str:
        out = []
        for color, label in items:
            out.append(self.disc(x + 8, y + 12, 8, color))
            out.append(self.line_text(x + 26, y, 24, label, font="mono", size=20, fill="muted"))
            x += 26 + FONTS["mono"].width(label, 20) + 28
        return "".join(out)

    # -- output -----------------------------------------------------------
    def svg(self, label: str) -> str:
        c = self.c
        defs = [f'<path id="{gid}" d="{d}"/>' for gid, d in sorted(self.used.items())]
        for name in sorted(self.markers):
            defs.append(f'<marker id="head-{name}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.5" '
                        f'markerHeight="4.5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="{self.col(name)}"/></marker>')
        defs.append(f'<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">'
                    f'<path d="M40 0 L0 0 L0 40" fill="none" stroke="{c["grid"]}" stroke-width="1"/></pattern>')
        defs.append('<filter id="shadow" x="-10%" y="-10%" width="120%" height="140%">'
                    f'<feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#23214F" flood-opacity="{c["shadow"]}"/>'
                    '</filter>')
        frame = (f'<rect width="{W}" height="{self.h}" rx="28" fill="{c["bg"]}"/>'
                 f'<rect width="{W}" height="{self.h}" rx="28" fill="url(#grid)"/>'
                 f'<rect x="1" y="1" width="{W - 2}" height="{self.h - 2}" rx="27" fill="none" '
                 f'stroke="{c["border"]}" stroke-width="2"/>')
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{self.h}" viewBox="0 0 {W} {self.h}" '
                f'role="img" aria-label="{label}"><title>{label}</title><defs>{"".join(defs)}</defs>'
                f'{frame}{"".join(self.body)}</svg>\n')


# -----------------------------------------------------------------------------
# 01 · Agent classes


def agent_class(theme: str) -> Figure:
    fig = Figure(800, theme, 11)
    fig.header("01 — AGENT CLASSES", "Python runs the program.", "The model makes the calls.")
    fig.add(fig.rect(64, 288, 800, 384, rx=20, shadow=True, stroke="border", width=1.5))
    code = [
        [("class ", "kw"), ("SupportAgent", "text"), ("(Agent):", "muted")],
        [("    def ", "kw"), ("triage", "call"), ("(self, ticket):", "muted")],
        [("        kind = ", "text"), ("self", "kw"), ("(ticket, choices=[", "muted"), ('"bug"', "str"),
         (", ", "muted"), ('"question"', "str"), ("])", "muted")],
        [("        if ", "kw"), ("kind == ", "text"), ('"bug"', "str"), (":", "muted")],
        [("            logs = ", "text"), ("search_logs", "call"), ("(ticket)", "muted")],
        [("            return self", "kw"), ("(", "muted"), ('f"Reply using {logs}"', "str"), (")", "muted")],
        [("        return self", "kw"), ("(", "muted"), ('"Draft a short reply."', "str"), (")", "muted")],
    ]
    top, lh = 324, 44
    steps = [(2, "model"), (3, "fn"), (4, "fn"), (5, "model")]
    start, span = 0.07, 0.19
    for i, (line, kind) in enumerate(steps):
        t0 = start + span * i
        band = (f'<rect x="76" y="{top + line * lh}" width="776" height="44" rx="8" fill="{fig.col("hl_" + kind)}" '
                f'opacity="{fig.c["hl_alpha"]}"/>'
                f'<rect x="76" y="{top + line * lh + 8}" width="4" height="28" rx="2" fill="{fig.col(kind)}"/>')
        fig.add(band, t0, t0 + span if i < 3 else 0.9)
    for i, parts in enumerate(code):
        fig.add(fig.runs(96, top + i * lh + 22 + 22 * 0.35, parts, size=22))
    fig.add(fig.legend(64, 704, [("model", "model call"), ("fn", "Python")]))

    fig.add(fig.line_text(944, 296, 24, "WHAT RUNS", font="mono", size=18, fill="muted", spacing=2.9))
    rows = [
        ("model", "The model picks a branch", 'choices  →  "bug"'),
        ("fn", "Python checks the answer", 'kind == "bug"  →  True'),
        ("fn", "Python calls your helper", "search_logs(ticket)  →  log lines"),
        ("model", "The model writes the reply", '→  "Thanks, we found the crash…"'),
    ]
    for i, (kind, title, detail) in enumerate(rows):
        y = 340 + i * 96
        t0 = start + span * i + 0.04
        inner = ""
        if i:
            inner += fig.seg(956, y - 72, 956, y - 4, stroke="line", width=2, draw=(t0 - 0.03, t0))
        inner += (fig.disc(956, y + 16, 12, kind)
                  + fig.line_text(992, y, 32, title, font="bold", size=26)
                  + fig.line_text(992, y + 32, 28, detail, font="mono", size=20, fill="muted"))
        fig.add(inner, t0)
    fig.add(fig.line_text(944, 704, 24, "Each step is a node in the execution graph.", font="mono", size=20,
                          fill="accent"), 0.86)
    return fig


# -----------------------------------------------------------------------------
# 02 · DAG context


def dag_context(theme: str) -> Figure:
    fig = Figure(800, theme, 11)
    fig.header("02 — DAG CONTEXT", "Every call is a node.", "Context is what you select.")
    fig.add(fig.legend(64, 272, [("user", "user / result"), ("model", "model call"), ("fn", "function call")]))
    fig.add(fig.rect(64, 548, 1472, 152, rx=20, fill="band", stroke="band_border", width=1.5))
    fig.add(fig.line_text(92, 568, 24, "SUB-AGENT BRANCH", font="mono", size=18, fill="green_text", spacing=2.5))
    fig.add(fig.line_text(92, 600, 28, "own history, own Git worktree;", size=22, fill="green_deep"))
    fig.add(fig.line_text(92, 628, 28, "only the result joins the main line", size=22, fill="green_deep"))

    y, sy = 400, 624
    t = {"root": 0.03, "user": 0.08, "plan": 0.14, "spawn": 0.20, "review": 0.28, "tests": 0.35,
         "merge": 0.43, "next": 0.50}
    edges = [
        ((192, y), (368, y), "line", "root", "user"),
        ((400, y), (584, y), "line", "user", "plan"),
        ((616, y), (800, y), "line", "plan", "spawn"),
        ((816, 416), (816, sy), "green", "spawn", None),
        ((816, sy), (944, sy), "green", None, "review"),
        ((976, sy), (1160, sy), "green", "review", "tests"),
        ((1192, sy), (1296, sy), "green", "tests", None),
        ((1296, sy), (1296, 416), "green", None, "merge"),
        ((832, y), (1280, y), "line", "tests", "merge"),
        ((1312, y), (1456, y), "line", "merge", "next"),
    ]
    for (x1, y1), (x2, y2), stroke, a, b in edges:
        start = t[a] + 0.02 if a else None
        end = t[b] if b else None
        if start is None:
            start = end - 0.04
        if end is None:
            end = start + 0.04
        fig.add(fig.seg(x1, y1, x2, y2, stroke=stroke, width=3, draw=(start, end)))

    def label(cx, top, s, color="text", w=None):
        return fig.line_text(cx, top, 24, s, font="mono", size=20, fill=color, anchor="middle")

    nodes = [
        ("root", fig.ring(176, y, 12, "muted") + label(176, 432, "root", "muted")),
        ("user", fig.disc(384, y, 16, "user") + label(384, 432, "user: ship v1.2")),
        ("plan", fig.disc(600, y, 16, "model") + label(600, 432, "plan release")),
        ("spawn", fig.disc(816, y, 16, "fn") + label(816, 344, "spawn reviewer")),
        ("review", fig.disc(960, sy, 16, "model") + label(960, 656, "review diff", "green_deep")),
        ("tests", fig.disc(1176, sy, 16, "fn") + label(1176, 656, "run tests", "green_deep")),
        ("merge", fig.disc(1296, y, 16, "user") + label(1296, 344, "merge result")),
        ("next", fig.ring(1472, y, 22, "accent") + fig.disc(1472, y, 16, "model")
         + label(1472, 432, "next call", "accent")),
    ]
    for name, inner in nodes:
        fig.add(inner, t[name])

    t_ctx = 0.58
    for k, cx in enumerate((384, 600, 1296)):
        halo = (f'<circle cx="{cx}" cy="{y}" r="32" fill="{fig.col("halo")}" opacity="{fig.c["halo_alpha"]}"/>'
                + fig.disc(cx, y, 16, ["user", "model", "user"][k]))
        fig.add(halo, t_ctx + 0.03 * k)
    fig.add(fig.card(1096, 256, 440, 64, [("Next call reads only the haloed nodes", "sans", 22, 28, "text")],
                     align="middle", rx=14), t_ctx + 0.10)
    fig.add(fig.seg(1472, 320, 1472, 372, stroke="accent", width=2.5, head=True), t_ctx + 0.12)
    return fig


# -----------------------------------------------------------------------------
# 03 · Workflows


def workflow(theme: str) -> Figure:
    fig = Figure(840, theme, 12)
    fig.header("03 — WORKFLOWS", "The model proposes.", "Code checks before anything runs.")
    fig.add(fig.line_text(64, 284, 24, "VALIDATED DECISIONS", font="mono", size=18, fill="muted", spacing=2.5))
    fig.add(fig.line_text(64, 564, 24, "SELF-EVOLVING METHODS", font="mono", size=18, fill="muted", spacing=2.5))
    cy = 380

    # Arrows and the loop back first, so cards paint over their ends.
    fig.add(fig.seg(360, cy, 434, cy, stroke="arrow", width=2.5, head=True))
    fig.add(fig.seg(736, cy, 810, cy, stroke="arrow", width=2.5, head=True))
    fig.add(fig.seg(1120, cy, 1194, cy, stroke="green", width=2.5, head=True))
    fig.add(fig.seg(968, 460, 968, 500, stroke="red", width=2.5, dash="6 7"))
    fig.add(fig.seg(968, 500, 588, 500, stroke="red", width=2.5, dash="6 7"))
    fig.add(fig.seg(588, 500, 588, 442, stroke="red", width=2.5, head=True))

    fig.add(fig.card(64, 324, 296, 112, [("decision.make(…)", "mono", 22, 32, "text"),
                                         ("deploy · rollback", "mono", 20, 28, "muted")]))
    fig.add(fig.card(440, 324, 296, 112, [("The model proposes", "bold", 24, 32, "text"),
                                          ("deploy(env=…)", "mono", 20, 28, "muted")]))
    fig.add(f'<polygon points="968,300 1120,380 968,460 816,380" fill="{fig.col("diamond")}"/>')
    fig.add(fig.line_text(968, 352, 28, "valid option", font="bold", size=22, fill="diamond_text", anchor="middle"))
    fig.add(fig.line_text(968, 380, 28, "and arguments?", font="bold", size=22, fill="diamond_text", anchor="middle"))
    fig.add(fig.card(1200, 324, 336, 112, [("The choice runs", "bold", 24, 32, "text"),
                                           ('deploy(env="prod")', "mono", 20, 28, "green_text")],
                     stroke="border"))
    fig.add(fig.line_text(1160, 344, 24, "yes", font="mono", size=20, fill="green_text", anchor="middle"))
    fig.add(fig.line_text(980, 468, 24, "no", font="mono", size=20, fill="red_text"))
    fig.add(fig.line_text(778, 512, 24, "back to the model", font="mono", size=20, fill="red_text", anchor="middle"))

    # One rejected proposal, then an accepted one.
    fig.add(fig.dot([(360, cy), (440, cy)], 0.03, 0.08))
    # Each proposal covers the card's placeholder line.
    rejected = (fig.rect(450, 382, 276, 28, rx=0, fill="card")
                + fig.line_text(464, 382, 28, 'deploy(env="prd")', font="mono", size=20, fill="red_text"))
    accepted = (fig.rect(450, 382, 276, 28, rx=0, fill="card")
                + fig.line_text(464, 382, 28, 'deploy(env="prod")', font="mono", size=20, fill="green_text"))
    fig.add(rejected, 0.08, 0.34)
    fig.add(accepted, 0.36)
    fig.add(fig.dot([(736, cy), (816, cy)], 0.11, 0.16, fill="red"))
    reject_flash = f'<polygon points="968,300 1120,380 968,460 816,380" fill="none" stroke="{fig.col("red")}" stroke-width="3"/>'
    fig.add(reject_flash, 0.16, 0.30)
    fig.add(fig.dot([(968, 460), (968, 500), (588, 500), (588, 436)], 0.19, 0.32, fill="red"))
    fig.add(fig.dot([(736, cy), (816, cy)], 0.38, 0.43, fill="green"))
    accept_flash = f'<polygon points="968,300 1120,380 968,460 816,380" fill="none" stroke="{fig.col("green")}" stroke-width="3"/>'
    fig.add(accept_flash, 0.43, 0.90)
    fig.add(fig.dot([(1120, cy), (1200, cy)], 0.45, 0.50, fill="green"))
    fig.add(fig.rect(1200, 324, 336, 112, rx=16, fill="none", stroke="green", width=3), 0.50)

    # The self-evolving loop.
    fig.add(fig.seg(384, 660, 442, 660, stroke="arrow", width=2.5, head=True))
    fig.add(fig.seg(768, 660, 826, 660, stroke="arrow", width=2.5, head=True))
    fig.add(fig.seg(1152, 660, 1210, 660, stroke="arrow", width=2.5, head=True))
    fig.add(fig.seg(1376, 716, 1376, 764, stroke="green", width=2.5, dash="6 7"))
    fig.add(fig.seg(1376, 764, 224, 764, stroke="green", width=2.5, dash="6 7"))
    fig.add(fig.seg(224, 764, 224, 722, stroke="green", width=2.5, head=True))
    steps = [
        ("Agent edits a method", "Write / Edit a .py file"),
        ("The watcher notices", "checks every 2 s"),
        ("It reloads", "import · register"),
        ("Live on the next turn", "callable as a tool"),
    ]
    xs = [64, 448, 832, 1216]
    for i, (title, sub) in enumerate(steps):
        fig.add(fig.card(xs[i], 604, 320, 112, [(title, "bold", 24, 32, "text"), (sub, "mono", 20, 28, "muted")]))
    for i in range(4):
        t0 = 0.12 + 0.14 * i
        fig.add(fig.rect(xs[i], 604, 320, 112, rx=16, fill="none", stroke="green", width=3), t0, t0 + 0.14)
        if i < 3:
            fig.add(fig.dot([(xs[i] + 320, 660), (xs[i + 1], 660)], t0 + 0.10, t0 + 0.14, fill="green"))
    fig.add(fig.dot([(1376, 716), (1376, 764), (224, 764), (224, 716)], 0.70, 0.86, fill="green"))
    fig.add(fig.line_text(800, 732, 24, "each change builds on the last", font="mono", size=20,
                          fill="green_text", anchor="middle"))
    return fig


# -----------------------------------------------------------------------------
# 04 · Events


def events(theme: str) -> Figure:
    fig = Figure(800, theme, 12)
    fig.header("04 — EVENTS", "One event bus.", "Anything can listen. A gate can stop a tool.")
    sources = [("Agent loop", "tool.before"), ("Context", "context.compacted"), ("Files", "file.changed"),
               ("Channels", "channel.message_inbound"), ("Memory", "memory.ingest_started")]
    centers = [320, 412, 504, 596, 688]
    sinks = [(296, "Web UI", ["streams events live"]), (448, "Your subscriber", ["subscribe(fn, types={…})"]),
             (600, "Plugin gate", ["tool.before:", "allow or deny"])]
    sink_cy = [352, 504, 656]
    route = [2, 0, 1, 0, 1]  # which subscriber each source's event reaches

    for cy in centers:
        fig.add(fig.seg(400, cy, 602, cy, stroke="line", width=2.5, head=True))
    fig.add(fig.seg(992, 352, 1194, 352, stroke="arrow", width=2.5, dash="6 7", head=True))
    fig.add(fig.seg(992, 504, 1194, 504, stroke="arrow", width=2.5, dash="6 7", head=True))
    fig.add(fig.seg(992, 656, 1192, 656, stroke="amber", width=3.5, head=True))
    for (name, ev), cy in zip(sources, centers):
        fig.add(fig.card(64, cy - 40, 336, 80, [(name, "bold", 24, 30, "text"), (ev, "mono", 20, 26, "muted")],
                         pad=20, rx=14))
    fig.add(f'<rect x="608" y="280" width="384" height="448" rx="28" fill="{fig.col("bus")}"/>')
    fig.add(fig.line_text(800, 360, 56, "EventBus", font="bold", size=44, fill="#FFFFFF", anchor="middle"))
    fig.add(fig.line_text(800, 416, 32, "one per process", size=22, fill="bus_sub", anchor="middle"))
    fig.add(fig.line_text(800, 472, 32, "emit(event)", font="mono", size=20, fill="#FFFFFF", anchor="middle"))
    fig.add(fig.line_text(800, 504, 32, "subscribe(fn, types)", font="mono", size=20, fill="#FFFFFF",
                          anchor="middle"))
    for (top, name, subs), cy in zip(sinks, sink_cy):
        gate = name == "Plugin gate"
        lines = [(name, "bold", 24, 30, "text")] + [(s, "mono", 20, 26, "amber_text" if gate else "muted")
                                                   for s in subs]
        fig.add(fig.card(1200, top, 336, 112, lines, pad=20, fill="amber_bg" if gate else "card",
                         stroke="amber" if gate else "border", width=2 if gate else 1.5))
    fig.add(fig.line_text(1096, 316, 24, "async", font="mono", size=20, fill="muted", anchor="middle"))
    fig.add(fig.line_text(1096, 620, 24, "sync gate", font="mono", size=20, fill="amber_text", anchor="middle"))

    slot = 0.18
    for i, ((name, ev), cy, sink) in enumerate(zip(sources, centers, route)):
        t0 = 0.04 + slot * i
        color = "amber" if sink == 2 else ("user" if sink == 0 else "fn")
        fig.add(fig.dot([(400, cy), (608, cy)], t0, t0 + 0.05, fill=color))
        chip_w = FONTS["mono"].width(ev, 20) + 40
        chip = (fig.rect(800 - chip_w / 2, 600, chip_w, 44, rx=22, fill="card")
                + fig.line_text(800, 600, 44, ev, font="mono", size=20, fill="text", anchor="middle"))
        fig.add(chip, t0 + 0.05, t0 + 0.13)
        fig.add(fig.dot([(992, sink_cy[sink]), (1200, sink_cy[sink])], t0 + 0.09, t0 + 0.14, fill=color))
        fig.add(fig.rect(1200, sinks[sink][0], 336, 112, rx=16, fill="none", stroke=color, width=3.5),
                t0 + 0.14, t0 + 0.18)
    return fig


FIGURES = [
    ("00-agent-class", agent_class, "Agent classes: Python runs the program and the model makes the calls"),
    ("01-dag-context", dag_context, "Execution DAG: every call is a node and context is a selection of nodes"),
    ("02-agentic-workflow", workflow, "Workflows: code checks model decisions, and agents extend their own methods"),
    ("03-event-infrastructure", events, "Events: one bus, async observers and a synchronous tool gate"),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, build, label in FIGURES:
        for theme, suffix in (("dark", ""), ("light", "-light")):
            path = OUT / f"{name}{suffix}.svg"
            path.write_text(build(theme).svg(label), encoding="utf-8")
            print(f"{path.relative_to(ROOT)}  {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
