import { getActiveSiteCount } from './mqtt-manager';
import { sseFanout } from './sse-fanout';

export interface HealthResponse {
  status: 'ok';
  activeSites: number;
  totalSubscribers: number;
}

export function getHealthStatus(): HealthResponse {
  const activeSiteIds = sseFanout.activeSiteIds();
  const totalSubscribers = activeSiteIds.reduce(
    (sum, siteId) => sum + sseFanout.subscriberCount(siteId),
    0,
  );

  return {
    status: 'ok',
    activeSites: getActiveSiteCount(),
    totalSubscribers,
  };
}
