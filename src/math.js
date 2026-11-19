// ============================================================================
// math + noise helpers
// ============================================================================
// ihash / vnoise / fbm must stay identical to hsh / vn / fbm in the shaders (src/shaders.js): the planets' terrain is
// displaced on the GPU and the ship lands on the same terrain computed here on the CPU.
const { sin, cos, sqrt, min, max, abs, floor, PI, pow, hypot, exp, round, acos, atan2, ceil } = Math;
const TAU = PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

const ihash = (x, y, z) => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const vnoise = (x, y, z) => {
  const ix = floor(x), iy = floor(y), iz = floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const a = mix(mix(ihash(ix, iy, iz), ihash(ix + 1, iy, iz), fx), mix(ihash(ix, iy + 1, iz), ihash(ix + 1, iy + 1, iz), fx), fy);
  const b = mix(mix(ihash(ix, iy, iz + 1), ihash(ix + 1, iy, iz + 1), fx), mix(ihash(ix, iy + 1, iz + 1), ihash(ix + 1, iy + 1, iz + 1), fx), fy);
  return mix(a, b, fz);
};
const fbm = (x, y, z, o = 4) => {
  let a = 0.5, s = 0, n = 0;
  for (let i = 0; i < o; i++) { s += a * vnoise(x, y, z); n += a; x = x * 2.03 + 17.1; y = y * 2.03 + 31.7; z = z * 2.03 + 5.3; a *= 0.5; }
  return s / n;
};

// 3-vector helpers on Float64Arrays (no allocation)
const vlen = (v) => hypot(v[0], v[1], v[2]);
// rotate v about the unit axis (ax, ay, az) by an angle with cosine c and sine s
const rotAx = (v, ax, ay, az, c, s) => {
  const x = v[0], y = v[1], z = v[2], k = (ax * x + ay * y + az * z) * (1 - c);
  v[0] = x * c + (ay * z - az * y) * s + ax * k;
  v[1] = y * c + (az * x - ax * z) * s + ay * k;
  v[2] = z * c + (ax * y - ay * x) * s + az * k;
};
