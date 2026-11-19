const SRC = new URL('../src/', import.meta.url).pathname;
import { readFileSync } from 'fs';
const src = ['quality.js', 'math.js', 'world.js', 'space.js', 'sim.js'].map((f) => readFileSync(SRC + f, 'utf8')).join('\n');
const body = src + `
tickBodies(1234);
console.log('comets', COMETS.map((c) => c.name + ' dist=' + (c.dist | 0) + ' v=' + hypot(...c.vel).toFixed(1)).join(' | '), '| station', [...STATION.pos].map((v) => v | 0));
for (const k in POI_KEYS) { warpTo(POI_KEYS[k]); console.log('warp', k, POI_KEYS[k].name, 'finite', [...SH.p].every(Number.isFinite)); }
const m = buildStation(), w = buildWreck(1), rk = buildRock(), sh = buildShip();
console.log('meshes: hub', m.hub.length / 10, 'ring', m.ring.length / 10, 'wreck', w.length / 10, 'rock', rk.length / 3, 'ship', sh.length / 10, [m.hub, m.ring, w, rk, sh].every((a) => a.every(Number.isFinite)));
// comet distance over a full orbit: perihelion must stay clear of the sun
let lo = 1e9; for (let t = 0; t < 9000; t += 20) { tickBodies(t); lo = Math.min(lo, COMETS[0].dist); } console.log('Aurelia perihelion', lo | 0, 'sun radius', SUN_R);
`;
const g = { matchMedia: () => ({ matches: false }), navigator: {}, localStorage: {}, console };
new Function(...Object.keys(g), body)(...Object.values(g));
