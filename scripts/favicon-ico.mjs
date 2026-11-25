// favicon.ico for crawlers and browsers that request it regardless of <link rel=icon>.
// An ICO may hold a PNG image directly (Windows Vista+ and every current browser), so no pixel conversion is needed.
export function pngToIco(png) {
  const buf = Buffer.from(png);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString('ascii', 12, 16) !== 'IHDR') throw new TypeError('pngToIco needs a PNG file');
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  if (width > 256 || height > 256) throw new RangeError('ICO images are at most 256×256');
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); // reserved, type icon, one image
  header.writeUInt8(width % 256, 6); header.writeUInt8(height % 256, 7); // 0 means 256
  header.writeUInt8(0, 8); header.writeUInt8(0, 9); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(buf.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, buf]);
}
