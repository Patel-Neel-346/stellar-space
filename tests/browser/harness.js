// Shared by the test scripts: launches Chromium with software WebGPU and redirects the canvas into a readable texture.
const OUT = require('path').resolve(process.env.OUT || 'shots'); const fs_ = require('fs'); fs_.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const fs = require('fs');
const ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-webgpu-developer-features', '--ignore-gpu-blocklist', '--no-sandbox'];
const INIT = () => {
  window.__cbs = []; window.__now = performance.now();
  window.requestAnimationFrame = (cb) => { window.__cbs.push(cb); return 1; };
  window.__step = async (n, dt) => {
    const times = [];
    for (let i = 0; i < n; i++) {
      const cbs = window.__cbs; window.__cbs = []; window.__now += dt;
      const t0 = performance.now();
      for (const cb of cbs) cb(window.__now);
      await window.__dev.queue.onSubmittedWorkDone();
      times.push(performance.now() - t0);
    }
    return times;
  };
  const origReq = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (d) { const dev = await origReq.call(this, d); window.__dev = dev; return dev; };
  GPUCanvasContext.prototype.getCurrentTexture = function () {
    const c = this.canvas, dev = window.__dev;
    if (!window.__off || window.__off.width !== c.width || window.__off.height !== c.height) {
      window.__off?.destroy();
      window.__off = dev.createTexture({ size: [c.width, c.height], format: navigator.gpu.getPreferredCanvasFormat(), usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    }
    return window.__off;
  };
  window.__read = async () => {
    const t = window.__off, dev = window.__dev, w = t.width, h = t.height, bpr = Math.ceil(w * 4 / 256) * 256;
    const buf = dev.createBuffer({ size: bpr * h, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = dev.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: t }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    dev.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange()), out = new Uint8Array(w * h * 4);
    const bgra = navigator.gpu.getPreferredCanvasFormat() === 'bgra8unorm';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = y * bpr + x * 4, d = (y * w + x) * 4; out[d] = src[s + (bgra ? 2 : 0)]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + (bgra ? 0 : 2)]; out[d + 3] = 255; }
    buf.unmap(); buf.destroy();
    let bin = ''; for (let i = 0; i < out.length; i += 8192) bin += String.fromCharCode.apply(null, out.subarray(i, i + 8192));
    return { w, h, b64: btoa(bin) };
  };
};
async function open(opts = {}) {
  const browser = await chromium.launch({ headless: true, args: ARGS });
  const ctx = await browser.newContext({ viewport: { width: opts.w || 800, height: opts.h || 450 } });
  await ctx.addInitScript(INIT);
  if (opts.level !== undefined) await ctx.addInitScript((l) => { try { localStorage.stellar = l; } catch {} }, String(opts.level));
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto('file://' + (opts.file || require('path').join(__dirname, '..', '..', 'index.html')) + (opts.hash || ''));
  await page.waitForFunction(() => document.body.className === 'm' || document.body.className === 'l e', null, { timeout: 120000, polling: 200 });
  const shot = async (name) => {
    const r = await page.evaluate(() => window.__read());
    fs.writeFileSync(`${OUT}/${name}.rgba`, Buffer.from(r.b64, 'base64'));
    require('child_process').execSync(`python3 -c "from PIL import Image; Image.frombytes('RGBA',(${r.w},${r.h}),open('${OUT}/${name}.rgba','rb').read()).save('${OUT}/${name}.png')"`);
    return `${OUT}/${name}.png`;
  };
  const step = (n = 1, dt = 16.7) => page.evaluate(([a, b]) => window.__step(a, b), [n, dt]);
  return { browser, page, logs, shot, step };
}
module.exports = { open, OUT };
