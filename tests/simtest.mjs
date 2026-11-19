const SRC = new URL('../src/', import.meta.url).pathname;
import { readFileSync } from 'node:fs';
globalThis.matchMedia = () => ({ matches: false });
globalThis.localStorage = {};
const src = ['quality.js', 'math.js', 'world.js', 'space.js', 'sim.js'].map((f) => readFileSync(SRC + f, 'utf8')).join('\n');
const api = new Function('navigator', src + '\nreturn { BODIES, IDX, SH, IN, ST, update, warpTo, tickBodies, groundR, terrain, placeCamera, vlen };')({ deviceMemory: 8 });
const { BODIES, IDX, SH, IN, ST, update, warpTo, tickBodies, groundR, vlen } = api;
const dt = 1 / 60;
const log = (tag) => console.log(tag.padEnd(26), `t=${ST.t.toFixed(1).padStart(6)}  near=${ST.nb.name.padEnd(8)} alt=${ST.alt.toFixed(1).padStart(8)}  speed=${ST.speed.toFixed(1).padStart(7)}  landed=${ST.landed ? ST.landed.name : '-'}`);

// 1. terrain sanity on every solid body
for (const b of BODIES.filter((b) => b.solid)) {
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < 4000; i++) {
    const th = Math.acos(2 * ((i * 0.618034) % 1) - 1), ph = i * 2.399963;
    const r = groundR(b, Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
    lo = Math.min(lo, r - b.R); hi = Math.max(hi, r - b.R);
  }
  console.log(`terrain ${b.name.padEnd(8)} height range ${lo.toFixed(2)} .. ${hi.toFixed(2)} (amp ${b.amp.toFixed(1)})`);
}

// 2. fly to Verdant, hold W, then release and land
tickBodies(0); warpTo(IDX.Verdant);
Object.assign(IN, { fwd: 0, str: 0, vert: 0, roll: 0, boost: 0, brake: 0, mx: 0, my: 0 });
update(dt, true); log('start (warp)');
IN.fwd = 1;
let t = 0, released = false;
for (; t < 200 && !ST.landed; t += dt) {
  if (ST.alt < 150 && !released) { IN.fwd = 0; released = true; log('release throttle'); }
  update(dt, true);
  if (Math.round(t * 60) % 300 === 0) log('flying');
}
log('result');
const L = ST.landed;
console.log('LANDED:', !!L, L && L.name);
if (L) {
  // 3. stay landed while the planet spins/orbits: check altitude and distance to the planet stay constant
  const d0 = vlen(SH.p.map((v, i) => v - L.pos[i]));
  for (let k = 0; k < 600; k++) update(dt, true);
  const d1 = vlen(SH.p.map((v, i) => v - L.pos[i]));
  console.log(`after 10 s on the ground: centre distance ${d0.toFixed(2)} -> ${d1.toFixed(2)}, still landed: ${ST.landed === L}, ship up.dot(planet-up)=${(SH.u[0]*ST.up[0]+SH.u[1]*ST.up[1]+SH.u[2]*ST.up[2]).toFixed(3)}`);
  // 4. take off
  IN.vert = 1;
  for (let k = 0; k < 240; k++) { update(dt, true); if (k % 60 === 59) log('takeoff'); }
  IN.vert = 0;
  console.log('airborne again:', !ST.landed);
}
// 5. warp to every body: nothing should crash, NaN or put us inside a planet
for (let i = 0; i < BODIES.length; i++) {
  warpTo(i); for (let k = 0; k < 120; k++) update(dt, false);
  const bad = [...SH.p, ...SH.v, ...SH.f, ...SH.u, ...SH.r].some((v) => !Number.isFinite(v));
  console.log(`warp ${BODIES[i].name.padEnd(8)} alt=${ST.alt.toFixed(0).padStart(6)} finite=${!bad} landed=${!!ST.landed}`);
}
// 6. sun approach with boost: must be pushed back, never inside
warpTo(0); IN.fwd = 1; IN.boost = 1;
let minAlt = 1e9;
for (let k = 0; k < 60 * 30; k++) { update(dt, true); minAlt = Math.min(minAlt, ST.alt); }
console.log('sun dive: minimum altitude', minAlt.toFixed(1), '(>= about -', 'HOVER means it was held out)');
