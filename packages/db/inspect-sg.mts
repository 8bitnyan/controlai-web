import { prisma } from './src/index';

const SG_ID = 'cmpqglevp000ttcp4kw61evzb';

const sg = await prisma.siteGroup.findUnique({
  where: { id: SG_ID },
  include: {
    sites: { include: { devices: true } },
  },
});

const gateways = await prisma.gateway.findMany({ where: { siteGroupId: SG_ID } });

console.log(
  JSON.stringify(
    {
      siteGroupId: SG_ID,
      siteCount: sg?.sites.length ?? 0,
      sites: sg?.sites.map((s) => ({
        id: s.id,
        name: s.name,
        controlaiTenantId: s.controlaiTenantId,
        controlaiSiteId: s.controlaiSiteId,
        brokerKind: s.brokerKind,
        retentionPeriod: s.retentionPeriod,
        deviceCount: s.devices.length,
        devices: s.devices.map((d) => ({
          key: d.deviceKey,
          typeId: d.deviceTypeId,
          state: d.registrationState,
          simDesired: d.simulationDesired,
          parent: d.parentDeviceKey,
        })),
      })),
      gatewayCount: gateways.length,
      gateways: gateways.map((g) => ({
        id: g.id,
        kind: g.kind,
        desiredState: g.desiredState,
        lastStatus: g.lastStatus,
        hasClientCert: !!g.clientCertPemEnc,
        endpointURL: g.endpointURL,
        sensorsCount: Array.isArray(g.sensors) ? g.sensors.length : 0,
      })),
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
