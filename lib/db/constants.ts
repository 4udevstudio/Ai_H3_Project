/** Defaults agreed with the compute service. */
export const DEFAULT_WIDTH = 960
export const DEFAULT_HEIGHT = 544
export const DEFAULT_FPS = 24
export const DEFAULT_DURATION_SEC = 5
export const DEFAULT_TRANSITION_DURATION = 0.5
export const DEFAULT_AUDIO_VOLUME = 1
export const DEFAULT_MAX_SCENES = 8

export const MAX_WIDTH = 1920
export const MAX_HEIGHT = 1920
export const MAX_FPS = 60
export const MAX_SCENE_DURATION = 30
export const MIN_BREAKDOWN_DURATION = 5
export const MAX_BREAKDOWN_DURATION = 15
export const MAX_SCENES = 24
export const MAX_AUDIO_VOLUME = 2
export const MAX_TRANSITION_DURATION = 5

export const LIMITS = {
  title: 200,
  prompt: 20000,
  negativePrompt: 20000,
  script: 100_000,
  path: 1000,
  language: 32,
  llmModel: 120,
} as const
