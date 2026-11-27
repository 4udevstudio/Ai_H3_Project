-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'midnight',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "script" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "transitionType" TEXT NOT NULL DEFAULT 'NONE',
    "transitionDuration" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "width" INTEGER NOT NULL DEFAULT 960,
    "height" INTEGER NOT NULL DEFAULT 544,
    "fps" INTEGER NOT NULL DEFAULT 24,
    "audioPath" TEXT,
    "audioVolume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "finalPath" TEXT,
    "coverPath" TEXT,
    "userId" TEXT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT,
    "sourceText" TEXT NOT NULL,
    "breakdown" TEXT NOT NULL DEFAULT '[]',
    "llmModel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scriptId" TEXT,
    "order" INTEGER NOT NULL,
    "title" TEXT,
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'T2V',
    "gguf" BOOLEAN NOT NULL DEFAULT false,
    "durationSec" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "seed" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "error" TEXT,
    "chainFromPrevious" BOOLEAN NOT NULL DEFAULT true,
    "inputFramePath" TEXT,
    "lastFramePath" TEXT,
    "clipPath" TEXT,
    "currentGenerationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "sceneId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'TEXT2VID',
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT,
    "seed" INTEGER NOT NULL DEFAULT -1,
    "steps" INTEGER NOT NULL DEFAULT 6,
    "resolution" TEXT NOT NULL DEFAULT '768p',
    "taskAdapter" TEXT,
    "loraUsed" TEXT,
    "lastFramePath" TEXT,
    "useAIEnhancement" BOOLEAN NOT NULL DEFAULT false,
    "videoPath" TEXT,
    "audioPath" TEXT,
    "thumbnailPath" TEXT,
    "duration" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "generationTime" DOUBLE PRECISION,
    "vramUsed" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reference" (
    "id" TEXT NOT NULL,
    "generationId" TEXT,
    "sceneId" TEXT,
    "assetId" TEXT,
    "type" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "role" TEXT DEFAULT 'REF',
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "metadata" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIPromptEnhancement" (
    "id" TEXT NOT NULL,
    "generationId" TEXT,
    "sceneId" TEXT,
    "referenceImages" TEXT NOT NULL,
    "basePrompt" TEXT NOT NULL,
    "customPrompt" TEXT,
    "enhancedPrompt" TEXT NOT NULL,
    "fullPrompt" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL DEFAULT 'gemma-4b-it',
    "tokensUsed" INTEGER,
    "responseTime" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIPromptEnhancement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalRender" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "audioPath" TEXT,
    "audioVolume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "width" INTEGER NOT NULL DEFAULT 960,
    "height" INTEGER NOT NULL DEFAULT 544,
    "fps" INTEGER NOT NULL DEFAULT 24,
    "outputPath" TEXT,
    "duration" DOUBLE PRECISION,
    "error" TEXT,
    "jobId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FinalRender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalRenderClip" (
    "id" TEXT NOT NULL,
    "finalRenderId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "generationId" TEXT,
    "order" INTEGER NOT NULL,
    "transitionType" TEXT NOT NULL DEFAULT 'NONE',
    "transitionDuration" DOUBLE PRECISION NOT NULL DEFAULT 0.5,

    CONSTRAINT "FinalRenderClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "projectId" TEXT,
    "backendJobId" TEXT,
    "generationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "resultPath" TEXT,
    "userId" TEXT,
    "batchId" TEXT,
    "nextJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LLMPromptTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "template" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'video',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LLMPromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE INDEX "Script_projectId_idx" ON "Script"("projectId");

-- CreateIndex
CREATE INDEX "Script_status_idx" ON "Script"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Scene_currentGenerationId_key" ON "Scene"("currentGenerationId");

-- CreateIndex
CREATE INDEX "Scene_projectId_order_idx" ON "Scene"("projectId", "order");

-- CreateIndex
CREATE INDEX "Scene_scriptId_idx" ON "Scene"("scriptId");

-- CreateIndex
CREATE INDEX "Scene_status_idx" ON "Scene"("status");

-- CreateIndex
CREATE INDEX "Generation_projectId_idx" ON "Generation"("projectId");

-- CreateIndex
CREATE INDEX "Generation_sceneId_idx" ON "Generation"("sceneId");

-- CreateIndex
CREATE INDEX "Generation_status_idx" ON "Generation"("status");

-- CreateIndex
CREATE INDEX "Generation_createdAt_idx" ON "Generation"("createdAt");

-- CreateIndex
CREATE INDEX "Reference_generationId_idx" ON "Reference"("generationId");

-- CreateIndex
CREATE INDEX "Reference_sceneId_idx" ON "Reference"("sceneId");

-- CreateIndex
CREATE INDEX "Reference_assetId_idx" ON "Reference"("assetId");

-- CreateIndex
CREATE INDEX "Reference_type_idx" ON "Reference"("type");

-- CreateIndex
CREATE INDEX "Asset_type_idx" ON "Asset"("type");

-- CreateIndex
CREATE INDEX "Asset_projectId_idx" ON "Asset"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_path_key" ON "Asset"("path");

-- CreateIndex
CREATE UNIQUE INDEX "AIPromptEnhancement_generationId_key" ON "AIPromptEnhancement"("generationId");

-- CreateIndex
CREATE INDEX "AIPromptEnhancement_sceneId_idx" ON "AIPromptEnhancement"("sceneId");

-- CreateIndex
CREATE INDEX "FinalRender_projectId_idx" ON "FinalRender"("projectId");

-- CreateIndex
CREATE INDEX "FinalRender_status_idx" ON "FinalRender"("status");

-- CreateIndex
CREATE INDEX "FinalRender_jobId_idx" ON "FinalRender"("jobId");

-- CreateIndex
CREATE INDEX "FinalRender_userId_idx" ON "FinalRender"("userId");

-- CreateIndex
CREATE INDEX "FinalRenderClip_finalRenderId_order_idx" ON "FinalRenderClip"("finalRenderId", "order");

-- CreateIndex
CREATE INDEX "FinalRenderClip_sceneId_idx" ON "FinalRenderClip"("sceneId");

-- CreateIndex
CREATE INDEX "FinalRenderClip_generationId_idx" ON "FinalRenderClip"("generationId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_generationId_key" ON "Job"("generationId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_nextJobId_key" ON "Job"("nextJobId");

-- CreateIndex
CREATE INDEX "Job_projectId_idx" ON "Job"("projectId");

-- CreateIndex
CREATE INDEX "Job_batchId_idx" ON "Job"("batchId");

-- CreateIndex
CREATE INDEX "Job_targetId_idx" ON "Job"("targetId");

-- CreateIndex
CREATE INDEX "Job_backendJobId_idx" ON "Job"("backendJobId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_kind_idx" ON "Job"("kind");

-- CreateIndex
CREATE INDEX "Job_userId_status_idx" ON "Job"("userId", "status");

-- CreateIndex
CREATE INDEX "PromptTemplate_category_idx" ON "PromptTemplate"("category");

-- CreateIndex
CREATE INDEX "PromptTemplate_isFavorite_idx" ON "PromptTemplate"("isFavorite");

-- CreateIndex
CREATE INDEX "LLMPromptTemplate_category_idx" ON "LLMPromptTemplate"("category");

-- CreateIndex
CREATE INDEX "LLMPromptTemplate_isActive_idx" ON "LLMPromptTemplate"("isActive");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_currentGenerationId_fkey" FOREIGN KEY ("currentGenerationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIPromptEnhancement" ADD CONSTRAINT "AIPromptEnhancement_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIPromptEnhancement" ADD CONSTRAINT "AIPromptEnhancement_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalRender" ADD CONSTRAINT "FinalRender_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalRender" ADD CONSTRAINT "FinalRender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalRenderClip" ADD CONSTRAINT "FinalRenderClip_finalRenderId_fkey" FOREIGN KEY ("finalRenderId") REFERENCES "FinalRender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalRenderClip" ADD CONSTRAINT "FinalRenderClip_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalRenderClip" ADD CONSTRAINT "FinalRenderClip_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_nextJobId_fkey" FOREIGN KEY ("nextJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

