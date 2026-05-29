import { prisma } from "@controlai-web/db";

async function main() {
  const totalInstances = await prisma.controlaiInstance.count();

  const { count: updatedCount } = await prisma.controlaiInstance.updateMany({
    where: { legacy: false },
    data: { legacy: true },
  });

  const alreadyLegacyCount = totalInstances - updatedCount;

  console.log("Backfill complete for ControlaiInstance.legacy");
  console.log(`Total instances: ${totalInstances}`);
  console.log(`Marked legacy=true: ${updatedCount}`);
  console.log(`Already legacy=true: ${alreadyLegacyCount}`);
}

main()
  .catch((error) => {
    console.error("Backfill failed for ControlaiInstance.legacy", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
