// ============================================================================
// the solar system, terrain, and the ship model
// ============================================================================
// 1 unit is about a metre-ish for the ship (10 long) but the system is compressed: planets are 70..1000 units across
// and orbit 5 000..60 000 units from the sun. Orbits are circular and slow (about 50 u/s) so landing on a planet is easy.
const lin = (r, g, b) => [pow(r / 255, 2.2), pow(g / 255, 2.2), pow(b / 255, 2.2)];
const SUN_R = 1300;

// kind: 0 rock, 1 living world, 2 giant, 3 ice, 4 volcanic, 5 sun
// pal: four colours whose meaning depends on kind (see the fragment shader); atm: [r, g, b, thickness / radius]
const BODY_DEFS = [
  { name: 'The Sun', kind: 5, R: SUN_R, pal: [lin(255, 120, 20), lin(255, 225, 130), [0, 0, 0], [0, 0, 0]], spinP: 600 },
  { name: 'Cinder', kind: 0, R: 140, a: 5200, per: 650, ph: 0.6, spinP: 90, amp: 0.045, freq: 2.6, sea: 0, seed: 3,
    pal: [lin(95, 88, 82), lin(165, 155, 145), lin(55, 50, 46), lin(160, 160, 160)], cap: 0 },
  { name: 'Ember', kind: 4, R: 230, a: 8600, per: 1050, ph: 2.4, spinP: 200, amp: 0.05, freq: 2.2, sea: 0.40, seed: 11,
    pal: [lin(30, 20, 18), lin(75, 48, 38), lin(255, 105, 28), lin(255, 190, 80)], atm: [1.0, 0.45, 0.18, 0.12] },
  { name: 'Verdant', kind: 1, R: 260, a: 13000, per: 1600, ph: 4.1, spinP: 150, amp: 0.045, freq: 2.4, sea: 0.50, seed: 5,
    pal: [lin(6, 30, 90), lin(20, 110, 150), lin(60, 120, 45), lin(150, 130, 110)], atm: [0.30, 0.55, 1.0, 0.08], cap: 0.7 },
  { name: 'Pale', kind: 0, R: 70, parent: 3, a: 1100, per: 150, ph: 1.0, spinP: 90, amp: 0.05, freq: 3.4, sea: 0, seed: 9,
    pal: [lin(110, 110, 112), lin(190, 190, 192), lin(70, 70, 74), lin(200, 200, 200)], cap: 0 },
  { name: 'Rust', kind: 0, R: 190, a: 18000, per: 2250, ph: 5.3, spinP: 130, amp: 0.05, freq: 2.2, sea: 0, seed: 17,
    pal: [lin(140, 70, 40), lin(205, 125, 75), lin(95, 45, 28), lin(240, 235, 230)], atm: [0.9, 0.55, 0.42, 0.05], cap: 0.5 },
  { name: 'Goliath', kind: 2, R: 1000, a: 30000, per: 4500, ph: 3.0, spinP: 100, freq: 11, seed: 2,
    pal: [lin(205, 160, 110), lin(160, 105, 65), lin(230, 205, 170), lin(120, 70, 45)], atm: [0.9, 0.72, 0.52, 0.04] },
  { name: 'Halcyon', kind: 2, R: 760, a: 41000, per: 6000, ph: 0.9, spinP: 110, freq: 9, seed: 6,
    pal: [lin(230, 210, 150), lin(200, 170, 110), lin(245, 235, 200), lin(170, 140, 90)], atm: [0.95, 0.85, 0.6, 0.03],
    ring: [1.35, 2.4, 0.45] },
  { name: 'Cerulea', kind: 2, R: 450, a: 51000, per: 8000, ph: 2.0, spinP: 120, freq: 5, seed: 8,
    pal: [lin(120, 200, 215), lin(90, 170, 200), lin(150, 220, 225), lin(70, 140, 175)], atm: [0.42, 0.82, 0.92, 0.05] },
  { name: 'Nyx', kind: 3, R: 300, a: 60000, per: 9500, ph: 4.7, spinP: 140, amp: 0.04, freq: 3, sea: 0, seed: 13,
    pal: [lin(200, 225, 245), lin(140, 180, 225), lin(70, 110, 170), lin(255, 255, 255)], atm: [0.6, 0.75, 1.0, 0.04] },
];
const IDX = {};
const BODIES = BODY_DEFS.map((d, i) => {
  IDX[d.name] = i;
  const solid = d.kind !== 2 && d.kind !== 5;
  return {
    ...d, i, solid,
    parent: d.parent ?? -1, amp: (d.amp || 0) * d.R, freq: d.freq || 0, sea: d.sea || 0, off: d.seed * 7.3,
    pos: new Float64Array(3), vel: new Float64Array(3), spin: 0, spinW: TAU / d.spinP,
    ubo: null, bg: null, u: new Float32Array(40),
  };
});
// number keys 1..9, 0 warp to these bodies (see main.js)
const WARP = ['Cinder', 'Ember', 'Verdant', 'Rust', 'Goliath', 'Halcyon', 'Cerulea', 'Nyx', 'Pale', 'The Sun'].map((n) => IDX[n]);

// advance all orbits to time t (seconds): circular orbits in the XZ plane; moons orbit their parent
const tickBodies = (t) => {
  for (const b of BODIES) {
    b.spin = b.spinW * t + b.off;
    if (!b.a) continue;
    const w = TAU / b.per, th = b.ph + w * t, c = cos(th), s = sin(th), p = b.parent >= 0 ? BODIES[b.parent] : null;
    b.pos[0] = b.a * c + (p ? p.pos[0] : 0); b.pos[1] = p ? p.pos[1] : 0; b.pos[2] = b.a * s + (p ? p.pos[2] : 0);
    b.vel[0] = -b.a * w * s + (p ? p.vel[0] : 0); b.vel[1] = 0; b.vel[2] = b.a * w * c + (p ? p.vel[2] : 0);
  }  tickSpace(t);
};

// terrain height above the sea-level radius for a unit direction d in the planet's own frame.
// Same formula as hgt() in the planet shader: the mesh you see is the ground you land on.
const terrain = (b, dx, dy, dz) => {
  if (!b.amp) return 0;
  const f = b.freq, o = b.off, f2 = f * 2.1 + 0;
  const n = fbm(dx * f + o, dy * f + o, dz * f + o, 5);
  const r = 1 - abs(2 * fbm(dx * f2 + o + 9, dy * f2 + o + 9, dz * f2 + o + 9, 4) - 1);
  return b.amp * max(n * 0.65 + r * 0.35 - b.sea, 0);
};
// radius of the ground below world-space offset (ox, oy, oz) from the body's centre
const groundR = (b, ox, oy, oz) => {
  if (!b.solid) return b.R;
  const c = cos(b.spin), s = sin(b.spin), lx = c * ox - s * oz, lz = s * ox + c * oz, k = 1 / (hypot(lx, oy, lz) || 1);
  return b.R + terrain(b, lx * k, oy * k, lz * k);
};
// ground normal below the offset (world space) written to out; two probes 4 units away
const groundN = (b, ox, oy, oz, out) => {
  const l = hypot(ox, oy, oz) || 1, nx = ox / l, ny = oy / l, nz = oz / l;
  // a tangent: n x (0,1,0), or n x (1,0,0) near the poles
  let tx = nz, ty = 0, tz = -nx, tl = hypot(tx, tz);
  if (tl < 0.05) { tx = 0; ty = nz; tz = -ny; tl = hypot(ty, tz) || 1; }
  tx /= tl; ty /= tl; tz /= tl;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx, e = 4;
  const r0 = groundR(b, ox, oy, oz), r1 = groundR(b, ox + tx * e, oy + ty * e, oz + tz * e), r2 = groundR(b, ox + bx * e, oy + by * e, oz + bz * e);
  // points on the ground: P0 = n*r0, P1 = (o + t*e) normalised * r1 ...
  const a1 = hypot(ox + tx * e, oy + ty * e, oz + tz * e), a2 = hypot(ox + bx * e, oy + by * e, oz + bz * e);
  const p0x = nx * r0, p0y = ny * r0, p0z = nz * r0;
  const p1x = (ox + tx * e) / a1 * r1 - p0x, p1y = (oy + ty * e) / a1 * r1 - p0y, p1z = (oz + tz * e) / a1 * r1 - p0z;
  const p2x = (ox + bx * e) / a2 * r2 - p0x, p2y = (oy + by * e) / a2 * r2 - p0y, p2z = (oz + bz * e) / a2 * r2 - p0z;
  let cx = p1y * p2z - p1z * p2y, cy = p1z * p2x - p1x * p2z, cz = p1x * p2y - p1y * p2x;
  const cl = hypot(cx, cy, cz) || 1;
  cx /= cl; cy /= cl; cz /= cl;
  if (cx * nx + cy * ny + cz * nz < 0) { cx = -cx; cy = -cy; cz = -cz; }
  out[0] = cx; out[1] = cy; out[2] = cz;
};

// ---------------------------------------------------------------- the ship: a low-poly fighter built from solids
// local axes: +x right wing, +y up, +z nose. Vertex = position, normal, colour (rgb) + glow amount (a).
// helpers that build flat-shaded meshes: 10 floats per vertex = position, normal, colour rgb + material (alpha)
const meshKit = () => {
  const out = [];
  const tri = (a, b, c, col, cen) => {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    // point the normal away from the part's centre
    if (nx * ((a[0] + b[0] + c[0]) / 3 - cen[0]) + ny * ((a[1] + b[1] + c[1]) / 3 - cen[1]) + nz * ((a[2] + b[2] + c[2]) / 3 - cen[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (const p of [a, b, c]) out.push(p[0], p[1], p[2], nx, ny, nz, col[0], col[1], col[2], col[3]);
  };
  const face = (pts, col, cen) => { for (let i = 1; i < pts.length - 1; i++) tri(pts[0], pts[i], pts[i + 1], col, cen); };
  // tapered box from z0 (tail) to z1 (nose), half sizes w/h at each end, centred at height y
  const frustum = (z0, z1, w0, h0, w1, h1, y, col) => {
    const c = [0, y, (z0 + z1) / 2];
    const A = [[-w0, y - h0, z0], [w0, y - h0, z0], [w0, y + h0, z0], [-w0, y + h0, z0]];
    const B = [[-w1, y - h1, z1], [w1, y - h1, z1], [w1, y + h1, z1], [-w1, y + h1, z1]];
    face(A, col, c); face(B, col, c);
    for (let i = 0; i < 4; i++) face([A[i], A[(i + 1) % 4], B[(i + 1) % 4], B[i]], col, c);
  };
  // flat plate: polygon in the XZ plane between heights y0 and y1
  const plate = (poly, y0, y1, col) => {
    const c = [poly.reduce((s, p) => s + p[0], 0) / poly.length, (y0 + y1) / 2, poly.reduce((s, p) => s + p[1], 0) / poly.length];
    face(poly.map((p) => [p[0], y1, p[1]]), col, c); face(poly.map((p) => [p[0], y0, p[1]]), col, c);
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; face([[p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]], col, c); }
  };
  // vertical plate: polygon in the (z, y) plane between x0 and x1
  const fin = (poly, x0, x1, col) => {
    const c = [(x0 + x1) / 2, poly.reduce((s, p) => s + p[1], 0) / poly.length, poly.reduce((s, p) => s + p[0], 0) / poly.length];
    face(poly.map((p) => [x1, p[1], p[0]]), col, c); face(poly.map((p) => [x0, p[1], p[0]]), col, c);
    for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; face([[x0, p[1], p[0]], [x0, q[1], q[0]], [x1, q[1], q[0]], [x1, p[1], p[0]]], col, c); }
  };
  // 8-sided engine pod along z
  const pod = (cx, cy, z0, z1, r, col, cap) => {
    const c = [cx, cy, (z0 + z1) / 2], ring = (z) => Array.from({ length: 8 }, (_, k) => [cx + r * cos(k * PI / 4), cy + r * sin(k * PI / 4), z]);
    const A = ring(z0), B = ring(z1);
    face(A, cap, c); face(B, col, c);
    for (let k = 0; k < 8; k++) face([A[k], A[(k + 1) % 8], B[(k + 1) % 8], B[k]], col, c);
  };
  // axis-aligned box with centre c and half sizes h
  const box = (c, h, col) => {
    const P = (sx, sy, sz) => [c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]];
    const F = [[[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
      [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]];
    for (const f of F) face(f.map((q) => P(...q)), col, c);
  };
  // closed cylinder around the y axis from y0 to y1
  const cylY = (cx, cz, y0, y1, r, n, col, r1 = r) => {
    const c = [cx, (y0 + y1) / 2, cz], ring = (y, rr) => Array.from({ length: n }, (_, k) => [cx + rr * cos(k * TAU / n), y, cz + rr * sin(k * TAU / n)]);
    const A = ring(y0, r), B = ring(y1, r1);
    face(A, col, c); face(B, col, c);
    for (let k = 0; k < n; k++) face([A[k], A[(k + 1) % n], B[(k + 1) % n], B[k]], col, c);
  };
  return { out, tri, face, frustum, plate, fin, pod, box, cylY };
};
const buildShip = () => {
  const { out, tri, face, frustum, plate, fin, pod, box } = meshKit();
  const hull = [0.78, 0.8, 0.86, 0], dark = [0.22, 0.23, 0.28, 0], accent = [1.0, 0.42, 0.12, 0], glass = [0.12, 0.45, 0.85, 0.55], burn = [1.0, 0.55, 0.2, 1];
  frustum(-4.2, 5.2, 1.0, 0.5, 0.12, 0.1, 0, hull);                        // fuselage
  frustum(0.2, 3.4, 0.52, 0.32, 0.1, 0.06, 0.55, glass);                    // canopy
  frustum(-3.6, -0.6, 0.62, 0.12, 0.62, 0.12, 0.58, dark);                  // spine
  for (const s of [1, -1]) {
    plate([[s * 0.7, -3.4], [s * 0.7, 1.6], [s * 5.4, -3.8], [s * 5.4, -2.7]], -0.12, 0.1, hull);   // wing
    plate([[s * 5.4, -3.8], [s * 5.4, -2.7], [s * 4.7, -2.7], [s * 4.7, -3.8]], -0.13, 0.11, accent); // wing tip
    pod(s * 1.45, -0.05, -4.9, -2.2, 0.55, dark, burn);                       // engine
    fin([[-3.8, 0.4], [-4.3, 2.0], [-2.4, 0.5]], s * 0.9 - 0.07, s * 0.9 + 0.07, accent);  // twin tail fins
  }
  // landing gear, drawn extended; the vertex shader folds it up into the hull about y = 0.05 (alpha 2 = gear)
  const gear = [0.2, 0.21, 0.24, 2];
  for (const [x, z, L] of [[0, 3.1, 1.25], [1.9, -2.3, 1.25], [-1.9, -2.3, 1.25]]) {
    box([x, 0.05 - L / 2, z], [0.09, L / 2, 0.09], gear);                      // strut
    box([x, 0.05 - L - 0.04, z], [0.38, 0.05, 0.55], gear);                    // foot pad
    box([x, 0.05 - L * 0.55, z - 0.08], [0.05, L * 0.28, 0.05], gear);         // brace
  }
  return new Float32Array(out);
};

// ---------------------------------------------------------------- surface props: low-poly trees, rocks and crystals
// Four models in one vertex buffer (10 floats per vertex like the ship: position, normal, then shade, -, class, material).
// y is up, the base sits at y = 0. Material 0 bark, 1 foliage, 2 rock, 3 crystal (coloured per planet in the shader).
const buildVeg = () => {
  const out = [], ranges = [];
  let cls = 0, seed = 5;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const tri = (a, b, c, mat, cen) => {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (nx * ((a[0] + b[0] + c[0]) / 3 - cen[0]) + ny * ((a[1] + b[1] + c[1]) / 3 - cen[1]) + nz * ((a[2] + b[2] + c[2]) / 3 - cen[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (const p of [a, b, c]) out.push(p[0], p[1], p[2], nx, ny, nz, 1, 0, cls, mat);
  };
  // cone or tapered cylinder: base ring at y0 (radius r0), top ring at y1 (radius r1; 0 = a point), n sides
  const cone = (x, y0, y1, r0, r1, n, mat, z = 0, lx = 0, lz = 0) => {
    const c = [x + lx / 2, (y0 + y1) / 2, z + lz / 2], ring = (y, r, off) => Array.from({ length: n }, (_, k) => [x + off * lx + r * cos(k * TAU / n), y, z + off * lz + r * sin(k * TAU / n)]);
    const A = ring(y0, r0, 0), B = ring(y1, r1, 1);
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      if (r1 < 0.01) tri(A[k], A[k2], [x + lx, y1, z + lz], mat, c);
      else { tri(A[k], A[k2], B[k2], mat, c); tri(A[k], B[k2], B[k], mat, c); }
    }
  };
  // squashed, lumpy sphere
  const blob = (x, y, z, rx, ry, rz, rings, seg, mat, lump) => {
    const P = (i, j) => {
      if (i === 0) return [x, y + ry, z];
      if (i === rings) return [x, y - ry, z];
      const th = i * PI / rings, ph = j * TAU / seg, k = 1 + lump * (rnd() - 0.5);
      return [x + rx * sin(th) * cos(ph) * k, y + ry * cos(th) * k, z + rz * sin(th) * sin(ph) * k];
    };
    const g = Array.from({ length: rings + 1 }, (_, i) => Array.from({ length: seg }, (_, j) => P(i, j)));
    const c = [x, y, z];
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      if (i === 0) tri(g[0][0], g[1][j], g[1][j2], mat, c);
      else if (i === rings - 1) tri(g[i][j], g[rings][0], g[i][j2], mat, c);
      else { tri(g[i][j], g[i + 1][j], g[i + 1][j2], mat, c); tri(g[i][j], g[i + 1][j2], g[i][j2], mat, c); }
    }
  };
  const model = (f) => { const a = out.length / 10; f(); ranges.push([a, out.length / 10 - a]); cls++; };
  model(() => {          // 0: conifer, 14 high
    cone(0, -0.4, 3, 0.55, 0.4, 5, 0);
    for (const [y0, r, h] of [[2.2, 3.4, 5], [5.2, 2.7, 4.6], [8.2, 2.0, 4.2], [10.8, 1.2, 3.4]]) cone(0, y0, y0 + h, r, 0, 7, 1);
  });
  model(() => {          // 1: broadleaf, 12 high
    cone(0, -0.4, 5.2, 0.75, 0.5, 6, 0);
    blob(0, 8.2, 0, 4.6, 3.6, 4.6, 4, 8, 1, 0.35);
    blob(2.8, 6.6, 1.2, 3, 2.5, 3, 3, 7, 1, 0.35);
    blob(-2.6, 7, -1.4, 3, 2.6, 3, 3, 7, 1, 0.35);
  });
  model(() => {          // 2: boulders
    blob(0, 0.9, 0, 2.3, 1.5, 1.9, 3, 7, 2, 0.5);
    blob(2.2, 0.5, 1.1, 1.2, 0.8, 1.1, 3, 6, 2, 0.5);
  });
  model(() => {          // 3: crystal cluster
    cone(0, -0.3, 8, 0.9, 0.35, 6, 3, 0, 0.5, 0.2);
    cone(1.6, -0.3, 5.4, 0.7, 0.28, 6, 3, 0.8, 0.9, -0.3);
    cone(-1.3, -0.3, 4, 0.6, 0.25, 6, 3, -0.9, -0.7, 0.4);
  });
  return { data: new Float32Array(out), ranges };
};
// the props each kind of world grows, as the chance per grid cell for the four models above
const VEG_P = { 0: [0, 0, 0.14, 0], 1: [0.17, 0.17, 0.04, 0], 3: [0, 0, 0.07, 0.11], 4: [0, 0, 0.13, 0] };
