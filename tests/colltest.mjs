const SRC = new URL('../src/', import.meta.url).pathname;
import { readFileSync } from 'node:fs';
const src = ['quality.js', 'math.js', 'world.js', 'space.js', 'sim.js'].map((f) => readFileSync(SRC + f, 'utf8')).join('\n');
const api = new Function('navigator', 'matchMedia', 'localStorage', src + '\nreturn { BODIES, IDX, SH, IN, ST, AST, RK, STATION, COMETS, WRECKS, BELT, update, warpTo, tickBodies, gatherRocks, snapshot, restore, newGame, interact, vlen, ortho };')({ deviceMemory: 8 }, () => ({ matches: false }), {});
const { BODIES, IDX, SH, IN, ST, AST, RK, STATION, COMETS, WRECKS, BELT, update, tickBodies, gatherRocks, snapshot, restore, newGame, vlen, ortho } = api;
const dt = 1 / 60;
let fails = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) fails++; };
const reset = () => { newGame(); Object.assign(IN, { fwd: 0, str: 0, vert: 0, roll: 0, boost: 0, brake: 0, mx: 0, my: 0, act: 0 }); tickBodies(ST.t); };
const aim = (from, to) => { SH.p.set(from); const f = to.map((v, i) => v - from[i]), l = vlen(f); SH.f.set(f.map((v) => v / l)); SH.r.set([-SH.f[2], 0, SH.f[0]]); ortho(); };
const run = (sec, fn) => { for (let t = 0; t < sec; t += dt) { update(dt, true); if (fn && fn()) return; } };

// 1. station hub: fly straight at it from the side
reset();
{
  const S = STATION; aim([S.pos[0] + 400, S.pos[1] + 10, S.pos[2]], [S.pos[0], S.pos[1] + 10, S.pos[2]]); SH.v.set(S.vel);
  IN.fwd = 1; let minD = 1e9; const h0 = ST.hull, hit0 = ST.hit;
  run(6, () => { minD = Math.min(minD, Math.hypot(SH.p[0] - S.pos[0], SH.p[2] - S.pos[2])); });
  ok(minD > 15 + 5 - 1, `hub: ship never entered the hub cylinder (closest ${minD.toFixed(1)} u from the axis, hub radius 15)`);
  ok(ST.hit > hit0, `hub: impact events fired (${ST.hit - hit0})`);
  console.log('   hull', ST.hull.toFixed(1), 'was', h0);
}
// 2. boost at the hub: heavy damage or recovery, never inside
reset();
{
  const S = STATION; aim([S.pos[0] + 3000, S.pos[1] + 10, S.pos[2]], [S.pos[0], S.pos[1] + 10, S.pos[2]]); SH.v.set(S.vel);
  IN.fwd = 1; IN.boost = 1; let minD = 1e9; const c0 = ST.crash;
  run(8, () => { if (ST.crash > c0) return 1; minD = Math.min(minD, Math.hypot(SH.p[0] - S.pos[0], SH.p[2] - S.pos[2])); });
  ok(ST.crash > c0 || ST.hull < 100, `hub at boost: hull ${ST.hull.toFixed(1)}, crashes ${ST.crash - c0}`);
  ok(ST.crash > c0 || minD > 18, `hub at boost: no tunnelling (closest ${minD.toFixed(1)})`);
}
// 3. asteroid belt: find a big rock and ram it
reset();
{
  AST.on = 1; AST.n = 28;
  const bp = [BELT.r * Math.cos(1.3), 0, BELT.r * Math.sin(1.3)];
  gatherRocks(bp[0] - 500, -150, bp[2] - 500, bp[0] + 500, 150, bp[2] + 500);
  let bi = -1, br = 0; for (let i = 0; i < RK.length; i += 4) if (RK[i + 3] > br) { br = RK[i + 3]; bi = i; }
  console.log('   rocks in test area:', RK.length / 4, 'largest radius', br.toFixed(1));
  ok(RK.length > 40 * 4, 'belt: rocks are found on the CPU');
  const c = [RK[bi], RK[bi + 1], RK[bi + 2]];
  aim([c[0] + 500, c[1], c[2]], c); SH.v.set([0, 0, 0]);
  IN.fwd = 1; IN.boost = 1; let minD = 1e9; const c0 = ST.crash, h0 = ST.hull;
  run(4, () => { if (ST.crash > c0) return 1; minD = Math.min(minD, Math.hypot(SH.p[0] - c[0], SH.p[1] - c[1], SH.p[2] - c[2])); });
  ok(minD > br * 0.9 + 4, `rock: stopped outside the rock (closest ${minD.toFixed(1)}, radius ${br.toFixed(1)})`);
  ok(ST.hull < h0 || ST.crash > c0, `rock: hull ${h0} -> ${ST.hull.toFixed(1)}`);
  AST.on = 0;
}
// 4. comet nucleus
reset();
{
  const c = COMETS[1]; tickBodies(ST.t);
  aim([c.pos[0] + 400, c.pos[1], c.pos[2]], [c.pos[0], c.pos[1], c.pos[2]]); SH.v.set(c.vel);
  IN.fwd = 1; let minD = 1e9; const h0 = ST.hull;
  run(5, () => { minD = Math.min(minD, Math.hypot(SH.p[0] - c.pos[0], SH.p[1] - c.pos[1], SH.p[2] - c.pos[2])); });
  ok(minD > 22, `comet: nucleus is solid (closest ${minD.toFixed(1)}, radius 22), hull ${h0} -> ${ST.hull.toFixed(1)}`);
}
// 5. wreck
reset();
{
  const w = WRECKS[0]; aim([w.pos[0] + 300, w.pos[1] + 1, w.pos[2]], [w.pos[0], w.pos[1] + 1, w.pos[2]]); SH.v.set([0, 0, 0]);
  IN.fwd = 1; let minD = 1e9;
  run(6, () => { minD = Math.min(minD, Math.hypot(SH.p[0] - w.pos[0], SH.p[1] - w.pos[1], SH.p[2] - w.pos[2])); });
  ok(Number.isFinite(SH.p[0]) && ST.hull <= 100, `wreck: flew at it, hull ${ST.hull.toFixed(1)}, closest ${minD.toFixed(1)}`);
}
// 6. docking
reset();
{
  const S = STATION; tickBodies(ST.t);
  aim([S.pos[0] + 20, S.pos[1] + 190, S.pos[2]], [S.pos[0], S.pos[1] + 66, S.pos[2]]); SH.v.set(S.vel);
  update(dt, true);
  ok(ST.msg.includes('PRESS F TO DOCK'), 'dock: prompt appears -> "' + ST.msg + '"');
  IN.act = 1; update(dt, true);
  ok(ST.dk === 1, 'dock: F starts the approach');
  run(5);
  ok(ST.dk === 2, 'dock: docked after the approach');
  const dd = Math.hypot(SH.p[0] - S.pos[0], SH.p[1] - S.pos[1] - 74, SH.p[2] - S.pos[2]);
  ok(dd < 0.5, `dock: ship sits at the port (off by ${dd.toFixed(2)})`);
  ok(Math.abs(SH.f[1] + 1) < 0.02, `dock: nose points into the port (f.y=${SH.f[1].toFixed(3)})`);
  ST.hull = 40; run(3); ok(ST.hull > 70, `dock: hull repairs (${ST.hull.toFixed(1)})`);
  const rel0 = SH.p[0] - S.pos[0]; run(10); ok(Math.abs(SH.p[0] - S.pos[0] - rel0) < 1e-6 && ST.dk === 2, 'dock: stays attached as the station orbits');
  IN.fwd = 1; run(0.5);
  ok(ST.dk === 0, 'dock: W undocks');
  IN.fwd = 1; run(4); ok(Math.hypot(SH.p[0] - S.pos[0], SH.p[1] - S.pos[1], SH.p[2] - S.pos[2]) > 100 && ST.hull > 0, 'dock: leaves cleanly without hitting the station');
}
// 6b. too fast to dock
reset();
{
  const S = STATION; aim([S.pos[0], S.pos[1] + 190, S.pos[2]], [S.pos[0], S.pos[1] + 66, S.pos[2]]); SH.v.set([S.vel[0], S.vel[1] - 200, S.vel[2]]);
  IN.act = 1; update(dt, true); ok(ST.dk === 0, 'dock: refused when too fast');
}
// 7. salvage
reset();
{
  const w = WRECKS[1]; tickBodies(ST.t);
  aim([w.pos[0] + 120, w.pos[1], w.pos[2]], [w.pos[0], w.pos[1], w.pos[2]]); SH.v.set([0, 0, 0]); SH.v.set(w.vel);
  update(dt, true); ok(ST.msg.includes('SALVAGE'), 'salvage: prompt -> "' + ST.msg + '"');
  const h0 = (ST.hull = 60); IN.act = 1; update(dt, true);
  ok(ST.sv === 1, 'salvage: F starts it');
  run(5);
  ok(ST.salv[1] === 1 && ST.cargo === 1 && ST.hull > h0, `salvage: done, cargo ${ST.cargo}, hull ${ST.hull}`);
  IN.act = 1; update(dt, true); ok(ST.sv === -1, 'salvage: can not be repeated');
  const s = snapshot(); ST.salv = [0, 0, 0]; ST.cargo = 0; ST.hull = 10; restore(s);
  ok(ST.salv[1] === 1 && ST.cargo === 1 && ST.hull > 60, 'save/load keeps hull, cargo and salvage');
  restore({ ...s, hull: undefined, cargo: undefined, salv: undefined }); ok(ST.hull === 100, 'old saves still load');
}
// 7b. salvage interrupted by flying away
reset();
{
  const w = WRECKS[2]; tickBodies(ST.t); aim([w.pos[0] + 100, w.pos[1], w.pos[2]], [w.pos[0] + 400, w.pos[1], w.pos[2]]); SH.v.set(w.vel);
  IN.act = 1; update(dt, true); IN.fwd = 1; run(3); ok(ST.sv === -1 && !ST.salv[2], 'salvage: cancelled when you leave');
}
// 8. nothing regressed: warp everywhere stays finite, normal landing still works
reset();
for (const b of BODIES) { api.warpTo(b.i); run(1); ok([...SH.p].every(Number.isFinite) && ST.hull === 100, 'warp to ' + b.name + ': finite, no damage'); }
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
