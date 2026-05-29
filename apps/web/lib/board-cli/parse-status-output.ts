export type ParsedBoardStatus = {
  boardReportedUuid: string | null;
  boardType: string | null;
  firmware: string | null;
  ipAddress: string | null;
  state: string | null;
  rtcTime: string | null;
  mqttStatus: {
    connected: string | null;
    broker: string | null;
    port: number | null;
    clientId: string | null;
    subsSummary: string | null;
    subscriptions: string[];
  };
  mqtt: {
    groupId: string | null;
    edgeNodeId: string | null;
    collectionPeriodSec: number | null;
    collectionAlign: string | null;
  };
  bus485: {
    registered: number | null;
    children: Array<{ raw: string; reportedTypeLabel: string }>;
  };
  _unparsed: string[];
};

const SECTION_HEADER = /^\s*\[([^\]]+)\]\s*$/;

export function parseStatusOutput(raw: string): ParsedBoardStatus {
  const normalized = raw.replace(/\r\n?/g, '\n').trim();
  if (!normalized) throw new Error('parseStatusOutput: empty input');

  const lines = normalized.split('\n');
  const result: ParsedBoardStatus = {
    boardReportedUuid: null,
    boardType: null,
    firmware: null,
    ipAddress: null,
    state: null,
    rtcTime: null,
    mqttStatus: { connected: null, broker: null, port: null, clientId: null, subsSummary: null, subscriptions: [] },
    mqtt: { groupId: null, edgeNodeId: null, collectionPeriodSec: null, collectionAlign: null },
    bus485: { registered: null, children: [] },
    _unparsed: [],
  };

  let section: string | null = null;
  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    if (!line) continue;
    if (/^\s*\[[^\]]*$/.test(line)) throw new Error(`parseStatusOutput: mangled section header: ${line}`);

    const headerMatch = line.match(SECTION_HEADER);
    if (headerMatch?.[1]) {
      section = headerMatch[1].trim().toLowerCase();
      continue;
    }

    if (!section) throw new Error('parseStatusOutput: mangled section header ordering');

    if (section === 'board status') {
      if (assignIfMatch(line, /^board\s*id\s*:\s*(.+)$/i, (v) => (result.boardReportedUuid = v))) continue;
      if (assignIfMatch(line, /^board\s*type\s*:\s*(.+)$/i, (v) => (result.boardType = v))) continue;
      if (assignIfMatch(line, /^firmware\s*:??\s*(.+)$/i, (v) => (result.firmware = v))) continue;
      if (assignIfMatch(line, /^ip\s*address\s*:\s*(.+)$/i, (v) => (result.ipAddress = v))) continue;
      if (assignIfMatch(line, /^state\s*:\s*(.+)$/i, (v) => (result.state = v))) continue;
      if (assignIfMatch(line, /^rtc\s*time\s*:\s*(.+)$/i, (v) => (result.rtcTime = v))) continue;
      result._unparsed.push(line);
      continue;
    }

    if (section === 'mqtt status') {
      if (assignIfMatch(line, /^connected\s*:\s*(.+)$/i, (v) => (result.mqttStatus.connected = v))) continue;
      if (assignIfMatch(line, /^broker\s*:\s*(.+)$/i, (v) => (result.mqttStatus.broker = v))) continue;
      if (assignIfMatch(line, /^port\s*:\s*(\d+)$/i, (v) => (result.mqttStatus.port = Number(v)))) continue;
      if (assignIfMatch(line, /^clientid\s*:\s*(.+)$/i, (v) => (result.mqttStatus.clientId = v))) continue;
      if (assignIfMatch(line, /^subs\s*:\s*(.+)$/i, (v) => (result.mqttStatus.subsSummary = v))) continue;
      if (assignIfMatch(line, /^\[(\d+)\]\s+(.+)$/i, (v) => result.mqttStatus.subscriptions.push(v), 2)) continue;
      result._unparsed.push(line);
      continue;
    }

    if (section === 'mqtt') {
      if (assignIfMatch(line, /^group_id\s*:\s*(.+)$/i, (v) => (result.mqtt.groupId = v))) continue;
      if (assignIfMatch(line, /^edge_node_id\s*:\s*(.+)$/i, (v) => (result.mqtt.edgeNodeId = v))) continue;
      if (assignIfMatch(line, /^collection_period\s*:\s*(\d+)\s*sec$/i, (v) => (result.mqtt.collectionPeriodSec = Number(v)))) continue;
      if (assignIfMatch(line, /^collection_align\s*:\s*(.+)$/i, (v) => (result.mqtt.collectionAlign = v))) continue;
      result._unparsed.push(line);
      continue;
    }

    if (section === '485 bus status') {
      if (assignIfMatch(line, /^registered\s*:\s*(\d+)$/i, (v) => (result.bus485.registered = Number(v)))) continue;
      const childMatch = line.match(/^\[(\d+)\]\s+([A-Fa-f0-9]{24})\s+type\s*=\s*(\S+)$/i);
      const [, , rawChildId, reportedTypeLabel] = childMatch ?? [];
      if (rawChildId && reportedTypeLabel) {
        result.bus485.children.push({ raw: rawChildId.toUpperCase(), reportedTypeLabel });
        continue;
      }
      result._unparsed.push(line);
      continue;
    }

    result._unparsed.push(line);
  }

  return result;
}

function assignIfMatch(line: string, pattern: RegExp, apply: (value: string) => void, group = 1): boolean {
  const match = line.match(pattern);
  if (!match) return false;
  const value = match[group];
  if (!value) return false;
  apply(value.trim());
  return true;
}
