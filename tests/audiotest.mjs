const SRC = new URL('../src/', import.meta.url).pathname;
import { readFileSync } from 'node:fs';
const calls = { ping: 0, blip: 0, sweep: 0 };
class P { constructor() { this.value = 0; } setValueAtTime() { return this; } linearRampToValueAtTime() { return this; } exponentialRampToValueAtTime() { return this; } setTargetAtTime() { return this; } }
class N { constructor(ac, o = {}) { this.o = o; for (const k of ['gain', 'frequency', 'Q', 'pan', 'playbackRate', 'detune', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[k] = new P(); } connect() {} start() {} stop() {} }
const mk = () => class extends N {};
const g = { GainNode: mk(), OscillatorNode: mk(), BiquadFilterNode: mk(), StereoPannerNode: mk(), ConvolverNode: mk(), DynamicsCompressorNode: mk(), AudioBufferSourceNode: mk(), WaveShaperNode: mk() };
class AB { constructor(o) { this.ch = [new Float32Array(o.length), new Float32Array(o.length)]; } getChannelData(i) { return this.ch[i]; } }
class AC { constructor() { this.sampleRate = 8000; this.currentTime = 0; this.destination = new N(); this.state = 'running'; } resume() {} suspend() {} }
let timers = [];
const doc = { hidden: false, addEventListener() {} };
const src = ['math.js', 'audio.js'].map((f) => readFileSync(SRC + f, 'utf8')).join('\n');
const api = new Function('g', 'AudioContext', 'AudioBuffer', 'setInterval', 'clearInterval', 'document', 'SND', 'console', 'AUD',
  'const audSave=()=>{};\nconst {GainNode,OscillatorNode,BiquadFilterNode,StereoPannerNode,ConvolverNode,DynamicsCompressorNode,AudioBufferSourceNode,WaveShaperNode}=g;\n' + src + '\nreturn { sound, ctx: () => AC };');
const SND = { spd: 0, thr: 0, atm: 0, landed: false, boost: 0, warp: 0, ev: 0, hit: 0, hitP: 0, hitM: 0, dock: 0, gear: 0, crash: 0, hull: 100, beam: 0, beamP: 0, grd: 0, bio: -1, entry: 0, say: null };
const errors = [];
const { sound, ctx } = api(g, AC, AB, (f, ms) => { const t = { f, ms, alive: true }; timers.push(t); return t; }, (t) => { t.alive = false; }, doc, SND, { error: (...a) => errors.push(a.join(' ')) }, { master: 0.8, amb: 0.8, eng: 0.8, ui: 0.8, mute: 0 });
sound();
const ac = ctx();
let ticks = 0;
for (let s = 0; s < 300 * 10; s++) {            // 5 minutes of audio time in 100 ms steps
  ac.currentTime += 0.1;
  SND.spd = 200 + 300 * Math.sin(s / 50); SND.thr = Math.max(0, Math.sin(s / 70)); SND.atm = s % 400 < 100 ? 0.8 : 0; SND.boost = s % 300 < 40 ? 1 : 0; SND.landed = s > 2000;
  SND.grd = s % 500 < 250 ? 0.9 : 0; SND.bio = [1, 3, 4, 0][(s / 500 | 0) % 4]; SND.entry = s % 700 < 100 ? 0.7 : 0; SND.hull = s % 900 < 200 ? 20 : 100; SND.beam = s % 400 < 100 ? 1 : 0; SND.beamP = (s % 100) / 100;
  if (s % 250 === 0) { SND.hit++; SND.hitP = 0.8; SND.hitM = s % 500 ? 1 : 0; } if (s % 600 === 0) SND.dock++; if (s % 800 === 0) SND.crash++; if (s % 450 === 0) SND.gear++; if (s % 300 === 0) SND.say = { who: 'X', text: 'Docking clearance granted. Hold steady, pilot.', n: s };
  for (const t of timers) if (t.alive) { t.f(); ticks++; }
}
console.log('timer ticks run:', ticks, '| timers still alive:', timers.filter((t) => t.alive).length, '| errors:', errors.length ? errors : 'none');
