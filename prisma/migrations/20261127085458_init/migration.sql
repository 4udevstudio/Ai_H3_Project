-- Baseline schema from main, before the film layer.
-- A database created from that schema with `prisma db push` has no
-- `_prisma_migrations` row. Prisma will not migrate a non-empty database
-- until this baseline is recorded:
--   npx prisma migrate resolve --applied 20261127085458_init
--   npx prisma migrate deploy
-- IF NOT EXISTS keeps the SQL itself safe if it is applied to tables that
-- already exist. The next migration adds the film columns.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'midnight',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
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
    "duration" REAL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "generationTime" REAL,
    "vramUsed" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Generation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Reference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reference_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AIPromptEnhancement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationId" TEXT,
    "referenceImages" TEXT NOT NULL,
    "basePrompt" TEXT NOT NULL,
    "customPrompt" TEXT,
    "enhancedPrompt" TEXT NOT NULL,
    "fullPrompt" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL DEFAULT 'gemma-4b-it',
    "tokensUsed" INTEGER,
    "responseTime" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIPromptEnhancement_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "category" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PromptTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LLMPromptTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "template" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'video',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Project_createdAt_idx" ON "Project"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Generation_projectId_idx" ON "Generation"("projectId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Generation_status_idx" ON "Generation"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Generation_createdAt_idx" ON "Generation"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Reference_generationId_idx" ON "Reference"("generationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Reference_type_idx" ON "Reference"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Asset_type_idx" ON "Asset"("type");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Asset_path_key" ON "Asset"("path");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AIPromptEnhancement_generationId_key" ON "AIPromptEnhancement"("generationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PromptTemplate_category_idx" ON "PromptTemplate"("category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PromptTemplate_isFavorite_idx" ON "PromptTemplate"("isFavorite");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LLMPromptTemplate_category_idx" ON "LLMPromptTemplate"("category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LLMPromptTemplate_isActive_idx" ON "LLMPromptTemplate"("isActive");
