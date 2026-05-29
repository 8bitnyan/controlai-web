export interface SiteGroupInboundEvent {
  siteGroupId: string;
  topic: string;
  msgType: 'NBIRTH' | 'NDATA' | 'NDEATH' | string;
  clientId: string;
  ts: number;
  payloadSummary: string;
  readings?: Array<{ sensorId: string; value: number; ts: number }>;
  source: 'sim' | 'board';
}
