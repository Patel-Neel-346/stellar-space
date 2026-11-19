// ============================================================================
// settings: graphics, game and audio, all kept in localStorage
// ============================================================================
// GP = the graphics settings as chosen in the menu (saved at once). GS = what this page load was built with. Resolution,
// bloom and particle density apply live; anti-aliasing, nebula, planet and terrain-map quality need the scene rebuilt
// (the menu offers a restart for those), so everything derived from them below reads GS.
//   p: preset 0 Low, 1 Medium, 2 High, 3 Ultra, 4 Custom
//   res: render scale in percent    aa: 0 off, 1 MSAA 4x    bloom: 0 off, 1 low, 2 high
//   nebula / planet / tex / amb: 0..3
// stellarLoad is set while the scene is built; still set on the next visit means that load crashed the tab, so the
// preset is lowered one step.
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
const load = (k, d) => { try { return { ...d, ...JSON.parse(localStorage[k]) }; } catch { return { ...d }; } };
const PRESETS = [
  { res: 70, aa: 0, bloom: 0, nebula: 0, planet: 0, tex: 0, amb: 0, veg: 1, ast: 1 },
  { res: 85, aa: 0, bloom: 1, nebula: 1, planet: 1, tex: 1, amb: 1, veg: 2, ast: 2 },
  { res: 100, aa: 1, bloom: 2, nebula: 2, planet: 2, tex: 2, amb: 2, veg: 3, ast: 3 },
  { res: 100, aa: 1, bloom: 2, nebula: 3, planet: 3, tex: 3, amb: 3, veg: 4, ast: 4 },
];
const GKEYS = ['res', 'aa', 'bloom', 'nebula', 'planet', 'tex', 'amb', 'veg', 'ast'];
let bad; try { bad = localStorage.stellarLoad; } catch {}
const p0 = mob || mem <= 4 ? 0 : 2;
let GP = load('stellarGfx', { p: p0, ...PRESETS[p0] });
if (!(GP.p >= 0 && GP.p <= 4)) GP = { p: p0, ...PRESETS[p0] };
if (bad && GP.p > 0) { const p = min4(GP.p === 4 ? 2 : GP.p - 1); GP = { p, ...PRESETS[p] }; }
function min4(x) { return x > 3 ? 3 : x < 0 ? 0 : x; }
const gfxSave = () => keep('stellarGfx', JSON.stringify(GP));
gfxSave();
const GS = { ...GP };
// scene detail, fixed for this page load
const NHI = [64, 112, 160, 224][GS.planet], NMID = [40, 64, 80, 112][GS.planet], NLO = [20, 32, 40, 56][GS.planet];
const AA = GS.aa ? 4 : 1, SKYN = [512, 768, 1024, 1280][GS.nebula], NEBX = [0, 0, 1, 2][GS.nebula], HS = [256, 384, 512, 1024][GS.tex];
const MAXPIX = [2.1e6, 3.7e6, 3.7e6, 8.3e6][GS.p > 3 ? 2 : GS.p];
// live (read every frame): particle count and bloom strength by level
const DUSTN = [1200, 3000, 5500, 9000], BLOOMK = [0, 0.15, 0.26], VEGN = [0, 20, 28, 36, 48], ASTN = [0, 22, 28, 34, 42];   // VEGN: grid cells per side of the prop field

// game settings and audio levels
let CFG = load('stellarCfg', { sens: 50, inv: 0, fov: 70, shake: 1, stats: 0 });
let AUD = load('stellarAud', { master: 0.8, amb: 0.8, eng: 0.8, ui: 0.8, mute: 0 });
const cfgSave = () => keep('stellarCfg', JSON.stringify(CFG));
const audSave = () => keep('stellarAud', JSON.stringify(AUD));
