/**
 * Dev seed — creates admin@localhost.dev user + dev-org organisation.
 *
 * Run:  pnpm --filter @controlai-web/db db:seed
 *
 * Uses better-auth's exported scrypt hasher so the seeded password verifies
 * against the same algorithm the runtime sign-in flow uses.
 */
import { hashPassword } from 'better-auth/crypto';
import { prisma } from '../src/index';

const EMAIL = 'admin@localhost.dev';
const PASSWORD = 'devpassword';
const NAME = 'Dev Admin';
const ORG_SLUG = 'dev-org';
const ORG_NAME = 'Dev Org';

async function main() {
  console.log('🌱 Seeding development database...');

  const passwordHash = await hashPassword(PASSWORD);

  // Upsert dev user
  const devUser = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { name: NAME, emailVerified: true },
    create: { email: EMAIL, name: NAME, emailVerified: true },
  });

  // Upsert credential account with a valid scrypt hash
  await prisma.account.upsert({
    where: {
      providerId_accountId: { providerId: 'credential', accountId: devUser.id },
    },
    update: { password: passwordHash },
    create: {
      accountId: devUser.id,
      providerId: 'credential',
      userId: devUser.id,
      password: passwordHash,
    },
  });

  // Upsert dev org
  const devOrg = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: {},
    create: { name: ORG_NAME, slug: ORG_SLUG },
  });

  // Upsert membership
  await prisma.organizationMember.upsert({
    where: { orgId_userId: { orgId: devOrg.id, userId: devUser.id } },
    update: {},
    create: { orgId: devOrg.id, userId: devUser.id, role: 'OWNER' },
  });

  console.log(`✅ Seeded user: ${EMAIL} (password: ${PASSWORD})`);
  console.log(`✅ Seeded org:  ${ORG_SLUG} (id: ${devOrg.id})`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
