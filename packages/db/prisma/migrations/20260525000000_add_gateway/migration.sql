-- CreateTable
CREATE TABLE "Gateway" (
    "id" TEXT NOT NULL,
    "siteGroupId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "endpointURL" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rootCaPemEnc" TEXT NOT NULL,
    "clientCertPemEnc" TEXT NOT NULL,
    "clientKeyPemEnc" TEXT NOT NULL,
    "sensors" JSONB NOT NULL,
    "jsonTopicTemplate" TEXT,
    "desiredState" TEXT NOT NULL DEFAULT 'stopped',
    "lastStatus" TEXT NOT NULL DEFAULT 'stopped',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gateway_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Gateway_siteGroupId_idx" ON "Gateway"("siteGroupId");

-- AddForeignKey
ALTER TABLE "Gateway" ADD CONSTRAINT "Gateway_siteGroupId_fkey" FOREIGN KEY ("siteGroupId") REFERENCES "SiteGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
