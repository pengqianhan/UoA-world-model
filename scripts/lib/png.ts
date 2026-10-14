// A small PNG decoder for elevation tiles: 8-bit, non-interlaced, greyscale, RGB, RGBA or
// palette images, with Node's zlib and nothing else.
import { inflateSync } from "node:zlib";

export interface Image {
  width: number;
  height: number;
  /** Red, green and blue of every pixel, row by row. */
  rgb: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function decodePng(buf: Buffer): Image {
  if (!SIGNATURE.every((b, i) => buf[i] === b)) throw new Error("not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let interlace = 0;
  let palette: Buffer | undefined;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      colour = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") palette = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`PNG with bit depth ${depth}, interlace ${interlace} is not handled`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour];
  if (!channels) throw new Error(`PNG colour type ${colour} is not handled`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);
  // Undo each row's filter, against the row above.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const up = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[row + x - channels]! : 0;
      const b = y > 0 ? out[up + x]! : 0;
      const c = x >= channels && y > 0 ? out[up + x - channels]! : 0;
      const v = raw[src + x]!;
      let p: number;
      if (filter === 0) p = v;
      else if (filter === 1) p = v + a;
      else if (filter === 2) p = v + b;
      else if (filter === 3) p = v + ((a + b) >> 1);
      else if (filter === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`PNG row filter ${filter}`);
      out[row + x] = p & 255;
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    if (colour === 3) {
      const k = out[i]! * 3;
      rgb.set([palette![k]!, palette![k + 1]!, palette![k + 2]!], i * 3);
    } else if (colour === 0 || colour === 4) {
      const g = out[i * channels]!;
      rgb.set([g, g, g], i * 3);
    } else {
      rgb.set([out[i * channels]!, out[i * channels + 1]!, out[i * channels + 2]!], i * 3);
    }
  }
  return { width, height, rgb };
}
