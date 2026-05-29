import { prisma } from '@controlai-web/db';

import { writeAudit } from '../lib/audit-writer';

type StartRegistrationProposalExpireJobOptions = {
  intervalMs?: number;
};

export async function runExpireTick(now = new Date()): Promise<void> {
  const expired = await prisma.registrationProposal.findMany({
    where: {
      state: 'PROPOSED',
      expiresAt: { lt: now },
    },
    select: {
      id: true,
      gatewayDeviceKey: true,
    },
  });

  for (const proposal of expired) {
    await prisma.$transaction(async (tx) => {
      await tx.registrationProposal.update({
        where: { id: proposal.id },
        data: { state: 'EXPIRED' },
      });

      await tx.device.updateMany({
        where: {
          OR: [{ deviceKey: proposal.gatewayDeviceKey }, { parentDeviceKey: proposal.gatewayDeviceKey }],
          registrationState: 'REGISTERING',
        },
        data: { registrationState: 'UNREGISTERED' },
      });

    });

    void writeAudit(prisma, {
      orgId: '',
      userId: null,
      action: 'gateway.register-expired',
      targetType: 'RegistrationProposal',
      targetId: proposal.id,
      metadata: {
        proposalId: proposal.id,
        gatewayDeviceKey: proposal.gatewayDeviceKey,
      },
    });
  }
}

export function startRegistrationProposalExpireJob({
  intervalMs = 300_000,
}: StartRegistrationProposalExpireJobOptions = {}): (() => void) | null {
  if (process.env.ENABLE_REGISTRATION_PROPOSAL_EXPIRE !== 'true') {
    return null;
  }

  void runExpireTick();
  const id = setInterval(() => void runExpireTick(), intervalMs);
  return () => clearInterval(id);
}
