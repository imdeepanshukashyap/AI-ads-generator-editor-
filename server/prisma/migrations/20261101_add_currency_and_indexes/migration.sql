-- Add currency column to Transaction table (missing from initial migration)
ALTER TABLE "Transaction" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';

-- Add composite indexes for payment queries performance
CREATE INDEX "Transaction_userId_status_createdAt_idx" ON "Transaction"("userId", "status", "createdAt");
CREATE INDEX "Transaction_status_createdAt_idx" ON "Transaction"("status", "createdAt");

-- Add individual indexes on Transaction (if not already present)
CREATE INDEX IF NOT EXISTS "Transaction_userId_idx" ON "Transaction"("userId");
CREATE INDEX IF NOT EXISTS "Transaction_status_idx" ON "Transaction"("status");
CREATE INDEX IF NOT EXISTS "Transaction_createdAt_idx" ON "Transaction"("createdAt");
