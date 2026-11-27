"""Challenge 3-B — recadrage intelligent 1:1 / 16:9 (et tout autre ratio de l'onglet Formats).

1. Détection des zones importantes : IA de vision Gemini (visages, personnes, logos, texte, objet)
   ou, en mode gratuit/hors ligne, OpenCV (visages Haar, personnes HOG, carte de saillance).
2. Placement du cadre au ratio cible qui contient TOUTES les zones critiques (jamais d'étirement).
3. Repli si le sujet ne tient pas (photo de groupe très large en 1:1) : on garde tout le sujet et on
   complète le fond (flou de l'image ou aplat aux couleurs ESIEA) au lieu de couper quelqu'un.
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np
from PIL import Image, ImageFilter

CRITICAL = {"visage", "personne", "logo", "texte", "face", "person", "objet"}


@dataclass
class Box:
    x0: float
    y0: float
    x1: float
    y1: float
    kind: str = "objet"
    label: str = ""

    @property
    def w(self) -> float:
        return self.x1 - self.x0

    @property
    def h(self) -> float:
        return self.y1 - self.y0

    def expand(self, m: float, W: int, H: int) -> "Box":
        dx, dy = self.w * m, self.h * m
        return Box(max(0, self.x0 - dx), max(0, self.y0 - dy), min(W, self.x1 + dx), min(H, self.y1 + dy), self.kind, self.label)


def union(boxes: list[Box]) -> Box:
    return Box(min(b.x0 for b in boxes), min(b.y0 for b in boxes), max(b.x1 for b in boxes), max(b.y1 for b in boxes), "union")


# ---------------- détection ----------------

def detect_opencv(img: np.ndarray) -> list[Box]:
    H, W = img.shape[:2]
    scale = 1000 / max(H, W) if max(H, W) > 1000 else 1.0
    small = cv2.resize(img, (int(W * scale), int(H * scale))) if scale != 1.0 else img
    gray = cv2.equalizeHist(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
    boxes: list[Box] = []
    for name in ("haarcascade_frontalface_default.xml", "haarcascade_profileface.xml"):
        casc = cv2.CascadeClassifier(cv2.data.haarcascades + name)
        for (x, y, w, h) in casc.detectMultiScale(gray, 1.1, 6, minSize=(24, 24)):
            boxes.append(Box(x / scale, y / scale, (x + w) / scale, (y + h) / scale, "visage"))
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
    rects, weights = hog.detectMultiScale(small, winStride=(8, 8), padding=(8, 8), scale=1.05)
    for (x, y, w, h), wt in zip(rects, np.ravel(weights) if len(rects) else []):
        if float(wt) > 0.6:
            boxes.append(Box(x / scale, y / scale, (x + w) / scale, (y + h) / scale, "personne"))
    # un visage implique le haut du corps : on garde de la marge sous le menton
    for b in [b for b in boxes if b.kind == "visage"]:
        boxes.append(Box(b.x0 - b.w * 0.5, b.y0 - b.h * 0.4, b.x1 + b.w * 0.5, min(H, b.y1 + b.h * 1.2), "personne", "buste"))
    return [Box(max(0, b.x0), max(0, b.y0), min(W, b.x1), min(H, b.y1), b.kind, b.label) for b in boxes]


def saliency_box(img: np.ndarray) -> Box:
    """Carte de saillance « spectral residual » (sans dépendance supplémentaire)."""
    H, W = img.shape[:2]
    g = cv2.cvtColor(cv2.resize(img, (128, 128)), cv2.COLOR_BGR2GRAY).astype(np.float32)
    f = np.fft.fft2(g)
    log_amp = np.log(np.abs(f) + 1e-8)
    residual = log_amp - cv2.blur(log_amp, (3, 3))
    sal = np.abs(np.fft.ifft2(np.exp(residual + 1j * np.angle(f)))) ** 2
    sal = cv2.GaussianBlur(sal, (9, 9), 2.5)
    mask = sal > np.percentile(sal, 90)
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return Box(W * 0.25, H * 0.25, W * 0.75, H * 0.75, "saillance")
    return Box(xs.min() / 128 * W, ys.min() / 128 * H, (xs.max() + 1) / 128 * W, (ys.max() + 1) / 128 * H, "saillance")


def detect_gemini(img: np.ndarray, model: str) -> tuple[list[Box], tuple[int, int]]:
    from gemini import detect_boxes

    H, W = img.shape[:2]
    pil = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    pil.thumbnail((1024, 1024))
    buf = io.BytesIO()
    pil.save(buf, "JPEG", quality=88)
    items, use = detect_boxes(model, buf.getvalue())
    boxes = []
    for it in items:
        b = it.get("box_2d") or []
        if len(b) != 4:
            continue
        ymin, xmin, ymax, xmax = [max(0, min(1000, v)) / 1000 for v in b]
        if xmax <= xmin or ymax <= ymin:
            continue
        boxes.append(Box(xmin * W, ymin * H, xmax * W, ymax * H, str(it.get("type", "objet")).lower(), it.get("label", "")))
    return boxes, use


# ---------------- plan de cadrage ----------------

@dataclass
class Plan:
    mode: str                 # "crop" ou "pad"
    rect: tuple[int, int, int, int]  # x, y, w, h dans l'image source (zone conservée)
    canvas: tuple[int, int, int, int]  # x, y, w, h du canevas au ratio cible (peut déborder de l'image)
    subject: Box | None
    reason: str


def plan_crop(W: int, H: int, ratio: float, boxes: list[Box], margin: float = 0.04) -> Plan:
    crit = [b.expand(margin, W, H) for b in boxes if b.kind in CRITICAL] or [b.expand(margin, W, H) for b in boxes]
    # taille maximale du cadre au ratio cible dans l'image
    if W / H > ratio:
        ch, cw = H, int(round(H * ratio))
    else:
        cw, ch = W, int(round(W / ratio))
    if not crit:
        x, y = (W - cw) // 2, (H - ch) // 2
        return Plan("crop", (x, y, cw, ch), (x, y, cw, ch), None, "aucun sujet détecté : cadrage centré")
    U = union(crit)
    if U.w <= cw + 0.5 and U.h <= ch + 0.5:
        cx = (U.x0 + U.x1) / 2
        # les visages sont placés vers le tiers supérieur, le reste au centre
        faces = [b for b in crit if b.kind in ("visage", "face")]
        cy = (U.y0 + U.y1) / 2 if not faces else min((U.y0 + U.y1) / 2, union(faces).y0 + ch * 0.38)
        x = int(round(min(max(cx - cw / 2, U.x1 - cw, 0), U.x0, W - cw)))
        y = int(round(min(max(cy - ch / 2, U.y1 - ch, 0), U.y0, H - ch)))
        x, y = max(0, min(x, W - cw)), max(0, min(y, H - ch))
        return Plan("crop", (x, y, cw, ch), (x, y, cw, ch), U, f"sujet ({len(crit)} zone(s)) conservé entier")
    # repli : le sujet ne tient pas → plus petit canevas au ratio cible contenant tout le sujet
    if U.w / U.h > ratio:
        cvw, cvh = U.w, U.w / ratio
    else:
        cvh, cvw = U.h, U.h * ratio
    cvx, cvy = (U.x0 + U.x1) / 2 - cvw / 2, (U.y0 + U.y1) / 2 - cvh / 2
    # on recadre l'image sur l'intersection et on complète le reste du canevas par le fond
    if cvw <= W:
        cvx = min(max(cvx, 0), W - cvw)
    if cvh <= H:
        cvy = min(max(cvy, 0), H - cvh)
    ix0, iy0 = max(0, int(cvx)), max(0, int(cvy))
    ix1, iy1 = min(W, int(cvx + cvw)), min(H, int(cvy + cvh))
    return Plan("pad", (ix0, iy0, ix1 - ix0, iy1 - iy0), (int(cvx), int(cvy), int(round(cvw)), int(round(cvh))), U,
                "sujet trop large pour le format : fond complété (aucune personne coupée)")


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = (h or "#002D72").lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def render(img_bgr: np.ndarray, plan: Plan, out_w: int, out_h: int, fallback: str = "flou",
           color: str = "#002D72", logo: Image.Image | None = None) -> Image.Image:
    src = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    x, y, w, h = plan.rect
    if plan.mode == "crop":
        out = src.crop((x, y, x + w, y + h)).resize((out_w, out_h), Image.LANCZOS)
    else:
        cx, cy, cw, ch = plan.canvas
        s = out_w / cw  # même facteur sur les deux axes : jamais d'étirement
        if fallback == "couleur":
            bg = Image.new("RGB", (out_w, out_h), hex_to_rgb(color))
        else:
            cover = max(out_w / src.width, out_h / src.height)
            bg = src.resize((int(src.width * cover) + 1, int(src.height * cover) + 1), Image.LANCZOS)
            bx, by = (bg.width - out_w) // 2, (bg.height - out_h) // 2
            bg = bg.crop((bx, by, bx + out_w, by + out_h)).filter(ImageFilter.GaussianBlur(radius=max(12, out_w // 40)))
            bg = Image.blend(bg, Image.new("RGB", bg.size, (0, 0, 0)), 0.25)
        piece = src.crop((x, y, x + w, y + h))
        pw, ph = max(1, int(round(w * s))), max(1, int(round(h * s)))
        piece = piece.resize((pw, ph), Image.LANCZOS)
        bg.paste(piece, (int(round((x - cx) * s)), int(round((y - cy) * s))))
        out = bg
    if logo is not None:  # logo officiel posé tel quel (jamais redessiné)
        lw = int(out_w * 0.16)
        lg = logo.copy()
        lg.thumbnail((lw, lw))
        m = int(out_w * 0.035)
        out.paste(lg, (out_w - lg.width - m, m), lg if lg.mode == "RGBA" else None)
    return out


def smart_reframe(img_bgr: np.ndarray, out_w: int, out_h: int, mode: str = "opencv", model: str = "gemini-3.8-flash",
                  fallback: str = "flou", color: str = "#002D72", logo: Image.Image | None = None):
    """Renvoie (image PIL, plan, boxes, tokens(in,out))."""
    H, W = img_bgr.shape[:2]
    use = (0, 0)
    boxes: list[Box] = []
    if mode == "gemini":
        try:
            boxes, use = detect_gemini(img_bgr, model)
        except Exception:  # repli local si l'API échoue
            boxes = detect_opencv(img_bgr)
    else:
        boxes = detect_opencv(img_bgr)
    if not boxes:
        boxes = [saliency_box(img_bgr)]
        boxes[0].kind = "objet"
    plan = plan_crop(W, H, out_w / out_h, boxes)
    return render(img_bgr, plan, out_w, out_h, fallback, color, logo), plan, boxes, use
