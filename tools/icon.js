// App icons, drawn in code the way the games draw theirs (after aether-and-brass/tools/icon.js): nothing here is
// committed, and tools/pwa.js renders every size at build time into dist/icons/.
//
// The emblem is an arcade joystick - a red ball on a steel stick, standing in a brass base with two buttons - on
// the shelf's own dark plum. It is a field function sampled with 4x4 supersampling rather than a path drawn by a
// rasteriser, because the only drawing surface Node has is arithmetic.
import zlib from 'node:zlib';

const GROUND_IN = [0x2b, 0x1f, 0x3d];
const GROUND_OUT = [0x14, 0x10, 0x1a];
const BRASS = [0xe2, 0xb3, 0x4a];
const STEEL = [0xc9, 0xce, 0xd6];
const BALL = [0xe5, 0x53, 0x3d];
const SHINE = [0xff, 0xe2, 0xd6];
const TEAL = [0x4d, 0xf0, 0xe0];
const PLUM = [0x9b, 0x6b, 0xe0];

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
/** Linear blend, `t` = how much of `b`. */
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** `c` lit from above: the top of a part brighter, the bottom darker, across `top`..`bottom` in emblem units. */
const lit = (c, y, top, bottom) => c.map((v) => v * (1.2 - 0.45 * Math.max(0, Math.min(1, (y - top) / (bottom - top)))));
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Colour at one point of the emblem.
 * @param {number} nx -1..1 across the emblem
 * @param {number} ny -1..1 down the emblem
 * @returns {number[]} [r, g, b], 0..255 floats
 */
function sample(nx, ny) {
  let rgb = mix(GROUND_IN, GROUND_OUT, smoothstep(0.1, 1.3, Math.hypot(nx, ny)));
  // the base: a rounded slab (a superellipse), lit from above
  const bx = nx / 0.74, by = (ny - 0.5) / 0.22;
  if (bx ** 4 + by ** 4 <= 1) rgb = lit(BRASS, ny, 0.28, 0.72);
  // two buttons on it, either side of the stick
  if (Math.hypot(nx + 0.44, ny - 0.47) < 0.1) rgb = lit(TEAL, ny, 0.37, 0.57);
  if (Math.hypot(nx - 0.44, ny - 0.47) < 0.1) rgb = lit(PLUM, ny, 0.37, 0.57);
  // the stick, lit from the left
  if (Math.abs(nx) < 0.075 && ny > -0.3 && ny < 0.46) rgb = STEEL.map((v) => v * (1.1 - 1.6 * (nx + 0.075)));
  // the ball, with a highlight up and to the left
  const br = Math.hypot(nx, ny + 0.4);
  if (br < 0.31) {
    rgb = lit(BALL, ny, -0.71, -0.09);
    rgb = mix(rgb, SHINE, smoothstep(0.11, 0.0, Math.hypot(nx + 0.1, ny + 0.51)));
  }
  return rgb;
}

/**
 * Render the emblem as raw RGB pixels.
 * @param {number} size edge length in px
 * @param {number} fill emblem diameter as a fraction of the edge (a maskable icon wants ~0.62, so the emblem
 *                      survives a circular crop; a plain icon can run wider)
 */
function pixels(size, fill) {
  const out = Buffer.alloc(size * size * 3);
  const half = size / 2, radius = half * fill, SS = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((x + (sx + 0.5) / SS - half) / radius, (y + (sy + 0.5) / SS - half) / radius);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS, i = (y * size + x) * 3;
      out[i] = clamp255(r / n); out[i + 1] = clamp255(g / n); out[i + 2] = clamp255(b / n);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (~c) >>> 0;
}

/** One PNG chunk: length, type, data, CRC of type+data. */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Encode raw RGB pixels as an opaque 8-bit truecolour PNG. Deterministic: the same arguments give byte-identical
 * output on every build, which is what lets the worker's cache name be a hash of the files it precaches.
 */
function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: truecolour, no alpha
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * One icon as PNG bytes.
 * @param {number} size edge length in px
 * @param {{maskable?: boolean}} [opts] a maskable icon keeps the emblem inside the safe circle
 */
export function renderIcon(size, opts = {}) {
  return encodePng(size, pixels(size, opts.maskable ? 0.62 : 0.88));
}
