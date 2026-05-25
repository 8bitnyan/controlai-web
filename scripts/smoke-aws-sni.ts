#!/usr/bin/env tsx
/**
 * AWS gateway-simulator end-to-end smoke verification.
 *
 * Verifies the SNI pipeline is wired correctly *without* requiring the web UI:
 *  1. TCP :8883 reachable on the AWS public IP
 *  2. Daemon HTTPS healthy and tenant.Domain set
 *  3. Postgres Site row has controlaiTenantId/controlaiSiteId + tlsServername stamped
 *  4. PKI cert issuance works against the daemon
 *  5. mqtt.js can complete a TLS handshake with SNI override (no app-level connect required)
 *
 * Usage:
 *   pnpm tsx scripts/smoke-aws-sni.ts
 *   (sources apps/web/.env.local for DATABASE_URL + INSTANCE_TOKEN_KEY)
 *
 * Exit code 0 = all green. Non-zero = first failed check is logged.
 */

import { PrismaClient } from '@controlai-web/db';
import { createDecipheriv } from 'node:crypto';
import net from 'node:net';
import mqtt from 'mqtt';

void createDecipheriv;

const AWS_IP = '52.79.241.139';
const AWS_BASEURL = 'https://api.52-79-241-139.nip.io';
const PROJECT_ID = 'cmpjyscdh000bb4lxs8ol711z';
const SITE_GROUP_ID = 'cmpjyzwrz000db95tu9uusq4b';

const INSTANCE_TOKEN_KEY = process.env.INSTANCE_TOKEN_KEY;
if (!INSTANCE_TOKEN_KEY) {
  console.error('FATAL: INSTANCE_TOKEN_KEY missing — source apps/web/.env.local first');
  process.exit(2);
}

import { decryptToken } from '../packages/api/src/lib/crypto';

function ok(label: string, detail = ''): void {
  console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? ' — ' + detail : ''}`);
}
function bad(label: string, detail = ''): never {
  console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ' — ' + detail : ''}`);
  process.exit(1);
}

async function checkTcp(host: string, port: number, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error(`timeout after ${ms}ms`));
    }, ms);
    sock.once('connect', () => {
      clearTimeout(timer);
      sock.end();
      resolve();
    });
    sock.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    sock.connect(port, host);
  });
}

async function daemonFetch<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const url = `${AWS_BASEURL}${path}`;
  const r = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`${r.status} ${url}: ${body.slice(0, 300)}`);
  }
  const text = await r.text();
  return (text.length ? JSON.parse(text) : null) as T;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  console.log('\n=== AWS SNI smoke ===\n');

  // (1) TCP :8883 reachability
  console.log('1) TCP reachability');
  try {
    await checkTcp(AWS_IP, 8883);
    ok(`${AWS_IP}:8883 open`);
  } catch (e) {
    bad(`${AWS_IP}:8883 unreachable`, String(e));
  }

  // (2) Resolve daemon instance + tenant + Site from Postgres
  console.log('\n2) Postgres state');
  const project = await prisma.project.findUnique({
    where: { id: PROJECT_ID },
    include: { instance: true },
  });
  if (!project) bad('Project row missing', PROJECT_ID);
  ok('Project found', project!.name);

  const instance = project!.instance;
  if (!instance) bad('Project.instance link missing');
  if (instance!.baseURL.replace(/\/$/, '') !== AWS_BASEURL) {
    bad('Project.instance.baseURL mismatch', `expected ${AWS_BASEURL}, got ${instance!.baseURL}`);
  }
  ok('Instance.baseURL', instance!.baseURL);

  const site = await prisma.site.findFirst({ where: { siteGroupId: SITE_GROUP_ID } });
  if (!site) bad('No Site row in siteGroup', SITE_GROUP_ID);
  if (!site!.controlaiTenantId || !site!.controlaiSiteId) {
    bad('Site not provisioned', `tenant=${site!.controlaiTenantId} site=${site!.controlaiSiteId}`);
  }
  ok('Site provisioned', `tenant=${site!.controlaiTenantId} site=${site!.controlaiSiteId}`);

  if (!site!.tlsServername) {
    bad(
      'Site.tlsServername NOT stamped — re-run Apply on this site-group; the createSite branch in packages/api/src/routers/apply.ts stamps this from daemon tenant.Domain',
    );
  }
  ok('Site.tlsServername', site!.tlsServername!);

  // (3) Daemon HTTPS + tenant domain
  console.log('\n3) Daemon HTTPS');
  const token = decryptToken(instance!.bearerTokenEnc);
  const health = await daemonFetch<{ status: string }>(token, '/v1/health');
  ok('Daemon /v1/health', health.status);

  type TenantRaw = { ID?: string; id?: string; Domain?: string; domain?: string };
  const tenants = await daemonFetch<TenantRaw[]>(token, '/v1/tenants');
  const tenant = tenants.find(
    (t) => (t.ID ?? t.id) === (site!.controlaiTenantId as string),
  );
  if (!tenant) bad('Tenant not found on daemon', site!.controlaiTenantId!);
  const domain = tenant.Domain ?? tenant.domain ?? '';
  if (!domain) bad('Tenant.Domain empty on daemon — PATCH /v1/tenants/<tid> {domain: ...} first');
  ok('Tenant.Domain', domain);

  const expectedSni = `${site!.controlaiSiteId}.${site!.controlaiTenantId}.${domain}`;
  if (site!.tlsServername !== expectedSni) {
    bad('Stamped Site.tlsServername drifted from daemon tenant.Domain', `db=${site!.tlsServername} daemon-derived=${expectedSni}`);
  }
  ok('Stamped SNI matches daemon-derived');

  // (4) PKI cert issuance
  console.log('\n4) PKI cert issuance');
  type Cert = { cert_pem: string; key_pem: string; fingerprint: string; not_after: string; ca_pem?: string };
  const cn = `smoke-${Date.now()}`;
  const cert = await daemonFetch<Cert>(
    token,
    `/v1/tenants/${site!.controlaiTenantId}/sites/${site!.controlaiSiteId}/pki/certs`,
    { method: 'POST', body: JSON.stringify({ gateway: cn }) },
  );
  if (!cert.cert_pem || !cert.key_pem) bad('PKI did not return cert+key');
  ok('PKI cert issued', `fp=${cert.fingerprint.slice(0, 24)} not_after=${cert.not_after}`);

  const caPem = cert.ca_pem ?? '';
  if (caPem) ok('Root CA fetched', `${caPem.length} bytes`);
  else ok('Root CA fetch skipped', 'daemon does not expose /pki/ca; will use rejectUnauthorized=false');

  // (5) mqtt.js TLS handshake with SNI override
  console.log('\n5) mqtt.js TLS handshake (SNI override)');
  const connectUrl = `mqtts://${AWS_IP}:8883`;
  console.log(`  connect=${connectUrl} servername=${expectedSni}`);

  await new Promise<void>((resolve, reject) => {
    const client = mqtt.connect(connectUrl, {
      clientId: `smoke-${Date.now()}`,
      clean: true,
      reconnectPeriod: 0,
      connectTimeout: 10_000,
      ...(caPem ? { ca: caPem, rejectUnauthorized: true } : { rejectUnauthorized: false }),
      cert: cert.cert_pem,
      key: cert.key_pem,
      servername: expectedSni,
    });
    const t = setTimeout(() => {
      client.end(true);
      reject(new Error('connect timeout 10s'));
    }, 10_000);
    client.once('connect', () => {
      clearTimeout(t);
      client.end(true);
      resolve();
    });
    client.once('error', (err) => {
      clearTimeout(t);
      client.end(true);
      reject(err);
    });
  })
    .then(() => ok('MQTT TLS handshake + CONNACK'))
    .catch((e) => bad('MQTT connect failed', String(e)));

  console.log('\n\x1b[32m=== ALL CHECKS PASSED ===\x1b[0m\n');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('\n\x1b[31mFATAL\x1b[0m', e);
  process.exit(1);
});
