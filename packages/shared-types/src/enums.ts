export enum OrgRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

export enum InstanceStatus {
  UNKNOWN = 'UNKNOWN',
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  UNREACHABLE = 'UNREACHABLE',
}

export enum BrokerKind {
  MOSQUITTO = 'MOSQUITTO',
  EMQX = 'EMQX',
}

export enum IngestDirection {
  UNI = 'UNI',
  BI = 'BI',
}

export enum ThroughputTier {
  LOW = 'LOW',
  MID = 'MID',
  HIGH = 'HIGH',
}

export enum RetentionPeriod {
  ONE_MINUTE = '1m',
  ONE_HOUR = '1h',
  ONE_DAY = '1d',
  SEVEN_DAYS = '7d',
  THIRTY_DAYS = '30d',
}
