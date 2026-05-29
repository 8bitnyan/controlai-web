CREATE TYPE "RegistrationProposalState" AS ENUM ('PROPOSED', 'COMMITTED', 'ABORTED', 'EXPIRED');

CREATE TABLE "RegistrationProposal" (
    "id" TEXT NOT NULL,
    "gatewayDeviceKey" TEXT NOT NULL,
    "state" "RegistrationProposalState" NOT NULL DEFAULT 'PROPOSED',
    "boardReportedUuid" TEXT NOT NULL DEFAULT '',
    "discoveredChildrenJson" JSONB NOT NULL DEFAULT '[]',
    "matchPlanJson" JSONB,
    "userDecisionsJson" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "abortedAt" TIMESTAMP(3),

    CONSTRAINT "RegistrationProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RegistrationProposal_gatewayDeviceKey_state_idx" ON "RegistrationProposal"("gatewayDeviceKey", "state");
CREATE INDEX "RegistrationProposal_expiresAt_idx" ON "RegistrationProposal"("expiresAt");

ALTER TABLE "RegistrationProposal" ADD CONSTRAINT "RegistrationProposal_gatewayDeviceKey_fkey" FOREIGN KEY ("gatewayDeviceKey") REFERENCES "Device"("deviceKey") ON DELETE CASCADE ON UPDATE CASCADE;
