// ============================================================================
// between the planets: an asteroid belt, two comets, a space station and derelict ships
// ============================================================================
// Everything here lives in the sun's frame like the planets do. The belt is not stored at all: main.js lays a grid of
// cells around the ship and the shader hashes each cell into (at most) one rock (see SHADER_AST).
const BELT = { r: 24000, w: 2800, h: 500 };        // radius of the middle of the belt, half width, half thickness
const kepler = (M, e) => { let E = M; for (let i = 0; i < 7; i++) E -= (E - e * sin(E) - M) / (1 - e * cos(E)); return E; };
const mk3 = () => new Float64Array(3);

// comets on long ellipses around the sun: a = semi-major axis, e = eccentricity, inc = inclination, om = longitude of the node,
// w = argument of the perihelion, per = period (s), M0 = starting phase
const COMETS = [
  { name: 'Aurelia', a: 26000, e: 0.85, inc: 0.35, om: 0.6, w: 1.1, per: 9000, M0: 2.2, R: 110 },
  { name: 'Vesper', a: 16000, e: 0.62, inc: -0.5, om: 3.5, w: 0.4, per: 5200, M0: 0.7, R: 90 },
].map((c) => ({ ...c, pos: mk3(), vel: mk3(), dist: 1 }));
const cometAt = (c, t, out) => {
  const E = kepler(c.M0 + TAU * t / c.per, c.e), x = c.a * (cos(E) - c.e), z = c.a * sqrt(1 - c.e * c.e) * sin(E);
  const px = x * cos(c.w) - z * sin(c.w), pz = x * sin(c.w) + z * cos(c.w);
  const y = -pz * sin(c.inc), z2 = pz * cos(c.inc);
  out[0] = px * cos(c.om) + z2 * sin(c.om); out[1] = y; out[2] = -px * sin(c.om) + z2 * cos(c.om);
};

// the station orbits Verdant; its ring turns
const STATION = { name: 'Haven Station', parent: 3, r: 720, per: 260, ph: 0.4, R: 95, scale: 5, pos: mk3(), vel: mk3(), ring: 0 };
// wrecks drift in the sun's frame and tumble slowly
const wreckAt = (name, r, ang, y, seed) => ({ name, pos: new Float64Array([r * cos(ang), y, r * sin(ang)]), vel: mk3(), R: 60, seed, scale: 2.4, axis: [0, 1, 0], rate: 0.03, ph: seed });
const WRECKS = [wreckAt('Kestrel wreck', 24000, 0.8, 90, 1), wreckAt('Mariner wreck', 10800, 5.5, -40, 2), wreckAt('Lantern wreck', 25100, 3.1, 150, 3)];
WRECKS.forEach((w, i) => { const a = [hash1(i * 3 + 1) - 0.5, hash1(i * 3 + 2) - 0.5, hash1(i * 3 + 3) - 0.5], l = hypot(...a); w.axis = a.map((x) => x / l); w.rate = 0.02 + 0.03 * hash1(i + 9); });
function hash1(n) { const s = sin(n * 127.1 + 311.7) * 43758.5453; return s - floor(s); }
// a point in the middle of the belt, for the warp key
const BELT_POI = { name: 'Asteroid belt', pos: new Float64Array([BELT.r * cos(1.3), 0, BELT.r * sin(1.3)]), vel: mk3(), R: 500 };

// extra warp destinations on their own keys (the number keys are the planets)
const POI_KEYS = { Minus: STATION, Equal: BELT_POI, BracketLeft: COMETS[0], BracketRight: WRECKS[0], Backslash: COMETS[1] };

// main.js says whether the belt rocks are being drawn (and how wide the fine layer is); collisions only exist where rocks do
const AST = { on: 0, n: 0 };
// the tumbling basis of a wreck at time t: [right, up, forward]; used by the draw code and by the collision code
const wreckBasis = (w, t) => {
  const a = t * w.rate + w.ph, c = cos(a), s = sin(a), ax = w.axis;
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((v) => { const q = new Float64Array(v); rotAx(q, ax[0], ax[1], ax[2], c, s); return q; });
};

const tickSpace = (t) => {
  for (const c of COMETS) {
    cometAt(c, t, c.pos); cometAt(c, t + 0.5, c.vel);
    for (let i = 0; i < 3; i++) c.vel[i] = (c.vel[i] - c.pos[i]) * 2;
    c.dist = hypot(c.pos[0], c.pos[1], c.pos[2]);
  }
  const p = BODIES[STATION.parent], th = STATION.ph + TAU * t / STATION.per, w = TAU / STATION.per;
  STATION.pos[0] = p.pos[0] + STATION.r * cos(th); STATION.pos[1] = p.pos[1] + 40 * sin(th * 0.5); STATION.pos[2] = p.pos[2] + STATION.r * sin(th);
  STATION.vel[0] = p.vel[0] - STATION.r * w * sin(th); STATION.vel[1] = 0; STATION.vel[2] = p.vel[2] + STATION.r * w * cos(th);
  STATION.ring = t * 0.12;
};

// ---------------------------------------------------------------- meshes
const HULL = [0.72, 0.74, 0.78, 0], DARK = [0.2, 0.22, 0.26, 0], ACC = [0.9, 0.45, 0.12, 0], SOLAR = [0.04, 0.08, 0.2, 0], WIN = [1.0, 0.78, 0.45, 0.3];
// rotate and move the vertices written since index `from`
const xform = (out, from, rx, ry, rz, tx, ty, tz) => {
  const cx = cos(rx), sx = sin(rx), cy = cos(ry), sy = sin(ry), cz = cos(rz), sz = sin(rz);
  const rot = (x, y, z) => { let a = y * cx - z * sx, b = y * sx + z * cx; y = a; z = b; a = x * cy + z * sy; b = -x * sy + z * cy; x = a; z = b; a = x * cz - y * sz; b = x * sz + y * cz; return [a, b, z]; };
  for (let i = from; i < out.length; i += 10) {
    const p = rot(out[i], out[i + 1], out[i + 2]), n = rot(out[i + 3], out[i + 4], out[i + 5]);
    out[i] = p[0] + tx; out[i + 1] = p[1] + ty; out[i + 2] = p[2] + tz; out[i + 3] = n[0]; out[i + 4] = n[1]; out[i + 5] = n[2];
  }
};
// two meshes: the hub (still) and the ring with its spokes (turns about y). Ring radius 14, so scale 5 gives a 140 unit station.
const buildStation = () => {
  const H = meshKit(), Rg = meshKit();
  const { out: ho, face, box, cylY, plate } = H;
  cylY(0, 0, -11, 11, 3, 14, HULL);
  cylY(0, 0, -3.2, 3.2, 4.4, 14, HULL);
  cylY(0, 0, 11, 13.2, 1.7, 8, DARK); cylY(0, 0, -13.2, -11, 1.7, 8, DARK);
  cylY(0, 0, 6, 6.6, 3.4, 14, ACC); cylY(0, 0, -6.6, -6, 3.4, 14, ACC);
  for (const s of [1, -1]) {
    box([0, s * 9, 0], [9.5, 0.22, 0.22], DARK);                               // solar boom
    for (const sx of [1, -1]) plate([[sx * 2.5, -4.2], [sx * 17, -4.2], [sx * 17, 4.2], [sx * 2.5, 4.2]], s * 9 - 0.07, s * 9 + 0.07, SOLAR);
  }
  // ring: 36 segments, outer face carries rows of lit windows
  const n = 36, r1 = 13, r2 = 15, hh = 1.6, P = (r, y, a) => [r * cos(a), y, r * sin(a)];
  const { face: rf, box: rbox } = Rg;
  for (let k = 0; k < n; k++) {
    const a0 = k * TAU / n, a1 = (k + 1) * TAU / n, c = [0, 0, 0], col = k % 6 === 0 ? ACC : HULL;
    rf([P(r2, -hh, a0), P(r2, -hh, a1), P(r2, hh, a1), P(r2, hh, a0)], col, c);
    rf([P(r1, hh, a0), P(r1, hh, a1), P(r1, -hh, a1), P(r1, -hh, a0)], DARK, c);
    rf([P(r1, hh, a0), P(r2, hh, a0), P(r2, hh, a1), P(r1, hh, a1)], col, c);
    rf([P(r1, -hh, a1), P(r2, -hh, a1), P(r2, -hh, a0), P(r1, -hh, a0)], DARK, c);
    if (hash1(k * 1.7) > 0.25) rf([P(r2 + 0.03, -0.45, a0 + 0.02), P(r2 + 0.03, -0.45, a1 - 0.02), P(r2 + 0.03, 0.45, a1 - 0.02), P(r2 + 0.03, 0.45, a0 + 0.02)], WIN, c);
  }
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) rbox([dx * 8.7, 0, dz * 8.7], [dx ? 4.5 : 0.6, 0.6, dz ? 4.5 : 0.6], HULL);
  return { hub: new Float32Array(ho), ring: new Float32Array(Rg.out) };
};
// a freighter, broken in two, with a cloud of torn-off plates around it. Length about 30, along z.
const buildWreck = (seed) => {
  const K = meshKit(), { out, frustum, box, plate, fin, pod } = K;
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const old = [0.36, 0.33, 0.3, 0], dim = [0.2, 0.19, 0.19, 0], glass = [0.02, 0.03, 0.05, 0.55];
  const palette = [[0.55, 0.2, 0.12, 0], [0.2, 0.3, 0.5, 0], [0.55, 0.42, 0.15, 0], [0.28, 0.4, 0.28, 0], [0.4, 0.4, 0.42, 0]];
  let m = out.length;
  frustum(-3, 11, 2.9, 2.0, 2.3, 1.7, 0, old);                                     // forward hull
  box([0, 3.6, 8.2], [1.7, 1.4, 2.2], old);                                        // bridge
  box([0, 4.1, 10.2], [1.3, 0.55, 0.05], glass);
  for (let z = 0; z < 3; z++) for (let x = -1; x <= 1; x++) for (let y = 0; y < 2; y++) if (rnd() > 0.25) box([x * 1.9, 2.9 + y * 1.6, 0.8 + z * 3.1], [0.85, 0.75, 1.4], palette[rnd() * 5 | 0]);
  m = out.length;
  frustum(-14, -4, 2.5, 1.7, 2.9, 2.0, 0, old);                                    // aft hull, torn off
  for (const x of [-1.6, 0, 1.6]) pod(x, 0, -17.5, -13.5, 0.95, dim, dim);
  xform(out, m, 0.08, 0.2, 0.28, 1.6, -1.4, -4.5);
  for (let i = 0; i < 14; i++) {                                                   // debris
    const f = out.length, kind = rnd();
    if (kind < 0.4) plate([[0, 0], [1 + rnd() * 3, 0], [1 + rnd() * 3, 1 + rnd() * 3], [0, 1 + rnd() * 2]], 0, 0.12, rnd() < 0.5 ? old : dim);
    else if (kind < 0.7) fin([[0, 0], [2 + rnd() * 2, 0.4], [0.5, 2 + rnd() * 2]], 0, 0.1, ACC);
    else box([0, 0, 0], [0.4 + rnd(), 0.3 + rnd() * 0.6, 0.4 + rnd()], palette[rnd() * 5 | 0]);
    const a = rnd() * TAU, d = 9 + rnd() * 22;
    xform(out, f, rnd() * TAU, rnd() * TAU, rnd() * TAU, cos(a) * d, (rnd() - 0.5) * 14, sin(a) * d * 1.4 - 2);
  }
  return new Float32Array(out);
};
// one lumpy low-poly sphere (positions only); the vertex shader shapes every rock from it
const buildRock = () => {
  const rings = 7, seg = 11, out = [], P = (i, j) => {
    if (i === 0) return [0, 1, 0];
    if (i === rings) return [0, -1, 0];
    const th = i * PI / rings, ph = j * TAU / seg;
    return [sin(th) * cos(ph), cos(th), sin(th) * sin(ph)];
  };
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const j2 = (j + 1) % seg, a = P(i, j), b = P(i, j2), c = P(i + 1, j), d = P(i + 1, j2);
    if (i === 0) out.push(...a, ...d, ...c);
    else if (i === rings - 1) out.push(...a, ...b, ...c);
    else out.push(...a, ...b, ...c, ...b, ...d, ...c);
  }
  return new Float32Array(out);
};
