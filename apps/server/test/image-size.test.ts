import { describe, it, expect } from 'vitest';
import { imageInfo } from '../src/lib/image-size.ts';

function png(w: number, h: number) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function gif(w: number, h: number) {
  const b = Buffer.alloc(13); b.write('GIF89a', 0, 'ascii'); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b;
}
function jpeg(w: number, h: number) {
  // SOI, APP0 (len 16), SOF0 (len 17) with height/width
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}
function webpVP8X(w: number, h: number) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'ascii'); b.write('VP8X', 12, 'ascii');
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}

describe('imageInfo', () => {
  it('reads png', () => expect(imageInfo(png(640, 480))).toEqual({ mime: 'image/png', width: 640, height: 480 }));
  it('reads gif', () => expect(imageInfo(gif(32, 16))).toEqual({ mime: 'image/gif', width: 32, height: 16 }));
  it('reads jpeg', () => expect(imageInfo(jpeg(1200, 800))).toEqual({ mime: 'image/jpeg', width: 1200, height: 800 }));
  it('reads webp VP8X', () => expect(imageInfo(webpVP8X(300, 200))).toEqual({ mime: 'image/webp', width: 300, height: 200 }));
  it('rejects non-images and truncated data', () => {
    expect(imageInfo(Buffer.from('hello world, definitely not an image'))).toBeNull();
    expect(imageInfo(png(1, 1).subarray(0, 10))).toBeNull();
    expect(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});
