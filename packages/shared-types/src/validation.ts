import { z } from 'zod';

// ─── Org ─────────────────────────────────────────────────────────────────────

export const CreateOrgSchema = z.object({
  name: z.string().min(2).max(64),
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

export const UpdateOrgSchema = z.object({
  orgId: z.string().cuid(),
  name: z.string().min(2).max(64).optional(),
});

export const DeleteOrgSchema = z.object({
  orgId: z.string().cuid(),
});

export const InviteMemberSchema = z.object({
  orgId: z.string().cuid(),
  email: z.string().email(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']).default('MEMBER'),
});

export const AcceptInvitationSchema = z.object({
  token: z.string().min(1),
});

export const RemoveMemberSchema = z.object({
  orgId: z.string().cuid(),
  userId: z.string().cuid(),
});

export const UpdateMemberRoleSchema = z.object({
  orgId: z.string().cuid(),
  userId: z.string().cuid(),
  role: z.enum(['ADMIN', 'MEMBER']),
});

// ─── Project ──────────────────────────────────────────────────────────────────

export const CreateProjectSchema = z.object({
  orgId: z.string().cuid(),
  instanceId: z.string().cuid(),
  name: z.string().min(1).max(128),
});

export const UpdateProjectSchema = z.object({
  orgId: z.string().cuid(),
  projectId: z.string().cuid(),
  name: z.string().min(1).max(128).optional(),
});

export const DeleteProjectSchema = z.object({
  orgId: z.string().cuid(),
  projectId: z.string().cuid(),
});

export const ListProjectsSchema = z.object({
  orgId: z.string().cuid(),
});

// ─── SiteGroup ────────────────────────────────────────────────────────────────

export const CreateSiteGroupSchema = z.object({
  orgId: z.string().cuid(),
  projectId: z.string().cuid(),
  name: z.string().min(1).max(128),
});

export const UpdateSiteGroupSchema = z.object({
  orgId: z.string().cuid(),
  siteGroupId: z.string().cuid(),
  name: z.string().min(1).max(128),
});

export const DeleteSiteGroupSchema = z.object({
  orgId: z.string().cuid(),
  siteGroupId: z.string().cuid(),
});

export const ListSiteGroupsSchema = z.object({
  orgId: z.string().cuid(),
  projectId: z.string().cuid(),
});

// ─── Site ─────────────────────────────────────────────────────────────────────

export const CreateSiteSchema = z.object({
  orgId: z.string().cuid(),
  siteGroupId: z.string().cuid(),
  name: z.string().min(1).max(128),
  brokerKind: z.enum(['MOSQUITTO', 'EMQX']).optional(),
  ingestDirection: z.enum(['UNI', 'BI']).optional(),
  throughputTier: z.enum(['LOW', 'MID', 'HIGH']).optional(),
  retentionPeriod: z.enum(['1m', '1h', '1d', '7d', '30d']).optional(),
});

export const UpdateSiteSchema = z.object({
  orgId: z.string().cuid(),
  siteId: z.string().cuid(),
  name: z.string().min(1).max(128).optional(),
  brokerKind: z.enum(['MOSQUITTO', 'EMQX']).optional(),
  ingestDirection: z.enum(['UNI', 'BI']).optional(),
  throughputTier: z.enum(['LOW', 'MID', 'HIGH']).optional(),
  retentionPeriod: z.enum(['1m', '1h', '1d', '7d', '30d']).optional(),
});

export const DeleteSiteSchema = z.object({
  orgId: z.string().cuid(),
  siteId: z.string().cuid(),
});

export const ListSitesSchema = z.object({
  orgId: z.string().cuid(),
  siteGroupId: z.string().cuid(),
});

// ─── Instance ─────────────────────────────────────────────────────────────────

export const RegisterInstanceSchema = z.object({
  orgId: z.string().cuid(),
  name: z.string().min(1).max(128),
  baseURL: z.string().url(),
  bearerToken: z.string().min(1),
});

export const UpdateInstanceSchema = z.object({
  orgId: z.string().cuid(),
  instanceId: z.string().cuid(),
  name: z.string().min(1).max(128).optional(),
  bearerToken: z.string().min(1).optional(),
});

export const DeleteInstanceSchema = z.object({
  orgId: z.string().cuid(),
  instanceId: z.string().cuid(),
});

export const ListInstancesSchema = z.object({
  orgId: z.string().cuid(),
});

export const TestConnectionSchema = z.object({
  orgId: z.string().cuid(),
  instanceId: z.string().cuid(),
});

// ─── Audit ─────────────────────────────────────────────────────────────────────

export const ListAuditSchema = z.object({
  orgId: z.string().cuid(),
  action: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().cuid().optional(),
});

// ─── Type exports ─────────────────────────────────────────────────────────────

export type CreateOrgInput = z.infer<typeof CreateOrgSchema>;
export type UpdateOrgInput = z.infer<typeof UpdateOrgSchema>;
export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type CreateSiteGroupInput = z.infer<typeof CreateSiteGroupSchema>;
export type CreateSiteInput = z.infer<typeof CreateSiteSchema>;
export type UpdateSiteInput = z.infer<typeof UpdateSiteSchema>;
export type RegisterInstanceInput = z.infer<typeof RegisterInstanceSchema>;
export type UpdateInstanceInput = z.infer<typeof UpdateInstanceSchema>;
export type ListAuditInput = z.infer<typeof ListAuditSchema>;
