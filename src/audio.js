// ============================================================================
// audio: procedural space ambience and ship sounds (no sample files)
// ============================================================================
// A fixed Web Audio graph, built on the first click / key and driven by a 10 Hz timer, not the frame loop.
// Three buses feed one master: ambience (rumble, drone, pad, pings, telemetry, distant sweeps), ship (reactor hum, engine,
// boost whoosh, warp, wind in an atmosphere) and interface (menu ticks and clicks). The sliders in the Audio panel set the
// bus gains (AUD, see quality.js). The ship layers follow SND, which main.js fills in every frame.
let AC, OUT, BUS = {}, UIS = () => {};
// push AUD to the graph (called after every slider move)
const audApply = () => {
  if (!AC || !OUT) return;
  const t = AC.currentTime;
  OUT.gain.setTargetAtTime(AUD.mute ? 0 : AUD.master, t, 0.08);
  BUS.amb.gain.setTargetAtTime(AUD.amb, t, 0.08); BUS.eng.gain.setTargetAtTime(AUD.eng, t, 0.08); BUS.ui.gain.setTargetAtTime(AUD.ui, t, 0.08);
};
function mkSound(ac) {
  const sr = ac.sampleRate;
  const N = (C, o, ...to) => { const n = new C(ac, o); for (const d of to) n.connect(d); if (n.start) n.start(); return n; };
  const G = (gain, ...to) => N(GainNode, { gain }, ...to);
  const BQ = (type, frequency, Q, ...to) => N(BiquadFilterNode, { type, frequency, Q }, ...to);
  const lfo = (frequency, depth, to) => N(OscillatorNode, { frequency }, G(depth, to));
  const noise = (secs, f) => { const n = sr * secs | 0, b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr }); f(b.getChannelData(0), n); f(b.getChannelData(1), n); return b; };
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const rr = (a, b) => a + (b - a) * rnd();
  // seamless brown noise loop (the end cross-fades into the start)
  const nb = noise(11, (d, n) => { for (let i = 0, b = 0; i < n + 4096; i++) { b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02; if (i < n) d[i] = b * 3.5; else { const k = (i - n) / 4096; d[i - n] = d[i - n] * k + b * 3.5 * (1 - k); } } });
  // reverb impulse: 6 s of noise that fades out and gets darker
  const ir = noise(6, (d, n) => { for (let i = 0, b = 0; i < n; i++) { const t = i / sr; b += (rnd() * 2 - 1 - b) * (0.04 + 0.5 * exp(-t * 2)); d[i] = b * (1 - exp(-t * 30)) * exp(-t * 1.1) * (1 - i / n); } });

  const lim = N(DynamicsCompressorNode, { threshold: -6, knee: 6, ratio: 20, attack: 0.003, release: 0.3 }, ac.destination);
  const out = OUT = G(0, lim);
  const amb = BUS.amb = G(AUD.amb, out), eb = BUS.eng = G(AUD.eng, out), uib = BUS.ui = G(AUD.ui, out);
  const wet = N(ConvolverNode, { buffer: ir }, amb);                  // ambience reverb
  const src = (playbackRate, ...to) => N(AudioBufferSourceNode, { buffer: nb, loop: true, playbackRate }, ...to);
  // ---- ambience: deep rumble, sub drone (three notes, each a detuned pair that slowly beats), slow pad
  const rum = G(0.45, amb); src(0.8, BQ('lowpass', 110, 0.7, rum)); lfo(0.05, 0.14, rum.gain);
  const sub = G(0.05, amb, G(0.8, wet));
  [36.71, 55, 73.42].forEach((f, i) => { N(OscillatorNode, { frequency: f }, sub); N(OscillatorNode, { frequency: f + 0.07 * (i + 1) }, sub); });
  lfo(0.04, 0.02, sub.gain);
  const padF = BQ('lowpass', 700, 0.5, G(0.045, amb, G(1.8, wet)));
  [73.42, 110, 146.83, 174.61, 220, 261.63].forEach((f) => { N(OscillatorNode, { type: 'sawtooth', frequency: f }, padF); N(OscillatorNode, { type: 'sawtooth', frequency: f * 1.004 }, padF); });
  lfo(0.021, 380, padF.frequency); lfo(0.037, 200, padF.frequency);
  // ---- ship: reactor hum (always there, you are inside the ship), engine (noise + low saw), boost whoosh, warp, wind
  const rea = G(0.05, eb); N(OscillatorNode, { frequency: 55 }, rea); N(OscillatorNode, { type: 'triangle', frequency: 110.4 }, G(0.5, rea)); lfo(0.3, 0.012, rea.gain);
  const eng = G(0, eb), engF = BQ('bandpass', 140, 1.2, eng); src(1.3, engF);
  const engO = G(0, eb), sawO = N(OscillatorNode, { type: 'sawtooth', frequency: 48 }, BQ('lowpass', 220, 0.7, engO));
  const wh = G(0, eb), whF = BQ('bandpass', 900, 0.6, wh); src(3, whF);
  const wp = G(0, eb), wpF = BQ('bandpass', 400, 0.9, wp); src(2.4, wpF);       // warp: a rising rush of noise
  const wo = G(0, eb), woO = N(OscillatorNode, { type: 'sawtooth', frequency: 60 }, BQ('lowpass', 500, 0.8, wo));   // and a rising tone under it
  const wind = G(0, eb), windF = BQ('bandpass', 500, 0.7, wind); src(1.9, windF);
  // ---- pooled voices: oscillator -> envelope -> pan -> dry + reverb
  const pool = (n, send, type, dest) => Array.from({ length: n }, () => { const p = N(StereoPannerNode, {}, dest, G(send, wet)), g = G(0, p); return { p, g, o: N(OscillatorNode, { type }, g) }; });
  const ping = pool(4, 1.6, 'sine', amb), blip = pool(3, 0.5, 'sine', amb), sweep = pool(2, 2.5, 'sine', amb), thump = pool(2, 0.8, 'sine', eb);
  const play = (vs, t, f0, f1, dur, vol, att) => {
    const v = vs.shift(), f = v.o.frequency, g = v.g.gain; vs.push(v);
    v.p.pan.setValueAtTime(rr(-0.7, 0.7), t);
    f.setValueAtTime(f0, t); f.exponentialRampToValueAtTime(f1, t + dur);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(vol, t + att); g.setTargetAtTime(0, t + att, (dur - att) / 5);
  };

  // ---- one-shot helpers (nodes are created per event and left to be collected)
  const tone = (dest, f0, f1, dur, vol, type = 'sine', at = 0, pan = 0) => {
    const t = ac.currentTime + 0.02 + at, o = new OscillatorNode(ac, { type, frequency: f0 }), g = new GainNode(ac, { gain: 0 }), p = new StereoPannerNode(ac, { pan });
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(max(f1, 1), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + min(0.01, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(p); p.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  };
  const burst = (dest, type, f0, f1, q, dur, vol, at = 0, pan = 0) => {   // a puff of filtered noise whose cutoff glides from f0 to f1
    const t = ac.currentTime + 0.02 + at, s = new AudioBufferSourceNode(ac, { buffer: nb, playbackRate: 2.5 }), f = new BiquadFilterNode(ac, { type, frequency: f0, Q: q }), g = new GainNode(ac, { gain: 0 }), p = new StereoPannerNode(ac, { pan });
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(max(f1, 20), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(p); p.connect(dest); s.start(t, rnd() * 8, dur + 0.1);
  };
  // ---- ship events: impact, docking clamps, landing gear, crash, hull alarm, salvage beam
  const sfx = {
    hit: (a, metal) => {
      burst(eb, 'lowpass', 200 + 1600 * a, 60, 0.7, 0.25 + 0.4 * a, 0.5 * a + 0.1);
      play(thump, ac.currentTime + 0.02, 120, 28, 0.5, 0.35 + 0.6 * a, 0.004);
      if (metal) for (const [f, v] of [[310, 1], [517, 0.6], [833, 0.4]]) tone(eb, f * (1 + 0.1 * rnd()), f * 0.97, 0.7 + a, 0.07 * v * (0.4 + a), 'triangle');
      else burst(eb, 'bandpass', 900, 300, 1.2, 0.2, 0.15 * a);
    },
    dock: () => { play(thump, ac.currentTime + 0.02, 90, 35, 0.6, 0.8, 0.004); burst(eb, 'highpass', 4000, 2500, 0.7, 0.7, 0.22, 0.1); tone(eb, 540, 540, 0.08, 0.06, 'square', 0.05); tone(eb, 720, 720, 0.08, 0.06, 'square', 0.18); },
    gear: () => { tone(eb, 90, 170, 0.9, 0.05, 'sawtooth'); tone(eb, 140, 260, 0.9, 0.02, 'square'); burst(eb, 'bandpass', 1800, 900, 2, 0.9, 0.05); play(thump, ac.currentTime + 0.95, 80, 40, 0.3, 0.4, 0.004); },
    crash: () => { burst(eb, 'lowpass', 900, 40, 0.7, 2.2, 1); play(thump, ac.currentTime + 0.02, 70, 20, 2.5, 1, 0.005); burst(eb, 'bandpass', 3000, 200, 0.8, 1.2, 0.3, 0.05); },
  };
  const bm = G(0, eb), bmO = N(OscillatorNode, { type: 'sawtooth', frequency: 200 }, BQ('bandpass', 700, 2, bm)); lfo(9, 25, bmO.frequency);   // salvage beam: a wobbling, rising tone
  // ---- atmospheric entry: a roar of noise that deepens with speed, with a low rumble under it
  const en = G(0, eb), enF = BQ('lowpass', 900, 0.6, en); src(1.6, enF);
  const enR = G(0, eb); src(0.7, BQ('lowpass', 90, 1.5, enR));
  // ---- surface ambience, by kind of world: living (insects, surf, wind through leaves), ice (howling wind), volcanic (deep rumble)
  const ins = G(0, amb), insC = G(0.5, ins); src(4, BQ('bandpass', 5600, 6, insC)); lfo(38, 0.5, insC.gain);           // insect chirr: noise chopped by a fast LFO
  const surf = G(0, amb), surfC = G(0.65, surf); src(1.1, BQ('lowpass', 700, 0.5, surfC)); lfo(0.11, 0.35, surfC.gain);   // waves: slow swell
  const howl = G(0, amb), howlF = BQ('bandpass', 420, 6, howl); src(1.5, howlF); lfo(0.07, 160, howlF.frequency); lfo(0.13, 90, howlF.frequency);
  const lav = G(0, amb), lavC = G(0.75, lav); src(0.55, BQ('lowpass', 70, 1.2, lavC)); lfo(0.3, 0.25, lavC.gain);
  // ---- wildlife calls (one-shot): bird chirps and a far-off long call on living worlds, crackle and hiss on volcanic ones
  const birds = () => {
    const pan = rr(-0.8, 0.8), f = rr(2200, 4200), kind = rnd();
    if (kind < 0.55) for (let i = 0, n = 2 + rnd() * 3 | 0; i < n; i++) tone(amb, f * rr(0.9, 1.1), f * rr(1.2, 1.5), 0.09, 0.035, 'sine', i * 0.13, pan);   // chirp-chirp
    else if (kind < 0.85) { for (let i = 0; i < 5; i++) tone(amb, f * 0.7 + i * 90, f * 0.7 + i * 90 + 300, 0.07, 0.03, 'triangle', i * 0.07, pan); }                              // trill
    else { const d = rr(1.2, 2); tone(amb, rr(380, 520), rr(200, 300), d, 0.05, 'sawtooth', 0, pan); tone(amb, rr(780, 1000), rr(400, 560), d, 0.03, 'sawtooth', 0.02, pan); } // a far, low call
  };
  const crackle = () => { burst(amb, 'bandpass', rr(1500, 4500), 800, 3, rr(0.03, 0.09), rr(0.05, 0.12), 0, rr(-0.8, 0.8)); };
  // ---- radio: speech-like babble. A buzzing voice (saw wave at a wobbling pitch) goes through two moving formant filters that jump
  // to new vowels every syllable, then a narrow radio band with a little distortion, opened and closed with squelch clicks.
  const sat = new WaveShaperNode(ac, { curve: Float32Array.from({ length: 256 }, (_, i) => Math.tanh((i / 127.5 - 1) * 2.2)) });
  const rb = BQ('highpass', 420, 0.7, BQ('lowpass', 2900, 0.7, sat));
  const radioOut = G(0.55, uib, G(0.15, wet)); sat.connect(radioOut);
  const talk = (secs) => {
    const t0 = ac.currentTime + 0.05, voice = new OscillatorNode(ac, { type: 'sawtooth', frequency: rr(105, 150) }), env = new GainNode(ac, { gain: 0 });
    const f1 = new BiquadFilterNode(ac, { type: 'bandpass', frequency: 500, Q: 5 }), f2 = new BiquadFilterNode(ac, { type: 'bandpass', frequency: 1500, Q: 7 }), sum = new GainNode(ac, { gain: 1 });
    voice.connect(env); env.connect(f1); env.connect(f2); f1.connect(sum); f2.connect(sum); sum.connect(rb);
    const hiss = new AudioBufferSourceNode(ac, { buffer: nb, playbackRate: 4, loop: true }), hg = new GainNode(ac, { gain: 0.05 });
    hiss.connect(hg); hg.connect(rb);
    let t = t0, base = voice.frequency.value;
    voice.frequency.setValueAtTime(base, t);
    while (t < t0 + secs) {
      const syl = rr(0.09, 0.2), vow = rnd();
      f1.frequency.setTargetAtTime(280 + 600 * vow, t, 0.02); f2.frequency.setTargetAtTime(900 + 1500 * rnd(), t, 0.02);
      voice.frequency.setTargetAtTime(base * rr(0.85, 1.2), t, 0.03);
      env.gain.setTargetAtTime(rnd() < 0.15 ? 0.05 : 0.9, t, 0.012); env.gain.setTargetAtTime(0.08, t + syl * 0.75, 0.015);   // each syllable swells and drops
      t += syl + (rnd() < 0.18 ? rr(0.12, 0.3) : 0);                                                                       // now and then a pause between words
    }
    env.gain.setTargetAtTime(0, t, 0.02);
    voice.start(t0); hiss.start(t0 - 0.05); voice.stop(t + 0.2); hiss.stop(t + 0.2);
    // squelch clicks at both ends
    for (const at of [t0 - 0.04, t + 0.05]) burst(uib, 'bandpass', 2400, 1400, 1.5, 0.06, 0.08, at - ac.currentTime - 0.02);
    tone(uib, 1700, 1700, 0.04, 0.04, 'square', t0 - ac.currentTime - 0.06);
  };

  // ---- interface sounds: tiny enveloped tones, created per event
  UIS = (kind) => {
    if (AC.state !== 'running') return;
    const t0 = ac.currentTime + 0.01;
    const tone = (f0, f1, dur, vol, type, at = 0) => {
      const o = new OscillatorNode(ac, { type, frequency: f0 }), g = new GainNode(ac, { gain: 0 }), t = t0 + at;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(uib); o.start(t); o.stop(t + dur + 0.03);
    };
    if (kind === 'hover') tone(2100, 2500, 0.05, 0.05, 'sine');
    else if (kind === 'click') { tone(880, 1320, 0.1, 0.12, 'triangle'); tone(1760, 2300, 0.08, 0.05, 'sine', 0.035); }
    else if (kind === 'back') tone(760, 440, 0.13, 0.1, 'triangle');
    else if (kind === 'toggle') { tone(1300, 1700, 0.06, 0.07, 'sine'); tone(2600, 3000, 0.04, 0.03, 'sine', 0.03); }
    else if (kind === 'cockpit') { tone(1500, 1500, 0.045, 0.07, 'square'); tone(2000, 2000, 0.045, 0.06, 'square', 0.07); }
    else if (kind === 'warp') { tone(220, 880, 0.9, 0.07, 'sawtooth'); tone(440, 1760, 0.9, 0.03, 'sine', 0.05); }
  };
  const NOTES = [0, 3, 5, 7, 10, 12, 15, 17, 19]; // D minor pentatonic, in semitones above D5
  const lt = ac.currentTime;
  let tP = lt + 2, tB = lt + 14, tS = lt + 25, ev = SND.ev, hit = SND.hit, dock = SND.dock, crash = SND.crash, say = SND.say, tBird = lt + 3, tCr = lt + 2, tAl = 0, gearEv = SND.gear;
  audApply();
  return () => {
    const now = ac.currentTime, t = now + 0.05, v = SND.spd, thr = SND.thr, air = SND.atm, w = SND.warp, bo = SND.boost;
    eng.gain.setTargetAtTime(0.02 + 0.16 * thr, t, 0.15); engF.frequency.setTargetAtTime(110 + 260 * thr + 120 * bo + min(v / 18, 120), t, 0.2);
    engO.gain.setTargetAtTime(0.012 + 0.10 * thr + 0.03 * bo, t, 0.2);
    sawO.frequency.setTargetAtTime(44 + 34 * thr + 26 * bo + 40 * w, t, 0.25);        // the engine note rises with thrust
    wh.gain.setTargetAtTime((0.22 * bo * min(v / 600, 1) + 0.12 * bo) * (1 - w), t, 0.3); whF.frequency.setTargetAtTime(500 + v * 0.3, t, 0.3);
    wp.gain.setTargetAtTime(0.5 * w * w, t, 0.2); wpF.frequency.setTargetAtTime(300 + 2600 * w, t, 0.25);
    wo.gain.setTargetAtTime(0.14 * w, t, 0.2); woO.frequency.setTargetAtTime(60 + 300 * w * w, t, 0.25);
    wind.gain.setTargetAtTime(air * (0.03 + 0.55 * min(v / 160, 1)), t, 0.4); windF.frequency.setTargetAtTime(260 + v * 2, t, 0.4);

    // impacts, docking, crash and the radio voice
    if (SND.hit !== hit) { hit = SND.hit; sfx.hit(SND.hitP, SND.hitM); }
    if (SND.dock !== dock) { dock = SND.dock; sfx.dock(); }
    if (SND.crash !== crash) { crash = SND.crash; sfx.crash(); }
    if (SND.gear !== gearEv) { gearEv = SND.gear; sfx.gear(); }
    if (SND.say !== say) { say = SND.say; if (say) talk(clamp(0.8 + say.text.length * 0.052, 1, 5)); }
    bm.gain.setTargetAtTime(SND.beam ? 0.05 : 0, t, 0.1); bmO.frequency.setTargetAtTime(160 + 420 * SND.beamP, t, 0.1);
    if (SND.hull < 30 && t > tAl && !AUD.mute) { tone(eb, 880, 880, 0.12, 0.05, 'square'); tone(eb, 660, 660, 0.12, 0.05, 'square', 0.18); tAl = t + 1.6; }
    // atmospheric entry
    const entry = SND.entry;
    en.gain.setTargetAtTime(0.55 * entry, t, 0.3); enF.frequency.setTargetAtTime(500 + 1800 * entry, t, 0.3); enR.gain.setTargetAtTime(0.5 * entry, t, 0.3);
    // surface life: only low in an atmosphere, and each kind of world sounds different
    const gd = SND.grd * (1 - w), bio = SND.bio;
    ins.gain.setTargetAtTime(bio === 1 ? 0.03 * gd : 0, t, 1); surf.gain.setTargetAtTime(bio === 1 ? 0.09 * gd : 0, t, 1);
    howl.gain.setTargetAtTime(bio === 3 ? 0.35 * gd : 0, t, 1); lav.gain.setTargetAtTime(bio === 4 ? 0.9 * gd : 0, t, 1);
    if (gd > 0.25 && bio === 1 && t > tBird) { birds(); tBird = t + rr(0.7, 3.2) / gd; }
    if (gd > 0.25 && bio === 4 && t > tCr) { crackle(); tCr = t + rr(0.05, 0.6); }
    rum.gain.setTargetAtTime(SND.landed ? 0.2 : 0.45, t, 1.5);
    if (SND.ev !== ev) { ev = SND.ev; play(thump, t, 110, 26, 2.4, 0.6, 0.015); }   // the jump itself: a deep thump
    if (t > tP) { // a star ping, sometimes a short falling arpeggio
      let tt = t;
      for (let n = rnd() < 0.35 ? 3 : 1; n--;) { const f = 587.33 * pow(2, NOTES[rnd() * 9 | 0] / 12); play(ping, tt, f, f, 4.5, rr(0.015, 0.035), 0.02); tt += rr(0.22, 0.4); }
      tP = tt + rr(3, 11);
    }
    if (t > tB) { // telemetry: a run of short beeps, far away
      let tt = t; const f = rr(1100, 2300);
      for (let n = 2 + rnd() * 3 | 0; n--;) { play(blip, tt, f, f, 0.16, 0.02, 0.01); tt += rr(0.12, 0.25); }
      tB = tt + rr(18, 45);
    }
    if (t > tS) { // a slow, deep glide, like something huge passing far off
      const f = rr(70, 110), d = rr(5, 8);
      play(sweep, t, f, f * rr(0.5, 0.8), d, 0.09, d * 0.45);
      tS = t + d + rr(30, 70);
    }
  };
}
// called on every click / key: builds the graph once and resumes it when the browser allows
function sound() {
  if (!AC) {
    AC = new AudioContext({ latencyHint: 'playback' });
    const tick = mkSound(AC), id = setInterval(() => { try { tick(); } catch (e) { console.error('audio stopped:', e); clearInterval(id); } }, 100);
  }
  if (AC.state === 'suspended' && !document.hidden) AC.resume();
}
const ui = (k) => { try { UIS(k); } catch {} };       // menu sound, silently ignored until the audio graph exists
const mute = () => { AUD.mute = AUD.mute ? 0 : 1; audSave(); audApply(); };
document.addEventListener('visibilitychange', () => { if (AC) document.hidden ? AC.suspend() : AC.resume(); });
