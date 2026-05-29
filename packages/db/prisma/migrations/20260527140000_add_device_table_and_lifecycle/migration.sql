CREATE TYPE "DeviceRegistrationState" AS ENUM ('UNREGISTERED', 'REGISTERING', 'REGISTERED', 'ORPHANED');

CREATE TABLE "Device" (
    "deviceKey" TEXT NOT NULL,
    "siteGroupId" TEXT NOT NULL,
    "canvasNodeId" TEXT NOT NULL,
    "siteId" TEXT,
    "deviceTypeId" TEXT NOT NULL,
    "registrationState" "DeviceRegistrationState" NOT NULL DEFAULT 'UNREGISTERED',
    "shadowUuid" TEXT NOT NULL,
    "realUuid" TEXT,
    "parentDeviceKey" TEXT,
    "portBindings" JSONB,
    "config" JSONB NOT NULL DEFAULT '{}',
    "simulationDesired" BOOLEAN NOT NULL DEFAULT true,
    "registeredAt" TIMESTAMP(3),
    "registeredByUserId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("deviceKey")
);

CREATE UNIQUE INDEX "Device_siteGroupId_canvasNodeId_key" ON "Device"("siteGroupId", "canvasNodeId");
CREATE INDEX "Device_siteGroupId_registrationState_idx" ON "Device"("siteGroupId", "registrationState");
CREATE INDEX "Device_parentDeviceKey_idx" ON "Device"("parentDeviceKey");
CREATE INDEX "Device_realUuid_idx" ON "Device"("realUuid");

ALTER TABLE "Device" ADD CONSTRAINT "Device_siteGroupId_fkey" FOREIGN KEY ("siteGroupId") REFERENCES "SiteGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_parentDeviceKey_fkey" FOREIGN KEY ("parentDeviceKey") REFERENCES "Device"("deviceKey") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Gateway" ADD COLUMN "deviceKey" TEXT;
ALTER TABLE "Gateway" ADD COLUMN "simulationDesired" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Gateway_deviceKey_key" ON "Gateway"("deviceKey");

ALTER TABLE "Gateway" ADD CONSTRAINT "Gateway_deviceKey_fkey" FOREIGN KEY ("deviceKey") REFERENCES "Device"("deviceKey") ON DELETE SET NULL ON UPDATE CASCADE;
