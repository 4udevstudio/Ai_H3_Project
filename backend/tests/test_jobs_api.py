"""
/jobs API with a mocked ComfyUI client.

Export tests render real clips with ffmpeg. Nothing here touches SQLite.
"""
from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

from tests.paths import COMFY_INPUT, OUTPUTS
from app.services import comfyui_client
from app.services.queue_service import queue_service


def _ffmpeg(*args: str) -> None:
    proc = subprocess.run(["ffmpeg", "-y", *args], capture_output=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", errors="replace")[-500:])


def _color_clip(path: Path, color: str, size: str, fps: int, duration: float, audio: bool) -> None:
    cmd = ["-f", "lavfi", "-i", f"color=c={color}:s={size}:r={fps}:d={duration}"]
    if audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={duration}", "-shortest", "-c:a", "aac"]
    else:
        cmd += ["-an"]
    cmd += ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)]
    _ffmpeg(*cmd)


def _jpeg(path: Path) -> None:
    _ffmpeg("-f", "lavfi", "-i", "color=c=green:s=32x32:d=1", "-frames:v", "1", str(path))


def _probe(path: Path) -> dict:
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration",
            "-of", "json",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    return json.loads(proc.stdout)


def _wait_job(client, job_id: str, timeout: float = 40.0) -> dict:
    deadline = time.monotonic() + timeout
    last = {}
    while time.monotonic() < deadline:
        response = client.get(f"/jobs/{job_id}")
        assert response.status_code == 200, response.text
        last = response.json()
        if last["status"] in {"done", "failed"}:
            return last
        time.sleep(0.15)
    raise AssertionError(f"job {job_id} did not finish: {last}")


def test_existing_routes_still_registered(api):
    root = api.get("/")
    assert root.status_code == 200
    assert root.json()["service"] == "ReelFire API"

    health = api.get("/api/llm/status")
    assert health.status_code == 200
    assert health.json()["loaded"] is False

    paths = [getattr(route, "path", "") for route in api.app.routes]
    assert paths.count("/api/media/extract-frame") == 1
    assert paths.count("/api/media/concat") == 1
    assert "/api/generations/" in paths or "/api/generations" in paths


def test_script_to_scenes_parses_model_json(api, monkeypatch):
    monkeypatch.setattr(comfyui_client, "get_system_stats", lambda: {"system": "ok"})

    def submit(_workflow):
        return ("pid-script", "cid", {})

    def history(prompt_id):
        assert prompt_id == "pid-script"
        payload = (
            '```json\n[{"prompt":"MODEL_SCENE_ALPHA harbor","mode":"T2V","duration":6},'
            '{"prompt":"MODEL_SCENE_BETA dock","mode":"fl2va","duration":8}]```'
        )
        return {"status": {"status_str": "success"}, "outputs": {"9": {"text": [payload]}}}

    monkeypatch.setattr(comfyui_client, "submit_prompt", submit)
    monkeypatch.setattr(comfyui_client, "get_history_entry", history)

    response = api.post(
        "/jobs/script-to-scenes",
        json={"script": "A boat leaves the harbor.\n\nIt reaches open water.", "max_scenes": 4, "language": "English"},
    )
    assert response.status_code == 200, response.text
    scenes = response.json()["scenes"]
    assert scenes[0]["prompt"] == "MODEL_SCENE_ALPHA harbor"
    assert scenes[0]["mode"] == "T2V"
    assert scenes[0]["duration"] == 6
    assert scenes[1]["mode"] == "FL2VA"


def test_script_to_scenes_falls_back_when_model_text_is_unusable(api, monkeypatch):
    monkeypatch.setattr(comfyui_client, "get_system_stats", lambda: {})
    monkeypatch.setattr(comfyui_client, "submit_prompt", lambda _workflow: ("pid", "cid", {}))
    monkeypatch.setattr(
        comfyui_client,
        "get_history_entry",
        lambda _prompt_id: {"outputs": {"9": {"text": "I cannot format that, sorry."}}},
    )

    response = api.post(
        "/jobs/script-to-scenes",
        json={"script": "The market opens at dawn.\n\nA violinist plays under the awning."},
    )
    assert response.status_code == 200, response.text
    scenes = response.json()["scenes"]
    assert scenes[0]["mode"] == "T2V"
    assert "market" in scenes[0]["prompt"]
    assert scenes[1]["mode"] == "FL2VA"
    assert "violinist" in scenes[1]["prompt"]


def test_script_to_scenes_503_when_comfyui_is_down(api, monkeypatch):
    def explode():
        raise comfyui_client.ComfyUIError("connection refused")

    called = {"submit": 0}

    def submit(_workflow):
        called["submit"] += 1
        return ("pid", "cid", {})

    monkeypatch.setattr(comfyui_client, "get_system_stats", explode)
    monkeypatch.setattr(comfyui_client, "submit_prompt", submit)

    response = api.post("/jobs/script-to-scenes", json={"script": "One quiet street."})
    assert response.status_code == 503
    assert "error" in response.json()
    assert called["submit"] == 0


def test_generate_scene_fl2va_first_frame_handoff(api, monkeypatch):
    frame = OUTPUTS / "frames" / "prev_last.jpg"
    _jpeg(frame)
    sample = OUTPUTS / "videos" / "sample-source.mp4"
    _color_clip(sample, "red", "160x96", 24, 2, audio=False)
    sample_bytes = sample.read_bytes()
    captured = {}

    monkeypatch.setattr("app.services.h3_service.comfyui_client.get_system_stats", lambda: {})

    def submit(workflow):
        captured["workflow"] = workflow
        return ("prompt-gen", "client-gen", {})

    def download(_file_info, destination, timeout=120.0):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(sample_bytes)
        return "video/mp4"

    monkeypatch.setattr("app.services.h3_service.comfyui_client.submit_prompt", submit)
    monkeypatch.setattr("app.services.h3_service.comfyui_client.wait_for_completion", lambda **_kwargs: None)
    monkeypatch.setattr(
        "app.services.h3_service.comfyui_client.wait_for_history",
        lambda prompt_id, timeout=1800.0: {
            "status": {"status_str": "success"},
            "outputs": {"161": {"video": [{"filename": "out.mp4", "subfolder": "", "type": "output"}]}},
        },
    )
    monkeypatch.setattr("app.services.h3_service.comfyui_client.download_output_file", download)

    created = api.post(
        "/jobs/generate-scene",
        json={
            "prompt": "Continue the walk down the alley",
            "mode": "FL2VA",
            "gguf": False,
            "duration": 5,
            "seed": 7,
            "width": 960,
            "height": 544,
            "fps": 24,
            "first_frame": "frames/prev_last.jpg",
        },
    )
    assert created.status_code == 200, created.text
    job_id = created.json()["job_id"]

    queued = api.get(f"/api/generations/{job_id}")
    assert queued.status_code == 200
    assert queued.json()["type"] == "FL2VA"
    assert queued.json()["resolution"] == "0.5 MP"
    assert queued.json()["aspect_ratio"] == "16:9 (Widescreen)"

    finished = _wait_job(api, job_id)
    assert finished["status"] == "done", finished
    assert finished["progress"] == 100
    assert finished["video_path"] == f"videos/{job_id}.mp4"
    assert finished["video_url"] == f"/api/media/videos/{job_id}.mp4"
    assert finished["last_frame_path"] == f"frames/{job_id}_last.jpg"
    assert finished["last_frame_url"] == f"/api/media/frames/{job_id}_last.jpg"
    assert finished["error"] is None

    media = api.get(finished["video_url"])
    assert media.status_code == 200
    frame_media = api.get(finished["last_frame_url"])
    assert frame_media.status_code == 200
    assert frame_media.content[:2] == b"\xff\xd8" or len(frame_media.content) > 100

    workflow = captured["workflow"]
    image_name = workflow["900"]["inputs"]["image"]
    assert workflow["162"]["inputs"]["first_frame"] == ["900", 0]
    assert (COMFY_INPUT / image_name).is_file()
    assert queue_service.get_job(job_id)["first_frame_name"] == image_name


def test_generate_scene_ref2va_uses_first_frame_as_reference(api, monkeypatch):
    frame = OUTPUTS / "frames" / "hero.jpg"
    _jpeg(frame)
    seen = {}

    def fake_process(job):
        seen["type"] = job.type
        seen["refs"] = list(job.reference_names)
        job.status = "DONE"
        job.progress = 100

    monkeypatch.setattr("app.services.queue_service.process_job", fake_process)

    created = api.post(
        "/jobs/generate-scene",
        json={
            "prompt": "The pilot stands in the hangar",
            "mode": "REF2VA",
            "gguf": True,
            "duration": 5,
            "first_frame": "frames/hero.jpg",
            "ref_images": ["frames/hero.jpg"],
        },
    )
    assert created.status_code == 200, created.text
    finished = _wait_job(api, created.json()["job_id"])
    assert finished["status"] == "done", finished
    assert seen["type"] == "REF2VA_LOW"
    assert len(seen["refs"]) == 1
    assert (COMFY_INPUT / seen["refs"][0]).is_file()


def test_generate_scene_queue_is_fifo(api, monkeypatch):
    order: list[str] = []

    def fake_process(job):
        order.append(job.prompt)
        time.sleep(0.2)
        job.status = "DONE"
        job.progress = 100

    monkeypatch.setattr("app.services.queue_service.process_job", fake_process)

    first = api.post(
        "/jobs/generate-scene",
        json={"prompt": "scene-one", "mode": "T2V", "gguf": False, "duration": 5},
    )
    second = api.post(
        "/jobs/generate-scene",
        json={"prompt": "scene-two", "mode": "T2V", "gguf": False, "duration": 5},
    )
    assert first.status_code == 200
    assert second.status_code == 200
    _wait_job(api, first.json()["job_id"])
    _wait_job(api, second.json()["job_id"])
    assert order == ["scene-one", "scene-two"]


def test_export_crossfade_normalizes_and_mixes_audio(api):
    clip_a = OUTPUTS / "videos" / "clip-a.mp4"
    clip_b = OUTPUTS / "videos" / "clip-b.mp4"
    bed = OUTPUTS / "audio" / "bed.wav"
    _color_clip(clip_a, "red", "320x240", 12, 1.0, audio=True)
    _color_clip(clip_b, "blue", "640x360", 30, 1.0, audio=False)
    _ffmpeg("-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=3", "-c:a", "pcm_s16le", str(bed))

    created = api.post(
        "/jobs/export",
        json={
            "clips": [
                {"path": "videos/clip-b.mp4", "order": 2, "transition": "crossfade", "transition_duration": 0.4},
                {"path": "videos/clip-a.mp4", "order": 1, "transition": "none", "transition_duration": 0},
            ],
            "audio_path": "audio/bed.wav",
            "audio_volume": 0.5,
            "width": 960,
            "height": 544,
            "fps": 24,
        },
    )
    assert created.status_code == 200, created.text
    finished = _wait_job(api, created.json()["job_id"], timeout=60)
    assert finished["status"] == "done", finished
    assert finished["output_path"].startswith("films/")
    assert finished["output_url"] == f"/api/media/{finished['output_path']}"

    film = OUTPUTS / finished["output_path"]
    info = _probe(film)
    video = next(stream for stream in info["streams"] if stream["codec_type"] == "video")
    audio = next(stream for stream in info["streams"] if stream["codec_type"] == "audio")
    assert video["width"] == 960
    assert video["height"] == 544
    assert video["codec_name"] == "h264"
    assert video["r_frame_rate"] in {"24/1", "24/1"}
    assert audio["codec_name"] == "aac"
    duration = float(info["format"]["duration"])
    assert 1.3 <= duration <= 1.9

    downloaded = api.get(finished["output_url"])
    assert downloaded.status_code == 200
    assert downloaded.content[:8] == film.read_bytes()[:8]


def test_export_none_transition_merges_mismatched_clips(api):
    left = OUTPUTS / "videos" / "left.mp4"
    right = OUTPUTS / "videos" / "right.mp4"
    _color_clip(left, "yellow", "160x120", 15, 1.0, audio=False)
    _color_clip(right, "purple", "400x300", 25, 1.0, audio=True)

    created = api.post(
        "/jobs/export",
        json={
            "clips": [
                {"path": "videos/left.mp4", "order": 0, "transition": "none"},
                {"path": "videos/right.mp4", "order": 1, "transition": "none"},
            ],
            "width": 320,
            "height": 180,
            "fps": 24,
        },
    )
    assert created.status_code == 200, created.text
    finished = _wait_job(api, created.json()["job_id"], timeout=60)
    assert finished["status"] == "done", finished
    info = _probe(OUTPUTS / finished["output_path"])
    video = next(stream for stream in info["streams"] if stream["codec_type"] == "video")
    audio = next(stream for stream in info["streams"] if stream["codec_type"] == "audio")
    assert (video["width"], video["height"]) == (320, 180)
    assert audio["codec_name"] == "aac"
    assert float(info["format"]["duration"]) >= 1.8


def test_upload_audio(api):
    response = api.post(
        "/jobs/upload-audio",
        files={"file": ("bed.wav", b"RIFF....WAVEfmt ", "audio/wav")},
    )
    assert response.status_code == 200, response.text
    rel = response.json()["audio_path"]
    assert rel.startswith("audio/")
    assert (OUTPUTS / rel).is_file()


def test_missing_job_404(api):
    response = api.get("/jobs/does-not-exist")
    assert response.status_code == 404
    assert "error" in response.json()
