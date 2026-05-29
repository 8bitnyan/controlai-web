ALTER TYPE "InstanceStatus" ADD VALUE IF NOT EXISTS 'PROVISIONING';
ALTER TYPE "InstanceStatus" ADD VALUE IF NOT EXISTS 'PROVISION_FAILED';
ALTER TABLE "ControlaiInstance"
  ADD COLUMN "env" TEXT,
  ADD COLUMN "provisioningStartedAt" TIMESTAMP(3),
  ADD COLUMN "provisionerInstanceId" TEXT;
CREATE UNIQUE INDEX "ControlaiInstance_orgId_env_unique"
  ON "ControlaiInstance" ("orgId", "env")
  WHERE "env" IS NOT NULL;
