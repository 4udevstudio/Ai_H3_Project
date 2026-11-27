"""
Split a short-film script into generation scenes.

LLM path
---------
This does not call a cloud model and does not use the llama.cpp stub in
``llm_service.py``. It reuses the local ComfyUI Gemma path already used for
prompt enhancement: ``CLIPLoader`` → ``TextGenerateV2`` → ``PreviewAny``
(``gemma4_e4b_it_fp8_scaled.safetensors``).

Script splitting is text-only, so the workflow has no ``LoadImage`` nodes.
That matches TextGenerateV2's optional image input. A real ComfyUI with the
Gemma clip is required at runtime; this service was not executed against a
GPU in CI.

If ComfyUI cannot be reached, submit fails, or the run does not finish, the
API returns 503. If ComfyUI returns text that is not usable JSON, the script
is split locally by paragraphs or sentences.
"""
from __future__ import annotations

import time
from typing import Any

from app.services import comfyui_client
from app.services.prompt_enhance_service import (
    DEFAULT_CLIP_NAME,
    NODE_CLIP_LOADER,
    NODE_PREVIEW,
    NODE_TEXT_GEN,
    extract_text,
)
from app.services.scene_parser import parse_scenes

SCRIPT_TIMEOUT_SECONDS = 120.0


class ScriptModelUnavailable(RuntimeError):
    """ComfyUI Gemma cannot run a script split right now."""


def build_script_workflow(instruction: str, seed: int = 0) -> dict[str, Any]:
    """Text-only Gemma workflow. No reference image is required."""
    prompt = instruction.strip()
    if not prompt:
        raise ValueError("instruction is empty")

    return {
        NODE_CLIP_LOADER: {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": DEFAULT_CLIP_NAME,
                "type": "stable_diffusion",
                "device": "default",
            },
        },
        NODE_TEXT_GEN: {
            "class_type": "TextGenerateV2",
            "inputs": {
                "prompt": prompt,
                "max_length": 2048,
                "sampling_mode": "on",
                "sampling_mode.temperature": 0.3,
                "sampling_mode.top_k": 40,
                "sampling_mode.top_p": 0.9,
                "sampling_mode.min_p": 0.05,
                "sampling_mode.repetition_penalty": 1.05,
                "sampling_mode.presence_penalty": 0,
                "sampling_mode.seed": int(seed),
                "thinking": False,
                "use_default_template": True,
                "mtp": "auto",
                "clip": [NODE_CLIP_LOADER, 0],
            },
        },
        NODE_PREVIEW: {
            "class_type": "PreviewAny",
            "inputs": {"source": [NODE_TEXT_GEN, 0]},
        },
    }


def compose_script_instruction(script: str, max_scenes: int, language: str | None) -> str:
    language_line = "Write each prompt in the same language as the script."
    if language and language.strip():
        clean = " ".join(language.strip().split())[:40]
        language_line = f"Write each prompt in {clean}."

    return (
        "You split a short film script into scenes for a local MiniMax H3 video model.\n"
        "Return ONLY a JSON array. No markdown, no commentary.\n"
        'Each item must be {"prompt": string, "mode": "T2V"|"REF2VA"|"FL2VA", "duration": number}.\n'
        "Rules:\n"
        f"- At most {int(max_scenes)} scenes.\n"
        "- duration is seconds, between 5 and 15.\n"
        "- The first scene is T2V unless it depends on an existing reference image.\n"
        "- A scene that continues the previous shot is FL2VA.\n"
        "- A scene that needs a character or location reference is REF2VA.\n"
        f"- {language_line}\n"
        "- prompt is one dense visual paragraph for that scene.\n\n"
        "SCRIPT:\n"
        f"{script.strip()}\n"
    )


def split_script(script: str, max_scenes: int = 8, language: str | None = None) -> list[dict[str, Any]]:
    """
    Run Gemma on ComfyUI and parse scenes.

    Raises:
        ScriptModelUnavailable: ComfyUI is down, rejected the workflow, or timed out.
    """
    _ensure_comfyui()
    instruction = compose_script_instruction(script, max_scenes, language)
    workflow = build_script_workflow(instruction)

    try:
        prompt_id, _client_id, _response = comfyui_client.submit_prompt(workflow)
    except Exception as exc:
        raise ScriptModelUnavailable(f"ComfyUI did not accept the script workflow: {exc}") from exc

    entry = _wait_for_text(prompt_id)
    text = extract_text(entry)
    return parse_scenes(text, script, max_scenes)


def _ensure_comfyui() -> None:
    try:
        comfyui_client.get_system_stats()
    except Exception as exc:
        raise ScriptModelUnavailable(f"ComfyUI is unavailable: {exc}") from exc


def _wait_for_text(prompt_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + SCRIPT_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        try:
            entry = comfyui_client.get_history_entry(prompt_id)
        except Exception as exc:
            raise ScriptModelUnavailable(f"ComfyUI history failed: {exc}") from exc

        if entry:
            status = (entry.get("status") or {}).get("status_str")
            if status == "error":
                raise ScriptModelUnavailable("ComfyUI reported an error while splitting the script")
            return entry

        time.sleep(0.4)

    raise ScriptModelUnavailable("ComfyUI did not finish the script split in time")
