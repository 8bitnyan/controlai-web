-- AlterTable
ALTER TABLE "Gateway" ADD COLUMN "lastProvisionedDeviceSerial" TEXT,
ADD COLUMN "lastProvisionedAt" TIMESTAMP(3);
