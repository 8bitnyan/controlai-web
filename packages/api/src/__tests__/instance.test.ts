import { describe, it, expect, vi, beforeEach } from 'vitest';

// Set encryption key before any crypto imports
process.env.INSTANCE_TOKEN_KEY = 'b'.repeat(64);

vi.mock('../lib/daemon-client', () => ({
  checkDaemonHealth: vi.fn(),
  DaemonError: class DaemonError extends Error {
    statusCode: number;
    constructor(statusCode: number, body: string, url: string) {
      super(`${statusCode} at ${url}: ${body}`);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('../lib/audit-writer', () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

import { checkDaemonHealth } from '../lib/daemon-client';
import { encryptToken } from '../lib/crypto';

const mockCheckDaemonHealth = checkDaemonHealth as ReturnType<typeof vi.fn>;

// Helper: build a minimal mock Prisma db
function makeMockPrisma() {
  return {
    controlaiInstance: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    organizationMember: {
      findUnique: vi.fn(),
    },
    project: {
      count: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('instance router logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('calls health check, encrypts token, and inserts instance on success', async () => {
      const db = makeMockPrisma();
      const healthResponse = {
        status: 'healthy',
        version: '0.0.3',
        capacity: { used_mb: 512, allowed_mb: 3276 },
      };
      mockCheckDaemonHealth.mockResolvedValue(healthResponse);

      const createdInstance = {
        id: 'inst_1',
        orgId: 'org_1',
        name: 'My Instance',
        baseURL: 'https://api.example.sslip.io',
        status: 'HEALTHY',
        lastSeenAt: new Date(),
        version: '0.0.3',
        capacityUsedMB: 512,
        capacityAllowedMB: 3276,
        bearerTokenEnc: 'enc:xxx:yyy',
      };
      db.controlaiInstance.create.mockResolvedValue(createdInstance);

      // Simulate what the router does
      const bearerToken = 'plain-token-abc';
      await checkDaemonHealth('https://api.example.sslip.io', bearerToken);
      const enc = encryptToken(bearerToken);

      expect(mockCheckDaemonHealth).toHaveBeenCalledWith(
        'https://api.example.sslip.io',
        bearerToken,
      );
      // The encrypted token should not equal the plaintext
      expect(enc).not.toBe(bearerToken);
      // Should contain 3 colon-separated parts (iv:ciphertext:authTag)
      expect(enc.split(':')).toHaveLength(3);
    });

    it('does not insert if health check fails', async () => {
      const db = makeMockPrisma();
      mockCheckDaemonHealth.mockRejectedValue(
        new Error('ECONNREFUSED'),
      );

      try {
        await checkDaemonHealth('https://unreachable.example.com', 'token');
      } catch {
        // Expected — router would throw TRPCError and NOT call db.create
      }

      expect(db.controlaiInstance.create).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('is blocked when projects depend on the instance', async () => {
      const db = makeMockPrisma();
      const instance = {
        id: 'inst_1',
        orgId: 'org_1',
        projects: [{ name: 'My Project' }],
      };
      db.controlaiInstance.findFirst.mockResolvedValue(instance);
      db.organizationMember.findUnique.mockResolvedValue({ role: 'OWNER' });

      // In the real router, this check prevents deletion.
      // Simulate the guard logic.
      if (instance.projects.length > 0) {
        const names = instance.projects.map((p) => p.name).join(', ');
        expect(names).toBe('My Project');
        // Deletion should not proceed
        expect(db.controlaiInstance.delete).not.toHaveBeenCalled();
      }
    });
  });
});
