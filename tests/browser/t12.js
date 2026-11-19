const { open, OUT } = require('./harness.js');
(async () => {
  const { browser, page, logs, shot, step } = await open({ w: 640, h: 360, hash: '#dev' });
  const comp = async (name) => {
    const c = await shot(name + '_c');
    await page.addStyleTag({ content: 'html,body{background:transparent!important} canvas#c{visibility:hidden!important}' });
    await page.screenshot({ path: `${OUT}/${name}_d.png`, omitBackground: true });
    await page.evaluate(() => { document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('visibility:hidden!important')) s.remove(); }); });
    require('child_process').execSync(`python3 -c "
from PIL import Image
a=Image.open('${c}').convert('RGBA');b=Image.open('${OUT}/${name}_d.png').convert('RGBA').resize(a.size)
a.alpha_composite(b);a.convert('RGB').save('${OUT}/${name}.png')"`);
  };
  await step(20, 100);
  await page.evaluate(() => [...document.querySelectorAll('#nav button')].find((b) => /new game/i.test(b.textContent)).click());
  await step(5, 30);
  // A: level over Verdant, then roll right with the real E key
  await page.evaluate(() => {
    const { SH, BODIES, IDX, snapCam } = window.dev, b = BODIES[IDX.Verdant];
    const n = [0.2, 0.4, 1], l = Math.hypot(...n); for (let i = 0; i < 3; i++) n[i] /= l;
    for (let i = 0; i < 3; i++) { SH.p[i] = b.pos[i] + n[i] * (b.R + 500); SH.v[i] = b.vel[i]; }
    let t = [n[2], 0, -n[0]]; const tl = Math.hypot(...t); t = t.map((x) => x / tl);
    const f = t, u = n, rr = [f[1] * u[2] - f[2] * u[1], f[2] * u[0] - f[0] * u[2], f[0] * u[1] - f[1] * u[0]];
    SH.f.set(f); SH.u.set(u); SH.r.set(rr); snapCam();
  });
  await page.keyboard.press('KeyV');
  await step(15, 40); await comp('s4_level');
  await page.keyboard.down('KeyE'); await step(14, 50); await page.keyboard.up('KeyE'); await step(6, 40);
  const roll = await page.evaluate(() => { const { SH, ST } = window.dev; return { rightDotUp: SH.r[0] * ST.up[0] + SH.r[1] * ST.up[1] + SH.r[2] * ST.up[2] }; });
  console.log('after holding E: right-wing . planet-up =', roll.rightDotUp.toFixed(3), roll.rightDotUp > 0 ? '(right wing up)' : '(right wing down)');
  await comp('s4_roll');
  await page.keyboard.press('KeyV');
  // B: dock prompt
  await page.evaluate(() => {
    const d = window.dev, S = d.STATION; d.tickBodies(d.ST.t);
    d.SH.p.set([S.pos[0] + 20, S.pos[1] + 200, S.pos[2]]); d.SH.v.set(S.vel);
    const f = [-0.1, -1, 0], l = Math.hypot(...f); d.SH.f.set(f.map((x) => x / l)); d.SH.r.set([0, 0, 1]); d.ortho(); d.snapCam();
  });
  await step(20, 40); await comp('s4_dockprompt');
  const msg = await page.evaluate(() => document.getElementById('t').textContent); console.log('prompt:', msg);
  await page.keyboard.press('KeyF'); await step(60, 100);
  const dk = await page.evaluate(() => window.dev.ST.dk); console.log('dk after F + 6 s:', dk);
  await comp('s4_docked'); console.log('docked msg:', await page.evaluate(() => document.getElementById('t').textContent), '| radio:', await page.evaluate(() => document.getElementById('rd').textContent));
  // C: ram the hub
  await page.evaluate(() => {
    const d = window.dev, S = d.STATION; d.ST.dk = 0;
    d.SH.p.set([S.pos[0] + 260, S.pos[1] + 5, S.pos[2]]); d.SH.v.set(S.vel);
    d.SH.f.set([-1, 0, 0]); d.SH.r.set([0, 0, -1]); d.ortho(); d.snapCam();
  });
  await page.keyboard.down('KeyW'); await step(75, 40);
  const st = await page.evaluate(() => ({ hull: window.dev.ST.hull, hit: window.dev.ST.hit, op: document.getElementById('hf').style.opacity }));
  console.log('ram:', JSON.stringify(st)); await comp('s4_impact');
  await page.keyboard.up('KeyW');
  console.log([...new Set(logs)].join('\n') || 'no logs');
  await browser.close();
})();
