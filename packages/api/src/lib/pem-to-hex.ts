export function pemToHexChunks(pem: string, chunkSize = 400): string[] {
  const base64Body = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');

  if (!base64Body) {
    throw new Error('No base64 body found in PEM');
  }

  const decoded = Buffer.from(base64Body, 'base64');

  if (decoded.length === 0) {
    throw new Error('No base64 body found in PEM');
  }

  const hex = decoded.toString('hex').toUpperCase();
  const chunks: string[] = [];

  for (let i = 0; i < hex.length; i += chunkSize) {
    chunks.push(hex.slice(i, i + chunkSize));
  }

  return chunks;
}
