"""
Parse a short-film script model response into scene prompts.

The model is asked for a JSON array. If that payload is missing or invalid,
the original script is split into scenes so a film can still be queued.
"""
from __future__ import annotations

import json
import re
from typing import Any

ALLOWED_MODES = ("T2V", "REF2VA", "FL2VA")

_MODE_ALIASES = {
    "T2V": "T2V",
    "TEXT2VID": "T2V",
    "TEXT2VIDEO": "T2V",
    "TEXT_TO_VIDEO": "T2V",
    "TXT2VID": "T2V",
    "REF2VA": "REF2VA",
    "REF2VID": "REF2VA",
    "REF2V": "REF2VA",
    "REFERENCE_TO_VIDEO": "REF2VA",
    "FL2VA": "FL2VA",
    "FL2V": "FL2VA",
    "I2V": "FL2VA",
    "FIRST_LAST": "FL2VA",
    "CHAIN": "FL2VA",
}

_MIN_DURATION = 5.0
_MAX_DURATION = 15.0
_DEFAULT_DURATION = 5.0

_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
_SENTENCE_RE = re.compile(r"(?<=[.!?。！？])\s+")


def parse_scenes(text: str, script: str, max_scenes: int) -> list[dict[str, Any]]:
    """
    Turn model text into a non-empty scene list.

    A scene is ``{"prompt", "mode", "duration"}``. ``max_scenes`` is at least 1.
    """
    limit = max(1, int(max_scenes))
    parsed = _scenes_from_model(text, limit)
    if parsed:
        return parsed
    return _fallback_scenes(script, limit)


def _scenes_from_model(text: str, limit: int) -> list[dict[str, Any]]:
    payload = _load_json_payload(text)
    items = _scene_items(payload)
    scenes: list[dict[str, Any]] = []

    for item in items:
        scene = _coerce_scene(item)
        if scene is None:
            continue
        scenes.append(scene)
        if len(scenes) >= limit:
            break

    return scenes


def _load_json_payload(text: str) -> Any:
    cleaned = (text or "").strip()
    if not cleaned:
        return None

    cleaned = _FENCE_RE.sub("", cleaned).strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    candidates = [cleaned]
    array_start = cleaned.find("[")
    array_end = cleaned.rfind("]")
    if array_start >= 0 and array_end > array_start:
        candidates.append(cleaned[array_start : array_end + 1])

    object_start = cleaned.find("{")
    object_end = cleaned.rfind("}")
    if object_start >= 0 and object_end > object_start:
        candidates.append(cleaned[object_start : object_end + 1])

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    return None


def _scene_items(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload

    if isinstance(payload, dict):
        for key in ("scenes", "shots", "items"):
            value = payload.get(key)
            if isinstance(value, list):
                return value
        if "prompt" in payload:
            return [payload]

    return []


def _coerce_scene(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None

    prompt = item.get("prompt", item.get("text", item.get("description")))
    if not isinstance(prompt, str):
        return None

    prompt = " ".join(prompt.split())
    if not prompt:
        return None

    mode = _MODE_ALIASES.get(str(item.get("mode", "T2V")).strip().upper())
    if mode not in ALLOWED_MODES:
        return None

    return {
        "prompt": prompt,
        "mode": mode,
        "duration": _coerce_duration(item.get("duration", item.get("duration_seconds"))),
    }


def _coerce_duration(value: Any) -> float:
    try:
        duration = float(value)
    except (TypeError, ValueError):
        duration = _DEFAULT_DURATION

    if duration != duration:  # NaN
        duration = _DEFAULT_DURATION

    return float(min(_MAX_DURATION, max(_MIN_DURATION, duration)))


def _fallback_scenes(script: str, limit: int) -> list[dict[str, Any]]:
    """
    Split the script when the model output cannot be used.

    Blank lines define scenes. A single block is split into sentences.
    The first scene is T2V. Later scenes are FL2VA so the caller can hand
    the previous last frame forward.
    """
    parts = _split_script(script)
    if not parts:
        text = " ".join((script or "").split())
        parts = [text] if text else ["Untitled scene"]

    scenes: list[dict[str, Any]] = []
    for index, part in enumerate(parts[:limit]):
        scenes.append(
            {
                "prompt": part,
                "mode": "T2V" if index == 0 else "FL2VA",
                "duration": _DEFAULT_DURATION,
            }
        )
    return scenes


def _split_script(script: str) -> list[str]:
    text = (script or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return []

    paragraphs = [re.sub(r"\s+", " ", block).strip() for block in re.split(r"\n\s*\n", text)]
    paragraphs = [block for block in paragraphs if block]
    if len(paragraphs) > 1:
        return paragraphs

    sentences = [part.strip() for part in _SENTENCE_RE.split(text) if part.strip()]
    if len(sentences) > 1:
        return [" ".join(part.split()) for part in sentences]

    return [" ".join(text.split())]
