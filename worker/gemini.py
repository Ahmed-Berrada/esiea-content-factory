"""Appels Gemini (vision + synthèse vocale) par API REST. Clé : variable d'environnement GEMINI_API_KEY."""
from __future__ import annotations

import base64
import json
import os
import random
import time

import requests

BASE = "https://generativelanguage.googleapis.com/v1beta/models/"


def _key() -> str:
    k = os.environ.get("GEMINI_API_KEY") or os.environ.get("API_KEY_GEMINI")
    if not k:
        raise RuntimeError("GEMINI_API_KEY absente (fichier worker/.env ou secret Colab)")
    return k


def generate(model: str, payload: dict, timeout: int = 180) -> dict:
    """POST generateContent avec reprise exponentielle sur 429/5xx."""
    for attempt in range(5):
        r = requests.post(
            BASE + model + ":generateContent",
            headers={"x-goog-api-key": _key(), "Content-Type": "application/json"},
            data=json.dumps(payload),
            timeout=timeout,
        )
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504) and attempt < 4:
            time.sleep(min(60, 2 ** (attempt + 1)) + random.random())
            continue
        raise RuntimeError(f"Gemini HTTP {r.status_code}: {r.text[:300]}")
    raise RuntimeError("Gemini : trop de tentatives")


def usage(resp: dict) -> tuple[int, int]:
    u = resp.get("usageMetadata", {})
    return u.get("promptTokenCount", 0), u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)


VISION_PROMPT = (
    "Tu analyses une image pour la recadrer automatiquement sans couper l'essentiel. "
    "Liste chaque élément IMPORTANT visible : visages, personnes (corps entier visible), logos, blocs de texte, "
    "objet principal. Pour chacun renvoie label (court), type parmi [visage, personne, logo, texte, objet] et "
    "box_2d = [ymin, xmin, ymax, xmax] normalisés de 0 à 1000. Ne renvoie que du JSON."
)


def detect_boxes(model: str, jpeg_bytes: bytes) -> tuple[list[dict], tuple[int, int]]:
    payload = {
        "contents": [{"parts": [
            {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(jpeg_bytes).decode()}},
            {"text": VISION_PROMPT},
        ]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "label": {"type": "STRING"},
                        "type": {"type": "STRING"},
                        "box_2d": {"type": "ARRAY", "items": {"type": "INTEGER"}},
                    },
                    "required": ["type", "box_2d"],
                },
            },
        },
    }
    if "2.5" in model:
        payload["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}
    resp = generate(model, payload)
    text = "".join(p.get("text", "") for p in resp["candidates"][0]["content"]["parts"])
    return json.loads(text), usage(resp)


def tts(model: str, voice: str, text: str) -> tuple[bytes, tuple[int, int]]:
    """Voix de synthèse GÉNÉRIQUE prédéfinie (jamais clonée). Renvoie du PCM 16 bits mono 24 kHz."""
    payload = {
        "contents": [{"parts": [{"text": "Lis ce texte en français, d'une voix claire, chaleureuse et dynamique :\n" + text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }
    resp = generate(model, payload, timeout=300)
    part = resp["candidates"][0]["content"]["parts"][0]
    data = part.get("inlineData") or part.get("inline_data")
    return base64.b64decode(data["data"]), usage(resp)
