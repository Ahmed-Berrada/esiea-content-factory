"""Clips verticaux 9:16 sous-titrés à partir d'une vidéo 16:9 + son SRT.

- Le passage est choisi par l'IA (format MOMENTS_CLES, horodatages vérifiés) puis RECALÉ sur des
  phrases complètes du SRT (début après une fin de phrase, fin sur une ponctuation finale).
- Recadrage 9:16 centré sur la personne qui parle (médiane des visages détectés sur le passage).
- Sous-titres incrustés (ASS) : police Roboto, 2 lignes max, encadré aux couleurs ESIEA, zone sûre Reels/Shorts.
- Traitement par ffmpeg (Apps Script ne peut pas le faire) en local ou dans Colab.
"""
from __future__ import annotations

import re
import shutil
import statistics
import subprocess
import textwrap
from dataclasses import dataclass
from pathlib import Path

import cv2


@dataclass
class Cue:
    start: float
    end: float
    text: str


def srt_time(t: str) -> float:
    h, m, s = re.match(r"(\d+):(\d+):(\d+[,.]\d+)", t.strip()).groups()
    return int(h) * 3600 + int(m) * 60 + float(s.replace(",", "."))


def parse_srt(content: str) -> list[Cue]:
    cues = []
    for block in re.split(r"\n\s*\n", content.replace("\r", "").lstrip("﻿")):
        lines = [l for l in block.split("\n") if l.strip()]
        ti = next((i for i, l in enumerate(lines) if "-->" in l), None)
        if ti is None:
            continue
        a, b = lines[ti].split("-->")
        txt = re.sub(r"<[^>]+>", "", " ".join(lines[ti + 1:])).strip()
        cues.append(Cue(srt_time(a), srt_time(b), txt))
    return cues


def clock(c: str) -> float:
    v = 0.0
    for p in str(c).strip().split(":"):
        v = v * 60 + float(p)
    return v


def ends_sentence(t: str) -> bool:
    return bool(re.search(r"[.!?…»\"]\s*$", t.strip()))


def snap_to_sentences(cues: list[Cue], t0: float, t1: float, dmin: float, dmax: float) -> tuple[float, float, list[Cue]]:
    """Recale [t0, t1] pour commencer et finir sur des phrases complètes, durée dans [dmin, dmax]."""
    if not cues:
        raise ValueError("SRT vide")
    starts = [i for i, c in enumerate(cues) if i == 0 or ends_sentence(cues[i - 1].text)]
    i0 = min(starts, key=lambda i: abs(cues[i].start - t0))
    ends = [j for j, c in enumerate(cues) if ends_sentence(c.text) and j >= i0]
    if not ends:
        ends = [len(cues) - 1]
    ok = [j for j in ends if dmin <= cues[j].end - cues[i0].start <= dmax]
    if ok:
        j1 = min(ok, key=lambda j: abs(cues[j].end - t1))
    else:  # aucune fin de phrase dans la plage : on prend la plus proche de la durée cible, bornée à dmax
        target = min(max(t1 - cues[i0].start, dmin), dmax)
        j1 = min(ends, key=lambda j: abs((cues[j].end - cues[i0].start) - target))
    return cues[i0].start, cues[j1].end, cues[i0:j1 + 1]


def speaker_center_x(video: Path, t0: float, t1: float, step: float = 0.5) -> tuple[float, int]:
    """Abscisse (0..1) médiane du plus grand visage détecté entre t0 et t1."""
    cap = cv2.VideoCapture(str(video))
    casc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    xs, t = [], t0
    while t < t1:
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        t += step
        if not ok:
            continue
        h, w = frame.shape[:2]
        sc = 640 / w
        g = cv2.cvtColor(cv2.resize(frame, (640, int(h * sc))), cv2.COLOR_BGR2GRAY)
        faces = casc.detectMultiScale(g, 1.1, 6, minSize=(30, 30))
        if len(faces):
            x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
            xs.append((x + fw / 2) / 640)
    cap.release()
    return (statistics.median(xs) if xs else 0.5), len(xs)


def ass_time(s: float) -> str:
    s = max(0.0, s)
    h = int(s // 3600)
    m = int(s % 3600 // 60)
    return f"{h}:{m:02d}:{s % 60:05.2f}"


def ass_color(hexc: str, alpha: int = 0) -> str:
    h = hexc.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H{alpha:02X}{b}{g}{r}".upper()


def build_ass(cues: list[Cue], offset: float, color: str, font: str = "Roboto", max_chars: int = 26) -> str:
    """Sous-titres lisibles en vertical : 2 lignes max de ~26 caractères, découpés dans le temps si besoin."""
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,{font},68,&H00FFFFFF,&H00FFFFFF,{ass_color(color, 0x20)},{ass_color(color, 0x20)},1,0,0,0,100,100,0,0,3,14,0,2,90,90,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    for c in cues:
        lines = textwrap.wrap(c.text, max_chars)
        chunks = [lines[i:i + 2] for i in range(0, len(lines), 2)] or [[""]]
        total = sum(len(" ".join(ch)) for ch in chunks) or 1
        t = c.start
        for ch in chunks:
            d = (c.end - c.start) * len(" ".join(ch)) / total
            text = "\\N".join(ch)
            events.append(f"Dialogue: 0,{ass_time(t - offset)},{ass_time(t + d - offset)},Sub,,0,0,0,,{text}")
            t += d
    return head + "\n".join(events) + "\n"


def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration",
         "-of", "default=nw=1", str(path)], capture_output=True, text=True, check=True).stdout
    d = dict(l.split("=", 1) for l in out.strip().splitlines() if "=" in l)
    return {"width": int(d.get("width", 0)), "height": int(d.get("height", 0)), "duration": float(d.get("duration", 0))}


def make_clip(video: Path, cues: list[Cue], t0: float, t1: float, out: Path, work: Path, *, out_w=1080, out_h=1920,
              dmin=10, dmax=60, color="#002D72", fonts_dir: Path | None = None, logo: Path | None = None) -> dict:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg introuvable (winget install Gyan.FFmpeg, ou lancer dans Colab)")
    start, end, sel = snap_to_sentences(cues, t0, t1, dmin, dmax)
    cap = cv2.VideoCapture(str(video))
    vw, vh = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    cx, nfaces = speaker_center_x(video, start, end)
    cw = int(vh * out_w / out_h) // 2 * 2
    cw = min(cw, vw // 2 * 2)
    x = int(min(max(cx * vw - cw / 2, 0), vw - cw))

    work.mkdir(parents=True, exist_ok=True)
    (work / "clip.ass").write_text(build_ass(sel, start, color), encoding="utf-8")
    fdir = work / "fonts"
    fdir.mkdir(exist_ok=True)
    if fonts_dir and fonts_dir.exists():
        for f in fonts_dir.glob("*.[ot]tf"):
            shutil.copy(f, fdir / f.name)
    shutil.copy(video, work / ("in" + video.suffix))
    vf = f"crop={cw}:{vh}:{x}:0,scale={out_w}:{out_h}:flags=lanczos,setsar=1,subtitles=clip.ass:fontsdir=fonts"
    cmd = ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", "in" + video.suffix]
    if logo and logo.exists():
        shutil.copy(logo, work / "logo.png")
        cmd += ["-i", "logo.png", "-filter_complex",
                f"[0:v]{vf}[v];[1:v]scale={int(out_w * 0.22)}:-1[l];[v][l]overlay=W-w-60:90[o]", "-map", "[o]", "-map", "0:a?"]
    else:
        cmd += ["-vf", vf]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "out.mp4"]
    p = subprocess.run(cmd, cwd=work, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError("ffmpeg : " + p.stderr[-600:])
    shutil.move(str(work / "out.mp4"), out)
    info = ffprobe(out)
    info.update({"start": start, "end": end, "faces": nfaces, "crop_x": x, "crop_w": cw})
    return info
