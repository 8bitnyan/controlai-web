/**
 * Dev seed — creates admin@localhost.dev user + dev-org organisation.
 *
 * Run:  pnpm --filter @controlai-web/db db:seed
 */
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256')
    .update(salt + password)
    .digest('hex');
  return `${salt}:${hash}`;
}

async function main() {
  console.log('🌱 Seeding development database...');

  // Upsert dev user
  const devUser = await prisma.user.upsert({
    where: { email: 'admin@localhost.dev' },
    update: {},
    create: {
      email: 'admin@localhost.dev',
      name: 'Dev Admin',
      emailVerified: true,
    },
  });

  // Upsert dev account (email+password via better-auth format)
  await prisma.account.upsert({
    where: { providerId_accountId: { providerId: 'credential', accountId: devUser.id } },
    update: {},
    create: {
      accountId: devUser.id,
      providerId: 'credential',
      userId: devUser.id,
      password: hashPassword('devpassword'),
    },
  });

  // Upsert dev org
  const devOrg = await prisma.organization.upsert({
    where: { slug: 'dev-org' },
    update: {},
    create: {
      name: 'Dev Org',
      slug: 'dev-org',
    },
  });

  // Upsert membership
  await prisma.organizationMember.upsert({
    where: { orgId_userId: { orgId: devOrg.id, userId: devUser.id } },
    update: {},
    create: {
      orgId: devOrg.id,
      userId: devUser.id,
      role: 'OWNER',
    },
  });

  console.log(`✅ Seeded user: admin@localhost.dev (password: devpassword)`);
  console.log(`✅ Seeded org: dev-org (id: ${devOrg.id})`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
