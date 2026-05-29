-- AlterTable
ALTER TABLE "Gateway" ADD COLUMN "canvasNodeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Gateway_siteGroupId_canvasNodeId_key" ON "Gateway"("siteGroupId", "canvasNodeId");
