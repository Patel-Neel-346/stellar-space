// ============================================================================
// ship flight, gravity and landing (pure logic: no DOM, no GPU, so it can be tested in Node)
// ============================================================================
// Flight model: the ship's velocity is eased toward a target (your thrust input) measured relative to the nearest
// planet's own motion, so a ship that lets go of the controls hangs beside a planet instead of drifting away from it.
// Gravity pulls toward the nearest planet; the easing makes that a gentle sink, which is how you land. Near the ground
// the top speed shrinks with altitude, so you can not hit the ground hard. Touching ground slowly = landed.
const HOVER = 1.3, SENS0 = 0.0021;   // mouse sensitivity is SENS0 scaled by the slider in the Settings panel (CFG.sens, 50 = default)
const SH = { p: new Float64Array(3), v: new Float64Array(3), r: new Float64Array([1, 0, 0]), u: new Float64Array([0, 1, 0]), f: new Float64Array([0, 0, -1]) };
// controls, written by the input code each frame (mx, my: mouse movement not yet applied)
const IN = { fwd: 0, str: 0, vert: 0, roll: 0, boost: 0, brake: 0, mx: 0, my: 0, act: 0 };
const ST = {
  t: 0, landed: null, cool: 0, nb: BODIES[3], dist: 0, alt: 0, thr: 0, boostA: 0, speed: 0, msg: '', noSolid: 0,
  skyS: 0, sky: new Float64Array(3), up: new Float64Array([0, 1, 0]), fv: new Float64Array(3), strk: new Float64Array(3),
  camD: 15, cam: new Float64Array(3), camBoost: 0,
  hull: 100, cargo: 0, salv: [0, 0, 0], hit: 0, hitI: 0, hitP: 0, hitM: 0, hitCool: 0, crash: 0, dk: 0, dkT: 0, dkS: 1, dkFree: 0, dock: 0, sv: -1, svT: 0, svDone: 0, alert: '', alertT: 0,   // hull %, scrap, salvaged wrecks, impact events, docking state, alert text
  warp: 0, wPh: 0, wT: 0, wDest: 0, flash: 0, wev: 0,   // warp jump: amount 0..1, phase (0 none, 1 charging, 2 arriving), timer, target, flash, event counter
};
const LO = new Float64Array(3), TN = new Float64Array(3);   // landed offset from the planet's centre, ground normal

const turn = (a, ang) => {
  const x = a[0], y = a[1], z = a[2], c = cos(ang), s = sin(ang);
  rotAx(SH.r, x, y, z, c, s); rotAx(SH.u, x, y, z, c, s); rotAx(SH.f, x, y, z, c, s);
};
const ortho = () => {
  const f = SH.f, r = SH.r, u = SH.u;
  let l = vlen(f);
  f[0] /= l; f[1] /= l; f[2] /= l;
  const d = r[0] * f[0] + r[1] * f[1] + r[2] * f[2];
  r[0] -= f[0] * d; r[1] -= f[1] * d; r[2] -= f[2] * d;
  l = vlen(r);
  r[0] /= l; r[1] /= l; r[2] /= l;
  u[0] = r[1] * f[2] - r[2] * f[1]; u[1] = r[2] * f[0] - r[0] * f[2]; u[2] = r[0] * f[1] - r[1] * f[0];
};
// swing the ship's 'up' toward the unit vector n, by at most `rate` radians
const align = (nx, ny, nz, rate) => {
  const u = SH.u, cx = u[1] * nz - u[2] * ny, cy = u[2] * nx - u[0] * nz, cz = u[0] * ny - u[1] * nx;
  const sn = hypot(cx, cy, cz);
  if (sn < 1e-7) return;
  turn([cx / sn, cy / sn, cz / sn], min(atan2(sn, u[0] * nx + u[1] * ny + u[2] * nz), rate));
};


// ---------------------------------------------------------------- collisions, hull, docking, salvage
// The ship is a sphere (SR). Everything it can hit is a handful of simple shapes: rocks are spheres (found by running the
// shader's cell hash on the CPU), comet nuclei are spheres, the station is a hub cylinder + ring (a torus) + four spokes + solar
// panels, a wreck is two capsules. Each frame the ship's path is sampled every few units, so even boost speed can not tunnel through.
const SR = 5, DOCK_V = 90;
const RK = [];                               // candidate rocks near the path: x, y, z, radius
const ASTL = [{ C: 150, chance: 0.3, smin: 2, smax: 32, seed: 1 }, { C: 1000, chance: 0.1, smin: 35, smax: 220, seed: 2 }];
const gatherRocks = (ax, ay, az, bx, by, bz) => {
  RK.length = 0;
  if (!AST.on) return;
  for (const L of ASTL) {
    const C = L.C, mg = L.smax + SR;
    const x0 = floor((min(ax, bx) - mg) / C), x1 = floor((max(ax, bx) + mg) / C), z0 = floor((min(az, bz) - mg) / C), z1 = floor((max(az, bz) + mg) / C), y0 = floor((min(ay, by) - mg) / C), y1 = floor((max(ay, by) + mg) / C);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) * (y1 - y0 + 1) > 900) continue;
    for (let ca = x0; ca <= x1; ca++) for (let cb = z0; cb <= z1; cb++) for (let cy = y0; cy <= y1; cy++) {
      const kz = cy * 64 + L.seed, x = (ca + ihash(ca + 1, cb, kz)) * C, y = (cy + ihash(ca, cb, kz + 1)) * C, z = (cb + ihash(ca, cb + 1, kz)) * C;
      const dr = (hypot(x, z) - BELT.r) / BELT.w;
      if (ihash(ca, cb, kz) > L.chance * exp(-dr * dr * 1.5) * exp(-pow(y / BELT.h, 2))) continue;
      RK.push(x, y, z, mix(L.smin, L.smax, pow(ihash(ca + 2, cb + 2, kz + 2), 3)) * 0.92);
    }
  }
};
const HIT = { nx: 0, ny: 0, nz: 0, pen: 0, ox: 0, oy: 0, oz: 0, what: '' };   // the deepest contact found by probe(): normal, depth, the obstacle's velocity
const setHit = (nx, ny, nz, pen, ox, oy, oz, what) => { if (pen > HIT.pen) { HIT.nx = nx; HIT.ny = ny; HIT.nz = nz; HIT.pen = pen; HIT.ox = ox; HIT.oy = oy; HIT.oz = oz; HIT.what = what; } };
const sph = (x, y, z, cx, cy, cz, r, ov, what) => {
  const dx = x - cx, dy = y - cy, dz = z - cz, d = hypot(dx, dy, dz), pen = r + SR - d;
  if (pen <= 0) return;
  if (d > 1e-6) setHit(dx / d, dy / d, dz / d, pen, ov ? ov[0] : 0, ov ? ov[1] : 0, ov ? ov[2] : 0, what);
  else setHit(0, 1, 0, pen, 0, 0, 0, what);
};
// closest point on a box (centre c, half sizes h) to p, as a hit in the box's own frame; returns [nx, ny, nz, pen] or null
const BX = [0, 0, 0, 0];
const boxPen = (x, y, z, cx, cy, cz, hx, hy, hz) => {
  const dx = x - cx, dy = y - cy, dz = z - cz, qx = clamp(dx, -hx, hx), qy = clamp(dy, -hy, hy), qz = clamp(dz, -hz, hz);
  const ex = dx - qx, ey = dy - qy, ez = dz - qz, d = hypot(ex, ey, ez);
  if (d >= SR) return null;
  if (d > 1e-6) { BX[0] = ex / d; BX[1] = ey / d; BX[2] = ez / d; BX[3] = SR - d; return BX; }
  const a = abs(dx) / hx, b = abs(dy) / hy, c = abs(dz) / hz;   // centre inside: leave through the nearest face
  BX[0] = BX[1] = BX[2] = 0;
  if (a > b && a > c) BX[0] = dx < 0 ? -1 : 1; else if (b > c) BX[1] = dy < 0 ? -1 : 1; else BX[2] = dz < 0 ? -1 : 1;
  BX[3] = SR + 1; return BX;
};
const stationProbe = (x, y, z) => {
  const dx = x - STATION.pos[0], dy = y - STATION.pos[1], dz = z - STATION.pos[2], ov = STATION.vel;
  const rr = hypot(dx, dz);
  // hub: body, bulge and the two ports are solid cylinders (radius, lowest y, highest y)
  for (const [r, y0, y1] of [[15, -55, 55], [22, -16, 16], [8.5, 55, 66], [8.5, -66, -55]]) {
    const qr = min(rr, r), qy = clamp(dy, y0, y1), k = rr > 1e-6 ? qr / rr : 0;
    const ex = dx - dx * k, ey = dy - qy, ez = dz - dz * k, d = hypot(ex, ey, ez);
    if (d >= SR) continue;
    if (d > 1e-6) setHit(ex / d, ey / d, ez / d, SR - d, ov[0], ov[1], ov[2], 'station');
    else setHit(rr > 1e-6 ? dx / rr : 1, 0, rr > 1e-6 ? dz / rr : 0, SR + r - rr, ov[0], ov[1], ov[2], 'station');
  }
  const ca = cos(STATION.ring), sa = sin(STATION.ring), lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;   // the ring's frame turns
  const put = (b, what) => { if (b) { const wx = b[0] * ca + b[2] * sa, wz = -b[0] * sa + b[2] * ca; setHit(wx, b[1], wz, b[3], ov[0], ov[1], ov[2], what); } };
  // ring: a torus, radius 70, tube about 8
  const q = hypot(lx, lz) - 70, td = hypot(q, dy), tp = 8.5 + SR - td;
  if (tp > 0 && td > 1e-6) { const k = q / td, rl = hypot(lx, lz) || 1, nx = lx / rl * k, nz = lz / rl * k; setHit(nx * ca + nz * sa, dy / td, -nx * sa + nz * ca, tp, ov[0], ov[1], ov[2], 'station'); }
  // spokes
  put(boxPen(lx, dy, lz, 43.5, 0, 0, 22.5, 3, 3), 'station'); put(boxPen(lx, dy, lz, -43.5, 0, 0, 22.5, 3, 3), 'station');
  put(boxPen(lx, dy, lz, 0, 0, 43.5, 3, 3, 22.5), 'station'); put(boxPen(lx, dy, lz, 0, 0, -43.5, 3, 3, 22.5), 'station');
  // solar panels and booms (hub frame)
  for (const sy of [45, -45]) {
    for (const sx of [48.75, -48.75]) { const b = boxPen(dx, dy, dz, sx, sy, 0, 36.25, 0.4, 21); if (b) setHit(b[0], b[1], b[2], b[3], ov[0], ov[1], ov[2], 'station'); }
    const b = boxPen(dx, dy, dz, 0, sy, 0, 47.5, 1.1, 1.1); if (b) setHit(b[0], b[1], b[2], b[3], ov[0], ov[1], ov[2], 'station');
  }
};
const WB = [];
const wreckProbe = (w, i, x, y, z) => {
  const B = WB[i], dx = x - w.pos[0], dy = y - w.pos[1], dz = z - w.pos[2];
  const lx = dx * B[0][0] + dy * B[0][1] + dz * B[0][2], ly = dx * B[1][0] + dy * B[1][1] + dz * B[1][2], lz = dx * B[2][0] + dy * B[2][1] + dz * B[2][2];
  // forward hull: z -7 .. 26, radius 6.5; broken-off aft hull: z -44 .. -20, off to one side
  for (const [ox, oy, z0, z1, r] of [[0, 0, -7, 26, 6.5], [3.8, -3.4, -44, -20, 7]]) {
    const qz = clamp(lz, z0, z1), ex = lx - ox, ey = ly - oy, ez = lz - qz, d = hypot(ex, ey, ez), pen = r + SR - d;
    if (pen > 0) {
      const k = d > 1e-6 ? 1 / d : 0, nl = d > 1e-6 ? [ex * k, ey * k, ez * k] : [0, 1, 0];
      setHit(nl[0] * B[0][0] + nl[1] * B[1][0] + nl[2] * B[2][0], nl[0] * B[0][1] + nl[1] * B[1][1] + nl[2] * B[2][1], nl[0] * B[0][2] + nl[1] * B[1][2] + nl[2] * B[2][2], pen, 0, 0, 0, 'wreck');
    }
  }
};
// the deepest contact at one point; time fraction `s` (0 = start of the step) places the moving obstacles
const probe = (x, y, z, s, dt) => {
  HIT.pen = 0;
  for (let i = 0; i < RK.length; i += 4) sph(x, y, z, RK[i], RK[i + 1], RK[i + 2], RK[i + 3], null, 'rock');
  for (const c of COMETS) { const k = dt * (1 - s); sph(x, y, z, c.pos[0] - c.vel[0] * k, c.pos[1] - c.vel[1] * k, c.pos[2] - c.vel[2] * k, 22, c.vel, 'comet'); }
  WRECKS.forEach((w, i) => { if (WB[i]) wreckProbe(w, i, x, y, z); });
  if (ST.dkFree <= 0 && ST.dk === 0 && hypot(x - STATION.pos[0], y - STATION.pos[1], z - STATION.pos[2]) < 130) stationProbe(x, y, z);
  return HIT.pen > 0;
};
const hurt = (imp, what) => {
  if (imp < 6) return;
  ST.hit++; ST.hitI = ST.hitP = clamp(imp / 260, 0.1, 1); ST.hitM = what === 'station' || what === 'wreck' ? 1 : 0;
  if (ST.hitCool <= 0 && imp > 30) {
    ST.hull = max(ST.hull - (imp - 30) * 0.1, 0); ST.hitCool = 0.3;
    if (ST.hull <= 0) crash(what);
  }
};
// the ship is wrecked: recovery beacon puts it back by Verdant with a damaged hull
const crash = (what) => {
  ST.crash++; ST.hull = 50; ST.alert = `HULL BREACH · ${what === 'planet' ? 'ground impact' : 'collision'} · recovered by beacon`; ST.alertT = 5;
  ST.dk = 0; ST.sv = -1; warpTo(IDX.Verdant); SH.v.set(BODIES[IDX.Verdant].vel);
};
// after the ship has moved from (ax, ay, az) to SH.p: find the first contact along that path and bounce off it
const collide = (ax, ay, az, dt) => {
  const bx = SH.p[0], by = SH.p[1], bz = SH.p[2], len = hypot(bx - ax, by - ay, bz - az);
  gatherRocks(ax, ay, az, bx, by, bz);
  WRECKS.forEach((w, i) => { WB[i] = hypot(w.pos[0] - bx, w.pos[1] - by, w.pos[2] - bz) < 200 + len ? wreckBasis(w, ST.t) : null; });
  const n = clamp(ceil(len / (SR * 0.8)), 1, 80);
  for (let k = 1; k <= n; k++) {
    const s = k / n, x = ax + (bx - ax) * s, y = ay + (by - ay) * s, z = az + (bz - az) * s;
    if (!probe(x, y, z, s, dt)) continue;
    const pen = HIT.pen;
    SH.p[0] = x + HIT.nx * (pen + 0.3); SH.p[1] = y + HIT.ny * (pen + 0.3); SH.p[2] = z + HIT.nz * (pen + 0.3);
    const vx = SH.v[0] - HIT.ox, vy = SH.v[1] - HIT.oy, vz = SH.v[2] - HIT.oz, vn = vx * HIT.nx + vy * HIT.ny + vz * HIT.nz;
    if (vn < 0) {
      const k2 = 1.4 * vn;   // bounce: lose a third of the speed into the obstacle, keep the sideways motion
      SH.v[0] -= HIT.nx * k2; SH.v[1] -= HIT.ny * k2; SH.v[2] -= HIT.nz * k2;
      hurt(-vn, HIT.what);
    }
    return;
  }
};
// docking: the hub has a port at each end; approach slowly with the nose at the port and press F
const dockPose = (s, out) => {   // ship position of the docked pose for port s (+1 top, -1 bottom)
  out[0] = STATION.pos[0]; out[1] = STATION.pos[1] + s * 74; out[2] = STATION.pos[2];
};
const DP = new Float64Array(3);
const dockOffer = () => {   // 0 = nothing nearby, 1 = near the station, 2 = slow down, 3 = can dock; sets ST.dkS
  const dx = SH.p[0] - STATION.pos[0], dy = SH.p[1] - STATION.pos[1], dz = SH.p[2] - STATION.pos[2], d = hypot(dx, dy, dz);
  if (d > 1100) return 0;
  const s = dy >= 0 ? 1 : -1; ST.dkS = s;
  const pd = hypot(dx, dy - s * 66, dz), rv = hypot(SH.v[0] - STATION.vel[0], SH.v[1] - STATION.vel[1], SH.v[2] - STATION.vel[2]);
  if (pd > 320 || s * dy < 70) return 1;
  return rv > DOCK_V ? 2 : 3;
};
const wreckOffer = () => {   // the nearest salvageable wreck in range, or -1
  let best = -1, bd = 170;
  WRECKS.forEach((w, i) => { const d = hypot(SH.p[0] - w.pos[0], SH.p[1] - w.pos[1], SH.p[2] - w.pos[2]); if (d < bd && !ST.salv[i]) { bd = d; best = i; } });
  return best;
};
const interact = () => {
  if (ST.wPh || ST.landed || ST.dk) return;
  if (dockOffer() === 3) { ST.dk = 1; ST.dkT = 0; ST.sv = -1; for (let i = 0; i < 3; i++) DP0[i] = SH.p[i] - STATION.pos[i]; DR0.set(SH.r); DF0.set(SH.f); ST.dock++; return; }
  const w = wreckOffer();
  if (w >= 0 && ST.sv < 0) {
    const rv = hypot(SH.v[0] - WRECKS[w].vel[0], SH.v[1] - WRECKS[w].vel[1], SH.v[2] - WRECKS[w].vel[2]);
    if (rv < 80) { ST.sv = w; ST.svT = 0; }
  }
};
const DP0 = new Float64Array(3), DR0 = new Float64Array(3), DF0 = new Float64Array(3);
const tickDock = (dt, wantOut) => {   // while approaching (dk 1) or docked (dk 2): the ship is carried by the station
  const s = ST.dkS, S = STATION;
  dockPose(s, DP);
  if (ST.dk === 1) {
    ST.dkT += dt; const k = sstep(0, 1, ST.dkT / 4);
    // the start pose is stored relative to the station, so the ship rides along with it
    for (let i = 0; i < 3; i++) SH.p[i] = mix(DP0[i] + S.pos[i], DP[i], k);
    SH.f[0] = mix(DF0[0], 0, k); SH.f[1] = mix(DF0[1], -s, k); SH.f[2] = mix(DF0[2], 0, k);
    SH.r[0] = mix(DR0[0], 0, k); SH.r[1] = mix(DR0[1], 0, k); SH.r[2] = mix(DR0[2], 1, k);
    if (ST.dkT >= 4) { ST.dk = 2; ST.dock++; ST.alert = 'DOCKED · ' + S.name; ST.alertT = 2.5; }
  } else {
    for (let i = 0; i < 3; i++) SH.p[i] = DP[i];
    ST.hull = min(100, ST.hull + 12 * dt);
    if (wantOut) {
      ST.dk = 0; ST.dkFree = 4; ST.cool = 1;
      SH.v[0] = S.vel[0]; SH.v[1] = S.vel[1] + s * 35; SH.v[2] = S.vel[2]; ST.dock++;
      return;
    }
  }
  SH.v[0] = S.vel[0]; SH.v[1] = S.vel[1]; SH.v[2] = S.vel[2];
};
const tickSalvage = (dt) => {
  if (ST.sv < 0) return;
  const w = WRECKS[ST.sv], d = hypot(SH.p[0] - w.pos[0], SH.p[1] - w.pos[1], SH.p[2] - w.pos[2]), rv = hypot(SH.v[0] - w.vel[0], SH.v[1] - w.vel[1], SH.v[2] - w.vel[2]);
  if (d > 260 || rv > 130 || ST.wPh) { ST.sv = -1; ST.alert = 'SALVAGE INTERRUPTED'; ST.alertT = 2; return; }
  ST.svT += dt / 4;
  if (ST.svT >= 1) {
    ST.salv[ST.sv] = 1; ST.cargo++; ST.svDone++; ST.hull = min(100, ST.hull + 25);
    ST.alert = `SALVAGE COMPLETE · ${w.name} · +1 scrap · hull +25`; ST.alertT = 4; ST.sv = -1;
  }
};

// put the ship in a good viewing spot in front of body i, on its sunlit side, looking at it
const warpTo = (i) => {
  const b = typeof i === 'number' ? BODIES[i] : i;      // a planet number, or any object with pos, vel and R
  ST.landed = null; ST.cool = 1;
  let dx = -b.pos[0], dy = -b.pos[1], dz = -b.pos[2], l = hypot(dx, dy, dz);
  if (l < 1) { dx = 1; dy = 0.2; dz = 0.3; l = hypot(dx, dy, dz); }
  dx /= l; dy /= l; dz /= l;
  let sx = -dz, sz = dx;
  const sl = hypot(sx, sz) || 1;
  sx /= sl; sz /= sl;
  let px = dx * 0.8 + sx * 0.5, py = dy * 0.8 + 0.15, pz = dz * 0.8 + sz * 0.5;
  const pl = hypot(px, py, pz);
  px /= pl; py /= pl; pz /= pl;
  const dist = b === BODIES[0] ? b.R * 3.5 : b.R * 4.2 + 150;
  SH.p[0] = b.pos[0] + px * dist; SH.p[1] = b.pos[1] + py * dist; SH.p[2] = b.pos[2] + pz * dist;
  SH.v.set(b.vel);
  const f = SH.f;
  f[0] = b.pos[0] - SH.p[0]; f[1] = b.pos[1] - SH.p[1]; f[2] = b.pos[2] - SH.p[2];
  const fl = vlen(f);
  f[0] /= fl; f[1] /= fl; f[2] /= fl;
  SH.r[0] = -f[2]; SH.r[1] = 0; SH.r[2] = f[0];
  ortho();
};

// one simulation step. playing = false while the menu is up: the ship just circles the nearest planet.
const update = (dt, playing) => {
  ST.t += dt; tickBodies(ST.t); ST.cool = max(ST.cool - dt, 0);
  ST.hitCool = max(ST.hitCool - dt, 0); ST.alertT = max(ST.alertT - dt, 0); ST.dkFree = max(ST.dkFree - dt, 0); ST.hitI *= exp(-dt * 3);
  if (!playing || ST.wPh) IN.act = 0;
  if (IN.act) { IN.act = 0; interact(); }
  // while a warp is charging the ship drives itself at full boost; the player only steers
  const jump = ST.wPh === 1, SENS = SENS0 * CFG.sens / 50;
  const fwd = playing ? (jump ? 1 : IN.fwd) : 0, str = playing ? IN.str : 0, vert = playing ? IN.vert : 0, boost = playing ? (jump ? 1 : IN.boost) : 0;
  // steering: apply a share of the accumulated mouse movement every frame, so it stays smooth at any frame rate
  const kk = 1 - exp(-dt * 16), mx = IN.mx * kk, my = IN.my * kk;
  IN.mx -= mx; IN.my -= my;
  if (playing) {
    if (mx) turn(SH.u, -mx * SENS);
    if (!ST.landed && my) turn(SH.r, -my * SENS * (CFG.inv ? -1 : 1));
    if (!ST.landed && IN.roll) turn(SH.f, IN.roll * dt * 1.5);
  } else IN.mx = IN.my = 0;

  // the nearest body, by altitude relative to its size
  let best = 1e30, nb = BODIES[0], ox = 0, oy = 0, oz = 0, nd = 1;
  for (const b of BODIES) {
    const x = SH.p[0] - b.pos[0], y = SH.p[1] - b.pos[1], z = SH.p[2] - b.pos[2], d = hypot(x, y, z), sc = (d - b.R) / b.R;
    if (sc < best) { best = sc; nb = b; ox = x; oy = y; oz = z; nd = d; }
  }
  ST.nb = nb; ST.dist = nd;
  ST.up[0] = ox / nd; ST.up[1] = oy / nd; ST.up[2] = oz / nd;
  const alt = nd - groundR(nb, ox, oy, oz);
  ST.alt = alt;

  const fv = ST.fv, w = 1 - sstep(nb.R * 6, nb.R * 20, nd);   // how much we move along with the nearest body
  fv[0] = nb.vel[0] * w; fv[1] = nb.vel[1] * w; fv[2] = nb.vel[2] * w;
  let thrTarget = 0;

  if (ST.landed) {
    const b = ST.landed, c = cos(b.spinW * dt), s = sin(b.spinW * dt);
    rotAx(LO, 0, 1, 0, c, s); rotAx(SH.r, 0, 1, 0, c, s); rotAx(SH.u, 0, 1, 0, c, s); rotAx(SH.f, 0, 1, 0, c, s);
    const k = (groundR(b, LO[0], LO[1], LO[2]) + HOVER) / vlen(LO);
    LO[0] *= k; LO[1] *= k; LO[2] *= k;
    for (let i = 0; i < 3; i++) SH.p[i] = b.pos[i] + LO[i];
    SH.v[0] = b.vel[0] + b.spinW * LO[2]; SH.v[1] = b.vel[1]; SH.v[2] = b.vel[2] - b.spinW * LO[0];
    groundN(b, LO[0], LO[1], LO[2], TN);
    align(TN[0], TN[1], TN[2], 3 * dt);
    if (playing && (fwd > 0 || vert > 0 || boost)) {   // take off
      const l = vlen(LO);
      SH.v[0] = b.vel[0] + LO[0] / l * 40; SH.v[1] = b.vel[1] + LO[1] / l * 40; SH.v[2] = b.vel[2] + LO[2] / l * 40;
      ST.landed = null; ST.cool = 1.5;
    }
  } else if (ST.dk) {
    tickDock(dt, playing && ST.dk === 2 && (fwd > 0 || vert > 0 || boost));
  } else {
    const px0 = SH.p[0], py0 = SH.p[1], pz0 = SH.p[2];
    // thrust target, relative to the nearest body's motion
    const spd = 380 * (boost ? 8.5 : 1);
    let tx = (SH.f[0] * fwd + SH.r[0] * str * 0.6 + SH.u[0] * vert * 0.6) * spd;
    let ty = (SH.f[1] * fwd + SH.r[1] * str * 0.6 + SH.u[1] * vert * 0.6) * spd;
    let tz = (SH.f[2] * fwd + SH.r[2] * str * 0.6 + SH.u[2] * vert * 0.6) * spd;
    thrTarget = min(1, hypot(fwd, str * 0.6, vert * 0.6)) * (boost ? 1.8 : 1);
    const lim = nd < nb.R * 8 ? 60 + max(alt, 0) * 0.9 : 1e9, tl = hypot(tx, ty, tz);
    if (tl > lim) { const k = lim / tl; tx *= k; ty *= k; tz *= k; }
    const brake = playing && IN.brake;
    if (brake) { tx = ty = tz = 0; thrTarget = 0; }
    const ease = 1 - exp(-(brake ? 5 : 1.8) * dt);
    let rx = SH.v[0] - fv[0], ry = SH.v[1] - fv[1], rz = SH.v[2] - fv[2];
    rx += (tx - rx) * ease; ry += (ty - ry) * ease; rz += (tz - rz) * ease;
    if (nb.i !== 0 && nd < nb.R * 10) {   // gravity (the sun's pull is left out so nobody gets trapped by it)
      const g = 38 * (nb.R / nd) * (nb.R / nd) * dt;
      rx -= ST.up[0] * g; ry -= ST.up[1] * g; rz -= ST.up[2] * g;
    }
    SH.v[0] = rx + fv[0]; SH.v[1] = ry + fv[1]; SH.v[2] = rz + fv[2];
    SH.p[0] += SH.v[0] * dt; SH.p[1] += SH.v[1] * dt; SH.p[2] += SH.v[2] * dt;
    // near solid ground: level the ship with the slope
    if (nb.solid && alt < 120) { groundN(nb, ox, oy, oz, TN); align(TN[0], TN[1], TN[2], 1.2 * dt * (1 - alt / 120)); }

    // ground contact
    ST.noSolid = max(ST.noSolid - dt, 0);
    for (const b of BODIES) {
      const x = SH.p[0] - b.pos[0], y = SH.p[1] - b.pos[1], z = SH.p[2] - b.pos[2], d = hypot(x, y, z);
      if (d > b.R + b.amp + HOVER + 4) continue;
      const pen = groundR(b, x, y, z) + HOVER - d;
      if (pen <= 0) continue;
      const nx = x / d, ny = y / d, nz = z / d;
      let vx = SH.v[0] - b.vel[0], vy = SH.v[1] - b.vel[1], vz = SH.v[2] - b.vel[2];
      const vn = vx * nx + vy * ny + vz * nz, vt = sqrt(max(vx * vx + vy * vy + vz * vz - vn * vn, 0));
      SH.p[0] += nx * pen; SH.p[1] += ny * pen; SH.p[2] += nz * pen;
      if (b.solid && ST.cool <= 0 && vn > -45 && vt < 55) {   // gentle enough: touch down
        ST.landed = b;
        LO[0] = SH.p[0] - b.pos[0]; LO[1] = SH.p[1] - b.pos[1]; LO[2] = SH.p[2] - b.pos[2];
        SH.v.set(b.vel);
        break;
      }
      if (vn < 0) { if (playing) hurt(-vn, 'planet'); vx -= nx * vn * 1.15; vy -= ny * vn * 1.15; vz -= nz * vn * 1.15; }
      SH.v[0] = vx + b.vel[0]; SH.v[1] = vy + b.vel[1]; SH.v[2] = vz + b.vel[2];
      if (!b.solid) ST.noSolid = 3;
    }
    if (playing && !ST.wPh) collide(px0, py0, pz0, dt);
  }
  tickSalvage(dt);
  ortho();
  ST.thr += (thrTarget - ST.thr) * (1 - exp(-dt * 6));
  ST.boostA += ((boost && !ST.landed ? 1 : 0) - ST.boostA) * (1 - exp(-dt * 2.5));
  ST.strk[0] = SH.v[0] - fv[0]; ST.strk[1] = SH.v[1] - fv[1]; ST.strk[2] = SH.v[2] - fv[2];
  ST.speed = vlen(ST.strk);

  // sky of the nearest planet: how much atmosphere we are inside, and how bright the day is up here
  ST.skyS = 0;
  if (nb.atm && nb.i !== 0) {
    const th = nb.R * nb.atm[3];
    ST.skyS = pow(clamp(1 - ST.alt / (th * 1.5), 0, 1), 0.7);
    const sl = hypot(nb.pos[0], nb.pos[1], nb.pos[2]) || 1;
    const day = clamp(-(ST.up[0] * nb.pos[0] + ST.up[1] * nb.pos[1] + ST.up[2] * nb.pos[2]) / sl * 2 + 0.3, 0.02, 1);
    ST.sky[0] = nb.atm[0] * day; ST.sky[1] = nb.atm[1] * day; ST.sky[2] = nb.atm[2] * day;
  }
  // message for the bottom of the screen
  const dko = ST.dk || ST.landed || ST.wPh ? 0 : dockOffer(), wo = ST.dk || ST.landed || ST.wPh ? -1 : wreckOffer();
  ST.msg = ST.alertT > 0 ? ST.alert
    : ST.dk === 1 ? 'DOCKING · automated approach'
    : ST.dk === 2 ? `DOCKED AT ${STATION.name.toUpperCase()} · hull repairing · hold W to undock`
    : ST.sv >= 0 ? `SALVAGING ${WRECKS[ST.sv].name.toUpperCase()} · ${(ST.svT * 100) | 0}% · stay close and slow`
    : ST.landed ? `LANDED ON ${ST.landed.name.toUpperCase()} · hold W or Space to take off`
    : dko === 3 ? `PRESS F TO DOCK · ${STATION.name}`
    : dko === 2 ? `${STATION.name.toUpperCase()} · slow down to dock (below ${DOCK_V} u/s)`
    : dko === 1 && hypot(SH.p[0] - STATION.pos[0], SH.p[1] - STATION.pos[1], SH.p[2] - STATION.pos[2]) < 700 ? `${STATION.name.toUpperCase()} · line up with a docking port at either end of the hub`
    : wo >= 0 ? `PRESS F TO SALVAGE · ${WRECKS[wo].name}`
    : ST.noSolid > 0 ? 'NO SOLID SURFACE · gas giants and the sun can not be landed on'
    : nb.solid && ST.alt < 220 && ST.speed < 140 ? 'ease off the throttle to descend and land' : '';
};

// camera orientation: follows the ship with a short lag in third person (so turning feels weighty), exactly in the cockpit
const CB = { r: new Float64Array([1, 0, 0]), u: new Float64Array([0, 1, 0]), f: new Float64Array([0, 0, -1]) };
const snapCam = () => { CB.r.set(SH.r); CB.u.set(SH.u); CB.f.set(SH.f); };
// camera position, written to ST.cam; orientation is CB
const placeCamera = (dt, cockpit) => {
  const k = cockpit ? 1 : 1 - exp(-dt * 9), f = CB.f, u = CB.u, r = CB.r;
  for (let i = 0; i < 3; i++) { f[i] += (SH.f[i] - f[i]) * k; u[i] += (SH.u[i] - u[i]) * k; }
  let l = vlen(f);
  f[0] /= l; f[1] /= l; f[2] /= l;
  const d = u[0] * f[0] + u[1] * f[1] + u[2] * f[2];
  u[0] -= f[0] * d; u[1] -= f[1] * d; u[2] -= f[2] * d;
  l = vlen(u);
  u[0] /= l; u[1] /= l; u[2] /= l;
  r[0] = f[1] * u[2] - f[2] * u[1]; r[1] = f[2] * u[0] - f[0] * u[2]; r[2] = f[0] * u[1] - f[1] * u[0];
  const landed = !!ST.landed, want = cockpit ? 0 : landed ? 26 : 15 + 7 * min(ST.speed / 1500, 1) + 1.2 * min(ST.thr, 1.8) + 4 * ST.warp;
  ST.camD += (want - ST.camD) * (1 - exp(-dt * 4));
  const up = cockpit ? 0.7 : landed ? 9 : 3.6;
  for (let i = 0; i < 3; i++) ST.cam[i] = SH.p[i] + (cockpit ? SH.f[i] * 1.6 + SH.u[i] * up : -f[i] * ST.camD + u[i] * up);
};

// ---------------------------------------------------------------- warp jump
// Charging (1.3 s): stars stretch, the field of view opens up, the ship drives itself forward. At the peak the ship is
// moved next to the destination under cover of a flash, then the effect eases away over 1.7 s.
const W_IN = 1.3, W_OUT = 1.7;
const startWarp = (i) => { if (ST.wPh) return false; ST.wPh = 1; ST.wT = 0; ST.wDest = i; return true; };
const tickWarp = (dt) => {
  ST.flash = 0;
  if (!ST.wPh) { ST.warp = 0; return; }
  ST.wT += dt;
  if (ST.wPh === 1) {
    const x = min(ST.wT / W_IN, 1);
    ST.warp = sstep(0, 1, x);
    ST.flash = 0.18 * sstep(0.8, 1, x);
    if (x >= 1) { warpTo(ST.wDest); snapCam(); ST.wPh = 2; ST.wT = 0; ST.wev++; ST.flash = 0.18; }
  } else {
    const x = min(ST.wT / W_OUT, 1);
    ST.warp = 1 - sstep(0, 1, x);
    ST.flash = 0.18 * exp(-ST.wT * 5);
    if (x >= 1) { ST.wPh = 0; ST.warp = 0; }
  }
};

// ---------------------------------------------------------------- saved games
const snapshot = () => ({
  v: 1, ts: Date.now(), t: ST.t, p: [...SH.p], vel: [...SH.v], r: [...SH.r], u: [...SH.u], f: [...SH.f],
  landed: ST.landed ? ST.landed.i : -1, lo: [...LO], near: ST.nb.name, alt: max(ST.alt, 0) | 0,
  hull: ST.hull, cargo: ST.cargo, salv: [...ST.salv],
});
const restore = (s) => {
  ST.t = s.t; tickBodies(ST.t);
  SH.p.set(s.p); SH.v.set(s.vel); SH.r.set(s.r); SH.u.set(s.u); SH.f.set(s.f); ortho();
  ST.landed = s.landed >= 0 ? BODIES[s.landed] : null; LO.set(s.lo);
  ST.cool = 1; ST.wPh = 0; ST.warp = 0; ST.flash = 0; ST.thr = ST.boostA = 0; ST.camD = 15; IN.mx = IN.my = 0;
  ST.hull = s.hull ?? 100; ST.cargo = s.cargo ?? 0; ST.salv = [0, 1, 2].map((i) => (s.salv && s.salv[i]) | 0); ST.dk = 0; ST.sv = -1; ST.alertT = 0; ST.dkFree = 0;
  snapCam();
};
const newGame = () => {
  ST.t = 0; tickBodies(0); warpTo(IDX.Verdant);
  ST.wPh = 0; ST.warp = 0; ST.flash = 0; ST.thr = ST.boostA = 0; ST.camD = 15; IN.mx = IN.my = 0;
  ST.hull = 100; ST.cargo = 0; ST.salv = [0, 0, 0]; ST.dk = 0; ST.sv = -1; ST.alertT = 0; ST.dkFree = 0;
  snapCam();
};
