// ============================================================================
// cockpit: the canopy frame, dashboard and instruments drawn over the scene in first-person view
// ============================================================================
// A full-screen 2D canvas on top of the 3D view. The frame (pillars, bow, dash, bezels) is drawn once per window size and
// kept; the instruments are redrawn about 20 times a second:
//   left   speed dial (logarithmic, amber part = boost), throttle bar
//   centre artificial horizon against the nearest world, nearest world and altitude
//   right  radar: forward is up, distance is logarithmic; planets, the sun, comets, the station and wrecks
//   top    status lights for landing gear, atmosphere, warp and landing
let dashCache = null, dashKey = '';
const dashInk = '#7fd0ff', dashAmb = '#ffb347', dashGrn = '#5ef2a0';
const dashLayout = (w, h) => ({ y: h * 0.885, r: h * 0.085, xl: w * 0.29, xc: w * 0.5, xr: w * 0.71 });
const dashStatic = (w, h) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), L = dashLayout(w, h);
  x.fillStyle = '#04060a';
  for (const m of [1, -1]) {                         // A-pillars
    x.beginPath(); x.moveTo(m > 0 ? 0 : w, 0); x.lineTo(m > 0 ? w * 0.07 : w * 0.93, 0); x.lineTo(m > 0 ? w * 0.015 : w * 0.985, h * 0.6); x.lineTo(m > 0 ? 0 : w, h * 0.72); x.fill();
  }
  x.beginPath(); x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w, h * 0.03); x.quadraticCurveTo(w / 2, h * 0.07, 0, h * 0.03); x.fill();   // top bow
  const top = (p) => { p.moveTo(0, h * 0.8); p.quadraticCurveTo(w * 0.25, h * 0.72, w * 0.5, h * 0.745); p.quadraticCurveTo(w * 0.75, h * 0.72, w, h * 0.8); };
  const g = x.createLinearGradient(0, h * 0.72, 0, h); g.addColorStop(0, '#121923'); g.addColorStop(0.35, '#0a0f16'); g.addColorStop(1, '#03050a');
  x.fillStyle = g; x.beginPath(); top(x); x.lineTo(w, h); x.lineTo(0, h); x.fill();
  x.strokeStyle = 'rgba(127,208,255,.4)'; x.lineWidth = Math.max(1.5, h * 0.003); x.beginPath(); top(x); x.stroke();
  // panel seams and vents
  x.strokeStyle = 'rgba(127,208,255,.08)'; x.lineWidth = 1;
  for (let i = 1; i < 14; i++) { x.beginPath(); x.moveTo(w * i / 14, h * 0.78); x.lineTo(w * i / 14 + (i - 7) * w * 0.012, h); x.stroke(); }
  x.fillStyle = 'rgba(0,0,0,.45)';
  for (const m of [0.1, 0.9]) for (let i = 0; i < 5; i++) x.fillRect(w * m - w * 0.03, h * (0.87 + i * 0.022), w * 0.06, h * 0.008);
  // bezels
  for (const cx of [L.xl, L.xc, L.xr]) {
    x.fillStyle = '#05080d'; x.beginPath(); x.arc(cx, L.y, L.r * 1.18, 0, TAU); x.fill();
    x.strokeStyle = 'rgba(127,208,255,.35)'; x.lineWidth = Math.max(1.5, h * 0.003); x.beginPath(); x.arc(cx, L.y, L.r * 1.18, 0, TAU); x.stroke();
  }
  return c;
};
const dashText = (x, t, px, py, size, col, align = 'center') => { x.font = `600 ${size}px Rajdhani, system-ui, sans-serif`; x.fillStyle = col; x.textAlign = align; x.fillText(t, px, py); };
// d: speed, thr, boost, alt, name, roll, pitch, gear, warp, atm, landed, contacts [{x, y, z, type}]
const drawDash = (cv, d) => {
  const w = cv.width, h = cv.height, x = cv.getContext('2d'), key = w + 'x' + h;
  if (key !== dashKey) { dashCache = dashStatic(w, h); dashKey = key; }
  x.clearRect(0, 0, w, h);
  x.drawImage(dashCache, 0, 0);
  const L = dashLayout(w, h), r = L.r, fs = h * 0.024;
  // ---- speed dial: 240 degree arc, logarithmic
  const a0 = PI * 0.65, sweep = PI * 1.7, f = clamp(Math.log10(1 + d.speed) / Math.log10(1 + 4000), 0, 1);
  x.lineWidth = r * 0.12; x.lineCap = 'round';
  x.strokeStyle = 'rgba(127,208,255,.15)'; x.beginPath(); x.arc(L.xl, L.y, r, a0, a0 + sweep); x.stroke();
  x.strokeStyle = d.boost > 0.3 ? dashAmb : dashInk; x.beginPath(); x.arc(L.xl, L.y, r, a0, a0 + sweep * f); x.stroke();
  x.lineWidth = 1; x.strokeStyle = 'rgba(127,208,255,.5)';
  for (let i = 0; i <= 8; i++) { const a = a0 + sweep * i / 8; x.beginPath(); x.moveTo(L.xl + cos(a) * r * 0.78, L.y + sin(a) * r * 0.78); x.lineTo(L.xl + cos(a) * r * 0.9, L.y + sin(a) * r * 0.9); x.stroke(); }
  dashText(x, String(d.speed | 0), L.xl, L.y + fs * 0.35, fs * 1.7, '#e9f1ff');
  dashText(x, 'SPEED  U/S', L.xl, L.y + r * 0.62, fs * 0.62, '#8fa4c4');
  // throttle bar beside the dial
  const bx = L.xl - r * 1.55, bh = r * 1.5, th = clamp(d.thr / 1.5, 0, 1);
  x.fillStyle = 'rgba(127,208,255,.15)'; x.fillRect(bx, L.y - bh / 2, r * 0.18, bh);
  x.fillStyle = d.boost > 0.3 ? dashAmb : dashInk; x.fillRect(bx, L.y + bh / 2 - bh * th, r * 0.18, bh * th);
  dashText(x, 'THR', bx + r * 0.09, L.y + bh / 2 + fs * 0.9, fs * 0.55, '#8fa4c4');
  // ---- artificial horizon
  x.save(); x.beginPath(); x.arc(L.xc, L.y, r, 0, TAU); x.clip();
  x.translate(L.xc, L.y); x.rotate(d.roll);
  const py = d.pitch * r * 1.9 / (PI / 2) * 1.4;
  x.fillStyle = '#143a5e'; x.fillRect(-r * 2, -r * 3 + py, r * 4, r * 3);
  x.fillStyle = '#3b2e20'; x.fillRect(-r * 2, py, r * 4, r * 3);
  x.strokeStyle = '#e9f1ff'; x.lineWidth = Math.max(1.5, h * 0.003); x.beginPath(); x.moveTo(-r * 2, py); x.lineTo(r * 2, py); x.stroke();
  x.lineWidth = 1; x.strokeStyle = 'rgba(233,241,255,.5)';
  for (let k = -3; k <= 3; k++) if (k) { const yy = py - k * r * 0.33, ww = k % 2 ? r * 0.25 : r * 0.45; x.beginPath(); x.moveTo(-ww, yy); x.lineTo(ww, yy); x.stroke(); }
  x.restore();
  x.strokeStyle = dashAmb; x.lineWidth = Math.max(2, h * 0.004);
  x.beginPath(); x.moveTo(L.xc - r * 0.55, L.y); x.lineTo(L.xc - r * 0.2, L.y); x.lineTo(L.xc - r * 0.2, L.y + r * 0.1); x.moveTo(L.xc + r * 0.55, L.y); x.lineTo(L.xc + r * 0.2, L.y); x.lineTo(L.xc + r * 0.2, L.y + r * 0.1); x.stroke();
  x.beginPath(); x.arc(L.xc, L.y, r * 0.03, 0, TAU); x.stroke();
  dashText(x, d.name.toUpperCase(), L.xc, L.y - r * 1.34, fs * 0.8, '#e9f1ff');
  dashText(x, 'ALT ' + (max(d.alt, 0) | 0) + ' U', L.xc, L.y + r * 1.42, fs * 0.7, dashInk);
  // ---- radar
  x.strokeStyle = 'rgba(127,208,255,.25)'; x.lineWidth = 1;
  for (const k of [0.33, 0.66, 1]) { x.beginPath(); x.arc(L.xr, L.y, r * k, 0, TAU); x.stroke(); }
  x.beginPath(); x.moveTo(L.xr, L.y - r); x.lineTo(L.xr, L.y + r); x.moveTo(L.xr - r, L.y); x.lineTo(L.xr + r, L.y); x.stroke();
  x.fillStyle = dashGrn; x.beginPath(); x.moveTo(L.xr, L.y - r * 0.12); x.lineTo(L.xr - r * 0.07, L.y + r * 0.07); x.lineTo(L.xr + r * 0.07, L.y + r * 0.07); x.fill();
  const lr = Math.log10(1 + 80000 / 30);
  for (const c of d.contacts) {
    const dist = hypot(c.x, c.y, c.z), hd = hypot(c.x, c.z) || 1, rad = min(Math.log10(1 + dist / 30) / lr, 1) * r * 0.96;
    const px = L.xr + c.x / hd * rad, py2 = L.y - c.z / hd * rad;
    x.fillStyle = x.strokeStyle = c.type === 'planet' ? '#ffd28a' : c.type === 'sun' ? dashAmb : c.type === 'comet' ? '#9fe8ff' : dashInk;
    if (c.type === 'poi' || c.type === 'comet') { x.beginPath(); x.moveTo(px, py2 - 3); x.lineTo(px + 3, py2); x.lineTo(px, py2 + 3); x.lineTo(px - 3, py2); x.fill(); }
    else { x.beginPath(); x.arc(px, py2, c.type === 'sun' ? 4 : 2.5, 0, TAU); x.fill(); }
    const st = c.y / (dist || 1) * 9; x.lineWidth = 1; x.beginPath(); x.moveTo(px, py2); x.lineTo(px, py2 - st); x.stroke();
  }
  dashText(x, 'RADAR', L.xr, L.y + r * 1.42, fs * 0.7, '#8fa4c4');
  // hull bar beside the radar: turns red when low
  const hx = L.xr + r * 1.4, hh = r * 1.5, hf = clamp(d.hull / 100, 0, 1), hc = hf < 0.3 ? '#ff5a5a' : hf < 0.6 ? dashAmb : dashGrn;
  x.fillStyle = 'rgba(127,208,255,.15)'; x.fillRect(hx, L.y - hh / 2, r * 0.18, hh);
  x.fillStyle = hc; x.fillRect(hx, L.y + hh / 2 - hh * hf, r * 0.18, hh * hf);
  dashText(x, 'HULL', hx + r * 0.09, L.y + hh / 2 + fs * 0.9, fs * 0.55, hf < 0.3 ? '#ff5a5a' : '#8fa4c4');
  if (d.cargo) dashText(x, 'SCRAP ' + d.cargo, hx + r * 0.09, L.y - hh / 2 - fs * 0.5, fs * 0.55, '#ffd28a');
  // ---- status lights
  const lights = [['GEAR', d.gear > 0.95 ? dashGrn : d.gear > 0.05 ? dashAmb : null], ['ATMOS', d.atm > 0.1 ? dashInk : null], ['WARP', d.warp > 0.05 ? dashAmb : null], ['LANDED', d.landed ? dashGrn : null], ['DOCK', d.dock === 2 ? dashGrn : d.dock ? dashAmb : null]];
  lights.forEach(([t, col], i) => {
    const lx = w * (0.375 + i * 0.065), ly = h * 0.775;
    x.fillStyle = col || 'rgba(127,208,255,.12)'; x.beginPath(); x.arc(lx, ly, h * 0.006, 0, TAU); x.fill();
    dashText(x, t, lx, ly + h * 0.025, fs * 0.5, col ? '#e9f1ff' : '#4d5d78');
  });
};
