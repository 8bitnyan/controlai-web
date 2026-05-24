/**
 * Compute the setup wizard state by querying User, Organization, and
 * ControlaiInstance counts. Used by the setup wizard and middleware.
 */
import type { PrismaClient } from '@controlai-web/db';

export interface SetupState {
  firstUserDone: boolean;
  firstOrgDone: boolean;
  firstInstanceDone: boolean;
  isComplete: boolean;
}

export async function getSetupState(db: PrismaClient): Promise<SetupState> {
  const [userCount, orgCount, instanceCount] = await Promise.all([
    db.user.count(),
    db.organization.count(),
    db.controlaiInstance.count(),
  ]);

  const firstUserDone = userCount > 0;
  const firstOrgDone = orgCount > 0;
  const firstInstanceDone = instanceCount > 0;

  return {
    firstUserDone,
    firstOrgDone,
    firstInstanceDone,
    isComplete: firstUserDone && firstOrgDone && firstInstanceDone,
  };
}
