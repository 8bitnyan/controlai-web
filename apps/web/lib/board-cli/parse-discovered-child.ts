export type DiscoveredChild = {
  raw: string;
  address: number;
  firmwareTypeCode: string;
  serialAscii: string | null;
  reportedTypeLabel: string;
  portId: 'rs485-1';
};

const DISCOVERED_CHILD_HEX_RE = /^[0-9a-f]{24}$/i;

export function parseDiscoveredChild(raw: string, reportedTypeLabel: string): DiscoveredChild | null {
  if (!DISCOVERED_CHILD_HEX_RE.test(raw)) {
    return null;
  }

  const addressHex = raw.slice(0, 2);
  const firmwareTypeCode = raw.slice(2, 10);
  const serialTailHex = raw.slice(10, 24);

  const serialChars = Array.from({ length: 7 }, (_, index) => {
    const start = index * 2;
    const charHex = serialTailHex.slice(start, start + 2);
    return String.fromCharCode(Number.parseInt(charHex, 16));
  });

  const isPrintableAscii = serialChars.every((char) => {
    const code = char.charCodeAt(0);
    return code >= 0x20 && code <= 0x7e;
  });

  return {
    raw,
    address: Number.parseInt(addressHex, 16),
    firmwareTypeCode,
    serialAscii: isPrintableAscii ? serialChars.join('') : null,
    reportedTypeLabel,
    portId: 'rs485-1',
  };
}
