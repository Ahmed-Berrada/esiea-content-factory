"""Tests hors ligne du worker (sans API ni Drive) : python -m pytest tests/"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))

import audio  # noqa: E402
import imaging  # noqa: E402
import video  # noqa: E402
from imaging import Box  # noqa: E402


def inside(inner: Box, rect) -> bool:
    x, y, w, h = rect
    return inner.x0 >= x - 1 and inner.y0 >= y - 1 and inner.x1 <= x + w + 1 and inner.y1 <= y + h + 1


def test_subject_on_edge_is_kept_in_square():
    face = Box(1700, 300, 1850, 500, "visage")          # visage tout à droite d'une image 16:9
    p = imaging.plan_crop(1920, 1080, 1.0, [face])
    assert p.mode == "crop"
    assert p.rect[2] == p.rect[3] == 1080              # carré maximal
    assert inside(face, p.rect)                         # le recadrage centré l'aurait coupé
    assert p.rect[0] > 420                              # centré aurait donné x=420


def test_logo_and_text_kept_in_16x9_from_portrait():
    logo = Box(50, 40, 300, 140, "logo")
    text = Box(100, 1700, 900, 1850, "texte")
    p = imaging.plan_crop(1080, 1920, 16 / 9, [logo, text])
    # logo en haut et texte en bas d'un portrait : impossible en 16:9 → repli sans coupe
    assert p.mode == "pad"
    assert inside(logo, p.rect) and inside(text, p.rect)


def test_wide_group_photo_falls_back_to_padding():
    people = [Box(60 + i * 330, 200, 300 + i * 330, 1000, "personne") for i in range(6)]  # 6 personnes sur 2000 px
    p = imaging.plan_crop(2048, 1100, 1.0, people)
    assert p.mode == "pad"
    for b in people:
        assert inside(b, p.rect)


def test_render_never_stretches_and_has_exact_size():
    img = np.zeros((1100, 2048, 3), np.uint8)
    img[:, :, 1] = 200
    people = [Box(60 + i * 330, 200, 300 + i * 330, 1000, "personne") for i in range(6)]
    p = imaging.plan_crop(2048, 1100, 1.0, people)
    for fb in ("flou", "couleur"):
        out = imaging.render(img, p, 1080, 1080, fb)
        assert out.size == (1080, 1080)
    # la zone conservée garde son ratio (même facteur d'échelle sur x et y)
    cx, cy, cw, ch = p.canvas
    assert abs(cw / ch - 1.0) < 0.01


def test_opencv_pipeline_runs_without_subject():
    img = (np.random.default_rng(0).random((600, 900, 3)) * 255).astype(np.uint8)
    out, plan, boxes, use = imaging.smart_reframe(img, 1920, 1080, mode="opencv")
    assert out.size == (1920, 1080) and use == (0, 0)


def cues():
    texts = ["Bonjour à tous.", "Aujourd'hui on parle", "de cybersécurité.", "C'est un sujet clé.",
             "Les étudiants travaillent", "sur des projets concrets.", "Merci."]
    return [video.Cue(i * 5.0, i * 5.0 + 5, t) for i, t in enumerate(texts)]


def test_clip_snaps_to_full_sentences():
    start, end, sel = video.snap_to_sentences(cues(), 7.0, 22.0, 10, 30)
    assert start in (5.0, 0.0, 15.0)
    assert video.ends_sentence(sel[-1].text)
    i0 = [c.start for c in cues()].index(start)
    assert i0 == 0 or video.ends_sentence(cues()[i0 - 1].text)
    assert 10 <= end - start <= 30


def test_ass_two_lines_max():
    ass = video.build_ass([video.Cue(0, 6, "Une phrase assez longue pour être découpée en plusieurs lignes de sous-titres verticaux lisibles.")], 0, "#002D72")
    dialogues = [l for l in ass.splitlines() if l.startswith("Dialogue")]
    assert len(dialogues) >= 2
    assert all(l.split(",,", 1)[1].count("\\N") <= 1 for l in dialogues)


def test_lexicon_pronunciation():
    t = audio.apply_lexicon("L'ESIEA forme à l'IA et au cyber.", "ESIEA=E-S-I-E-A; IA=I-A; cyber=cybère")
    assert "E-S-I-E-A" in t and "I-A" in t and "cybère" in t
    assert "ESIEA" not in t


def test_srt_parse():
    c = video.parse_srt("1\n00:00:01,500 --> 00:00:03,000\nBonjour.\n\n2\n00:00:03,000 --> 00:00:05,000\nSuite.\n")
    assert len(c) == 2 and c[0].start == 1.5
