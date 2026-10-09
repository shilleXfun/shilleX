export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
export interface ImageInfo { mime: ImageMime; width: number; height: number }

export function imageInfo(buf: Buffer): ImageInfo | null {
  try {
    if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
      return ok('image/png', buf.readUInt32BE(16), buf.readUInt32BE(20));
    }
    if (buf.length >= 10 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')) {
      return ok('image/gif', buf.readUInt16LE(6), buf.readUInt16LE(8));
    }
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) return jpeg(buf);
    if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return webp(buf);
  } catch { /* fall through */ }
  return null;
}

function ok(mime: ImageMime, width: number, height: number): ImageInfo | null {
  return width > 0 && height > 0 && width <= 20000 && height <= 20000 ? { mime, width, height } : null;
}

function jpeg(buf: Buffer): ImageInfo | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1]!;
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return ok('image/jpeg', buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
    }
    i += 2 + len;
  }
  return null;
}

function webp(buf: Buffer): ImageInfo | null {
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return ok('image/webp', buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1);
  if (chunk === 'VP8 ') return ok('image/webp', buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return ok('image/webp', (b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1);
  }
  return null;
}
