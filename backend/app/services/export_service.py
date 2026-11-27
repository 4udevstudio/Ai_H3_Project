"""
Assemble a short film with ffmpeg on a background queue.

Clips are normalized to the requested width, height, fps, and yuv420p before
they are joined, so mismatched scene files still merge. Crossfades use
``xfade``. When every clip has audio, the same boundary also uses
``acrossfade``. When any clip has no audio, the join is video-only ``xfade``
and a silent AAC track (or the optional bed) is added afterwards.

An optional background audio file is looped or trimmed to the film length and
mixed at ``audio_volume``. Output is MP4 (H.264 + AAC) under ``outputs/films/``.
"""
from __future__ import annotations

import shutil
import subprocess
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core import config
from app.services.film_paths import FilmPathError, media_url, relative_output, resolve_shared_file

DEFAULT_WIDTH = 960
DEFAULT_HEIGHT = 544
DEFAULT_FPS = 24


class ExportRequestError(ValueError):
    """The export request cannot be queued."""


@dataclass
class ExportClip:
    path: Path
    order: int
    transition: str
    transition_duration: float
    index: int


@dataclass
class ExportJob:
    id: str
    clips: list[ExportClip]
    audio_path: Path | None
    audio_volume: float
    width: int
    height: int
    fps: int
    status: str = "queued"
    progress: int = 0
    error: str | None = None
    output_path: str | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def update(self, **changes: Any) -> None:
        with self._lock:
            for key, value in changes.items():
                setattr(self, key, value)

    def view(self) -> dict[str, Any]:
        with self._lock:
            status = self.status
            output_path = self.output_path
            error = self.error if status == "failed" else None
            progress = max(0, min(100, int(self.progress)))
        return {
            "status": status,
            "progress": progress,
            "error": error,
            "video_path": output_path,
            "video_url": media_url(output_path),
            "last_frame_path": None,
            "last_frame_url": None,
            "output_path": output_path,
            "output_url": media_url(output_path),
        }


class ExportService:
    """FIFO background exporter. Independent of the ComfyUI generation queue."""

    def __init__(self) -> None:
        self._jobs: OrderedDict[str, ExportJob] = OrderedDict()
        self._lock = threading.RLock()
        self._worker: threading.Thread | None = None
        self._stop = threading.Event()

    def start(self) -> None:
        with self._lock:
            self._stop.clear()
            if self._worker is not None and self._worker.is_alive():
                return
            self._worker = threading.Thread(
                target=self._loop,
                name="h3-export-worker",
                daemon=True,
            )
            self._worker.start()

    def stop(self) -> None:
        self._stop.set()
        if self._worker is not None:
            self._worker.join(timeout=2)

    def submit(
        self,
        clips: list[dict[str, Any]],
        audio_path: str | None = None,
        audio_volume: float | None = None,
        width: int | None = None,
        height: int | None = None,
        fps: int | None = None,
    ) -> str:
        prepared = _prepare_request(clips, audio_path, audio_volume, width, height, fps)
        job = ExportJob(id=str(uuid.uuid4()), **prepared)
        with self._lock:
            self._jobs[job.id] = job
        self.start()
        return job.id

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            return None
        return job.view()

    def reset(self) -> None:
        """Drop queued bookkeeping. Used by tests between cases."""
        with self._lock:
            self._jobs.clear()

    def _loop(self) -> None:
        while not self._stop.is_set():
            job_id: str | None = None
            with self._lock:
                for candidate_id, job in self._jobs.items():
                    if job.status == "queued":
                        job.update(status="running", progress=1)
                        job_id = candidate_id
                        break

            if job_id is None:
                self._stop.wait(0.2)
                continue

            with self._lock:
                job = self._jobs.get(job_id)
            if job is None or job.status != "running":
                continue

            try:
                _render(job)
            except Exception as exc:
                job.update(status="failed", error=f"{type(exc).__name__}: {exc}", progress=100)


def _prepare_request(
    clips: list[dict[str, Any]],
    audio_path: str | None,
    audio_volume: float | None,
    width: int | None,
    height: int | None,
    fps: int | None,
) -> dict[str, Any]:
    if not clips:
        raise ExportRequestError("clips is empty")

    prepared: list[ExportClip] = []
    for index, clip in enumerate(clips):
        if not isinstance(clip, dict):
            raise ExportRequestError("each clip must be an object")
        raw_path = clip.get("path")
        try:
            resolved = resolve_shared_file(str(raw_path or ""))
        except FilmPathError as exc:
            raise ExportRequestError(str(exc)) from exc

        transition = str(clip.get("transition") or "none").strip().lower()
        if transition not in {"none", "crossfade"}:
            raise ExportRequestError("transition must be none or crossfade")

        try:
            order = int(clip.get("order", index))
        except (TypeError, ValueError) as exc:
            raise ExportRequestError("clip order must be an integer") from exc

        try:
            fade = float(clip.get("transition_duration", 0.5) or 0.0)
        except (TypeError, ValueError) as exc:
            raise ExportRequestError("transition_duration must be a number") from exc
        if fade < 0:
            raise ExportRequestError("transition_duration must be >= 0")

        prepared.append(
            ExportClip(
                path=resolved,
                order=order,
                transition=transition,
                transition_duration=fade,
                index=index,
            )
        )

    prepared.sort(key=lambda item: (item.order, item.index))

    bed: Path | None = None
    if audio_path and str(audio_path).strip():
        try:
            bed = resolve_shared_file(str(audio_path))
        except FilmPathError as exc:
            raise ExportRequestError(str(exc)) from exc

    try:
        volume = 1.0 if audio_volume is None else float(audio_volume)
    except (TypeError, ValueError) as exc:
        raise ExportRequestError("audio_volume must be a number") from exc
    volume = max(0.0, min(2.0, volume))

    w = DEFAULT_WIDTH if width is None else int(width)
    h = DEFAULT_HEIGHT if height is None else int(height)
    rate = DEFAULT_FPS if fps is None else int(fps)
    w -= w % 2
    h -= h % 2
    if w < 16 or h < 16 or rate < 1 or rate > 60:
        raise ExportRequestError("width, height, and fps are out of range")

    return {
        "clips": prepared,
        "audio_path": bed,
        "audio_volume": volume,
        "width": w,
        "height": h,
        "fps": rate,
    }


def _render(job: ExportJob) -> None:
    ffmpeg = _tool("ffmpeg")
    ffprobe = _tool("ffprobe")
    if not ffmpeg or not ffprobe:
        raise RuntimeError("ffmpeg and ffprobe must be on PATH")

    films_dir = config.OUTPUTS_DIR / "films"
    films_dir.mkdir(parents=True, exist_ok=True)
    work = films_dir / f".work-{job.id}"
    if work.exists():
        shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)

    try:
        job.update(progress=5)
        normalized: list[Path] = []
        audios: list[Path | None] = []
        for index, clip in enumerate(job.clips):
            video_out = work / f"clip-{index:03d}.mp4"
            _normalize_video(ffmpeg, clip.path, video_out, job.width, job.height, job.fps)
            normalized.append(video_out)
            wav = work / f"clip-{index:03d}.wav"
            audios.append(wav if _extract_audio(ffmpeg, clip.path, wav) else None)
            job.update(progress=10 + int(30 * (index + 1) / len(job.clips)))

        durations = [_probe_duration(ffprobe, path) for path in normalized]
        all_audio = all(path is not None for path in audios)
        transitions = [clip.transition for clip in job.clips]
        fades = [clip.transition_duration for clip in job.clips]
        any_cross = any(item == "crossfade" for item in transitions[1:])

        assembled = work / "assembled.mp4"
        if not any_cross:
            _concat_videos(ffmpeg, normalized, assembled)
            source_audio = None
            if all_audio:
                source_audio = work / "assembled.wav"
                _concat_audio(ffmpeg, [path for path in audios if path is not None], source_audio)
            composed = sum(durations)
        else:
            source_audio = work / "assembled.wav" if all_audio else None
            composed = _xfade(
                ffmpeg,
                normalized,
                durations,
                audios if all_audio else None,
                transitions,
                fades,
                job.fps,
                assembled,
                source_audio,
            )

        job.update(progress=80)
        destination = films_dir / f"{job.id}.mp4"
        _mux_final(
            ffmpeg,
            assembled,
            destination,
            source_audio if not any_cross else None,
            job.audio_path,
            job.audio_volume,
            composed,
            has_embedded_audio=any_cross and all_audio,
        )
        job.update(
            status="done",
            progress=100,
            output_path=relative_output(destination),
            error=None,
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _normalize_video(ffmpeg: str, source: Path, dest: Path, width: int, height: int, fps: int) -> None:
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"setsar=1,fps={fps},format=yuv420p"
    )
    _run(
        [
            ffmpeg, "-y", "-i", str(source),
            "-vf", vf,
            "-an",
            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            str(dest),
        ]
    )


def _extract_audio(ffmpeg: str, source: Path, dest: Path) -> bool:
    if not _has_audio(source):
        return False
    _run(
        [
            ffmpeg, "-y", "-i", str(source),
            "-vn", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le",
            str(dest),
        ]
    )
    return dest.is_file() and dest.stat().st_size > 0


def _concat_videos(ffmpeg: str, files: list[Path], dest: Path) -> None:
    _concat_demuxer(ffmpeg, files, dest, copy=True)


def _concat_audio(ffmpeg: str, files: list[Path], dest: Path) -> None:
    _concat_demuxer(ffmpeg, files, dest, copy=False)


def _concat_demuxer(ffmpeg: str, files: list[Path], dest: Path, copy: bool) -> None:
    listing = dest.with_suffix(".txt")
    lines = []
    for path in files:
        escaped = str(path).replace("'", "'\\''")
        lines.append(f"file '{escaped}'")
    listing.write_text("\n".join(lines) + "\n", encoding="utf-8")
    cmd = [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(listing)]
    if copy:
        cmd += ["-c", "copy"]
    else:
        cmd += ["-c:a", "pcm_s16le"]
    cmd.append(str(dest))
    _run(cmd)


def _xfade(
    ffmpeg: str,
    videos: list[Path],
    durations: list[float],
    audios: list[Path | None] | None,
    transitions: list[str],
    fades: list[float],
    fps: int,
    dest: Path,
    audio_dest: Path | None,
) -> float:
    cmd = [ffmpeg, "-y"]
    for path in videos:
        cmd += ["-i", str(path)]
    audio_offset = len(videos)
    if audios is not None:
        for path in audios:
            cmd += ["-i", str(path)]

    filters: list[str] = []
    composed = durations[0]
    prev = "[0:v]"
    for index in range(1, len(videos)):
        fade = _fade_seconds(transitions[index], fades[index], composed, durations[index], fps)
        offset = max(0.0, composed - fade)
        out = "[vout]" if index == len(videos) - 1 else f"[vx{index}]"
        filters.append(
            f"{prev}[{index}:v]xfade=transition=fade:duration={fade:.4f}:offset={offset:.4f}{out}"
        )
        prev = out
        composed = composed + durations[index] - fade

    if audios is not None and audio_dest is not None:
        a_composed = durations[0]
        prev_a = f"[{audio_offset}:a]"
        for index in range(1, len(videos)):
            fade = _fade_seconds(transitions[index], fades[index], a_composed, durations[index], fps)
            out = "[aout]" if index == len(videos) - 1 else f"[ax{index}]"
            filters.append(
                f"{prev_a}[{audio_offset + index}:a]acrossfade=d={fade:.4f}:c1=tri:c2=tri{out}"
            )
            prev_a = out
            a_composed = a_composed + durations[index] - fade
        cmd += [
            "-filter_complex", ";".join(filters),
            "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-c:a", "pcm_s16le",
            str(dest),
        ]
        # Audio stays inside dest. The caller passes has_embedded_audio for the final mux.
        _ = audio_dest
    else:
        cmd += [
            "-filter_complex", ";".join(filters),
            "-map", "[vout]",
            "-an",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            str(dest),
        ]

    _run(cmd)
    return composed


def _fade_seconds(transition: str, requested: float, left: float, right: float, fps: int) -> float:
    if transition != "crossfade":
        return max(1.0 / max(fps, 1), 0.02)
    fade = requested if requested > 0 else 0.5
    cap = max(0.04, min(left, right) * 0.45)
    return max(0.04, min(fade, cap))


def _mux_final(
    ffmpeg: str,
    video: Path,
    dest: Path,
    source_audio: Path | None,
    bed: Path | None,
    volume: float,
    duration: float,
    has_embedded_audio: bool,
) -> None:
    ffprobe = _tool("ffprobe")
    if ffprobe:
        try:
            duration = _probe_duration(ffprobe, video)
        except RuntimeError:
            duration = max(0.1, duration)
    duration = max(0.1, duration)
    vol = max(0.0, min(2.0, volume))
    cmd = [ffmpeg, "-y", "-i", str(video)]

    if source_audio is not None and not has_embedded_audio:
        cmd += ["-i", str(source_audio)]

    if bed is not None:
        cmd += ["-stream_loop", "-1", "-i", str(bed)]

    filter_parts: list[str] = []
    maps = ["-map", "0:v"]

    if bed is not None and (source_audio is not None or has_embedded_audio):
        if has_embedded_audio:
            main_audio = "[0:a]"
            bed_index = 1
        else:
            main_audio = "[1:a]"
            bed_index = 2
        filter_parts.append(
            f"[{bed_index}:a]atrim=duration={duration:.3f},asetpts=PTS-STARTPTS,volume={vol:.4f}[bed]"
        )
        filter_parts.append(
            f"{main_audio}[bed]amix=inputs=2:duration=first:dropout_transition=0[aout]"
        )
        maps += ["-map", "[aout]"]
    elif bed is not None:
        bed_index = 1
        filter_parts.append(
            f"[{bed_index}:a]atrim=duration={duration:.3f},asetpts=PTS-STARTPTS,volume={vol:.4f}[aout]"
        )
        maps += ["-map", "[aout]"]
    elif source_audio is not None or has_embedded_audio:
        maps += ["-map", "1:a" if source_audio is not None and not has_embedded_audio else "0:a"]
    else:
        cmd += ["-f", "lavfi", "-t", f"{duration:.3f}", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
        maps += ["-map", f"{1 if source_audio is None else 2}:a"]

    if filter_parts:
        cmd += ["-filter_complex", ";".join(filter_parts)]
    cmd += maps
    cmd += [
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        str(dest),
    ]
    _run(cmd)


def _has_audio(path: Path) -> bool:
    ffprobe = _tool("ffprobe")
    if not ffprobe:
        return False
    proc = subprocess.run(
        [
            ffprobe, "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    return proc.returncode == 0 and "audio" in proc.stdout


def _probe_duration(ffprobe: str, path: Path) -> float:
    proc = subprocess.run(
        [
            ffprobe, "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path.name}")
    try:
        duration = float(proc.stdout.strip())
    except ValueError as exc:
        raise RuntimeError(f"ffprobe returned no duration for {path.name}") from exc
    if duration <= 0:
        raise RuntimeError(f"clip duration is zero: {path.name}")
    return duration


def _tool(name: str) -> str | None:
    configured = (config.FFMPEG_PATH or "").strip()
    if name == "ffmpeg" and configured:
        candidate = Path(configured)
        if candidate.is_file():
            return str(candidate)
    found = shutil.which(name)
    if found:
        return found
    if name == "ffprobe" and configured:
        sibling = Path(configured).with_name("ffprobe")
        if sibling.is_file():
            return str(sibling)
        sibling_exe = Path(configured).with_name("ffprobe.exe")
        if sibling_exe.is_file():
            return str(sibling_exe)
    return None


def _run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, timeout=600, check=False)
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace")[-800:]
        raise RuntimeError(err.strip() or f"ffmpeg exited {proc.returncode}")


export_service = ExportService()
