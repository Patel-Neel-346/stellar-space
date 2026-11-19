// ============================================================================
// renderer (HDR scene -> bloom -> composite), menus, input and the frame loop
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
const say = (m, to) => { $('s').textContent = m; $('b').style.transform = `scaleX(${to})`; return new Promise((r) => setTimeout(r, 30)); };
const fail = (m) => { throw new Error(m, { cause: 1 }); }; // cause marks a message that is shown as it is
// read by the sound code (src/audio.js)
// what the audio code listens to: continuous levels, and counters that go up once per event (impact, dock, ...)
const SND = { spd: 0, thr: 0, atm: 0, landed: false, boost: 0, warp: 0, ev: 0, hit: 0, hitP: 0, hitM: 0, dock: 0, gear: 0, crash: 0, hull: 100, beam: 0, beamP: 0, grd: 0, bio: -1, entry: 0, say: null };

if (!navigator.gpu) fail('This game needs WebGPU. Try a current Chrome or Edge.');
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU adapter found.');
$('w').hidden = !!navigator.userAgentData;
const device = await adapter.requestDevice();
device.addEventListener('uncapturederror', (e) => console.error('GPU: ' + e.error.message));
let dead;
device.lost.then((l) => {
  if (l.reason === 'destroyed') return;
  dead = body.className = 'l e'; $('s').textContent = 'The graphics device was lost. Reload the page to try again.';
});
keep('stellarLoad', 1); // cleared after the first frame; still set next time = this load crashed
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat(), DEPTH = 'depth32float', HDR = 'rgba16float';
ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
const Q = device.queue, BU = GPUBufferUsage, TU = GPUTextureUsage, VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, FS = GPUShaderStage.FRAGMENT;

await say('Building the solar system…', 0.15);
// ---------------------------------------------------------------- uniforms, bind groups
const ubuf = (size) => device.createBuffer({ size, usage: BU.UNIFORM | BU.COPY_DST });
const bglU = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: VF, buffer: {} }] });
const layG = device.createPipelineLayout({ bindGroupLayouts: [bglU] });
const layGP = device.createPipelineLayout({ bindGroupLayouts: [bglU, bglU] });
const bglH = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: GPUShaderStage.VERTEX, texture: { viewDimension: '2d-array' } },
  { binding: 1, visibility: GPUShaderStage.VERTEX, sampler: {} },
] });
const layPl = device.createPipelineLayout({ bindGroupLayouts: [bglU, bglU, bglH] });
const layHB = device.createPipelineLayout({ bindGroupLayouts: [bglU, bglU, bglU] });
const bgOf = (buffer) => device.createBindGroup({ layout: bglU, entries: [{ binding: 0, resource: { buffer } }] });
const GF = new Float32Array(40), uboG = ubuf(160), bgG = bgOf(uboG);      // per frame
const SU = new Float32Array(20), uboS = ubuf(80), bgS = bgOf(uboS);        // ship
const GL = new Float32Array(192), uboL = ubuf(768), bgL = bgOf(uboL);      // glows (16 sprites)
const PPF = new Float32Array(8), uboP = ubuf(32);                          // post
const VUF = new Float32Array(16), uboV = ubuf(64), bgV = bgOf(uboV);       // surface props
const veg = buildVeg(), vegBuf = device.createBuffer({ size: veg.data.byteLength, usage: BU.VERTEX | BU.COPY_DST });
Q.writeBuffer(vegBuf, 0, veg.data);
// space objects: station (hub + turning ring), wrecks, asteroid layers, comet nuclei and tails
const vbuf2 = (arr) => { const b = device.createBuffer({ size: arr.byteLength, usage: BU.VERTEX | BU.COPY_DST }); Q.writeBuffer(b, 0, arr); return b; };
const stationM = buildStation(), vbHub = vbuf2(stationM.hub), vbRing = vbuf2(stationM.ring), rockM = buildRock(), vbRock = vbuf2(rockM);
const wreckV = [1, 2, 3].map((k) => { const m = buildWreck(k); return { vb: vbuf2(m), n: m.length / 10 }; });
const suSet = () => { const b = ubuf(80); return { b, bg: bgOf(b), f: new Float32Array(20) }; };
const suHub = suSet(), suRing = suSet(), suWreck = WRECKS.map(suSet);
const auSet = () => { const b = ubuf(112); return { b, bg: bgOf(b), f: new Float32Array(28) }; };
const auSmall = auSet(), auLarge = auSet(), auNuc = COMETS.map(auSet);
const tuSet = () => { const b = ubuf(64); return { b, bg: bgOf(b), f: new Float32Array(16) }; };
const tuComet = COMETS.map(tuSet);
for (const b of BODIES) {
  const u = b.u;
  u[3] = b.R; u[6] = b.kind; u[7] = b.off; u[8] = b.amp; u[9] = b.freq; u[10] = b.sea;
  if (b.atm) u.set(b.atm, 12);
  b.pal.forEach((c, k) => u.set(c, 16 + k * 4));
  if (b.ring) { u[32] = b.ring[0]; u[33] = b.ring[1]; u[36] = sin(b.ring[2]); u[37] = cos(b.ring[2]); }
  u[35] = b.cap || 0;
  b.ubo = ubuf(160); b.bg = bgOf(b.ubo);
}
const shipV = buildShip(), shipN = shipV.length / 10;
const vbuf = device.createBuffer({ size: shipV.byteLength, usage: BU.VERTEX | BU.COPY_DST });
Q.writeBuffer(vbuf, 0, shipV);

// ---------------------------------------------------------------- pipelines
await say('Compiling shaders…', 0.4);
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const ALPHA = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
const mkPipe = async (name, code, layout, o = {}) => {
  const module = device.createShaderModule({ code });
  const err = (await module.getCompilationInfo()).messages.find((m) => m.type === 'error');
  if (err) fail(`Shader "${name}" failed: ${err.message} (line ${err.lineNum}; run "npm run build:readable" for readable line numbers)`);
  return device.createRenderPipelineAsync({
    layout,
    vertex: { module, entryPoint: 'vs', buffers: o.buffers || [] },
    fragment: { module, entryPoint: o.fs || 'fs', targets: [{ format: o.fmt || HDR, blend: o.blend }] },
    primitive: { topology: 'triangle-list', cullMode: o.cull || 'none' },
    ...(o.nodepth ? {} : { depthStencil: { format: DEPTH, depthWriteEnabled: !!o.write, depthCompare: o.cmp || 'greater' } }),
    multisample: { count: o.samples || AA },
  });
};
// the sky texture: six faces, filled once below
const SKYK = 1 + 2.5 / SKYN;
const tSky = device.createTexture({ size: [SKYN, SKYN, 6], format: HDR, usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
const bglSky = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: FS, texture: { viewDimension: '2d-array' } },
  { binding: 2, visibility: FS, sampler: {} },
] });
const smpL = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const bgSky = device.createBindGroup({ layout: bglSky, entries: [
  { binding: 0, resource: { buffer: uboG } },
  { binding: 1, resource: tSky.createView({ dimension: '2d-array' }) },
  { binding: 2, resource: smpL },
] });
const bglP = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: FS, buffer: {} }, { binding: 1, visibility: FS, texture: {} },
  { binding: 2, visibility: FS, sampler: {} }, { binding: 3, visibility: FS, texture: {} },
] });
const layP = device.createPipelineLayout({ bindGroupLayouts: [bglP] });
const P1 = { nodepth: true, samples: 1 };
const layVeg = device.createPipelineLayout({ bindGroupLayouts: [bglU, bglU, bglH, bglU] });
const [pSky, pBake, pPlanet, pHBake, pRing, pShip, pAtmo, pGlow, pDust, pPre, pDown, pUp, pComp, pVeg, pAst, pTail] = await Promise.all([
  mkPipe('sky', SHADER_SKY, device.createPipelineLayout({ bindGroupLayouts: [bglSky] }), { cmp: 'always' }),
  mkPipe('sky bake', SHADER_BAKE, layGP, { fmt: HDR, ...P1 }),
  mkPipe('planet', COMMON + PLANET, layPl, { cull: 'back', write: true }),
  mkPipe('height bake', SHADER_HBAKE, layHB, { fmt: 'r16float', ...P1 }),
  mkPipe('ring', SHADER_RING, layGP, { blend: ALPHA }),
  mkPipe('ship', SHADER_SHIP, layGP, { write: true, buffers: [{ arrayStride: 40, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x4' }] }] }),
  mkPipe('atmosphere', SHADER_ATMO, layGP, { blend: ADD }),
  mkPipe('glow', SHADER_GLOW, layGP, { blend: ADD }),
  mkPipe('dust', SHADER_DUST, layG, { blend: ADD }),
  mkPipe('bloom pre', SHADER_POST, layP, { fs: 'fsPre', ...P1 }),
  mkPipe('bloom down', SHADER_POST, layP, { fs: 'fsDown', ...P1 }),
  mkPipe('bloom up', SHADER_POST, layP, { fs: 'fsUp', blend: ADD, ...P1 }),
  mkPipe('composite', SHADER_POST, layP, { fs: 'fsComp', fmt: FMT, ...P1 }),
  mkPipe('props', SHADER_VEG, layVeg, { write: true, buffers: [{ arrayStride: 40, attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32x4' }] }] }),
  mkPipe('asteroids', SHADER_AST, layGP, { write: true, buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] }),
  mkPipe('comet tails', SHADER_TAIL, layGP, { blend: ADD }),
]);

{ // bake the nebulae into the sky texture, once
  const enc = device.createCommandEncoder();
  for (let f = 0; f < 6; f++) {
    const fu = ubuf(16);
    Q.writeBuffer(fu, 0, new Float32Array([f, SKYK, NEBX, 0]));
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: tSky.createView({ dimension: '2d', baseArrayLayer: f, arrayLayerCount: 1 }), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
    pass.setPipeline(pBake); pass.setBindGroup(0, bgG); pass.setBindGroup(1, bgOf(fu)); pass.draw(3); pass.end();
  }
  Q.submit([enc.finish()]);
}
// terrain: every solid body gets its heights baked once (6 faces of HS x HS); bodies without terrain share an empty texture
const hSamp = smpL;
const hEmpty = device.createTexture({ size: [1, 1, 6], format: 'r16float', usage: TU.TEXTURE_BINDING });
{
  const enc = device.createCommandEncoder();
  for (const b of BODIES) {
    let tex = hEmpty;
    if (b.amp) {
      tex = device.createTexture({ size: [HS, HS, 6], format: 'r16float', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
      Q.writeBuffer(b.ubo, 0, b.u);
      for (let f = 0; f < 6; f++) {
        const fu = ubuf(16);
        Q.writeBuffer(fu, 0, new Float32Array([f, HS, 0, 0]));
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView({ dimension: '2d', baseArrayLayer: f, arrayLayerCount: 1 }), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(pHBake); pass.setBindGroup(0, bgG); pass.setBindGroup(1, b.bg); pass.setBindGroup(2, bgOf(fu)); pass.draw(3); pass.end();
      }
    }
    b.bgH = device.createBindGroup({ layout: bglH, entries: [{ binding: 0, resource: tex.createView({ dimension: '2d-array' }) }, { binding: 1, resource: hSamp }] });
  }
  Q.submit([enc.finish()]);
}
const IB = {};
for (const n of new Set([NHI, NMID, NLO, min(NHI, 48), min(NMID, 48), min(NLO, 48)])) {
  const w = n + 1, ix = new Uint32Array(n * n * 6);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * w + i, b = a + 1, c = a + w, d = c + 1; ix[k++] = a; ix[k++] = b; ix[k++] = c; ix[k++] = b; ix[k++] = d; ix[k++] = c; }
  IB[n] = device.createBuffer({ size: ix.byteLength, usage: BU.INDEX | BU.COPY_DST });
  Q.writeBuffer(IB[n], 0, ix);
}

// ---------------------------------------------------------------- render targets (follow the window size)
// scene (HDR, optionally multisampled) -> tRes -> bloom mip chain -> composite to the canvas
let RS = GP.res / 100;
let W = 0, H = 0, tScene, tRes, tDepth, vScene, vRes, vDepth, tBl = [], bgPre, bgDn = [], bgUp = [], bgComp, bgCompNoBloom, bloomN = 0;
const tDum = device.createTexture({ size: [1, 1], format: HDR, usage: TU.TEXTURE_BINDING });
const postBG = (src, bl) => device.createBindGroup({ layout: bglP, entries: [
  { binding: 0, resource: { buffer: uboP } }, { binding: 1, resource: src.createView() }, { binding: 2, resource: smpL }, { binding: 3, resource: (bl || tDum).createView() }] });
const resize = () => {
  const px = min(devicePixelRatio || 1, 2) * RS;
  let w = Math.max(2, round(canvas.clientWidth * px)), h = Math.max(2, round(canvas.clientHeight * px));
  if (w * h > MAXPIX) { const k = sqrt(MAXPIX / (w * h)); w = round(w * k); h = round(h * k); }
  if (w === W && h === H) return;
  W = canvas.width = w; H = canvas.height = h;
  for (const t of [tScene, tRes, tDepth, ...tBl]) t?.destroy();
  tDepth = device.createTexture({ size: [w, h], format: DEPTH, usage: TU.RENDER_ATTACHMENT, sampleCount: AA }); vDepth = tDepth.createView();
  tRes = device.createTexture({ size: [w, h], format: HDR, usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING }); vRes = tRes.createView();
  if (AA > 1) { tScene = device.createTexture({ size: [w, h], format: HDR, usage: TU.RENDER_ATTACHMENT, sampleCount: AA }); vScene = tScene.createView(); }
  else { tScene = null; vScene = vRes; }
  tBl = []; bgDn = []; bgUp = [];
  let bw = w >> 1, bh = h >> 1;
  for (let k = 0; k < 6 && bw >= 2 && bh >= 2; k++, bw >>= 1, bh >>= 1) tBl.push(device.createTexture({ size: [bw, bh], format: HDR, usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING }));
  bloomN = tBl.length;
  bgPre = postBG(tRes);
  for (let k = 1; k < bloomN; k++) { bgDn[k] = postBG(tBl[k - 1]); bgUp[k] = postBG(tBl[k]); }
  bgComp = postBG(tRes, tBl[0]); bgCompNoBloom = postBG(tRes);
};

// ---------------------------------------------------------------- saved games
const SLOTS = 4;   // 0 = autosave, 1..3 = manual
const slotKey = (i) => 'stellarSave' + i;
const readSlot = (i) => { try { const s = JSON.parse(localStorage[slotKey(i)]); return s && s.v === 1 && s.p && s.t >= 0 ? s : null; } catch { return null; } };
const writeSlot = (i) => { try { keep(slotKey(i), JSON.stringify(snapshot())); return true; } catch { return false; } };
const newest = () => { let b = null; for (let i = 0; i < SLOTS; i++) { const s = readSlot(i); if (s && (!b || s.ts > b.ts)) b = s; } return b; };

// ---------------------------------------------------------------- state and input
const K = {};
let cockpit = false, stats = false, mode = 'load', locked = false, hideSet = 0;
const playing = () => mode === 'play';
const WARPKEYS = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9 };
const pn = $('pn');
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space' || e.code === 'Tab') { if (mode === 'play') e.preventDefault(); }
  if (e.code === 'Escape' && !e.repeat) {
    if (pn.classList.contains('on')) { closePanel(); ui('back'); }
    else if (mode === 'play') pause();
    else if (mode === 'pause') resume();
    return;
  }
  if (mode !== 'play') return;
  K[e.code] = 1;
  if (e.repeat) return;
  if (e.code in WARPKEYS) { if (startWarp(WARP[WARPKEYS[e.code]])) ui('warp'); }
  else if (e.code in POI_KEYS) { if (startWarp(POI_KEYS[e.code])) ui('warp'); }
  else if (e.code === 'KeyF') IN.act = 1;
  else if (e.code === 'KeyV') { cockpit = !cockpit; ui('cockpit'); }
  else if (e.code === 'KeyH') stats = !stats;
  else if (e.code === 'KeyM' && AC) mute();
  try { sound(); } catch {}
});
addEventListener('keyup', (e) => { K[e.code] = 0; });
addEventListener('blur', () => { for (const k in K) K[k] = 0; });
addEventListener('mousemove', (e) => { if (locked) { IN.mx += e.movementX; IN.my += e.movementY; } });
addEventListener('pointerdown', () => { try { sound(); } catch {} });
const lock = () => { try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch {} };
canvas.addEventListener('click', () => { if (mode === 'play' && !locked) lock(); });
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (mode === 'play') { if (locked) body.className = 'g p'; else pause(); }
});

// ---------------------------------------------------------------- menus
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const nav = $('nav');
const hot = (b) => { b.onmouseenter = () => ui('hover'); b.addEventListener('focus', () => ui('hover')); return b; };
const closePanel = () => { pn.classList.remove('on'); pn.replaceChildren(); };
const openPanel = (title, fill) => {
  pn.replaceChildren(); const c = h('div', 'card'); c.append(h('h2', null, title)); fill(c); pn.append(c); pn.classList.add('on');
};
pn.onclick = (e) => { if (e.target === pn) { closePanel(); ui('back'); } };
const back = (c, extra = []) => {
  const r = h('div', 'btns'); for (const b of extra) r.append(hot(b));
  const b = hot(h('button', null, 'Back')); b.onclick = () => { closePanel(); ui('back'); }; r.append(b); c.append(r);
};
const row = (c, label, ctl, out, note) => { const r = h('div', 'row'), l = h('label', null, label); if (note) l.append(h('small', null, note)); r.append(l, ctl); if (out) r.append(out); c.append(r); };
const slider = (c, label, obj, key, lo, hi, step, fmt, save, after) => {
  const i = h('input'); i.type = 'range'; i.min = lo; i.max = hi; i.step = step; i.value = obj[key];
  const o = h('output', null, fmt(obj[key]));
  i.oninput = () => { obj[key] = +i.value; o.textContent = fmt(obj[key]); save?.(); after?.(); };
  i.onchange = () => ui('hover');
  row(c, label, i, o);
};
const seg = (c, label, obj, key, opts, save, after, note) => {
  const s = h('div', 'seg');
  opts.forEach((t, v) => {
    const b = hot(h('button', obj[key] === v ? 'on' : '', t));
    b.onclick = () => { obj[key] = v; [...s.children].forEach((x, k) => x.classList.toggle('on', k === v)); save?.(); after?.(); ui('toggle'); };
    s.append(b);
  });
  const r = h('div', 'row'), l = h('label', null, label); if (note) l.append(h('small', null, note));
  s.className = 'seg sw'; r.append(l, s); c.append(r);
};
const LVL = ['Low', 'Medium', 'High', 'Ultra'];
const settingsPanel = () => openPanel('Settings', (c) => {
  slider(c, 'Mouse sensitivity', CFG, 'sens', 10, 100, 1, (v) => v, cfgSave);
  seg(c, 'Invert vertical look', CFG, 'inv', ['Off', 'On'], cfgSave);
  slider(c, 'Field of view', CFG, 'fov', 50, 100, 1, (v) => v + '°', cfgSave);
  slider(c, 'Camera shake', CFG, 'shake', 0, 1.5, 0.1, (v) => (v * 100 | 0) + '%', cfgSave);
  seg(c, 'Performance stats', CFG, 'stats', ['Off', 'On'], cfgSave, () => { stats = !!CFG.stats; });
  back(c);
});
const audioPanel = () => openPanel('Audio', (c) => {
  const A = (k) => ({ get v() { return AUD[k] * 100 | 0; }, set v(x) { AUD[k] = x / 100; } });
  for (const [label, k] of [['Master volume', 'master'], ['Ambience', 'amb'], ['Engines and ship', 'eng'], ['Interface', 'ui']]) slider(c, label, A(k), 'v', 0, 100, 1, (v) => v + '%', audSave, audApply);
  seg(c, 'Mute all sound', AUD, 'mute', ['Off', 'On'], audSave, audApply);
  back(c);
});
const graphicsPanel = () => openPanel('Graphics', (c) => {
  const rs = h('div'); rs.id = 'rs';
  const ap = hot(h('button', 'go', 'Apply and restart')); ap.onclick = () => location.reload(); ap.style.display = 'none';
  const upd = () => { const need = ['aa', 'nebula', 'planet', 'tex'].some((k) => GP[k] !== GS[k]); rs.classList.toggle('on', need); ap.style.display = need ? '' : 'none'; rs.textContent = need ? 'Anti-aliasing, nebula, planet and terrain quality are built when the page loads. Restart to apply them.' : ''; };
  const ch = () => { GP.p = 4; gfxSave(); upd(); };
  // presets
  const ps = h('div', 'seg sw'), pr = h('div', 'row'); pr.append(h('label', null, 'Quality preset'), ps);
  ['Low', 'Medium', 'High', 'Ultra'].forEach((t, v) => { const b = hot(h('button', GP.p === v ? 'on' : '', t)); b.onclick = () => { Object.assign(GP, PRESETS[v], { p: v }); gfxSave(); graphicsPanel(); ui('toggle'); }; ps.append(b); });
  c.append(pr);
  if (GP.p === 4) c.append(h('p', null, 'Custom settings'));
  slider(c, 'Resolution scale', GP, 'res', 50, 100, 5, (v) => v + '%', null, () => { RS = min(RS, GP.res / 100); ch(); });
  seg(c, 'Anti-aliasing', GP, 'aa', ['Off', 'MSAA 4x'], null, ch, 'needs restart');
  seg(c, 'Bloom', GP, 'bloom', ['Off', 'Low', 'High'], null, ch);
  seg(c, 'Particles', GP, 'amb', LVL, null, ch);
  seg(c, 'Asteroid density', GP, 'ast', ['Off', 'Low', 'Medium', 'High', 'Ultra'], null, ch);
  seg(c, 'Vegetation and props', GP, 'veg', ['Off', 'Low', 'Medium', 'High', 'Ultra'], null, ch);
  seg(c, 'Nebula quality', GP, 'nebula', LVL, null, ch, 'needs restart');
  seg(c, 'Planet detail', GP, 'planet', LVL, null, ch, 'needs restart');
  seg(c, 'Terrain maps', GP, 'tex', LVL, null, ch, 'needs restart');
  c.append(rs); upd(); back(c, [ap]);
});
const saveTime = (s) => new Date(s.ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const slotsPanel = (saving) => openPanel(saving ? 'Save game' : 'Load game', (c) => {
  for (let i = saving ? 1 : 0; i < SLOTS; i++) {
    const s = readSlot(i), b = hot(h('button', 'slot'));
    b.append(h('b', null, i ? 'Slot ' + i : 'Autosave'), h('b', null, s ? saveTime(s) : 'Empty'), h('span', null, s ? `Near ${s.near}${s.landed >= 0 ? ' · landed' : ''}` : (saving ? 'Save here' : 'No save')), h('span', null, s ? `Played ${(s.t / 60) | 0} min` : ''));
    b.disabled = !saving && !s;
    b.onclick = () => { ui('click'); if (saving) { writeSlot(i); slotsPanel(true); } else { restore(s); closePanel(); launch(); } };
    c.append(b);
  }
  back(c);
});
const quitPanel = () => openPanel('Quit game?', (c) => {
  c.append(h('p', null, 'Progress since your last save will be lost.'));
  const y = hot(h('button', 'bad', 'Quit')), n = hot(h('button', 'go', 'Stay'));
  y.onclick = () => { closePanel(); body.className = 'q'; try { window.close(); } catch {} };
  n.onclick = () => { closePanel(); ui('back'); };
  const r = h('div', 'btns'); r.append(n, y); c.append(r);
});
$('fb').onclick = () => { body.className = mode === 'pause' ? 'z' : 'm'; };
const ITEMS = {
  main: () => [['Continue', () => { const s = newest(); if (s) { restore(s); launch(); } }, !newest(), 1], ['New game', () => { newGame(); launch(); }, 0, !newest()],
    ['Load game', () => slotsPanel(false)], ['Settings', settingsPanel], ['Graphics', graphicsPanel], ['Audio', audioPanel], ['Quit', quitPanel]],
  pause: () => [['Resume', resume, 0, 1], ['Save game', () => slotsPanel(true)], ['Load game', () => slotsPanel(false)], ['Settings', settingsPanel],
    ['Graphics', graphicsPanel], ['Audio', audioPanel], ['Main menu', () => { writeSlot(0); setMode('main'); }]],
};
const buildNav = () => {
  nav.replaceChildren();
  for (const [t, f, off, pri] of ITEMS[mode === 'pause' ? 'pause' : 'main']()) { const b = hot(h('button', pri ? 'pri' : '', t)); b.disabled = !!off; b.onclick = () => { ui('click'); f(); }; nav.append(b); }
  $('hint').textContent = mode === 'pause' ? 'ESC · RESUME' : 'WASD THRUST · SHIFT BOOST · V CAMERA · M MUTE · ESC PAUSE\nWARP: 1–0 PLANETS · − STATION · = ASTEROID BELT · [ ] \\ COMETS AND WRECK';
};
const setMode = (m) => { mode = m; body.className = m === 'pause' ? 'z' : m === 'main' ? 'm' : 'g'; closePanel(); if (m !== 'play') { buildNav(); for (const k in K) K[k] = 0; } };
const launch = () => { try { sound(); } catch (e) { console.error('audio:', e); } setMode('play'); lock(); };
const pause = () => { if (mode !== 'play') return; document.exitPointerLock?.(); writeSlot(0); setMode('pause'); };
const resume = () => { launch(); };
$('o').onclick = pause;
setInterval(() => { if (mode === 'play') writeSlot(0); }, 60000);

// ---------------------------------------------------------------- cinematic camera behind the menu
// the camera circles the ship with the planet (or the sky) behind it; the ship sits on the right of the picture
let mA = 0;
const nrm = (v) => { const l = hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const menuCam = (dt) => {
  mA += dt;
  const P = SH.p, nb = ST.nb;
  let dp = nrm([nb.pos[0] - P[0], nb.pos[1] - P[1], nb.pos[2] - P[2]]);
  if (ST.landed) dp = [SH.f[0], SH.f[1], SH.f[2]];
  let up = [SH.u[0], SH.u[1], SH.u[2]];
  if (!ST.landed) { up = [-dp[0], -dp[1], -dp[2]]; }
  const side = nrm(cross(dp, SH.u)), a = 0.75 + 0.4 * sin(mA * 0.09), D = 24;
  const c = ST.cam;
  // away from the planet and a little to the side, so the planet fills the background behind the ship
  const upv = ST.landed ? [SH.u[0], SH.u[1], SH.u[2]] : [SH.u[0], SH.u[1], SH.u[2]];
  for (let i = 0; i < 3; i++) c[i] = P[i] - dp[i] * D * cos(a) + side[i] * D * sin(a) + upv[i] * 5;
  let f = nrm([P[0] - c[0], P[1] - c[1], P[2] - c[2]]);
  const r0 = nrm(cross(f, upv));
  f = nrm([P[0] - r0[0] * 6.5 - c[0], P[1] - r0[1] * 6.5 - c[1], P[2] - r0[2] * 6.5 - c[2]]);
  const r = nrm(cross(f, upv)), u = cross(r, f);
  CB.f.set(f); CB.r.set(r); CB.u.set(nrm(u));
};


// ---------------------------------------------------------------- radio: subtitles here, a synthesized voice in audio.js
// The voice is speech-like babble (formant noise shaped into syllables), not real words; the subtitle carries the message.
let radioUntil = 0, radioN = 0, radioNext = 40;
const radio = (who, text) => {
  SND.say = { who, text, n: ++radioN };
  rdEl.innerHTML = `<b>${who}</b>${text}`; rdEl.className = 'on'; radioUntil = performance.now() + 2200 + text.length * 55;
};
const CHAT = {
  station: ['HAVEN CONTROL', ['All traffic, orbital lane three is clear.', 'Supply shuttle on approach. Hold your vector.', 'Ring gravity stable. Docking bays are open.']],
  belt: ['SURVEY NET', ['Drone twelve reporting. Claim markers updated.', 'Rock density rising. Watch your vector in the belt.', 'Mining beacon seven, all quiet.']],
  ground: ['GROUND RELAY', ['Weather relay: clear skies, light winds.', 'Surface survey logged. Fly safe, pilot.']],
  deep: ['DEEP RELAY', ['Long range relay, all quiet in the outer system.', 'Comet tracking is nominal.', 'Pilot, your transponder is clear.']],
};
let rp = { dk: 0, svDone: 0, sv: -1, crash: 0, low: false, dock: 0 }, beaconSeen = [0, 0, 0];
const radioTick = (dt) => {
  if (performance.now() > radioUntil && rdEl.className) rdEl.className = '';
  if (ST.dock !== rp.dock) { rp.dock = ST.dock; radio('HAVEN CONTROL', ST.dk === 1 ? 'Docking clearance granted. Hold steady, pilot.' : ST.dk === 2 ? 'Hard dock confirmed. Welcome to Haven.' : 'You are clear of the ring. Safe travels.'); }
  else if (ST.svDone !== rp.svDone) { rp.svDone = ST.svDone; radio('SHIP AI', 'Salvage secured. Scrap added to cargo.'); }
  else if (ST.sv >= 0 && rp.sv < 0) radio('SHIP AI', 'Tractor beam locked on the wreck.');
  else if (ST.crash !== rp.crash) { rp.crash = ST.crash; radio('RECOVERY BEACON', 'Drone team dispatched. Hull restored to fifty percent.'); }
  else if (ST.hull < 30 && !rp.low) radio('SHIP AI', 'Hull integrity critical.');
  rp.sv = ST.sv; rp.low = ST.hull < 30;
  WRECKS.forEach((w, i) => { if (!beaconSeen[i] && hypot(SH.p[0] - w.pos[0], SH.p[1] - w.pos[1], SH.p[2] - w.pos[2]) < 700) { beaconSeen[i] = 1; radio('DISTRESS BEACON', `This is the ${w.name.replace(' wreck', '')}. Crew evacuated. Cargo unsecured.`); } });
  if ((radioNext -= dt) < 0) {
    radioNext = 70 + Math.random() * 70;
    if (performance.now() > radioUntil && !ST.wPh) {
      const near = hypot(SH.p[0] - STATION.pos[0], SH.p[1] - STATION.pos[1], SH.p[2] - STATION.pos[2]) < 5000 ? 'station' : abs(hypot(SH.p[0], SH.p[2]) - BELT.r) < 3500 ? 'belt' : SND.grd > 0.3 ? 'ground' : 'deep';
      const [who, lines] = CHAT[near]; radio(who, lines[Math.random() * lines.length | 0]);
    }
  }
};

// ---------------------------------------------------------------- one frame
const cam = ST.cam, strk = ST.strk, F = SH.f, R = SH.r, U = SH.u;
let gearE = 0, dashT = 0, gearWas = 1;
let hudT = 0, fps = 60, msgShown = '', frames = 0, accT = 0, accN = 0, goodT = 0, fade = 0, wmShown = '', shk = 0;
const cpv = $('cp'), hitFx = $('hf'), rdEl = $('rd');
let dashOn = false;
const frame = (dt) => {
  const live = mode === 'play', frozen = mode === 'pause';
  IN.fwd = (K.KeyW | 0) - (K.KeyS | 0); IN.str = (K.KeyD | 0) - (K.KeyA | 0); IN.vert = (K.Space | 0) - (K.KeyC | 0);
  IN.roll = (K.KeyE | 0) - (K.KeyQ | 0); IN.boost = (K.ShiftLeft | K.ShiftRight) | 0; IN.brake = K.KeyX | 0;
  // adaptive resolution: judge the frame rate every 0.6 s, step the render scale down quickly and back up slowly
  const rsMax = GP.res / 100;
  if (++frames > 90 && (accT += dt, ++accN, accT > 0.6)) {
    const f = accN / accT;
    if (f < 50) { RS = max(0.4, RS * (f < 35 ? 0.8 : 0.92)); goodT = 0; }
    else if (f > 57 && RS < rsMax) { if ((goodT += accT) > 4) { RS = min(rsMax, RS * 1.06); goodT = 0; } }
    else goodT = 0;
    accT = accN = 0;
  }
  RS = min(RS, rsMax);
  if (!frozen) {
    if (live) { tickWarp(dt); radioTick(dt); }
    update(dt, live);
    if (live) placeCamera(dt, cockpit); else menuCam(dt);
  }
  const inFlight = live || frozen;
  const cp = inFlight && cockpit;
  SND.hit = ST.hit; SND.hitP = ST.hitP; SND.hitM = ST.hitM; SND.dock = ST.dock; SND.crash = ST.crash; SND.hull = ST.hull; SND.beam = ST.sv >= 0 ? 1 : 0; SND.beamP = ST.svT;
  SND.grd = ST.nb.solid ? ST.skyS : 0; SND.bio = ST.nb.kind; SND.entry = live ? ST.skyS * clamp((ST.speed - 120) / 800, 0, 1) : 0;
  SND.spd = ST.speed; SND.thr = live ? ST.thr : 0; SND.atm = ST.skyS; SND.landed = !!ST.landed; SND.boost = live ? ST.boostA : 0; SND.warp = ST.warp; SND.ev = ST.wev;

  resize();
  fade = min(fade + dt * 0.5, 1);
  const nb = ST.nb, bo = live ? ST.boostA : 0, wp = live ? ST.warp : 0;
  shk = (0.035 * bo + 0.22 * wp + 0.9 * ST.hitI) * CFG.shake;
  hitFx.style.opacity = live ? clamp(ST.hitI * 1.4, 0, 0.8) + (ST.hull < 25 ? 0.12 + 0.08 * sin(ST.t * 6) : 0) : 0;
  const tt = ST.t;
  const cx = cam[0] + (shk ? (sin(tt * 53.1) + sin(tt * 91.7)) * 0.5 * shk : 0), cy = cam[1] + (shk ? (sin(tt * 61.3) + sin(tt * 77.9)) * 0.5 * shk : 0), cz = cam[2];
  const CF = CB.f, CR = CB.r, CU = CB.u;
  // --- per-frame uniforms
  const fov = ((inFlight ? CFG.fov : 52) + 6 * bo + 24 * wp) * PI / 180, BOX = 300;
  GF.set(CR, 0); GF.set(CU, 4); GF.set(CF, 8);
  GF[3] = 0.006 + 0.005 * bo;                                             // dust streak length in seconds of travel
  GF[12] = 1 / Math.tan(fov / 2); GF[13] = W / H; GF[14] = 0.25; GF[15] = ST.t;
  GF[16] = -cx; GF[17] = -cy; GF[18] = -cz; GF[19] = SUN_R;
  GF[20] = ST.sky[0]; GF[21] = ST.sky[1]; GF[22] = ST.sky[2]; GF[23] = ST.skyS;
  GF[24] = ST.up[0]; GF[25] = ST.up[1]; GF[26] = ST.up[2]; GF[27] = wp;
  GF[28] = strk[0]; GF[29] = strk[1]; GF[30] = strk[2]; GF[31] = ST.speed;
  GF[32] = cx - BOX * floor(cx / BOX); GF[33] = cy - BOX * floor(cy / BOX); GF[34] = cz - BOX * floor(cz / BOX); GF[35] = BOX;
  // particles: faint motes that you only notice when moving; no permanent speed lines
  GF[36] = W; GF[37] = H; GF[38] = (1 - ST.skyS * 0.85) * (live ? min(ST.speed / 400, 1) * 0.16 * (1 - wp) + 0.03 : 0.04); GF[39] = SKYK;
  Q.writeBuffer(uboG, 0, GF);
  // --- bodies: position, spin, mesh detail, visibility
  for (const b of BODIES) {
    const rx = b.pos[0] - cx, ry = b.pos[1] - cy, rz = b.pos[2] - cz, d = hypot(rx, ry, rz), u = b.u, ang = b.R / max(d, 1);
    b.vis = rx * CF[0] + ry * CF[1] + rz * CF[2] > -b.R * 1.2 - 5;
    if (!b.vis) continue;
    const n = ang > 0.05 ? NHI : ang > 0.012 ? NMID : NLO, N = b.amp ? n : min(n, 48);
    u[0] = rx; u[1] = ry; u[2] = rz; u[4] = cos(b.spin); u[5] = sin(b.spin);
    u[11] = b === nb ? ST.skyS : 0; u[34] = ang > 0.008 ? 1 : 0; u[39] = N;
    b.N = N;
    b.atmo = b.atm && d > b.R * (1 + b.atm[3]) * 1.003;
    Q.writeBuffer(b.ubo, 0, u);
  }
  // --- surface props: a field of trees, rocks or crystals around the ship while it is low over a solid world
  const VS = 9;
  let nProps = 0;
  if (VEGN[GP.veg] && nb.solid && VEG_P[nb.kind] && ST.alt < 420 && nb.vis) {
    const n = VEGN[GP.veg], c = cos(nb.spin), s = sin(nb.spin), ox = cam[0] - nb.pos[0], oy = cam[1] - nb.pos[1], oz = cam[2] - nb.pos[2];
    const L = [c * ox - s * oz, oy, s * ox + c * oz];           // the ship in the planet's own frame
    let k = nb.vk ?? 0;
    const A = L.map(abs);
    if (A[k] < 0.88 * max(A[0], A[1], A[2])) k = A[0] >= A[1] && A[0] >= A[2] ? 0 : A[1] >= A[2] ? 1 : 2;   // only switch grid plane when clearly needed
    nb.vk = k;
    const i1 = k === 0 ? 1 : 0, i2 = k === 2 ? 1 : 2;
    VUF[0] = k; VUF[1] = L[k] < 0 ? -1 : 1; VUF[2] = floor(L[i1] / VS) - (n >> 1); VUF[3] = floor(L[i2] / VS) - (n >> 1);
    VUF[4] = VS; VUF[5] = n; VUF[7] = nb.i;
    VUF[8] = L[0]; VUF[9] = L[1]; VUF[10] = L[2]; VUF[11] = n * VS * 0.5 * 0.95;
    VUF.set(VEG_P[nb.kind], 12);
    Q.writeBuffer(uboV, 0, VUF);
    nProps = n * n;
  }
  // --- ship
  const showShip = !cp;
  SU[0] = SH.p[0] - cx; SU[1] = SH.p[1] - cy; SU[2] = SH.p[2] - cz; SU[3] = 1;
  SU.set(R, 4); SU.set(U, 8); SU.set(F, 12);
  let lit = 1;
  const sl = hypot(SH.p[0], SH.p[1], SH.p[2]), sx = -SH.p[0] / sl, sy = -SH.p[1] / sl, sz = -SH.p[2] / sl;
  for (const b of BODIES) {
    if (b.i === 0) continue;
    const ox = b.pos[0] - SH.p[0], oy = b.pos[1] - SH.p[1], oz = b.pos[2] - SH.p[2], t = ox * sx + oy * sy + oz * sz;
    if (t <= 0) continue;
    const m = sqrt(max(ox * ox + oy * oy + oz * oz - t * t, 0)) / b.R;
    lit = min(lit, sstep(0.97, 1.03, m));
  }
  const thrG = live ? min(ST.thr, 1.5) : 0.12;
  const gearWant = ST.landed || ST.dk || (ST.alt < 90 && ST.speed < 220) ? 1 : 0;
  if (live && gearWant !== gearWas) { gearWas = gearWant; SND.gear++; }
  gearE += (gearWant - gearE) * min(dt * 1.6, 1);
  SU[16] = lit; SU[17] = thrG * 0.8; SU[18] = ST.t; SU[19] = gearE;
  Q.writeBuffer(uboS, 0, SU);
  // --- glows: [0] the sun, then engine plumes and navigation lights
  GL.fill(0);
  let ng = 0;
  const setGlow = (x, y, z, size, r, g, b, I, flare, shift) => {
    const k = ng++;
    GL[k * 4] = x; GL[k * 4 + 1] = y; GL[k * 4 + 2] = z; GL[k * 4 + 3] = size;
    GL[64 + k * 4] = r; GL[65 + k * 4] = g; GL[66 + k * 4] = b; GL[67 + k * 4] = I;
    GL[128 + k * 4] = flare; GL[129 + k * 4] = shift;
  };
  setGlow(-cx, -cy, -cz, SUN_R * 7, 1.0, 0.82, 0.55, 0.9, 1, SUN_R * 1.05);
  if (showShip) {
    const loc = (x, y, z) => [SU[0] + R[0] * x + U[0] * y + F[0] * z, SU[1] + R[1] * x + U[1] * y + F[1] * z, SU[2] + R[2] * x + U[2] * y + F[2] * z];
    // engines: a small hot core and a longer, dimmer plume; boost makes them longer, not brighter white
    if (thrG > 0.03) {
      const pl = 1 + 0.5 * bo + 0.25 * wp;
      for (const s of [1, -1]) {
        const a = loc(1.45 * s, -0.05, -5.0 - 0.4 * thrG), b2 = loc(1.45 * s, -0.05, -5.0 - (1.4 + 2.2 * thrG) * pl);
        setGlow(a[0], a[1], a[2], 0.9 + 0.7 * thrG, 0.55, 0.75, 1.0, 1.1 + 0.5 * thrG, 0, 0);
        setGlow(b2[0], b2[1], b2[2], (1.2 + 1.4 * thrG) * pl, 0.25, 0.5, 1.0, 0.28 + 0.2 * thrG, 0, 0);
      }
    }
    // navigation lights: red port, green starboard, white strobes on the fins
    const blink = (ST.t % 1.6) < 0.09 || ((ST.t + 0.25) % 1.6) < 0.09 ? 1 : 0;
    let a = loc(-5.4, 0, -3.25); setGlow(a[0], a[1], a[2], 0.5, 1, 0.1, 0.1, 1.6, 0.4, 0);
    a = loc(5.4, 0, -3.25); setGlow(a[0], a[1], a[2], 0.5, 0.1, 1, 0.25, 1.6, 0.4, 0);
    if (blink) for (const s of [1, -1]) { a = loc(0.9 * s, 2.0, -4.3); setGlow(a[0], a[1], a[2], 0.8, 1, 1, 1, 3, 0.6, 0); }
  }
  // --- space objects
  const rel = (o) => [o.pos[0] - cx, o.pos[1] - cy, o.pos[2] - cz];
  const setSU = (o, p, sc, r, u, f) => { const q = o.f; q[0] = p[0]; q[1] = p[1]; q[2] = p[2]; q[3] = sc; q.set(r, 4); q.set(u, 8); q.set(f, 12); q[16] = 1; q[17] = 0; q[18] = ST.t; q[19] = 1; Q.writeBuffer(o.b, 0, q); };
  const IDm = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const stRel = rel(STATION), stD = hypot(...stRel), drawSt = stD < 40000, drawWr = [];
  if (drawSt) {
    const ca = cos(STATION.ring), sa = sin(STATION.ring);
    setSU(suHub, stRel, STATION.scale, ...IDm);
    setSU(suRing, stRel, STATION.scale, [ca, 0, -sa], [0, 1, 0], [sa, 0, ca]);
    if (stD < 4000) {
      const bl = (ST.t % 2) < 0.12 ? 1 : 0;
      for (const sg of [1, -1]) setGlow(stRel[0], stRel[1] + sg * 13.6 * STATION.scale, stRel[2], 6, sg > 0 ? 1 : 0.2, sg > 0 ? 0.15 : 1, 0.15, bl ? 3 : 0.6, 0.5, 0);
    }
  }
  WRECKS.forEach((w, i) => {
    const wr = rel(w), d = hypot(...wr);
    if (d > 15000) { drawWr[i] = 0; return; }
    drawWr[i] = 1;
    const [wr0, wr1, wr2] = wreckBasis(w, ST.t);
    setSU(suWreck[i], wr, w.scale, wr0, wr1, wr2);
  });
  // asteroid layers: a fine one close by and a coarse one reaching far, both only while the ship is inside or near the belt
  const rxz = hypot(cx, cz), nearBelt = GP.ast && abs(rxz - BELT.r) < BELT.w * 2.4 + 3000 && abs(cy) < 3000;
  const astLayer = (o, C, n, chance, smin, smax, seed) => {
    const q = o.f;
    q[0] = C; q[1] = n; q[2] = chance; q[3] = seed;
    q[4] = smin; q[5] = smax; q[6] = floor(cx / C) - (n >> 1); q[7] = floor(cz / C) - (n >> 1);
    q[8] = cx; q[9] = cy; q[10] = cz; q[11] = n * C * 0.485;
    q[12] = BELT.r; q[13] = BELT.w; q[14] = BELT.h; q[15] = 0;
    q[16] = floor(cy / C) - 1;
    Q.writeBuffer(o.b, 0, q);
  };
  AST.on = nearBelt ? 1 : 0; AST.n = ASTN[GP.ast];
  if (nearBelt) { astLayer(auSmall, 150, ASTN[GP.ast], 0.3, 2, 32, 1); astLayer(auLarge, 1000, 30, 0.1, 35, 220, 2); }
  // comets: nucleus (a rock), coma (a glow) and two tails
  const cometOn = COMETS.map((c) => hypot(c.pos[0] - cx, c.pos[1] - cy, c.pos[2] - cz) < 120000);
  COMETS.forEach((c, i) => {
    if (!cometOn[i]) return;
    const cr = rel(c), act = clamp(1.4 - c.dist / 40000, 0.25, 1.3);
    const au = auNuc[i].f; au.fill(0);
    au[15] = 1; au[20] = cr[0]; au[21] = cr[1]; au[22] = cr[2]; au[23] = 20; au[24] = 0.14; au[25] = 0.12; au[26] = 0.11;
    Q.writeBuffer(auNuc[i].b, 0, au);
    const ion = [c.pos[0] / c.dist, c.pos[1] / c.dist, c.pos[2] / c.dist], vl = hypot(c.vel[0], c.vel[1], c.vel[2]) || 1, bend = [-c.vel[0] / vl, -c.vel[1] / vl, -c.vel[2] / vl];
    let dust = [ion[0] + bend[0] * 0.35, ion[1] + bend[1] * 0.35, ion[2] + bend[2] * 0.35]; const dl = hypot(...dust); dust = dust.map((v) => v / dl);
    const L = clamp(36e6 / max(c.dist, 4000), 300, 8000), tf = tuComet[i].f;
    tf.set(cr, 0); tf[3] = L; tf.set(ion, 4); tf[7] = L * 0.012; tf.set(dust, 8); tf[11] = 0.4; tf.set(bend, 12); tf[15] = act * 0.7;
    Q.writeBuffer(tuComet[i].b, 0, tf);
    if (ng < 15) setGlow(cr[0], cr[1], cr[2], 90 + 120 * act, 0.6, 0.82, 1.0, 0.45 * act, 0, 0);
  });
  Q.writeBuffer(uboL, 0, GL);
  // --- post uniforms: threshold, knee, bloom strength, exposure | warp, vignette, time, flash
  const bk = BLOOMK[GP.bloom];
  PPF[0] = 1.0; PPF[1] = 0.5; PPF[2] = bk; PPF[3] = fade * fade * (3 - 2 * fade);
  PPF[4] = wp; PPF[5] = 0.4; PPF[6] = ST.t; PPF[7] = live ? ST.flash : 0;
  Q.writeBuffer(uboP, 0, PPF);

  // --- draw
  const enc = device.createCommandEncoder(), view = ctx.getCurrentTexture().createView(), clear = { r: 0, g: 0, b: 0, a: 1 };
  const pass = enc.beginRenderPass({
    colorAttachments: [AA > 1 ? { view: vScene, resolveTarget: vRes, clearValue: clear, loadOp: 'clear', storeOp: 'discard' } : { view: vRes, clearValue: clear, loadOp: 'clear', storeOp: 'store' }],
    depthStencilAttachment: { view: vDepth, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
  });
  pass.setBindGroup(0, bgG);
  pass.setPipeline(pSky); pass.setBindGroup(0, bgSky); pass.draw(3); pass.setBindGroup(0, bgG);
  pass.setPipeline(pPlanet);
  for (const b of BODIES) if (b.vis) { pass.setBindGroup(1, b.bg); pass.setBindGroup(2, b.bgH); pass.setIndexBuffer(IB[b.N], 'uint32'); pass.drawIndexed(b.N * b.N * 6, 6); }
  if (showShip) { pass.setPipeline(pShip); pass.setBindGroup(1, bgS); pass.setVertexBuffer(0, vbuf); pass.draw(shipN); }
  if (nProps) {
    pass.setPipeline(pVeg); pass.setBindGroup(1, nb.bg); pass.setBindGroup(2, nb.bgH); pass.setBindGroup(3, bgV); pass.setVertexBuffer(0, vegBuf);
    for (const [first, count] of veg.ranges) pass.draw(count, nProps, first, 0);
    pass.setBindGroup(1, bgS);
  }
  if (drawSt || drawWr.includes(1)) {
    pass.setPipeline(pShip);
    if (drawSt) { pass.setBindGroup(1, suHub.bg); pass.setVertexBuffer(0, vbHub); pass.draw(stationM.hub.length / 10); pass.setBindGroup(1, suRing.bg); pass.setVertexBuffer(0, vbRing); pass.draw(stationM.ring.length / 10); }
    WRECKS.forEach((w, i) => { if (drawWr[i]) { pass.setBindGroup(1, suWreck[i].bg); pass.setVertexBuffer(0, wreckV[i].vb); pass.draw(wreckV[i].n); } });
  }
  if (nearBelt || cometOn.includes(true)) {
    pass.setPipeline(pAst); pass.setVertexBuffer(0, vbRock);
    const rn = rockM.length / 3;
    if (nearBelt) { pass.setBindGroup(1, auSmall.bg); pass.draw(rn, ASTN[GP.ast] * ASTN[GP.ast] * 3); pass.setBindGroup(1, auLarge.bg); pass.draw(rn, 30 * 30 * 3); }
    COMETS.forEach((c, i) => { if (cometOn[i]) { pass.setBindGroup(1, auNuc[i].bg); pass.draw(rn, 1); } });
  }
  pass.setPipeline(pRing);
  for (const b of BODIES) if (b.vis && b.ring) { pass.setBindGroup(1, b.bg); pass.draw(6); }
  pass.setPipeline(pAtmo);
  for (const b of BODIES) if (b.vis && b.atmo) { pass.setBindGroup(1, b.bg); pass.draw(6); }
  if (cometOn.includes(true)) { pass.setPipeline(pTail); COMETS.forEach((c, i) => { if (cometOn[i]) { pass.setBindGroup(1, tuComet[i].bg); pass.draw(168, 2); } }); }
  pass.setPipeline(pGlow); pass.setBindGroup(1, bgL); pass.draw(6, ng);
  pass.setPipeline(pDust); pass.draw(6, DUSTN[GP.amb]);
  pass.end();
  // bloom: threshold + downsample chain, then tent-upsample additively back up the chain
  const fsq = (target, pipe, bg, load) => {
    const p = enc.beginRenderPass({ colorAttachments: [{ view: target, loadOp: load ? 'load' : 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    p.setPipeline(pipe); p.setBindGroup(0, bg); p.draw(3); p.end();
  };
  const useBloom = bk > 0 && bloomN > 1;
  if (useBloom) {
    fsq(tBl[0].createView(), pPre, bgPre);
    for (let k = 1; k < bloomN; k++) fsq(tBl[k].createView(), pDown, bgDn[k]);
    for (let k = bloomN - 1; k >= 1; k--) fsq(tBl[k - 1].createView(), pUp, bgUp[k], true);
  }
  fsq(view, pComp, useBloom ? bgComp : bgCompNoBloom);
  Q.submit([enc.finish()]);

  // --- heads-up display and prompts, a few times a second
  fps += (1 / max(dt, 1e-4) - fps) * 0.05;
  const showDash = cp && (live || frozen);
  if (showDash !== dashOn) { dashOn = showDash; cpv.style.display = showDash ? 'block' : 'none'; dashT = 9; }
  if (showDash && (dashT += dt) > 0.05) {
    dashT = 0;
    const dp = min(devicePixelRatio || 1, 2), cw = round(cpv.clientWidth * dp), ch = round(cpv.clientHeight * dp);
    if (cpv.width !== cw || cpv.height !== ch) { cpv.width = cw; cpv.height = ch; }
    const contacts = [], add = (o, type) => { const v0 = o.pos[0] - SH.p[0], v1 = o.pos[1] - SH.p[1], v2 = o.pos[2] - SH.p[2]; contacts.push({ type, x: v0 * R[0] + v1 * R[1] + v2 * R[2], y: v0 * U[0] + v1 * U[1] + v2 * U[2], z: v0 * F[0] + v1 * F[1] + v2 * F[2] }); };
    for (const b of BODIES) add(b, b.i === 0 ? 'sun' : 'planet');
    for (const c of COMETS) add(c, 'comet');
    add(STATION, 'poi'); add(BELT_POI, 'poi'); for (const w of WRECKS) add(w, 'poi');
    const up = ST.up, dU = F[0] * up[0] + F[1] * up[1] + F[2] * up[2];
    drawDash(cpv, { speed: ST.speed, thr: ST.thr, boost: ST.boostA, alt: ST.alt, name: nb.name, gear: gearE, warp: ST.warp, atm: ST.skyS, landed: !!ST.landed, hull: ST.hull, cargo: ST.cargo, dock: ST.dk, contacts,
      pitch: Math.asin(clamp(dU, -1, 1)), roll: atan2(R[0] * up[0] + R[1] * up[1] + R[2] * up[2], U[0] * up[0] + U[1] * up[1] + U[2] * up[2]) });
  }
  if ((hudT += dt) > 0.12) {
    hudT = 0;
    info.textContent = (live || frozen) && !cp ? `SPEED  ${ST.speed | 0} u/s\nNEAR   ${nb.name}\nALT    ${max(ST.alt, 0) | 0} u\nHULL   ${ST.hull | 0}%${ST.cargo ? `   SCRAP ${ST.cargo}` : ''}${stats || CFG.stats ? `\n${fps | 0} fps · ${W}×${H} (${RS * 100 | 0}%) · ${['Low', 'Medium', 'High', 'Ultra', 'Custom'][GP.p]}` : ''}` : '';
    $('t').style.bottom = cp ? '30%' : '';
    const m = live && !ST.wPh ? ST.msg : '';
    if (m !== msgShown) { msgShown = $('t').textContent = m; $('t').className = m ? 'on' : ''; }
    const wm = live && ST.wPh === 1 ? 'Warp drive charging · ' + (typeof ST.wDest === 'number' ? BODIES[ST.wDest] : ST.wDest).name : '';
    if (wm !== wmShown) { wmShown = $('wm').textContent = wm || wmShown; $('wm').className = wm ? 'on' : ''; if (!wm) wmShown = ''; }
  }
};

// ---------------------------------------------------------------- go
newGame();
const first = readSlot(0);
let last = performance.now();
const loop = (now) => {
  if (dead) return;
  try { frame(min((now - last) / 1000, 0.05) || 0.016); } catch (e) { if (!loop.err) { loop.err = 1; console.error('frame error:', e); $('t').textContent = 'Error: ' + e.message; $('t').className = 'on'; } }
  last = now;
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
await Q.onSubmittedWorkDone();
try { delete localStorage.stellarLoad; } catch {}
await say('Ready', 1);
setMode('main');
if (location.hash === "#dev") window.dev = { SND, IN, ST, SH, BODIES, IDX, groundR, tickBodies, snapCam, warpTo, STATION, COMETS, WRECKS, BELT_POI, POI_KEYS, ortho };   // test hook
