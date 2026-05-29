-- Add per-Site broker-driver config + per-SiteGroup topic-schema mode
ALTER TABLE "Site" ADD COLUMN "driverId" TEXT DEFAULT 'mqtt-driver';
ALTER TABLE "Site" ADD COLUMN "driverConfig" JSONB;
ALTER TABLE "Site" ADD COLUMN "ingestModeJson" JSONB;

ALTER TABLE "SiteGroup" ADD COLUMN "topicSchemaMode" TEXT NOT NULL DEFAULT 'legacy';
