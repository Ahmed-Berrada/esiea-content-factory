"""Worker média de l'usine ESIEA — traite les lignes du Journal où moteur = worker.

    python worker.py --sheet <ID_DE_LA_SHEET> [--watch] [--parallel 3]

Il lit Config / Formats / Sources / Journal dans la Sheet, réserve les sorties A_FAIRE, produit
(clip 9:16, audio, images 1:1 & 16:9), dépose dans Drive/02_Sorties/<FORMAT>/ et met à jour le Journal.
Tout paramètre (dimensions, durées, modèles, couleurs) vient de la Sheet.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

try:
    from dotenv import load_dotenv

    load_dotenv(HERE / ".env")
except ImportError:
    pass

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import requests  # noqa: E402
from PIL import Image  # noqa: E402

import audio  # noqa: E402
import gemini  # noqa: E402
import imaging  # noqa: E402
import video  # noqa: E402
from gsheets import Factory  # noqa: E402

FONTS = HERE / "assets" / "fonts"
LOCK = threading.Lock()


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def num(v, default=None):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return default


def file_name(source_id: str, format_id: str, version, ext: str) -> str:
    return f"{source_id}__{format_id}__v{int(num(version, 1)):02d}.{ext}"


def cost(cfg: dict, model: str, tin: int, tout: int) -> float:
    pin = num(cfg.get(f"PRIX_IN:{model}"), num(cfg.get("PRIX_IN_DEFAUT"), 0))
    pout = num(cfg.get(f"PRIX_OUT:{model}"), num(cfg.get("PRIX_OUT_DEFAUT"), 0))
    return round((tin * pin + tout * pout) / 1e6, 6)


class Worker:
    def __init__(self, sheet_id: str):
        self.f = Factory(sheet_id)
        self.reload()

    def reload(self):
        self.cfg = self.f.config()
        self.formats = {r["format_id"]: r for r in self.f.table("Formats").rows if r.get("format_id")}
        self.sources = {r["source_id"]: r for r in self.f.table("Sources").rows if r.get("source_id")}
        self.journal = self.f.table("Journal")
        self._logo = None

    # ---------- utilitaires ----------
    def logo(self) -> Path | None:
        fid = self.cfg.get("LOGO_FILE_ID")
        if not fid:
            return None
        if self._logo is None:
            p = Path(tempfile.gettempdir()) / "esiea_logo.png"
            self.f.download(fid, p)
            self._logo = p
        return self._logo

    def update(self, row: int, patch: dict):
        with LOCK:
            self.f.update_row("Journal", self.journal.headers, row, patch)

    def dep_row(self, job: dict, fmt: dict) -> dict | None:
        dep = (fmt.get("depend_de") or "").strip()
        if not dep:
            return None
        ok = [j for j in self.journal.rows if j["source_id"] == job["source_id"] and j["format_id"] == dep and j["statut"] == "OK"]
        return ok[-1] if ok else None

    def deliver(self, job: dict, path: Path, ext: str, mime: str) -> dict:
        root = self.cfg["SORTIES_FOLDER_ID"]
        folder = self.f.folder(root, job["format_id"])
        name = file_name(job["source_id"], job["format_id"], job.get("version") or 1, ext)
        meta = self.f.upload(path, folder, name, mime)
        return {"fichier": name, "file_id": meta["id"], "lien": meta.get("webViewLink", ""), "dossier": job["format_id"]}

    def source_image(self, src: dict, dest: Path) -> np.ndarray:
        if src.get("fichier_id"):
            self.f.download(src["fichier_id"], dest)
        else:
            r = requests.get(src["url"], timeout=60, headers={"User-Agent": "esiea-content-factory/1.0"})
            r.raise_for_status()
            dest.write_bytes(r.content)
        img = cv2.imdecode(np.frombuffer(dest.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise RuntimeError("image illisible")
        return img

    # ---------- formats ----------
    def do_image(self, job, fmt, src, tmp: Path) -> dict:
        W, H = int(num(fmt.get("largeur"), 1080)), int(num(fmt.get("hauteur"), 1080))
        img = self.source_image(src, tmp / "src.img")
        mode = (self.cfg.get("VISION_MODE") or "opencv").lower()
        model = self.cfg.get("VISION_MODEL") or "gemini-3.8-flash"
        logo_path = self.logo() if str(self.cfg.get("LOGO_SUR_IMAGES", "NON")).upper() == "OUI" else None
        logo = Image.open(logo_path).convert("RGBA") if logo_path else None
        out_img, plan, boxes, (tin, tout) = imaging.smart_reframe(
            img, W, H, mode=mode, model=model, fallback=(self.cfg.get("FOND_REPLI") or "flou").lower(),
            color=self.cfg.get("COULEUR_PRIMAIRE") or "#002D72", logo=logo)
        out = tmp / "out.jpg"
        out_img.convert("RGB").save(out, "JPEG", quality=90)
        check = Image.open(out).size
        ok = check == (W, H)
        kinds = ", ".join(sorted({b.kind for b in boxes}))
        res = self.deliver(job, out, "jpg", "image/jpeg")
        res.update({
            "statut": "OK" if ok else "REJETE",
            "controle_auto": f"{'OK' if ok else 'KO'} — {check[0]}x{check[1]} (attendu {W}x{H}), mode {plan.mode}, zones : {kinds or 'aucune'}",
            "raison": plan.reason,
            "modele": model if mode == "gemini" else "opencv (local)",
            "tokens_in": tin, "tokens_out": tout, "cout_usd": cost(self.cfg, model, tin, tout) if mode == "gemini" else 0,
            "genere_par_ia": "O" if mode == "gemini" else "N (traitement algorithmique)",
            "origine_medias": f"image source ESIEA ({src.get('fichier_id') or src.get('url')}) recadrée, aucun pixel généré"
                              + (" ; fond flou de la même image" if plan.mode == "pad" else ""),
        })
        return res

    def do_clip(self, job, fmt, src, tmp: Path) -> dict:
        dep = self.dep_row(job, fmt)
        moments = json.loads(self.f.read_text(dep["file_id"]))
        items = [m for m in moments.get("items", []) if m.get("temps") and m.get("fin")]
        if not items:
            raise RuntimeError("aucun passage clé exploitable dans " + dep["fichier"])
        if not src.get("fichier_video_id"):
            raise RuntimeError("source sans fichier vidéo (colonne fichier_video_id)")
        cues = video.parse_srt(self.f.read_text(src["fichier_id"]))
        vid = self.f.download(src["fichier_video_id"], tmp / "video.mp4")
        W, H = int(num(fmt.get("largeur"), 1080)), int(num(fmt.get("hauteur"), 1920))
        dmin, dmax = num(fmt.get("duree_min_s"), 10), num(fmt.get("duree_max_s"), 60)
        m = items[0]
        info = video.make_clip(vid, cues, video.clock(m["temps"]), video.clock(m["fin"]), tmp / "clip.mp4", tmp / "work",
                               out_w=W, out_h=H, dmin=dmin, dmax=dmax, color=self.cfg.get("COULEUR_PRIMAIRE") or "#002D72",
                               fonts_dir=FONTS, logo=self.logo())
        ok = info["width"] == W and info["height"] == H and dmin - 0.5 <= info["duration"] <= dmax + 0.5
        res = self.deliver(job, tmp / "clip.mp4", "mp4", "video/mp4")
        res.update({
            "statut": "OK" if ok else "REJETE",
            "controle_auto": f"{'OK' if ok else 'KO'} — {info['width']}x{info['height']}, {info['duration']:.1f} s "
                             f"(attendu {W}x{H}, {dmin:g}-{dmax:g} s), visage suivi sur {info['faces']} image(s)",
            "raison": f"passage « {m.get('titre', '')} » {video.ass_time(info['start'])}→{video.ass_time(info['end'])} recalé sur phrases complètes",
            "modele": dep.get("modele", ""), "tokens_in": 0, "tokens_out": 0, "cout_usd": 0,
            "genere_par_ia": "O (choix du passage par IA)",
            "origine_medias": "vidéo source ESIEA (corpus) recadrée ; sous-titres issus du SRT source"
                              + (" ; logo officiel" if self.logo() else ""),
        })
        return res

    def do_audio(self, job, fmt, src, tmp: Path) -> dict:
        dep = self.dep_row(job, fmt)
        script = self.f.read_text(dep["file_id"])
        text = audio.apply_lexicon(audio.clean_for_speech(script), self.cfg.get("LEXIQUE_PRONONCIATION", ""))
        model = self.cfg.get("TTS_MODEL") or "gemini-3.8-flash-tts"
        voice = self.cfg.get("TTS_VOICE") or "Kore"
        pcm, (tin, tout) = gemini.tts(model, voice, text)
        wav = tmp / "voice.wav"
        audio.write_wav(pcm, wav)
        music = None
        if self.cfg.get("MUSIQUE_FILE_ID"):
            music = self.f.download(self.cfg["MUSIQUE_FILE_ID"], tmp / "music.mp3")
        out = tmp / "out.mp3"
        audio.to_mp3(wav, out, music)
        d = audio.mp3_duration(out)
        dmin, dmax = num(fmt.get("duree_min_s"), 0), num(fmt.get("duree_max_s"), 1e9)
        ok = dmin <= d <= dmax
        res = self.deliver(job, out, "mp3", "audio/mpeg")
        res.update({
            "statut": "OK" if ok else "REJETE",
            "controle_auto": f"{'OK' if ok else 'KO'} — {d:.1f} s (attendu {dmin:g}-{dmax:g} s)",
            "raison": f"script {dep['fichier']} ; lexique de prononciation appliqué",
            "modele": model, "tokens_in": tin, "tokens_out": tout, "cout_usd": cost(self.cfg, model, tin, tout),
            "genere_par_ia": "O",
            "origine_medias": f"voix de synthèse générique « {voice} » (aucune voix réelle clonée) ; musique : "
                              + (self.cfg.get("MUSIQUE_LICENCE") or "libre de droits") if music else
                              f"voix de synthèse générique « {voice} » (aucune voix réelle clonée) ; sans musique",
        })
        return res

    # ---------- boucle ----------
    def pending(self) -> list[dict]:
        out = []
        for j in self.journal.rows:
            if (j.get("moteur") or "") != "worker":
                continue
            stale = j["statut"] == "EN_COURS" and j.get("maj_le") and \
                (datetime.now() - datetime.strptime(j["maj_le"][:19], "%Y-%m-%d %H:%M:%S")).total_seconds() > 1800
            if j["statut"] in ("A_FAIRE", "ATTENTE_DEP") or stale:
                out.append(j)
        return out

    def run_one(self, job: dict):
        fmt = self.formats.get(job["format_id"])
        src = self.sources.get(job["source_id"])
        t0 = time.time()
        if fmt and (fmt.get("depend_de") or "").strip() and not self.dep_row(job, fmt):
            dep = fmt["depend_de"].strip()
            failed = [j for j in self.journal.rows if j["source_id"] == job["source_id"] and j["format_id"] == dep]
            if failed and all(j["statut"] in ("ERREUR", "REJETE") for j in failed):
                self.update(job["_row"], {"statut": "ERREUR", "raison": f"dépendance {dep} en échec", "maj_le": now()})
            elif job["statut"] != "ATTENTE_DEP":
                self.update(job["_row"], {"statut": "ATTENTE_DEP", "maj_le": now()})
            return
        tries = int(num(job.get("tentatives"), 0)) + 1
        self.update(job["_row"], {"statut": "EN_COURS", "tentatives": tries, "maj_le": now()})
        try:
            if not fmt or not src:
                raise RuntimeError("format ou source introuvable")
            ext = (fmt.get("sortie") or "").lower()
            with tempfile.TemporaryDirectory() as td:
                tmp = Path(td)
                if ext == "mp4":
                    res = self.do_clip(job, fmt, src, tmp)
                elif ext == "mp3":
                    res = self.do_audio(job, fmt, src, tmp)
                elif ext in ("jpg", "png"):
                    res = self.do_image(job, fmt, src, tmp)
                else:
                    raise RuntimeError(f"sortie worker inconnue : {ext}")
            res.update({"duree_s": round(time.time() - t0, 1), "maj_le": now()})
            self.update(job["_row"], res)
            print(f"  ✔ {job['output_id']} → {res['statut']} ({res['duree_s']} s)")
        except Exception as e:  # le lot continue, l'erreur est visible dans le Journal
            retry = tries < int(num(self.cfg.get("MAX_RETRIES"), 3)) and bool(re.search(r"HTTP (429|5\d\d)|timeout", str(e), re.I))
            self.update(job["_row"], {"statut": "A_FAIRE" if retry else "ERREUR", "raison": str(e)[:480],
                                      "duree_s": round(time.time() - t0, 1), "maj_le": now()})
            print(f"  ✖ {job['output_id']} : {e}")
            if os.environ.get("FACTORY_DEBUG"):
                traceback.print_exc()

    def run(self, parallel: int = 2) -> int:
        self.reload()
        jobs = self.pending()
        print(f"{len(jobs)} sortie(s) média en attente")
        with ThreadPoolExecutor(max_workers=max(1, parallel)) as ex:
            list(ex.map(self.run_one, jobs))
        return len(jobs)


def main():
    ap = argparse.ArgumentParser(description="Worker média de l'usine à contenus ESIEA")
    ap.add_argument("--sheet", default=os.environ.get("FACTORY_SHEET_ID"), help="ID de la Google Sheet tour de contrôle")
    ap.add_argument("--watch", action="store_true", help="tourne en continu (toutes les 30 s)")
    ap.add_argument("--parallel", type=int, default=2)
    a = ap.parse_args()
    if not a.sheet:
        ap.error("--sheet ou FACTORY_SHEET_ID requis")
    w = Worker(a.sheet)
    while True:
        n = w.run(a.parallel)
        if not a.watch:
            break
        time.sleep(30 if n == 0 else 5)


if __name__ == "__main__":
    main()
