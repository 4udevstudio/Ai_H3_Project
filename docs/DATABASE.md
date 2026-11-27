# ReelFire database

4udevstudio By Firework

Next.js and Prisma own every row in PostgreSQL. FastAPI (`BACKEND_URL`, default `http://127.0.0.1:8000`) is a stateless compute service and never opens the database. The studio history flow is unchanged: the browser still polls FastAPI `GET /api/generations` and posts finished jobs to `POST /api/history`.

Status, mode, and role columns are strings, not Postgres enums, and store **UPPERCASE** values. JSON payloads (`Script.breakdown`, `Setting.value`, `Reference.metadata`, `Asset.metadata`, `AIPromptEnhancement.referenceImages`) stay text so existing code can keep calling `JSON.parse`.

## Enum mapping

| Concept | Database | JSON |
| --- | --- | --- |
| Scene mode | `T2V`, `REF2VA`, `FL2VA` | same uppercase `mode` |
| Film status | `DRAFT`, `GENERATING`, `ASSEMBLING`, `DONE`, `FAILED` | `draft`, `generating`, `assembling`, `done`, `failed` |
| Scene status | `DRAFT`, `QUEUED`, `RUNNING`, `DONE`, `FAILED` | `draft`, `queued`, `running`, `done`, `failed` |
| Job status | `QUEUED`, `RUNNING`, `DONE`, `FAILED` | `queued`, `running`, `done`, `failed` |
| Job kind | `SCENE`, `EXPORT` | `scene`, `export` |
| Render status | `PENDING`, `RUNNING`, `DONE`, `FAILED` | `pending`, `running`, `done`, `failed` |
| Script status | `DRAFT`, `BREAKING_DOWN`, `DONE`, `FAILED` | `draft`, `breaking_down`, `done`, `failed` |
| Transition | `NONE`, `CROSSFADE` | `none`, `crossfade` |
| Image role | `REF`, `FIRST`, `LAST` | `ref`, `first`, `last` |

`Generation.status` keeps the existing history vocabulary: `PENDING`, `RUNNING`, `DONE`, `FAILED`, `CANCELLED`. A scene job that is `QUEUED` is stored on the Generation row as `PENDING`.

Film JSON uses `title`. That maps to `Project.name`.

## Media URLs

The database stores paths relative to the shared `outputs/` directory (`videos/…`, `frames/…`, `films/…`, `audio/…`). FastAPI serves those files. JSON `*_url` fields are absolute browser URLs:

`{NEXT_PUBLIC_BACKEND_URL or BACKEND_URL}/api/media/{type}/{filename}`

Examples the compute service returns:

- `/api/media/videos/{id}.mp4`
- `/api/media/frames/{id}_last.jpg`
- `/api/media/films/{id}.mp4`
- `/api/media/audio/{uuid}.wav`

There is no Next.js file route for these. An `http(s)` value already stored in a path column is returned unchanged.

## Auth hook

`lib/request-user.ts` is the only integration point for the auth branch. `getRequestUser(req)` returns `null` today, which means auth is off and every row is visible. Replace that function body with `getCurrentUser()` from `lib/auth` (that file is not in this branch).

`ownerWhere(user)` filters `Project`, `Job`, and `FinalRender`:

- `null` or `ADMIN`: no extra filter
- `USER`: `userId = user.id`

Scenes and scripts are loaded through a film that already passed that check. New films, jobs, and renders store `userId = user?.id` (`null` while auth is off).

Every FastAPI call goes through `lib/backend-server.ts`. It sends `X-Internal-Secret` when `INTERNAL_API_SECRET` is set, and `X-User-Id` when a user is passed.

## Models

### User

`id`, `email` unique (stored lowercased), `passwordHash`, `name?`, `role` default `USER` (`ADMIN` or `USER`), `disabled` default false, `createdAt`, `updatedAt`, `lastLoginAt?`.

The seed creates `admin@reelfire.local` with role `ADMIN` only when that user does not exist. `passwordHash` is **bcryptjs with 10 salt rounds** (a standard `$2a$` / `$2b$` string). The auth branch should verify with `bcrypt.compare` / `bcryptjs.compare`. If `SEED_ADMIN_PASSWORD` is set it must be at least 12 characters. If it is empty, the seed generates a URL-safe password from `crypto.randomBytes(24)` and prints it once. Re-seeding does not change an existing `passwordHash`.

### Session

`id`, `userId` (cascade delete), `tokenHash` unique (SHA-256 of the cookie token, never the raw token), `expiresAt`, `createdAt`, `lastSeenAt?`, `ip?`, `userAgent?`. Index on `userId`.

### Ownership

`Project`, `Job`, and `FinalRender` have nullable `userId` (`onDelete: SetNull`). Indexes: `Project(userId)`, `Job(userId, status)`, `FinalRender(userId)`. Null means the row was created before a user was signed in.

Existing `Project` and `Generation` columns are otherwise unchanged. New columns are nullable or have defaults.

### Project (film)

| Field | Notes |
| --- | --- |
| `id`, `name`, `description`, `theme`, `createdAt`, `updatedAt` | unchanged |
| `script` | nullable source text |
| `status` | default `DRAFT` |
| `transitionType` | default `NONE` |
| `transitionDuration` | float, default `0.5` (export accepts 0–5) |
| `width`, `height`, `fps` | default `960`, `544`, `24`. Width and height max 1920. fps 1–60 |
| `audioPath` | nullable, usually `audio/<uuid>.<ext>` from upload |
| `audioVolume` | float, default `1`, range 0–2 |
| `finalPath` | nullable export output, e.g. `films/<id>.mp4` |
| `coverPath` | nullable, not included in the Film JSON |
| `userId` | nullable owner. Null while auth is off |

Relations: `user`, `generations`, `scenes`, `scripts`, `finalRenders`, `assets`, `jobs`.

### Script

`projectId`, `title?`, `sourceText`, `breakdown` (JSON string of `[{prompt, mode, duration}]`), `llmModel?`, `status`, timestamps. Scenes created from a breakdown point back here.

The seeded LLM template named **Script breakdown** (`category: script`) is the system prompt for splitting. `POST /jobs/script-to-scenes` itself only receives `{script, max_scenes?, language?}`. The compute service owns the model call.

### Scene

`projectId`, `scriptId?`, `order` (0-based, index on `[projectId, order]`, **not unique**), `title?`, `prompt`, `negativePrompt?`, `mode` default `T2V`, `gguf` default false, `durationSec` default `5` (0.1–30; breakdown shots are clamped to 5–15), `seed?`, `status`, `error?`, `chainFromPrevious` default true, `inputFramePath?`, `lastFramePath?`, `clipPath?`, `currentGenerationId?` unique, timestamps.

Relations: `generations` (every attempt), `images` (`Reference` rows).

### Generation

Adds nullable `sceneId` (`onDelete: SetNull`). Every other column is unchanged, including `lastFramePath` and `videoPath`.

### Reference (scene image)

`generationId` is now optional. Added `sceneId?`, `role` (`REF` / `FIRST` / `LAST`, default `REF`), `assetId?`. `type`, `path`, and `order` stay. Existing rows get `role = REF`.

### Asset

Adds nullable `projectId`.

### AIPromptEnhancement

Adds nullable `sceneId`.

### FinalRender

`projectId`, `status` default `PENDING`, `audioPath?`, `audioVolume`, `width`, `height`, `fps`, `outputPath?`, `duration?`, `error?`, `jobId?` (this app's `Job.id`, not the FastAPI id), `createdAt`, `completedAt`.

### FinalRenderClip

`finalRenderId`, `sceneId`, `generationId?`, `order`, `transitionType`, `transitionDuration`.

### Job

`id`, `kind` (`SCENE` or `EXPORT`), `targetId` (scene id or final-render id), `projectId?`, `backendJobId?`, `generationId?` (unique, scene attempts only), `status` default `QUEUED`, `progress` 0–100, `error?`, `resultPath?`, timestamps.

`generationId` is an extra nullable column so a poll updates the attempt that created the job when a scene has more than one.

### Unchanged

`Setting`, `PromptTemplate`, and `LLMPromptTemplate` stay. Nothing was dropped.

## Compute calls

All of these go to `BACKEND_URL` (default `http://127.0.0.1:8000`). Connection failures are stored on the Job as `FAILED` and returned to the client. They do not crash the route.

| Call | Body | Result |
| --- | --- | --- |
| `POST /jobs/script-to-scenes` | `{script, max_scenes? , language?}` | `200 {scenes:[{prompt, mode, duration}]}`. `max_scenes` default 8, range 1–24. Durations come back in 5–15. `503 {error}` when ComfyUI is down. Timeout is 5 minutes. |
| `POST /jobs/generate-scene` | `{prompt, mode, gguf, duration, seed, width?, height?, fps?, ref_images?, first_frame?, last_frame?}` | `{job_id}`. `seed` is `-1` when `Scene.seed` is null. Paths are outputs-relative (`frames/x_last.jpg`) or absolute under outputs or the ComfyUI input dir. |
| `POST /jobs/upload-audio` | multipart field `file` | `{audio_path}` such as `audio/<uuid>.wav` |
| `POST /jobs/export` | `{clips:[{path, order, transition, transition_duration}], audio_path?, audio_volume?, width?, height?, fps?}` | `{job_id}`. `path` is `Scene.clipPath`. `transition` is `none` or `crossfade`. `audio_volume` is 0–2. |
| `GET /jobs/{id}` | | `{status, progress, error, video_path, video_url, last_frame_path, last_frame_url, output_path, output_url}`. Unknown ids are `404 {error:"job not found"}`. |

Chaining: when `chain_from_previous` is true, generate sends the previous scene's `lastFramePath` as `first_frame`. The backend applies that per mode (FL2VA node, REF2VA reference, T2V ignored).

On a successful poll:

- `video_path` → `Scene.clipPath` and `Generation.videoPath`, and `Scene.currentGenerationId`
- `last_frame_path` → `Scene.lastFramePath` and `Generation.lastFramePath`
- `output_path` → `FinalRender.outputPath` and `Project.finalPath`, and the film status becomes `DONE`

FastAPI keeps jobs in memory. If a poll gets **404**, the Job is marked `FAILED` and the scene or the final render is marked `FAILED` with error `backend job lost`. A connection error during poll does not change the row, so the next poll can succeed.

## Routes

Errors are `{ "error": "...", "detail"?: "..." }` with an HTTP status. Creates return 201. A compute failure returns the persisted row plus 503 (unreachable or ComfyUI down), 502, or 400.

### Films

`GET /api/films` → `Film[]`

`POST /api/films`

```json
{
  "title": "Harbor at Dusk",
  "script": "Optional source text",
  "transition": "crossfade",
  "transition_duration": 0.5,
  "width": 960,
  "height": 544,
  "fps": 24,
  "audio_volume": 1
}
```

```json
{
  "id": "clx...",
  "title": "Harbor at Dusk",
  "script": "Optional source text",
  "transition": "crossfade",
  "transition_duration": 0.5,
  "width": 960,
  "height": 544,
  "fps": 24,
  "audio_url": null,
  "audio_volume": 1,
  "final_url": null,
  "status": "draft",
  "created_at": "2026-11-27T00:00:00.000Z",
  "updated_at": "2026-11-27T00:00:00.000Z"
}
```

`GET /api/films/{id}` returns the same object. `PATCH` accepts any of those input fields. `audio_path` may be set directly. `DELETE` returns `{ "deleted": true }` and detaches `Generation` rows first so studio history survives. Scenes, scripts, renders, and jobs cascade.

`POST /api/films/{id}/audio` is multipart, field name `file`. It forwards the file to `POST /jobs/upload-audio`, stores `audio_path` on the project, and returns the Film. `audio_url` looks like `http://127.0.0.1:8000/api/media/audio/<uuid>.wav`.

### Scenes

`GET /api/films/{id}/scenes` → `Scene[]` ordered by `order`.

`POST /api/films/{id}/scenes`

```json
{ "prompt": "Wide harbor at dusk", "mode": "T2V", "gguf": false, "duration_sec": 5, "chain_from_previous": true }
```

```json
{
  "id": "clx...",
  "film_id": "clx...",
  "order": 0,
  "prompt": "Wide harbor at dusk",
  "mode": "T2V",
  "gguf": false,
  "duration_sec": 5,
  "seed": null,
  "chain_from_previous": true,
  "status": "draft",
  "clip_url": null,
  "error": null,
  "images": [],
  "created_at": "2026-11-27T00:00:00.000Z",
  "updated_at": "2026-11-27T00:00:00.000Z"
}
```

`GET`, `PATCH`, and `DELETE /api/films/{id}/scenes/{sceneId}`. Delete closes the gap in `order`.

`POST /api/films/{id}/scenes/reorder`

```json
{ "scene_ids": ["scene-c", "scene-a", "scene-b"] }
```

The array must be exactly the film's scenes, once each. Every `order` is rewritten in one transaction. Response is `{ "scenes": [ ... ] }`.

### Scene images

`POST /api/films/{id}/scenes/{sceneId}/images`

```json
{ "path": "frames/hero.jpg", "role": "ref", "order": 0, "type": "IMAGE" }
```

```json
{ "id": "clx...", "scene_id": "clx...", "url": "http://127.0.0.1:8000/api/media/frames/hero.jpg", "role": "ref", "order": 0 }
```

`DELETE` the same path with `{ "image_id": "..." }` or `?image_id=`.

The same POST also accepts `multipart/form-data` with fields `file`, `role`, and `order`. The bytes are forwarded to FastAPI `POST /api/uploads/reference` (field `file`; response `uploaded[0].stored_path`). That path is stored on the Reference row. If the compute service is down or that route returns 404, the file is written to `outputs/references/<uuid>.<ext>` and the stored path is `references/<file>`. Browser URLs for that fallback are `{BACKEND}/api/media/references/<file>`. FastAPI's media allow-list in PR #1 does not include `references` yet, so those fallback URLs 404 until that folder is served. JSON `{path, role, order}` still works.

`POST /api/films/{id}/scenes/{sceneId}/duplicate` copies prompt, mode, gguf, duration, seed, chain flag, title, negative prompt, and image rows into a new `draft` scene inserted immediately after the original. Later `order` values shift by one in the same transaction. The clip, generations, and last-frame fields are not copied. Response is the new Scene, status 201.

`POST /api/films/{id}/generate-all` runs scenes one after another so each can chain the previous last frame.

```json
{ "scene_ids": ["optional"], "force": false }
```

Omitted `scene_ids` means every scene, in `order`. `force` defaults to false and skips scenes that already have a DONE clip. Response is `{ "job_ids": ["..."] }` in that scene order. One QUEUED Job is created per scene up front, linked by `batchId` and `nextJobId`. Only the first is sent to FastAPI. `GET /api/jobs/{id}` on **any** id in the batch polls the active job and, when it is `done`, starts the next one, passing the new `lastFramePath` as `first_frame` when `chain_from_previous` is set. If a job fails, every later job in the batch is marked `failed` with error `previous scene failed`. A second batch while one is still `queued` or `running` returns 409.

`GET /api/films/{id}/jobs` returns `{ "jobs": [ Job, ... ] }` newest first and advances the active batch the same way. Job JSON includes `batch_id` (null for a single generate).

`REF` images are sent as `ref_images`. The lowest-order `FIRST` / `LAST` image is used when a chain handoff does not already supply `first_frame`.

### Scripts

`GET /api/films/{id}/scripts` → script objects, newest first.

`POST /api/films/{id}/scripts`

```json
{
  "source_text": "At dusk a quiet harbor...",
  "title": "Harbor",
  "language": "en",
  "max_scenes": 8,
  "create_scenes": true,
  "llm_model": "gemma"
}
```

`script` is accepted as an alias of `source_text`. `create_scenes` defaults to false. When true, Scene rows are appended after the current last order.

```json
{
  "script": {
    "id": "clx...",
    "film_id": "clx...",
    "title": "Harbor",
    "source_text": "At dusk a quiet harbor...",
    "breakdown": [{ "prompt": "Wide dusk harbor", "mode": "T2V", "duration": 5 }],
    "llm_model": "gemma",
    "status": "done",
    "created_at": "2026-11-27T00:00:00.000Z",
    "updated_at": "2026-11-27T00:00:00.000Z"
  },
  "scenes": [],
  "error": null
}
```

The source text is also copied onto `Project.script`. If ComfyUI is down the script is stored with `status: "failed"` and the HTTP status is 503.

### Generate

`POST /api/films/{id}/scenes/{sceneId}/generate` creates a Generation (`sceneId` set, `seed` `-1` when the scene seed is null) and a Job, sets the scene to `queued` and the film to `generating`, then calls `/jobs/generate-scene`. The response is a Job:

```json
{
  "id": "clx...",
  "kind": "scene",
  "target_id": "scene id",
  "status": "queued",
  "progress": 0,
  "error": null,
  "result_url": null
}
```

### Jobs

`GET /api/jobs/{id}` polls FastAPI when the job is still `queued` or `running` and has a `backendJobId`. The response is the Job shape above. `result_url` is the public media URL for `video_path` (scene) or `output_path` (export).

### Renders

`GET /api/films/{id}/renders` → export history, newest first.

`POST /api/films/{id}/renders` requires every scene to already have `clipPath`. It creates `FinalRender`, one `FinalRenderClip` per scene in order, and a Job, then calls `/jobs/export` with the film transition.

```json
{
  "render": {
    "id": "clx...",
    "film_id": "clx...",
    "status": "pending",
    "audio_url": null,
    "audio_volume": 1,
    "width": 960,
    "height": 544,
    "fps": 24,
    "output_url": null,
    "duration": null,
    "error": null,
    "job_id": "job id",
    "created_at": "2026-11-27T00:00:00.000Z",
    "completed_at": null,
    "clips": [
      {
        "id": "clx...",
        "scene_id": "clx...",
        "generation_id": null,
        "order": 0,
        "transition": "crossfade",
        "transition_duration": 0.5
      }
    ]
  },
  "job": { "id": "clx...", "kind": "export", "target_id": "render id", "status": "queued", "progress": 0, "error": null, "result_url": null }
}
```

Poll `GET /api/jobs/{job.id}` until `done`. The film then has `status: "done"` and `final_url`.

## Migrations and seed

There is one Postgres migration, `prisma/migrations/20261127120000_init`. It creates the full schema, including users and sessions. Apply it to an empty database:

```bash
docker compose up -d postgres
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
```

`DATABASE_URL` in `.env.example` matches `docker-compose.yml`:

`postgresql://reelfire:reelfirepassword@127.0.0.1:5432/reelfire?schema=public`

That password is the local default only (`POSTGRES_PASSWORD` in Compose, otherwise `reelfirepassword`). Postgres is published on `127.0.0.1:5432` and is not reachable from other machines. Change `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` together, and set `INTERNAL_API_SECRET`, before a Cloudflare Tunnel or any other non-local deploy. Leave `SEED_ADMIN_PASSWORD` empty unless you want to choose the first admin password yourself.

The seed is idempotent. It upserts the **Script breakdown** template, the admin user, and replaces the demo film **Harbor at Dusk** (3 ordered scenes plus a script) owned by that admin. It does not call FastAPI.

`npm run dev` still serves `GET /api/projects`, `GET/POST /api/history`, and `GET /api/health` against the same tables.

## Moving an old SQLite database

`main` stored data in `prisma/dev.db`. Deploy the Postgres schema first, then copy rows in foreign-key order:

```bash
npx prisma migrate deploy
npx tsx scripts/migrate-sqlite-to-postgres.ts prisma/dev.db
```

The script reads SQLite with `node:sqlite` and upserts into `DATABASE_URL`. Columns that did not exist on `main` keep the Postgres defaults (`DRAFT`, 960×544, role `REF`, `userId` null). A database that already has the film tables is copied too, including `currentGenerationId` after generations exist.

Do not use pgloader to create tables here. Prisma owns the schema, and a raw SQLite copy would miss the new NOT NULL columns. The script is the supported path.
