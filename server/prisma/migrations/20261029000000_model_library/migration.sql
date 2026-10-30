CREATE TABLE "ModelLibraryEntry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'General',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imageUrl" TEXT NOT NULL,
    "imagePublicId" TEXT NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModelLibraryEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ModelLibraryEntry_isPublished_idx" ON "ModelLibraryEntry"("isPublished");
CREATE INDEX "ModelLibraryEntry_category_idx" ON "ModelLibraryEntry"("category");
CREATE INDEX "ModelLibraryEntry_createdById_idx" ON "ModelLibraryEntry"("createdById");
CREATE INDEX "ModelLibraryEntry_createdAt_idx" ON "ModelLibraryEntry"("createdAt");
ALTER TABLE "ModelLibraryEntry" ADD CONSTRAINT "ModelLibraryEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
