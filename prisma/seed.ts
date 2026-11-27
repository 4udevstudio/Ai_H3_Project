import 'dotenv/config'

import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const DEMO_TITLE = 'Harbor at Dusk'
const TEMPLATE_NAME = 'Script breakdown'
const ADMIN_EMAIL = 'admin@reelfire.local'

/**
 * Password hashes use bcryptjs with 10 salt rounds (the bcrypt $2a$/$2b$ string).
 * The auth branch must verify with bcryptjs.compare(password, user.passwordHash)
 * or any compatible bcrypt implementation. Emails are stored lowercased.
 */
async function upsertAdmin() {
  const email = ADMIN_EMAIL.trim().toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD?.trim() || 'changeme'
  const passwordHash = await bcrypt.hash(password, 10)
  return prisma.user.upsert({
    where: { email },
    update: {
      role: 'ADMIN',
      passwordHash,
      name: 'ReelFire Admin',
      disabled: false,
    },
    create: {
      email,
      passwordHash,
      name: 'ReelFire Admin',
      role: 'ADMIN',
    },
  })
}

const SOURCE_TEXT = [
  'At dusk a quiet harbor glows under sodium lamps. Fishing boats knock against the pilings.',
  'A woman in a dark coat steps onto the wooden pier and the wind lifts her collar.',
  'She looks back toward the village as the lighthouse beam sweeps across the water.',
].join(' ')

const SYSTEM_PROMPT = `You are the script breakdown system for a short-film generator that uses MiniMax H3.

Turn the user's script into an ordered list of shots. Respond with JSON only, no markdown:
{"scenes":[{"prompt":"...","mode":"T2V"|"REF2VA"|"FL2VA","duration":5}]}

Rules:
- duration is seconds, from 5 to 15. Use 5 unless the action needs longer.
- mode T2V is text-to-video and needs no reference image.
- mode REF2VA uses reference images of a character or place.
- mode FL2VA continues from the previous shot's last frame.
- The first shot is T2V unless the user already supplied references. Later shots that continue the same action are FL2VA.
- Write each prompt as one concrete cinematic shot: subject, action, camera, lighting, and setting. Do not mention the mode name inside the prompt.
- Honor max_scenes when it is provided (1 to 24). Otherwise keep the list short, around 8 shots or fewer.
- Write prompts in the requested language. If none is given, use the language of the script.`

const SCENES: { prompt: string; mode: 'T2V' | 'FL2VA'; duration: number }[] = [
  {
    prompt:
      'Wide dusk view of a quiet fishing harbor, boats rocking against wooden pilings, warm sodium lamps reflecting on the water, slow drift in.',
    mode: 'T2V',
    duration: 5,
  },
  {
    prompt:
      'A woman in a dark coat steps from the quay onto a wooden pier, wind lifting her collar, camera tracking beside her at eye level.',
    mode: 'FL2VA',
    duration: 5,
  },
  {
    prompt:
      'She stops and looks back toward the village as a lighthouse beam sweeps across her face and the black water.',
    mode: 'FL2VA',
    duration: 5,
  },
]

async function removeDemoFilm() {
  const existing = await prisma.project.findMany({
    where: { name: DEMO_TITLE },
    select: { id: true },
  })

  for (const film of existing) {
    await prisma.scene.updateMany({
      where: { projectId: film.id },
      data: { currentGenerationId: null },
    })
    await prisma.generation.updateMany({
      where: { OR: [{ projectId: film.id }, { scene: { projectId: film.id } }] },
      data: { projectId: null, sceneId: null },
    })
    await prisma.project.delete({ where: { id: film.id } })
  }
}

async function main() {
  const admin = await upsertAdmin()
  const templateData = {
    description: 'System prompt for POST /jobs/script-to-scenes. The compute service owns the model call.',
    template: SYSTEM_PROMPT,
    category: 'script',
    isDefault: true,
    isActive: true,
  }

  const existingTemplate = await prisma.lLMPromptTemplate.findFirst({
    where: { name: TEMPLATE_NAME },
  })

  if (existingTemplate) {
    await prisma.lLMPromptTemplate.update({
      where: { id: existingTemplate.id },
      data: templateData,
    })
  } else {
    await prisma.lLMPromptTemplate.create({
      data: { name: TEMPLATE_NAME, ...templateData },
    })
  }

  await removeDemoFilm()

  const film = await prisma.project.create({
    data: {
      name: DEMO_TITLE,
      description: 'Seeded three-scene short. Safe to delete.',
      theme: 'midnight',
      script: SOURCE_TEXT,
      status: 'DRAFT',
      transitionType: 'CROSSFADE',
      transitionDuration: 0.5,
      width: 960,
      height: 544,
      fps: 24,
      userId: admin.id,
    },
  })

  const script = await prisma.script.create({
    data: {
      projectId: film.id,
      title: DEMO_TITLE,
      sourceText: SOURCE_TEXT,
      breakdown: JSON.stringify(
        SCENES.map((scene) => ({
          prompt: scene.prompt,
          mode: scene.mode,
          duration: scene.duration,
        }))
      ),
      llmModel: null,
      status: 'DONE',
    },
  })

  for (let order = 0; order < SCENES.length; order += 1) {
    const scene = SCENES[order]
    await prisma.scene.create({
      data: {
        projectId: film.id,
        scriptId: script.id,
        order,
        title: `Scene ${order + 1}`,
        prompt: scene.prompt,
        mode: scene.mode,
        gguf: false,
        durationSec: scene.duration,
        chainFromPrevious: true,
        status: 'DRAFT',
      },
    })
  }

  console.log(`Seeded film ${film.id} (${DEMO_TITLE}) with ${SCENES.length} scenes`)
  console.log(`Admin ${admin.email} (${admin.role}) owns the demo film`)
  console.log(`LLM template "${TEMPLATE_NAME}" is active`)
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
