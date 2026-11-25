"""Résumé audio : script (produit et vérifié par l'Apps Script, format PODCAST_SCRIPT) → voix de synthèse
GÉNÉRIQUE (aucune voix clonée) → MP3, avec musique libre de droits optionnelle."""
from __future__ import annotations

import re
import shutil
import subprocess
import wave
from pathlib import Path


def apply_lexicon(text: str, lexicon: str) -> str:
    """Config LEXIQUE_PRONONCIATION : "ESIEA=E-S-I-E-A; IA=I-A" → sigles prononcés correctement."""
    for pair in re.split(r"[;\n]", lexicon or ""):
        if "=" not in pair:
            continue
        src, dst = (p.strip() for p in pair.split("=", 1))
        if src:
            text = re.sub(r"(?<![\w-])" + re.escape(src) + r"(?![\w-])", dst, text)
    return text


def clean_for_speech(text: str) -> str:
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"[#*_>`]+", "", text)
    text = re.sub(r"[\U0001F300-\U0001FAFF☀-➿]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def write_wav(pcm: bytes, path: Path, rate: int = 24000) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)


def to_mp3(voice_wav: Path, out: Path, music: Path | None = None) -> None:
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg introuvable")
    if music and music.exists():
        dur = wav_duration(voice_wav) + 1.5  # voix + 1,5 s de musique seule, fondu de sortie
        fc = ("[1:a]volume=0.10,afade=t=in:d=1[m];[0:a]apad=pad_dur=1.5[v];"
              f"[v][m]amix=inputs=2:duration=first:dropout_transition=0,afade=t=out:st={max(0.0, dur - 1.5):.2f}:d=1.5[a]")
        cmd = ["ffmpeg", "-y", "-i", str(voice_wav), "-stream_loop", "-1", "-i", str(music), "-filter_complex", fc,
               "-map", "[a]", "-ar", "44100", "-b:a", "128k", str(out)]
    else:
        cmd = ["ffmpeg", "-y", "-i", str(voice_wav), "-ar", "44100", "-b:a", "128k", str(out)]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError("ffmpeg : " + p.stderr[-500:])


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


def mp3_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip() or 0)
