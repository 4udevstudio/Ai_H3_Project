-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT,
    "sourceText" TEXT NOT NULL,
    "breakdown" TEXT NOT NULL DEFAULT '[]',
    "llmModel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Script_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "scriptId" TEXT,
    "order" INTEGER NOT NULL,
    "title" TEXT,
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'T2V',
    "gguf" BOOLEAN NOT NULL DEFAULT false,
    "durationSec" REAL NOT NULL DEFAULT 5,
    "seed" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "error" TEXT,
    "chainFromPrevious" BOOLEAN NOT NULL DEFAULT true,
    "inputFramePath" TEXT,
    "lastFramePath" TEXT,
    "clipPath" TEXT,
    "currentGenerationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Scene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Scene_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Scene_currentGenerationId_fkey" FOREIGN KEY ("currentGenerationId") REFERENCES "Generation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinalRender" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "audioPath" TEXT,
    "audioVolume" REAL NOT NULL DEFAULT 1,
    "width" INTEGER NOT NULL DEFAULT 960,
    "height" INTEGER NOT NULL DEFAULT 544,
    "fps" INTEGER NOT NULL DEFAULT 24,
    "outputPath" TEXT,
    "duration" REAL,
    "error" TEXT,
    "jobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "FinalRender_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinalRenderClip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "finalRenderId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "generationId" TEXT,
    "order" INTEGER NOT NULL,
    "transitionType" TEXT NOT NULL DEFAULT 'NONE',
    "transitionDuration" REAL NOT NULL DEFAULT 0.5,
    CONSTRAINT "FinalRenderClip_finalRenderId_fkey" FOREIGN KEY ("finalRenderId") REFERENCES "FinalRender" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FinalRenderClip_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FinalRenderClip_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "projectId" TEXT,
    "backendJobId" TEXT,
    "generationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "resultPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AIPromptEnhancement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationId" TEXT,
    "sceneId" TEXT,
    "referenceImages" TEXT NOT NULL,
    "basePrompt" TEXT NOT NULL,
    "customPrompt" TEXT,
    "enhancedPrompt" TEXT NOT NULL,
    "fullPrompt" TEXT NOT NULL,
    "modelUsed" TEXT NOT NULL DEFAULT 'gemma-4b-it',
    "tokensUsed" INTEGER,
    "responseTime" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIPromptEnhancement_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AIPromptEnhancement_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AIPromptEnhancement" ("basePrompt", "createdAt", "customPrompt", "enhancedPrompt", "fullPrompt", "generationId", "id", "modelUsed", "referenceImages", "responseTime", "tokensUsed") SELECT "basePrompt", "createdAt", "customPrompt", "enhancedPrompt", "fullPrompt", "generationId", "id", "modelUsed", "referenceImages", "responseTime", "tokensUsed" FROM "AIPromptEnhancement";
DROP TABLE "AIPromptEnhancement";
ALTER TABLE "new_AIPromptEnhancement" RENAME TO "AIPromptEnhancement";
CREATE UNIQUE INDEX "AIPromptEnhancement_generationId_key" ON "AIPromptEnhancement"("generationId");
CREATE INDEX "AIPromptEnhancement_sceneId_idx" ON "AIPromptEnhancement"("sceneId");
CREATE TABLE "new_Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "metadata" TEXT,
    "projectId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Asset" ("createdAt", "id", "metadata", "name", "path", "size", "type") SELECT "createdAt", "id", "metadata", "name", "path", "size", "type" FROM "Asset";
DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE INDEX "Asset_type_idx" ON "Asset"("type");
CREATE INDEX "Asset_projectId_idx" ON "Asset"("projectId");
CREATE UNIQUE INDEX "Asset_path_key" ON "Asset"("path");
CREATE TABLE "new_Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "duration" REAL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "generationTime" REAL,
    "vramUsed" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Generation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Generation_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Generation" ("audioPath", "completedAt", "createdAt", "duration", "error", "generationTime", "id", "lastFramePath", "loraUsed", "negativePrompt", "projectId", "prompt", "resolution", "seed", "status", "steps", "taskAdapter", "thumbnailPath", "type", "useAIEnhancement", "videoPath", "vramUsed") SELECT "audioPath", "completedAt", "createdAt", "duration", "error", "generationTime", "id", "lastFramePath", "loraUsed", "negativePrompt", "projectId", "prompt", "resolution", "seed", "status", "steps", "taskAdapter", "thumbnailPath", "type", "useAIEnhancement", "videoPath", "vramUsed" FROM "Generation";
DROP TABLE "Generation";
ALTER TABLE "new_Generation" RENAME TO "Generation";
CREATE INDEX "Generation_projectId_idx" ON "Generation"("projectId");
CREATE INDEX "Generation_sceneId_idx" ON "Generation"("sceneId");
CREATE INDEX "Generation_status_idx" ON "Generation"("status");
CREATE INDEX "Generation_createdAt_idx" ON "Generation"("createdAt");
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'midnight',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "script" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "transitionType" TEXT NOT NULL DEFAULT 'NONE',
    "transitionDuration" REAL NOT NULL DEFAULT 0.5,
    "width" INTEGER NOT NULL DEFAULT 960,
    "height" INTEGER NOT NULL DEFAULT 544,
    "fps" INTEGER NOT NULL DEFAULT 24,
    "audioPath" TEXT,
    "audioVolume" REAL NOT NULL DEFAULT 1,
    "finalPath" TEXT,
    "coverPath" TEXT
);
INSERT INTO "new_Project" ("createdAt", "description", "id", "name", "theme", "updatedAt") SELECT "createdAt", "description", "id", "name", "theme", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt");
CREATE INDEX "Project_status_idx" ON "Project"("status");
CREATE TABLE "new_Reference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationId" TEXT,
    "sceneId" TEXT,
    "assetId" TEXT,
    "type" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "role" TEXT DEFAULT 'REF',
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reference_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reference_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reference_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Reference" ("createdAt", "generationId", "id", "metadata", "order", "path", "type") SELECT "createdAt", "generationId", "id", "metadata", "order", "path", "type" FROM "Reference";
DROP TABLE "Reference";
ALTER TABLE "new_Reference" RENAME TO "Reference";
CREATE INDEX "Reference_generationId_idx" ON "Reference"("generationId");
CREATE INDEX "Reference_sceneId_idx" ON "Reference"("sceneId");
CREATE INDEX "Reference_assetId_idx" ON "Reference"("assetId");
CREATE INDEX "Reference_type_idx" ON "Reference"("type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

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
CREATE INDEX "FinalRender_projectId_idx" ON "FinalRender"("projectId");

-- CreateIndex
CREATE INDEX "FinalRender_status_idx" ON "FinalRender"("status");

-- CreateIndex
CREATE INDEX "FinalRender_jobId_idx" ON "FinalRender"("jobId");

-- CreateIndex
CREATE INDEX "FinalRenderClip_finalRenderId_order_idx" ON "FinalRenderClip"("finalRenderId", "order");

-- CreateIndex
CREATE INDEX "FinalRenderClip_sceneId_idx" ON "FinalRenderClip"("sceneId");

-- CreateIndex
CREATE INDEX "FinalRenderClip_generationId_idx" ON "FinalRenderClip"("generationId");

-- CreateIndex
CREATE INDEX "Job_projectId_idx" ON "Job"("projectId");

-- CreateIndex
CREATE INDEX "Job_targetId_idx" ON "Job"("targetId");

-- CreateIndex
CREATE INDEX "Job_backendJobId_idx" ON "Job"("backendJobId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_kind_idx" ON "Job"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "Job_generationId_key" ON "Job"("generationId");
