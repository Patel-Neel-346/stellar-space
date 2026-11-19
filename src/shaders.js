// ============================================================================
// shaders (WGSL). Every pass shares COMMON: the per-frame uniforms, noise and the camera projection.
// ============================================================================
// Rendering conventions
//  - everything is camera-relative: JS subtracts the camera position in 64-bit before upload, so 32-bit floats stay
//    precise even 60 000 units from the sun.
//  - reverse-Z with an infinite far plane: clip.z = near, clip.w = distance along the view axis, depth clears to 0 and
//    passes with 'greater'. No projection matrix: proj() projects from the camera basis directly.
//  - the world is right-handed; (right, up, -forward) is the camera frame.
// Note for the minifier (build.mjs): no "- -" in WGSL (it would become the decrement token), no reversed smoothstep.
const COMMON = /*wgsl*/`
struct G {
  right: vec4f, up: vec4f, fwd: vec4f,
  cam: vec4f,   // cot(fov/2), aspect, near, time
  sun: vec4f,   // sun centre relative to the camera, sun radius
  atm: vec4f,   // sky colour (already lit), strength 0..1 (1 = standing on a planet with an atmosphere)
  srf: vec4f,   // local 'up' of the nearest body
  vel: vec4f,   // ship velocity relative to the nearest body (dust streaks), speed
  pm: vec4f,    // dust wrap offset, dust box size
  res: vec4f,   // width, height, dust strength, 0
};
@group(0) @binding(0) var<uniform> g: G;

fn hsh(c: vec3i) -> f32 {
  var h = bitcast<u32>(c.x) * 374761393u + bitcast<u32>(c.y) * 668265263u + bitcast<u32>(c.z) * 1274126177u;
  h = (h ^ (h >> 13u)) * 1274126177u;
  return f32(h ^ (h >> 16u)) / 4294967296.0;
}
fn vn(q: vec3f) -> f32 {
  let fl = floor(q);
  let i = vec3i(fl);
  var f = q - fl;
  f = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hsh(i), hsh(i + vec3i(1, 0, 0)), f.x), mix(hsh(i + vec3i(0, 1, 0)), hsh(i + vec3i(1, 1, 0)), f.x), f.y);
  let b = mix(mix(hsh(i + vec3i(0, 0, 1)), hsh(i + vec3i(1, 0, 1)), f.x), mix(hsh(i + vec3i(0, 1, 1)), hsh(i + vec3i(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
fn fbm(q0: vec3f, oct: i32) -> f32 {
  var q = q0;
  var a = 0.5;
  var s = 0.0;
  var n = 0.0;
  for (var k = 0; k < oct; k++) {
    s += a * vn(q);
    n += a;
    q = q * 2.03 + vec3f(17.1, 31.7, 5.3);
    a *= 0.5;
  }
  return s / n;
}
fn proj(rel: vec3f) -> vec4f {
  let z = dot(rel, g.fwd.xyz);
  return vec4f(dot(rel, g.right.xyz) * g.cam.x / g.cam.y, dot(rel, g.up.xyz) * g.cam.x, g.cam.z, z);
}
// filmic curve + gamma, applied once per pass (the canvas is not sRGB-aware)
fn tm(c: vec3f) -> vec3f {
  let a = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  return pow(clamp(a, vec3f(0.0), vec3f(1.0)), vec3f(0.4545));
}
`;

// ---------------------------------------------------------------- sky: nebulae baked once, stars drawn live
// The nebula is expensive layered noise but never changes, so it is rendered once at start-up into six square faces of an
// array texture (a hand-made cube map: the face layout is ours and the seams are hidden by a one-texel border). The
// per-frame sky is one texture read plus the star layers. Everything here is linear HDR; the composite pass tonemaps.
// Face f looks along: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z. uv is in [-K, K]; K is slightly above 1 (the border).
const NEB = /*wgsl*/`
fn fdir(f: i32, uv: vec2f) -> vec3f {
  switch f {
    case 0: { return vec3f(1.0, uv.y, -uv.x); }
    case 1: { return vec3f(-1.0, uv.y, uv.x); }
    case 2: { return vec3f(uv.x, 1.0, -uv.y); }
    case 3: { return vec3f(uv.x, -1.0, uv.y); }
    case 4: { return vec3f(uv.x, uv.y, 1.0); }
    default: { return vec3f(-uv.x, uv.y, -1.0); }
  }
}
// ridged multifractal: thin bright filaments where the noise crosses 0.5, like gas pushed into sheets
fn ridged(p0: vec3f, oct: i32) -> f32 {
  var p = p0;
  var a = 0.55;
  var s = 0.0;
  for (var k = 0; k < oct; k++) {
    let n = 1.0 - abs(2.0 * vn(p) - 1.0);
    s += a * n * n;
    p = p * 2.07 + vec3f(11.3, 7.1, 3.7);
    a *= 0.5;
  }
  return s;
}
// Deep space is mostly black. Only some regions hold gas: a distant blue reflection haze, warm copper filaments in front of
// it with a lit rim on the side facing the light, and dark dust lanes that absorb what lies behind them.
// rgb = emission, a = strength of the galactic band (the star field gets denser inside it)
fn neb(d: vec3f, extra: i32) -> vec4f {
  let bn = normalize(vec3f(0.3, 0.9, -0.3));
  let bd = dot(d, bn);
  var milky = exp(-bd * bd * 14.0);
  milky = milky * (0.30 + 1.1 * fbm(d * 5.0 + vec3f(3.0), 4));
  let reg = smoothstep(0.46, 0.80, fbm(d * 1.15 + vec3f(5.0), 4));       // where the gas is
  let reg2 = smoothstep(0.50, 0.82, fbm(d * 1.6 + vec3f(61.0), 4));
  let w = vec3f(fbm(d * 2.1 + vec3f(1.0), 4), fbm(d * 2.1 + vec3f(9.0), 4), fbm(d * 2.1 + vec3f(21.0), 4)) - vec3f(0.5);
  let p = d * 3.0 + w * 1.7;                                              // warped: gives the swirling, wind-blown shapes
  let den = ridged(p, 4 + extra);
  let den2 = ridged(p * 1.85 + vec3f(40.0), 3 + extra);
  let light = normalize(vec3f(0.5, 0.65, -0.35));
  let denL = ridged((d + light * 0.035) * 3.0 + w * 1.7, 4 + extra);
  let rim = clamp((den - denL) * 7.0, 0.0, 1.0);                          // bright where the sheet faces the light
  let hue = fbm(d * 1.4 + vec3f(33.0), 3);
  let warmth = smoothstep(0.42, 0.62, hue);
  let dust = smoothstep(0.42, 0.78, fbm(p * 1.2 + vec3f(70.0), 4));
  // far layer: blue reflection nebula
  let blue = mix(vec3f(0.035, 0.07, 0.30), vec3f(0.12, 0.30, 0.85), den2) * (0.25 + 0.75 * den2) * reg2;
  var e = blue * 0.55 * (1.0 - 0.8 * dust * reg);
  // near layer: warm gas, dark lanes drawn over it
  let warm = mix(vec3f(0.75, 0.22, 0.06), vec3f(1.0, 0.58, 0.22), den2);
  let red = vec3f(0.55, 0.05, 0.08);
  let gas = mix(red, warm, 0.35 + 0.65 * warmth);
  e += gas * den * den * reg * (0.28 + 0.5 * warmth);
  e += mix(vec3f(0.6, 0.75, 1.0), vec3f(1.0, 0.72, 0.42), warmth) * rim * den * reg * 0.55;
  e *= 1.0 - 0.7 * dust * reg;
  e += vec3f(0.5, 0.45, 0.65) * milky * 0.035;
  e += vec3f(0.003, 0.005, 0.012);                                        // never fully black: a trace of ambient light
  return vec4f(e, milky);
}
`;
const SHADER_BAKE = COMMON + NEB + /*wgsl*/`
@group(1) @binding(0) var<uniform> bk: vec4f;   // face, K, extra octaves
struct BV { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> BV {
  var q = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: BV;
  o.pos = vec4f(q[vi], 0.0, 1.0);
  o.uv = q[vi];
  return o;
}
@fragment fn fs(i: BV) -> @location(0) vec4f {
  return neb(normalize(fdir(i32(bk.x + 0.5), i.uv * bk.y)), i32(bk.z + 0.5));
}
`;
const SHADER_SKY = COMMON + /*wgsl*/`
@group(0) @binding(1) var skyT: texture_2d_array<f32>;
@group(0) @binding(2) var skyS: sampler;
struct SV { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> SV {
  var q = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: SV;
  o.pos = vec4f(q[vi], 0.0, 1.0);
  o.uv = q[vi];
  return o;
}
// the inverse of fdir(): which face the direction hits and where on it
fn baked(d: vec3f) -> vec4f {
  let a = abs(d);
  var f = 0;
  var uv = vec2f(0.0);
  if (a.x >= a.y && a.x >= a.z) {
    if (d.x > 0.0) { f = 0; uv = vec2f(-d.z, d.y) / a.x; } else { f = 1; uv = vec2f(d.z, d.y) / a.x; }
  } else if (a.y >= a.z) {
    if (d.y > 0.0) { f = 2; uv = vec2f(d.x, -d.z) / a.y; } else { f = 3; uv = vec2f(d.x, d.z) / a.y; }
  } else {
    if (d.z > 0.0) { f = 4; uv = vec2f(d.x, d.y) / a.z; } else { f = 5; uv = vec2f(-d.x, d.y) / a.z; }
  }
  let t = vec2f(uv.x / g.res.w + 1.0, 1.0 - uv.y / g.res.w) * 0.5;
  return textureSampleLevel(skyT, skyS, t, f, 0.0);
}
// star colour from a 0..1 temperature: blue-white, white, yellow, orange
fn tcol(h: f32) -> vec3f {
  return mix(mix(vec3f(0.66, 0.78, 1.0), vec3f(1.0, 0.97, 0.92), smoothstep(0.0, 0.45, h)), vec3f(1.0, 0.66, 0.42), smoothstep(0.6, 1.0, h));
}
// faint and medium stars: one star per lattice cell at most, brightness follows a steep power law (a few bright, many dim)
fn stars(d: vec3f, sc: f32, dens: f32, seed: i32, pix: f32, gain: f32) -> vec3f {
  let q = d * sc;
  let ic = vec3i(floor(q));
  let h = hsh(ic + vec3i(seed, seed * 3, seed * 7));
  if (h > dens) { return vec3f(0.0); }
  let h2 = hsh(ic + vec3i(seed + 101, 17, 29));
  let h3 = hsh(ic + vec3i(41, seed + 211, 5));
  let h4 = hsh(ic + vec3i(7, 19, seed + 313));
  let h5 = hsh(ic + vec3i(seed + 19, seed + 23, seed + 29));
  let sp = vec3f(ic) + vec3f(0.15) + 0.7 * vec3f(h2, h3, h4);
  let m = pow(h5, 6.0);
  let r = pix * sc * (0.75 + 0.6 * m);
  let k = length(q - sp) / r;
  return tcol(h3) * gain * (0.04 + 2.5 * m) * exp(-k * k * 1.5);
}
// the few bright stars: a hot core, a soft halo, and diffraction spikes along the screen axes plus fainter diagonals,
// like a telescope image. Positions stay in the middle of their cell so the spikes are never clipped by the cell edge.
fn bright(d: vec3f, pix: f32) -> vec3f {
  let sc = 11.0;
  let q = d * sc;
  let ic = vec3i(floor(q));
  let h = hsh(ic + vec3i(211, 5, 77));
  if (h > 0.04) { return vec3f(0.0); }
  let h2 = hsh(ic + vec3i(311, 17, 29));
  let h3 = hsh(ic + vec3i(41, 411, 5));
  let h4 = hsh(ic + vec3i(7, 19, 511));
  let h5 = hsh(ic + vec3i(611, 23, 31));
  let sp = vec3f(ic) + vec3f(0.35) + 0.3 * vec3f(h2, h3, h4);
  let dq = q - sp;
  let r = pix * sc;
  let x = dot(dq, g.right.xyz);
  let y = dot(dq, g.up.xyz);
  let dist = length(dq);
  let br = 1.6 + 12.0 * pow(h5, 3.0);
  let L = 0.09 + 0.16 * h5;
  let w = r * 0.85;
  var s = exp(-dist * dist / (r * r * 1.8));
  s += 0.04 * exp(-dist / (r * 4.0));
  let sx = exp(-abs(y) / w) * exp(-abs(x) / (L * 0.45));
  let sy = exp(-abs(x) / w) * exp(-abs(y) / (L * 0.45));
  let u = (x + y) * 0.7071;
  let v = (x - y) * 0.7071;
  let s1 = exp(-abs(v) / w) * exp(-abs(u) / (L * 0.22));
  let s2 = exp(-abs(u) / w) * exp(-abs(v) / (L * 0.22));
  s += (sx + sy) * 0.4 + (s1 + s2) * 0.15;
  s *= 1.0 - smoothstep(0.16, 0.3, dist);          // nothing may reach the cell edge, or the glow would be cut off in straight lines
  return tcol(h3) * br * s * 0.5;
}
// very distant galaxies: small tilted ellipses with a bright nucleus
fn galaxies(d: vec3f) -> vec3f {
  let sc = 7.0;
  let q = d * sc;
  let ic = vec3i(floor(q));
  let h = hsh(ic + vec3i(901, 13, 5));
  if (h > 0.10) { return vec3f(0.0); }
  let h2 = hsh(ic + vec3i(11, 902, 7));
  let h3 = hsh(ic + vec3i(13, 5, 903));
  let h4 = hsh(ic + vec3i(904, 29, 3));
  let c0 = normalize((vec3f(ic) + vec3f(0.3) + 0.4 * vec3f(h2, h3, h4)) / sc);
  let a1 = normalize(cross(c0, vec3f(0.0, 1.0, 0.0)));
  let a2 = cross(c0, a1);
  let v = d - c0;
  let u0 = dot(v, a1);
  let w0 = dot(v, a2);
  let ang = h4 * 6.2831853;
  let ur = u0 * cos(ang) + w0 * sin(ang);
  let wr = w0 * cos(ang) - u0 * sin(ang);
  let R = 0.006 + 0.011 * h3;
  let e = 0.22 + 0.5 * h2;
  let rr = sqrt(ur * ur + (wr / e) * (wr / e)) / R;
  let I = exp(-rr * 1.7) * 0.42 + exp(-rr * rr * 40.0) * 0.8;
  return mix(vec3f(1.0, 0.86, 0.62), vec3f(0.68, 0.78, 1.0), h3) * I;
}
fn starfield(d: vec3f, pix: f32, boost: f32) -> vec3f {
  var c = stars(d, 45.0, 0.05 * boost, 1, pix, 0.55) + stars(d, 110.0, 0.06 * boost, 2, pix, 0.42) + stars(d, 260.0, 0.07 * boost, 3, pix, 0.34);
  c += bright(d, pix);
  c += galaxies(d);
  return c;
}
@fragment fn fs(i: SV) -> @location(0) vec4f {
  let d0 = normalize(g.fwd.xyz + g.right.xyz * (i.uv.x * g.cam.y / g.cam.x) + g.up.xyz * (i.uv.y / g.cam.x));
  let pix = 2.0 / (g.res.y * g.cam.x);
  let fx = g.srf.w;                 // 0 in normal flight; during a warp the sky is smeared radially away from the heading
  var c = vec3f(0.0);
  if (fx < 0.003) {
    let nb = baked(d0);
    c = nb.rgb + starfield(d0, pix, 1.0 + 2.2 * nb.a);
  } else {
    let F = g.fwd.xyz;
    let tan0 = F - d0 * dot(d0, F);
    let nt = select(14, 6, fx < 0.15);
    let step = fx * 0.2 * length(tan0) / f32(nt - 1);
    let pixS = max(pix, step * 0.8);                       // a star must cover the gap between samples to read as a line
    var st = vec3f(0.0);
    var nbl = vec3f(0.0);
    for (var k = 0; k < nt; k++) {
      let dd = normalize(d0 - tan0 * (f32(k) / f32(nt - 1) * fx * 0.2));
      let nb = baked(dd);
      nbl += nb.rgb;
      st += starfield(dd, pixS, 1.0 + 2.2 * nb.a);
    }
    c = nbl / f32(nt) + st * (0.5 + 1.2 * fx) / f32(nt) * 2.5;
  }
  // sky of the planet we are standing on / flying through
  c = c * (1.0 - g.atm.w);
  let up = g.srf.xyz;
  let hz = 1.0 - clamp(dot(d0, up), 0.0, 1.0);
  let sd = normalize(g.sun.xyz);
  let halo = pow(max(dot(d0, sd), 0.0), 16.0);
  c += (g.atm.rgb * (0.30 + 0.9 * pow(hz, 2.5)) + g.atm.rgb * halo * 0.8) * g.atm.w;
  return vec4f(c, 1.0);
}
`;

// ---------------------------------------------------------------- planets, moons and the sun
// A cube-sphere generated entirely from the vertex index (no vertex buffer). Terrain is displaced here and normals come
// from finite differences; the fragment shader adds colour, derivative-based bump detail, clouds, fog and rim light.
const PLANET = /*wgsl*/`
struct PU {
  c: vec4f,    // centre relative to the camera, radius
  rot: vec4f,  // cos(spin), sin(spin), kind, noise seed
  t: vec4f,    // terrain amplitude, terrain frequency, sea level, ground fog
  a: vec4f,    // atmosphere colour, thickness / radius
  c0: vec4f, c1: vec4f, c2: vec4f, c3: vec4f,   // palette
  r: vec4f,    // ring inner, ring outer (in radii), 1 while big on screen (detail noise on), polar cap strength
  n: vec4f,    // ring normal, mesh resolution
};
@group(1) @binding(0) var<uniform> pl: PU;

// terrain height in units of the amplitude (0..~0.6). Only the one-time height bake calls this; every frame the vertex
// shader reads the baked result. Must match terrain() in world.js, which the landing code uses.
fn hgt(d: vec3f) -> f32 {
  let f = pl.t.y;
  let o = vec3f(pl.rot.w);
  let n = fbm(d * f + o, 5);
  let r = 1.0 - abs(2.0 * fbm(d * f * 2.1 + o + vec3f(9.0), 4) - 1.0);
  return max(mix(n, r, 0.35) - pl.t.z, 0.0);
}
fn spin(v: vec3f) -> vec3f {
  return vec3f(pl.rot.x * v.x + pl.rot.y * v.z, v.y, pl.rot.x * v.z - pl.rot.y * v.x);
}
fn unspin(v: vec3f) -> vec3f {
  return vec3f(pl.rot.x * v.x - pl.rot.y * v.z, v.y, pl.rot.y * v.x + pl.rot.x * v.z);
}
// climate of a living world: moisture decides forest, grass or desert; temperature falls towards the poles and with height
fn moist(d: vec3f) -> f32 { return fbm(d * pl.t.y * 1.3 + vec3f(pl.rot.w + 21.0), 3); }
fn temp(d: vec3f, h01: f32) -> f32 { return 1.0 - abs(d.y) * 1.15 - h01 * 0.45; }
// craters: the nearest crater centre in a jittered 3D lattice; x = bowl depth (negative), y = rim
fn crat(p: vec3f) -> vec2f {
  let ip = vec3i(floor(p));
  var best = 9.0;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let c = ip + vec3i(x, y, z);
    if (hsh(c + vec3i(11, 2, 4)) < 0.5) { continue; }
    let ctr = vec3f(c) + vec3f(hsh(c), hsh(c + vec3i(7, 0, 0)), hsh(c + vec3i(0, 13, 0)));
    let r = 0.16 + 0.3 * hsh(c + vec3i(3, 5, 9));
    best = min(best, length(p - ctr) / r);
  } } }
  let bowl = select(0.0, -(1.0 - best * best), best < 1.0);
  let q = (best - 1.05) * 5.0;
  return vec2f(bowl, exp(-q * q) * 0.4);
}
// cube face basis: columns are normal, tangent, bitangent with tangent x bitangent = normal (outward, CCW)
fn fbas(f: u32) -> mat3x3f {
  switch f {
    case 0u: { return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0)); }
    case 1u: { return mat3x3f(vec3f(-1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0)); }
    case 2u: { return mat3x3f(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0)); }
    case 3u: { return mat3x3f(vec3f(0.0, -1.0, 0.0), vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0)); }
    case 4u: { return mat3x3f(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0)); }
    default: { return mat3x3f(vec3f(0.0, 0.0, -1.0), vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0)); }
  }
}
struct PV {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) nrm: vec3f,
  @location(2) ld: vec3f,
  @location(3) hh: f32,
};
// baked heights: one texture layer per cube face, texel i holds grid point i / (size - 1), so neighbouring faces agree
@group(2) @binding(0) var hT: texture_2d_array<f32>;
@group(2) @binding(1) var hS: sampler;
fn hsm(face: u32, pu: f32, pv: f32) -> f32 {
  let S = f32(textureDimensions(hT).x);
  let t = (clamp(vec2f(pu, pv), vec2f(0.0), vec2f(1.0)) * (S - 1.0) + 0.5) / S;
  return textureSampleLevel(hT, hS, t, face, 0.0).r * pl.t.x;
}
// unit direction of the face point (pu, pv), both 0..1
fn fdr(B: mat3x3f, pu: f32, pv: f32) -> vec3f {
  return normalize(B[0] + B[1] * tan((pu * 2.0 - 1.0) * 0.7853982) + B[2] * tan((pv * 2.0 - 1.0) * 0.7853982));
}
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) face: u32) -> PV {
  // indexed draw: vi is a grid point (N + 1 per row) of the face given by the instance
  let N = u32(pl.n.w);
  let pu = f32(vi % (N + 1u)) / f32(N);
  let pv = f32(vi / (N + 1u)) / f32(N);
  let B = fbas(face);
  let R = pl.c.w;
  let e = 1.0 / f32(N);
  let eu = select(e, -e, pu + e > 1.0001);   // step inwards at the face edge: the baked texture stops there
  let ev = select(e, -e, pv + e > 1.0001);
  let d = fdr(B, pu, pv);
  let d1 = fdr(B, pu + eu, pv);
  let d2 = fdr(B, pu, pv + ev);
  let h0 = hsm(face, pu, pv);
  let p0 = d * (R + h0);
  let p1 = d1 * (R + hsm(face, pu + eu, pv));
  let p2 = d2 * (R + hsm(face, pu, pv + ev));
  var nl = normalize(cross(p1 - p0, p2 - p0));
  if (dot(nl, d) < 0.0) { nl = -nl; }
  var o: PV;
  o.wp = pl.c.xyz + spin(p0);
  o.pos = proj(o.wp);
  o.nrm = spin(nl);
  o.ld = d;
  o.hh = h0;
  return o;
}
@fragment fn fs(i: PV) -> @location(0) vec4f {
  let kind = i32(pl.rot.z + 0.5);
  let amp = pl.t.x;
  let wp = i.wp;
  var N = normalize(i.nrm);
  let V = -normalize(wp);
  let L = normalize(g.sun.xyz - wp);
  // everything that needs screen-space derivatives comes first, in uniform control flow
  let px = dpdx(wp);
  let py = dpdy(wp);
  // detail noise only while the planet is big on screen (pl.r.z is a uniform, so these branches are uniform control flow)
  var dn = 0.5;
  var bp = 0.5;
  var bx = 0.0;
  var by = 0.0;
  var cr = vec2f(0.0);
  if ((kind == 0 || kind == 3) && amp > 0.0) { cr = crat(i.ld * pl.t.y * 3.0 + vec3f(pl.rot.w)) * select(1.0, 0.5, kind == 3); }
  if (pl.r.z > 0.5 && kind != 5) {
    dn = fbm(i.ld * pl.t.y * 6.0 + vec3f(pl.rot.w + 3.0), 4);
    if (amp > 0.0) {
      bp = fbm(i.ld * pl.t.y * 28.0 + vec3f(pl.rot.w + 5.0), 3);
      var cs = vec2f(0.0);
      if (kind == 0) { cs = crat(i.ld * pl.t.y * 11.0 + vec3f(pl.rot.w + 2.0)); }
      bp = bp + cr.x * 0.4 + cr.y * 0.3 + cs.x * 0.08 + cs.y * 0.08;
      bx = dpdx(bp);
      by = dpdy(bp);
    }
  }
  let foot = length(px) + length(py);                       // world units per pixel
  let dd = clamp(1.0 - foot * 0.15, 0.0, 1.0);              // fine detail fades out with distance
  let dnv = mix(0.5, dn, dd);
  let bumpK = select(amp * 0.10, 0.0, kind == 2 || kind == 5) * (1.0 - smoothstep(1.0, 5.0, length(px)));
  let r1 = cross(py, N);
  let r2 = cross(N, px);
  let det = dot(px, r1);
  let grad = sign(det) * (bx * r1 + by * r2);
  N = select(N, normalize(abs(det) * N - bumpK * grad), abs(det) > 0.000000001);

  let h01 = clamp(i.hh / max(amp, 0.001), 0.0, 1.0);
  var col = vec3f(0.0);
  var emi = vec3f(0.0);
  var spec = 0.0;
  var shin = 30.0;
  if (kind == 0) {          // rocky / desert / moon
    col = mix(pl.c0.rgb, pl.c1.rgb, h01);
    col = mix(col, pl.c2.rgb, smoothstep(0.4, 0.75, dnv) * 0.7);
    col = col * (0.8 + 0.4 * mix(0.5, bp, dd));
    col = col * (1.0 - 0.32 * clamp(-cr.x, 0.0, 1.0)) * (1.0 + 0.5 * cr.y);
    let cap = smoothstep(0.80, 0.90, abs(i.ld.y) + (dnv - 0.5) * 0.15) * pl.r.w;
    col = mix(col, pl.c3.rgb, cap);
  } else if (kind == 1) {   // living world: oceans, land, snow, clouds
    let land = smoothstep(0.0, 0.03 * amp + 0.0001, i.hh);
    var water = mix(pl.c0.rgb, pl.c1.rgb, dnv);
    let mo = moist(i.ld);
    let tp = temp(i.ld, h01) + (dnv - 0.5) * 0.2;
    // lowlands: dry sand-coloured desert -> grass -> dark forest as moisture rises; mountains turn to rock, cold ground to tundra and snow
    let forest = pl.c2.rgb * 0.5;
    let grass = pl.c2.rgb * 1.15;
    let desert = mix(vec3f(0.5, 0.38, 0.2), vec3f(0.68, 0.56, 0.34), dnv);
    var ground = mix(grass, forest, smoothstep(0.55, 0.72, mo));
    ground = mix(desert, ground, smoothstep(0.36, 0.5, mo));
    ground = mix(ground, pl.c3.rgb, smoothstep(0.45, 0.8, h01));
    ground = mix(ground, vec3f(0.3, 0.31, 0.27), smoothstep(0.42, 0.26, tp) * 0.85);
    ground = mix(vec3f(0.74, 0.66, 0.46), ground, smoothstep(0.0, 0.1, h01));      // beaches
    if (dd > 0.01 && pl.r.z > 0.5) { ground = ground * (0.8 + 0.4 * fbm(i.ld * pl.t.y * 140.0 + vec3f(pl.rot.w), 3)); }
    ground = ground * (0.85 + 0.3 * mix(0.5, bp, dd));
    ground = mix(ground, vec3f(0.88, 0.9, 0.94), smoothstep(0.14, 0.04, tp) * pl.r.w);
    water = mix(water, vec3f(0.8, 0.86, 0.92), smoothstep(0.86, 0.94, abs(i.ld.y)) * pl.r.w);
    col = mix(water, ground, land);
    spec = (1.0 - land) * 0.9;
    shin = 90.0;
    // clouds, and their shadows on the ground (the shadow sits where the cloud's line to the sun hits the surface)
    let cdir = i.ld + vec3f(g.cam.w * 0.0012, 0.0, 0.0);
    let cn = fbm(cdir * 3.2 + vec3f(pl.rot.w), 4);
    let cl = smoothstep(0.50, 0.70, cn) * smoothstep(0.22 * pl.c.w, 0.8 * pl.c.w, length(wp));
    if (pl.r.z > 0.5) {
      let Ll = unspin(L);
      let sn = fbm(normalize(cdir - Ll * 0.02) * 3.2 + vec3f(pl.rot.w), 4);
      col = col * (1.0 - 0.45 * smoothstep(0.52, 0.72, sn) * (1.0 - cl));
    }
    col = mix(col, mix(vec3f(0.6), vec3f(0.92), smoothstep(0.5, 0.85, cn)), cl * 0.92);
    spec = spec * (1.0 - cl);
  } else if (kind == 2) {   // gas / ice giant: latitude bands with turbulence
    let wv = fbm(vec3f(i.ld.x * 3.0, i.ld.y * 10.0, i.ld.z * 3.0) + vec3f(pl.rot.w + g.cam.w * 0.003), 4) - 0.5;
    let s = i.ld.y * pl.t.y + wv * 5.0;
    let b1 = 0.5 + 0.5 * sin(s);
    let b2 = 0.5 + 0.5 * sin(s * 2.3 + 1.0 + wv * 4.0);
    col = mix(mix(pl.c0.rgb, pl.c1.rgb, b1), mix(pl.c2.rgb, pl.c3.rgb, b2), 0.35 + 0.3 * sin(s * 0.6));
    col = col * (0.88 + 0.24 * dnv);
    if (pl.t.y > 8.0) {
      var da = atan2(i.ld.z, i.ld.x) - pl.rot.w * 0.9;
      da = atan2(sin(da), cos(da));
      let sl = -0.3 + 0.1 * sin(pl.rot.w);
      let q = pow((i.ld.y - sl) / 0.1, 2.0) + pow(da / 0.3, 2.0);
      col = mix(col, mix(pl.c3.rgb, pl.c2.rgb, 0.4) * 1.05, exp(-q) * 0.85);
      col = col * (1.0 - 0.22 * exp(-pow(sqrt(q) - 1.3, 2.0) * 6.0));
    }
  } else if (kind == 3) {   // frozen world
    col = mix(pl.c0.rgb, pl.c1.rgb, dnv);
    let ridge = 1.0 - abs(2.0 * fbm(i.ld * pl.t.y * 3.0 + vec3f(pl.rot.w + 11.0), 4) - 1.0);
    col = mix(col, pl.c2.rgb, smoothstep(0.90, 0.98, ridge) * 0.8);
    col = mix(col, pl.c3.rgb, h01 * 0.5);
    spec = 0.5;
    shin = 50.0;
  } else if (kind == 4) {   // volcanic: glowing cracks and lava lakes
    col = mix(pl.c0.rgb, pl.c1.rgb, clamp(h01 + (dnv - 0.5) * 0.4, 0.0, 1.0));
    let ridge = 1.0 - abs(2.0 * fbm(i.ld * pl.t.y * 3.5 + vec3f(pl.rot.w + 7.0), 4) - 1.0);
    let crack = smoothstep(0.93, 0.985, ridge);
    let lake = 1.0 - smoothstep(0.0, 0.03 * amp + 0.0001, i.hh);
    let lava = max(crack * 0.8, lake);
    emi = mix(pl.c2.rgb, pl.c3.rgb, clamp(lake * dnv + crack * 0.3, 0.0, 1.0)) * lava * 2.2;
    col = mix(col, vec3f(0.02), lava);
  } else {                  // the sun
    let t = fbm(i.ld * 7.0 + vec3f(g.cam.w * 0.04, g.cam.w * 0.03, 0.0), 5);
    let mu = max(dot(N, V), 0.0);
    let e = mix(pl.c0.rgb, pl.c1.rgb, t) * 3.2 * (0.45 + 0.55 * sqrt(mu));
    return vec4f(e, 1.0);
  }
  let ndl = max(dot(N, L), 0.0);
  let H = normalize(L + V);
  let sp = spec * pow(max(dot(N, H), 0.0), shin) * select(0.0, 1.0, ndl > 0.0);
  var lit = col * (ndl * 1.05 + 0.01) + vec3f(sp * 1.4) + emi;
  // atmosphere: rim light on the limb, and haze when we are low over the ground
  let fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  let atmL = clamp(dot(N, L) * 0.8 + 0.35, 0.0, 1.0);
  lit += pl.a.rgb * fr * atmL * 0.5 * select(0.0, 1.0, pl.a.w > 0.0);
  let nlr = dot(N, L);
  let tw = smoothstep(-0.02, 0.08, nlr) * (1.0 - smoothstep(0.08, 0.38, nlr));
  lit += vec3f(0.9, 0.38, 0.14) * col * tw * 0.12 * select(0.0, 1.0, pl.a.w > 0.0);
  let fog = pl.t.w * (1.0 - exp(-length(wp) / (pl.c.w * 1.2)));
  lit = mix(lit, g.atm.rgb * 0.9, fog);
  return vec4f(lit, 1.0);
}
`;

// ---------------------------------------------------------------- surface props (trees, rocks, crystals), placed on the GPU
// A grid of cells lies on the ground around the ship. The grid is a plane of the planet's own axes (the one most facing
// the ship, chosen on the CPU) projected onto the sphere, so the same cell always holds the same prop. Every cell hashes
// to at most one prop; the baked height texture gives the ground height, and the same climate functions as the planet
// shader decide where forests may grow.
const SHADER_VEG = COMMON + PLANET.slice(0, PLANET.indexOf('struct PV')) + /*wgsl*/`
@group(2) @binding(0) var hT: texture_2d_array<f32>;
@group(2) @binding(1) var hS: sampler;
struct VU {
  a: vec4f,   // axis (0 x, 1 y, 2 z), side (+1 / -1), first cell column, first cell row
  b: vec4f,   // cell size, cells per side, -, seed
  c: vec4f,   // ship position in the planet's own frame, fade-out radius
  p: vec4f,   // chance per cell of each of the four models
};
@group(3) @binding(0) var<uniform> vu: VU;
fn hsm(face: u32, pu: f32, pv: f32) -> f32 {
  let S = f32(textureDimensions(hT).x);
  let t = (clamp(vec2f(pu, pv), vec2f(0.0), vec2f(1.0)) * (S - 1.0) + 0.5) / S;
  return textureSampleLevel(hT, hS, t, face, 0.0).r * pl.t.x;
}
struct VO {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) nrm: vec3f,
  @location(2) col: vec3f,
  @location(3) up: vec3f,
  @location(4) emi: f32,
};
fn gone() -> VO {
  var o: VO;
  o.pos = vec4f(3.0, 3.0, 0.0, 1.0);
  o.wp = vec3f(0.0); o.nrm = vec3f(0.0, 1.0, 0.0); o.col = vec3f(0.0); o.up = vec3f(0.0, 1.0, 0.0); o.emi = 0.0;
  return o;
}
@vertex fn vs(@builtin(instance_index) ii: u32, @location(0) mp: vec3f, @location(1) mn: vec3f, @location(2) mc: vec4f) -> VO {
  let cls = u32(mc.z + 0.5);
  let mat = u32(mc.w + 0.5);
  let n = u32(vu.b.y);
  let ca = i32(vu.a.z) + i32(ii % n);
  let cb = i32(vu.a.w) + i32(ii / n);
  let key = vec3i(ca, cb, i32(vu.a.x) * 2 + i32(vu.a.y > 0.0) + i32(vu.b.w) * 16);
  // one hash picks which model (if any) lives in this cell; this draw only keeps its own model
  let r = hsh(key);
  var lo = 0.0;
  for (var k = 0u; k < cls; k++) { lo += vu.p[k]; }
  if (r < lo || r >= lo + vu.p[cls]) { return gone(); }
  let S = vu.b.x;
  let x1 = (f32(ca) + hsh(key + vec3i(5, 0, 0))) * S;
  let x2 = (f32(cb) + hsh(key + vec3i(0, 9, 0))) * S;
  let R = pl.c.w;
  let rem = R * R - x1 * x1 - x2 * x2;
  if (rem < 1.0) { return gone(); }
  let x3 = vu.a.y * sqrt(rem);
  let ax = i32(vu.a.x);
  var q = vec3f(x1, x2, x3);
  if (ax == 0) { q = vec3f(x3, x1, x2); } else if (ax == 1) { q = vec3f(x1, x3, x2); }
  let d = normalize(q);
  let dist = length(d * R - vu.c.xyz);
  var fade = 1.0 - smoothstep(0.7, 1.0, dist / vu.c.w);
  if (fade <= 0.02) { return gone(); }
  // ground height from the baked terrain
  let ad = abs(d);
  var face = 0u;
  if (ad.x >= ad.y && ad.x >= ad.z) { face = select(1u, 0u, d.x > 0.0); }
  else if (ad.y >= ad.z) { face = select(3u, 2u, d.y > 0.0); }
  else { face = select(5u, 4u, d.z > 0.0); }
  let B = fbas(face);
  let nn = dot(d, B[0]);
  let pu = (atan(dot(d, B[1]) / nn) / 0.7853982 + 1.0) * 0.5;
  let pv = (atan(dot(d, B[2]) / nn) / 0.7853982 + 1.0) * 0.5;
  let hh = hsm(face, pu, pv);
  let amp = max(pl.t.x, 0.001);
  let h01 = clamp(hh / amp, 0.0, 1.0);
  let kind = i32(pl.rot.z + 0.5);
  var dens = 1.0;
  if (kind == 1) {
    if (hh < 0.04 * amp) { return gone(); }                     // sea and beaches stay clear
    let mo = moist(d);
    let tp = temp(d, h01);
    if (cls == 0u) { dens = smoothstep(0.4, 0.62, mo) * smoothstep(0.2, 0.3, tp) * (1.0 - smoothstep(0.55, 0.7, tp * 0.0 + h01)); }
    else if (cls == 1u) { dens = smoothstep(0.48, 0.7, mo) * smoothstep(0.42, 0.55, tp) * (1.0 - smoothstep(0.4, 0.55, h01)); }
    else { dens = max(smoothstep(0.5, 0.9, h01), smoothstep(0.45, 0.3, mo) * 0.7) + 0.1; }
  }
  if (hsh(key + vec3i(8, 8, 8)) > dens) { return gone(); }
  let hs = hsh(key + vec3i(1, 1, 1));
  let hs2 = hsh(key + vec3i(2, 7, 1));
  let sc = (0.5 + 0.5 * hs) * fade;
  // orientation: up is radial, a random turn about it
  let up = d;
  let rf = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(d.y) > 0.9);
  let t0 = normalize(cross(up, rf));
  let b0 = cross(up, t0);
  let yaw = hsh(key + vec3i(3, 3, 3)) * 6.2831853;
  let tt = t0 * cos(yaw) + b0 * sin(yaw);
  let bb = cross(up, tt);
  let P = d * (R + hh - 0.35 * sc) + (tt * mp.x + up * mp.y + bb * mp.z) * sc;
  var o: VO;
  o.wp = pl.c.xyz + spin(P);
  o.pos = proj(o.wp);
  o.nrm = spin(tt * mn.x + up * mn.y + bb * mn.z);
  o.up = spin(up);
  // colours
  let CH = array<f32, 4>(14.0, 12.0, 3.0, 8.0);
  var col = vec3f(0.3, 0.2, 0.12) * (0.8 + 0.4 * hs2);
  var emi = 0.0;
  if (mat == 1u) {
    col = mix(pl.c2.rgb * 0.5, pl.c2.rgb * 1.2, hs2);
    if (cls == 0u) { col = col * 0.6; }
    if (cls == 1u && hs2 > 0.88) { col = mix(col, vec3f(0.55, 0.38, 0.06), 0.7); }
  } else if (mat == 2u) {
    col = select(mix(pl.c0.rgb, pl.c1.rgb, 0.3 + 0.5 * hs2), pl.c3.rgb * 0.6, kind == 1) * (0.75 + 0.35 * hs);
  } else if (mat == 3u) {
    col = vec3f(0.45, 0.75, 1.0) * (0.55 + 0.6 * hs2);
    emi = 0.35;
  }
  let ao = 0.55 + 0.45 * clamp(mp.y / CH[cls], 0.0, 1.0);
  o.col = col * ao;
  o.emi = emi;
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let N = normalize(i.nrm);
  let L = normalize(g.sun.xyz - i.wp);
  let sunk = smoothstep(-0.06, 0.12, dot(normalize(i.up), L));    // after sunset the ground, and what stands on it, goes dark
  let ndl = max(dot(N, L), 0.0) * sunk;
  let hemi = 0.5 + 0.5 * dot(N, normalize(i.up));
  let amb = g.atm.rgb * g.atm.w * 0.22 * hemi * (0.3 + 0.7 * sunk);
  var lit = i.col * (ndl * 1.05 + 0.012 + amb) + i.col * i.emi * 1.6;
  let fog = pl.t.w * (1.0 - exp(-length(i.wp) / (pl.c.w * 1.2)));
  lit = mix(lit, g.atm.rgb * 0.9, fog);
  return vec4f(lit, 1.0);
}
`;

// ---------------------------------------------------------------- asteroids
// Rocks come from a grid of cells in the sun's frame laid around the ship (cells and layers are set by main.js). Each cell
// hashes to at most one rock; how likely depends on the distance from the middle of the belt and the height above its plane.
// All rocks share one lumpy sphere that is stretched, dented with noise and spun here. A comet's nucleus uses the same code
// in single mode (d.w = 1: one rock at s.xyz). Faces are flat shaded from screen derivatives.
const SHADER_AST = COMMON + /*wgsl*/`
struct AU {
  a: vec4f,   // cell size, cells per side, spawn chance, layer seed
  b: vec4f,   // smallest rock, largest rock, first cell column, first cell row
  c: vec4f,   // ship position in the sun's frame, fade-out radius
  d: vec4f,   // belt radius, belt half width, belt half thickness, 1 = single rock
  e: vec4f,   // first cell layer
  s: vec4f,   // single rock: position relative to the ship, radius
  t: vec4f,   // single rock: colour
};
@group(1) @binding(0) var<uniform> au: AU;
struct AO { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) lp: vec3f, @location(2) col: vec3f };
fn rotAx(v: vec3f, ax: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c); }
fn nothing() -> AO { var o: AO; o.pos = vec4f(3.0, 3.0, 0.0, 1.0); o.wp = vec3f(0.0); o.lp = vec3f(0.0); o.col = vec3f(0.0); return o; }
@vertex fn vs(@builtin(instance_index) ii: u32, @location(0) mp: vec3f) -> AO {
  var rel = au.s.xyz;
  var size = au.s.w;
  var key = vec3i(77, 5, 3);
  var tint = au.t.xyz;
  if (au.d.w < 0.5) {
    let n = u32(au.a.y);
    let ca = i32(au.b.z) + i32(ii % n);
    let cb = i32(au.b.w) + i32((ii / n) % n);
    let cy = i32(au.e.x) + i32(ii / (n * n));
    key = vec3i(ca, cb, cy * 64 + i32(au.a.w));
    let C = au.a.x;
    let pos = vec3f((f32(ca) + hsh(key + vec3i(1, 0, 0))) * C, (f32(cy) + hsh(key + vec3i(0, 0, 1))) * C, (f32(cb) + hsh(key + vec3i(0, 1, 0))) * C);
    let dr = (length(pos.xz) - au.d.x) / au.d.y;
    let chance = au.a.z * exp(-dr * dr * 1.5) * exp(-pow(pos.y / au.d.z, 2.0));
    if (hsh(key) > chance) { return nothing(); }
    rel = pos - au.c.xyz;
    let fade = 1.0 - smoothstep(0.75, 1.0, length(rel) / au.c.w);
    if (fade < 0.02) { return nothing(); }
    size = mix(au.b.x, au.b.y, pow(hsh(key + vec3i(2, 2, 2)), 3.0)) * fade;
    tint = mix(vec3f(0.3, 0.27, 0.24), vec3f(0.52, 0.36, 0.25), hsh(key + vec3i(4, 4, 4))) * (0.7 + 0.5 * hsh(key + vec3i(6, 1, 2)));
  }
  let sd = hsh(key + vec3i(9, 4, 2));
  let el = vec3f(1.0, 0.6 + 0.4 * hsh(key + vec3i(3, 0, 0)), 0.7 + 0.3 * hsh(key + vec3i(0, 3, 0)));
  let disp = 1.0 + 0.55 * (vn(mp * 1.5 + vec3f(sd * 50.0)) - 0.5);
  var q = mp * disp * el;
  let ax = normalize(vec3f(hsh(key + vec3i(5, 0, 0)) - 0.5, hsh(key + vec3i(0, 5, 0)) - 0.5, hsh(key + vec3i(0, 0, 5)) - 0.5) + vec3f(0.001));
  q = rotAx(q, ax, g.cam.w * (0.03 + 0.12 * sd) + sd * 6.28);
  var o: AO;
  o.wp = rel + q * size;
  o.lp = mp * disp * 2.0 + vec3f(sd * 30.0);
  o.col = tint;
  o.pos = proj(o.wp);
  return o;
}
@fragment fn fs(i: AO) -> @location(0) vec4f {
  var n = normalize(cross(dpdx(i.wp), dpdy(i.wp)));
  let V = -normalize(i.wp);
  if (dot(n, V) < 0.0) { n = -n; }
  let L = normalize(g.sun.xyz - i.wp);
  let tex = fbm(i.lp * 2.2, 3);
  let alb = i.col * (0.55 + 0.9 * tex);
  let lit = alb * (max(dot(n, L), 0.0) * 0.85 + 0.012);
  return vec4f(lit, 1.0);
}
`;

// ---------------------------------------------------------------- comet tails
// Two ribbons that always face the camera: a thin blue ion tail pointing straight away from the sun, and a wider, curved,
// yellowish dust tail. Each is 28 quads along its length, drawn additively with streaks of noise.
const SHADER_TAIL = COMMON + /*wgsl*/`
struct TU {
  a: vec4f,   // nucleus relative to the ship, tail length
  b: vec4f,   // ion tail direction, base width
  c: vec4f,   // dust tail direction, bend
  d: vec4f,   // bend direction, brightness
};
@group(1) @binding(0) var<uniform> tu: TU;
struct TO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) k: f32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> TO {
  let seg = vi / 6u;
  let c = vi % 6u;
  let cx = select(0.0, 1.0, c == 1u || c == 4u || c == 5u);
  let cy = select(-1.0, 1.0, c == 2u || c == 3u || c == 5u);
  let t = (f32(seg) + cx) / 28.0;
  let dust = ii == 1u;
  let dir = select(tu.b.xyz, tu.c.xyz, dust);
  let len = tu.a.w * select(1.0, 0.6, dust);
  var P = tu.a.xyz + dir * len * t;
  if (dust) { P += tu.d.xyz * tu.c.w * len * t * t; }
  let w = tu.b.w * select(0.25 + 2.2 * t, 0.9 + 5.0 * t, dust);
  let side = normalize(cross(dir, P));
  var o: TO;
  o.pos = proj(P + side * cy * w);
  o.uv = vec2f(t, cy);
  o.k = select(0.0, 1.0, dust);
  return o;
}
@fragment fn fs(i: TO) -> @location(0) vec4f {
  let t = i.uv.x;
  let core = exp(-i.uv.y * i.uv.y * select(3.0, 1.6, i.k > 0.5));
  let streak = 0.45 + 1.1 * vn(vec3f(t * 22.0, i.uv.y * 4.0 + i.k * 7.0, g.cam.w * 0.35));
  let I = pow(1.0 - t, select(1.8, 1.3, i.k > 0.5)) * core * streak * smoothstep(0.0, 0.05, t) * tu.d.w;
  let col = select(vec3f(0.35, 0.62, 1.0) * 1.9, vec3f(1.0, 0.82, 0.55) * 0.7, i.k > 0.5);
  return vec4f(col * I, 1.0);
}
`;

// ---------------------------------------------------------------- one-time terrain bake: 6 faces x one texture each
const SHADER_HBAKE = COMMON + PLANET.slice(0, PLANET.indexOf('struct PV')) + /*wgsl*/`
@group(2) @binding(0) var<uniform> hb: vec4f;   // face, texture size
struct HV { @builtin(position) pos: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> HV {
  var q = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: HV;
  o.pos = vec4f(q[vi], 0.0, 1.0);
  return o;
}
@fragment fn fs(i: HV) -> @location(0) vec4f {
  let p = (i.pos.xy - 0.5) / (hb.y - 1.0);       // texel centre i + 0.5 is grid point i / (size - 1)
  let B = fbas(u32(hb.x + 0.5));
  let d = normalize(B[0] + B[1] * tan((p.x * 2.0 - 1.0) * 0.7853982) + B[2] * tan((p.y * 2.0 - 1.0) * 0.7853982));
  return vec4f(hgt(d), 0.0, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------- atmosphere shell seen from space
// A camera-facing quad in front of the planet; the fragment shader works out how much air the view ray crosses.
const SHADER_ATMO = COMMON + PLANET.slice(PLANET.indexOf('struct PU')).split('fn hgt')[0] + /*wgsl*/`
struct AV { @builtin(position) pos: vec4f, @location(0) wp: vec3f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> AV {
  let cx = select(-1.0, 1.0, vi == 1u || vi == 4u || vi == 5u);
  let cy = select(-1.0, 1.0, vi == 2u || vi == 3u || vi == 5u);
  let Ra = pl.c.w * (1.0 + pl.a.w);
  let ctr = pl.c.xyz - normalize(pl.c.xyz) * Ra;
  var o: AV;
  o.wp = ctr + (g.right.xyz * cx + g.up.xyz * cy) * Ra * 1.35;
  o.pos = proj(o.wp);
  return o;
}
@fragment fn fs(i: AV) -> @location(0) vec4f {
  let d = normalize(i.wp);
  let Rp = pl.c.w;
  let Ra = Rp * (1.0 + pl.a.w);
  let t0 = dot(pl.c.xyz, d);
  let h = sqrt(max(dot(pl.c.xyz, pl.c.xyz) - t0 * t0, 0.0));
  if (h >= Ra) { discard; }
  let half = sqrt(Ra * Ra - h * h);
  var path = 2.0 * half;
  if (h < Rp) { path = half - sqrt(Rp * Rp - h * h); }
  let dens = 1.0 - exp(-path / (Ra - Rp) * 0.9);
  let cp = normalize(d * t0 - pl.c.xyz);
  let sd = normalize(g.sun.xyz - pl.c.xyz);
  let ndl = dot(cp, sd);
  let lit = smoothstep(-0.2, 0.55, ndl);
  let alt = clamp((h - Rp) / (Ra - Rp), 0.0, 1.0);          // 0 at the surface, 1 at the top of the air
  let limb = exp(-alt * 3.2);                              // the thin bright ring hugging the surface
  let tint = mix(pl.a.rgb, pl.a.rgb * vec3f(0.5, 0.72, 1.3), alt);   // the upper air shifts toward blue
  let twi = smoothstep(-0.28, 0.0, ndl) * (1.0 - smoothstep(0.0, 0.3, ndl));
  let onDisc = 1.0 - smoothstep(Rp * 0.97, Rp, h);          // seen against the planet itself the air is thin; the glow belongs to the limb
  var col = tint * dens * (0.03 + 0.95 * lit) * (0.25 + 0.9 * limb) * (1.0 - 0.8 * onDisc);
  col += vec3f(1.0, 0.42, 0.16) * twi * dens * limb * 0.5;   // sunrise and sunset colours along the terminator
  return vec4f(col, 1.0);
}
`;

// ---------------------------------------------------------------- planetary rings
const SHADER_RING = COMMON + PLANET.slice(PLANET.indexOf('struct PU')).split('fn hgt')[0] + /*wgsl*/`
struct RV { @builtin(position) pos: vec4f, @location(0) wp: vec3f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> RV {
  let cx = select(-1.0, 1.0, vi == 1u || vi == 4u || vi == 5u);
  let cy = select(-1.0, 1.0, vi == 2u || vi == 3u || vi == 5u);
  let n = normalize(pl.n.xyz);
  let u = normalize(cross(n, vec3f(0.0, 0.0, 1.0)));
  let w = cross(n, u);
  var o: RV;
  o.wp = pl.c.xyz + (u * cx + w * cy) * pl.r.y * pl.c.w;
  o.pos = proj(o.wp);
  return o;
}
@fragment fn fs(i: RV) -> @location(0) vec4f {
  let n = normalize(pl.n.xyz);
  let u = normalize(cross(n, vec3f(0.0, 0.0, 1.0)));
  let w = cross(n, u);
  let rel = i.wp - pl.c.xyz;
  let rad = length(vec2f(dot(rel, u), dot(rel, w))) / pl.c.w;
  let fw = fwidth(rad);
  if (rad < pl.r.x || rad > pl.r.y) { discard; }
  let x = (rad - pl.r.x) / (pl.r.y - pl.r.x);
  let aa = clamp(1.0 - fw * 140.0, 0.0, 1.0);               // bands blur out when they get thinner than a pixel
  let band = mix(0.6, 0.5 + 0.5 * sin(rad * 140.0 + 6.0 * vn(vec3f(rad * 40.0, 3.0, pl.rot.w))), aa);
  var dens = (0.35 + 0.65 * band) * mix(0.8, 0.6 + 0.4 * vn(vec3f(rad * 300.0, 7.0, 1.0)), aa);
  dens = dens * smoothstep(0.0, 0.06, x) * (1.0 - smoothstep(0.92, 1.0, x));
  dens = dens * (1.0 - smoothstep(0.55, 0.57, x) * (1.0 - smoothstep(0.62, 0.64, x)));
  // the planet's shadow falls across the rings
  let Ld = normalize(g.sun.xyz - pl.c.xyz);
  let b = dot(rel, Ld);
  let m2 = dot(rel, rel) - b * b;
  let sh = select(1.0, smoothstep(0.9, 1.05, sqrt(max(m2, 0.0)) / pl.c.w), b < 0.0);
  let col = mix(pl.c2.rgb, pl.c3.rgb, band) * (1.35 * sh + 0.02);
  return vec4f(col, dens * 0.9);
}
`;

// ---------------------------------------------------------------- the ship
// vertex colour alpha selects the material: < 0.4 painted metal, 0.4..0.9 glass, > 0.9 engine nozzle (glows with thrust)
const SHADER_SHIP = COMMON + /*wgsl*/`
struct SU { pos: vec4f, r: vec4f, u: vec4f, f: vec4f, m: vec4f };   // pos.w = scale, m.x = sunlight (0 in shadow), m.y = thrust glow, m.z = time
@group(1) @binding(0) var<uniform> sh: SU;
struct SIn { @location(0) p: vec3f, @location(1) n: vec3f, @location(2) c: vec4f };
struct SO { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) c: vec4f, @location(2) wp: vec3f, @location(3) lp: vec3f, @location(4) ln: vec3f };
@vertex fn vs(i: SIn) -> SO {
  var o: SO;
  var p = i.p;
  if (i.c.a > 1.5) { p.y = mix(0.05, p.y, sh.m.w); }       // landing gear (alpha 2): folds up into the hull when m.w = 0
  o.wp = sh.pos.xyz + (sh.r.xyz * p.x + sh.u.xyz * p.y + sh.f.xyz * p.z) * sh.pos.w;
  o.n = sh.r.xyz * i.n.x + sh.u.xyz * i.n.y + sh.f.xyz * i.n.z;
  o.c = i.c;
  o.lp = i.p;
  o.ln = i.n;
  o.pos = proj(o.wp);
  return o;
}
// panel seams, per-panel tone and rivet-ish dots on the two axes that face the surface: x = seam, y = tone, z = dots
fn panel(lp: vec3f, ln: vec3f) -> vec3f {
  let an = abs(ln);
  var uv = lp.zy;
  if (an.y > an.x && an.y > an.z) { uv = lp.xz; } else if (an.z > an.x) { uv = lp.xy; }
  let c = uv / vec2f(1.1, 0.78);
  let f = abs(fract(c) - vec2f(0.5));
  let seam = smoothstep(0.47, 0.5, max(f.x, f.y));
  let cell = floor(c);
  let tone = hsh(vec3i(i32(cell.x) + 53, i32(cell.y) - 17, i32(dot(an, vec3f(1.0, 3.0, 7.0)) * 5.0)));
  let dd = length(f - vec2f(0.44)) ;
  let dots = 1.0 - smoothstep(0.012, 0.024, dd);
  return vec3f(seam, tone, dots);
}
@fragment fn fs(i: SO) -> @location(0) vec4f {
  let n = normalize(i.n);
  let V = -normalize(i.wp);
  let L = normalize(g.sun.xyz - i.wp);
  let nn = select(-n, n, dot(n, V) > 0.0);                  // the hull is drawn two-sided
  let ndl = max(dot(nn, L), 0.0) * sh.m.x;
  let H = normalize(L + V);
  let nv = max(dot(nn, V), 0.0);
  let fres = pow(1.0 - nv, 4.0);
  let Rv = reflect(-V, nn);
  // a plausible environment: dark space with a trace of the sun's glare, or the sky of the planet we are flying through
  let env = mix(vec3f(0.012, 0.016, 0.03), g.atm.rgb * 0.7, g.atm.w) + vec3f(1.0, 0.9, 0.75) * pow(max(dot(Rv, L), 0.0), 14.0) * 0.35 * sh.m.x;
  var mat = i.c.a;
  if (mat > 1.5) { mat = 0.0; }
  var col = vec3f(0.0);
  if (mat > 0.9) {                                          // nozzle: dark metal ring, hot core that follows the throttle
    col = i.c.rgb * 0.25 * (ndl * 1.2 + 0.08) + vec3f(0.45, 0.68, 1.0) * sh.m.y * 1.5;
  } else if (mat > 0.2 && mat < 0.35) {                    // lit windows: a warm glow, each pane on or off
    let w = hsh(vec3i(i32(floor(i.lp.x * 0.9)), i32(floor(i.lp.z * 0.9)), i32(floor(i.lp.y * 0.9))));
    col = i.c.rgb * (0.25 + 1.6 * step(0.35, w)) * (0.8 + 0.2 * sin(sh.m.z * 0.7 + w * 40.0));
  } else if (mat > 0.4) {                                   // cockpit glass: dark, glossy, strong reflections at grazing angles
    let sp = pow(max(dot(nn, H), 0.0), 90.0) * sh.m.x;
    col = vec3f(0.01, 0.025, 0.05) * (0.4 + ndl) + env * (0.25 + 2.2 * fres) + vec3f(sp * 2.5);
  } else {                                                  // painted metal
    let pn = panel(i.lp, normalize(i.ln));
    let wear = fbm(i.lp * 2.4, 3);
    var alb = i.c.rgb * (0.84 + 0.3 * pn.y) * (0.78 + 0.4 * wear);
    alb = alb * (1.0 - 0.6 * pn.x) * (1.0 - 0.45 * pn.z);
    let rough = mix(24.0, 70.0, wear);
    let sp = pow(max(dot(nn, H), 0.0), rough) * (1.0 - pn.x) * sh.m.x;
    col = alb * (ndl * 1.45 + 0.05) + vec3f(sp * 0.55) + env * alb * (0.35 + 1.2 * fres) + alb * pow(1.0 - nv, 3.0) * 0.1;
  }
  return vec4f(col, 1.0);
}
`;

// ---------------------------------------------------------------- additive glows: the sun's corona and engine flames
const SHADER_GLOW = COMMON + /*wgsl*/`
struct GU { a: array<vec4f, 16>, b: array<vec4f, 16>, c: array<vec4f, 16> };   // pos+size, colour+intensity, flare+depth shift
@group(1) @binding(0) var<uniform> gl: GU;
struct GV { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) @interpolate(flat) k: u32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GV {
  let cx = select(-1.0, 1.0, vi == 1u || vi == 4u || vi == 5u);
  let cy = select(-1.0, 1.0, vi == 2u || vi == 3u || vi == 5u);
  let A = gl.a[ii];
  let C = gl.c[ii];
  let ctr = A.xyz - normalize(A.xyz) * C.y;
  var o: GV;
  o.pos = proj(ctr + (g.right.xyz * cx + g.up.xyz * cy) * A.w);
  o.q = vec2f(cx, cy);
  o.k = ii;
  return o;
}
@fragment fn fs(i: GV) -> @location(0) vec4f {
  let B = gl.b[i.k];
  let C = gl.c[i.k];
  let q = i.q;
  let r2 = dot(q, q);
  var f = max(1.0 - r2, 0.0);
  f = f * f * f;
  var I = f * 0.6 + exp(-r2 * 14.0) * 0.8;
  I += C.x * exp(-abs(q.y) * 50.0) * exp(-abs(q.x) * 2.2) * 0.5;
  I += C.x * exp(-abs(q.x) * 50.0) * exp(-abs(q.y) * 2.2) * 0.5;
  I = I * (1.0 - smoothstep(0.6, 1.0, max(abs(q.x), abs(q.y))));
  return vec4f(B.rgb * B.w * I, 1.0);
}
`;

// ---------------------------------------------------------------- space dust: streaks that give a sense of speed
// Fixed lattice of particles wrapped around the camera; nothing is stored, positions come from the instance index.
const SHADER_DUST = COMMON + /*wgsl*/`
struct DO { @builtin(position) pos: vec4f, @location(0) a: f32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DO {
  let id = i32(ii);
  let h = vec3f(hsh(vec3i(id, 1, 2)), hsh(vec3i(id, 3, 4)), hsh(vec3i(id, 5, 6)));
  let S = g.pm.w;
  var rel = h * S - g.pm.xyz;
  rel = rel - S * floor(rel / S + 0.5);
  let a = rel;
  let b = rel + g.vel.xyz * g.right.w;
  let pa = proj(a);
  let pb = proj(b);
  var o: DO;
  o.a = 0.0;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (pa.w > 0.2 && pb.w > 0.2) {
    let asp = g.cam.y;
    let na = pa.xy / pa.w * vec2f(asp, 1.0);
    let nb = pb.xy / pb.w * vec2f(asp, 1.0);
    let dp = nb - na;
    let len = length(dp);
    let dir = select(vec2f(1.0, 0.0), dp / max(len, 0.000001), len > 0.000001);
    let perp = vec2f(-dir.y, dir.x);
    let hw = 1.0 / g.res.y * (0.8 + 1.2 * h.x);
    let e = select(0.0, 1.0, vi == 1u || vi == 4u || vi == 5u);
    let s = select(-1.0, 1.0, vi == 2u || vi == 3u || vi == 5u);
    let p2 = mix(na, nb, e) + dir * (e * 2.0 - 1.0) * hw + perp * s * hw;
    let w = mix(pa.w, pb.w, e);
    o.pos = vec4f(p2.x / asp * w, p2.y * w, g.cam.z, w);
    let dist = length(rel) / (S * 0.5);
    o.a = (0.25 + 0.75 * h.y) * (1.0 - smoothstep(0.55, 1.0, dist)) * smoothstep(5.0, 14.0, length(rel)) * g.res.z;
  }
  return o;
}
@fragment fn fs(i: DO) -> @location(0) vec4f {
  return vec4f(vec3f(0.8, 0.85, 0.95) * i.a, 1.0);
}
`;

// ---------------------------------------------------------------- post: bloom (down / up chain) and the final composite
// pp.a = threshold, knee, bloom strength, exposure; pp.b = warp amount, vignette, time, flash
const SHADER_POST = /*wgsl*/`
struct PP { a: vec4f, b: vec4f };
@group(0) @binding(0) var<uniform> pp: PP;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;
@group(0) @binding(3) var bl: texture_2d<f32>;
struct PV { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> PV {
  var q = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: PV;
  o.pos = vec4f(q[vi], 0.0, 1.0);
  o.uv = vec2f(q[vi].x * 0.5 + 0.5, 0.5 - q[vi].y * 0.5);
  return o;
}
fn tm(c: vec3f) -> vec3f {
  let a = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  return pow(clamp(a, vec3f(0.0), vec3f(1.0)), vec3f(0.4545));
}
// only the part of a pixel above the threshold blooms, with a soft knee so there is no hard edge
fn thr(c: vec3f) -> vec3f {
  let br = max(c.r, max(c.g, c.b));
  let kn = pp.a.y;
  var rq = clamp(br - pp.a.x + kn, 0.0, 2.0 * kn);
  rq = rq * rq / (4.0 * kn + 0.0001);
  return c * max(rq, br - pp.a.x) / max(br, 0.0001);
}
fn tap(uv: vec2f, o: vec2f, ts: vec2f) -> vec3f { return textureSampleLevel(src, smp, uv + o * ts, 0.0).rgb; }
fn tapT(uv: vec2f, o: vec2f, ts: vec2f) -> vec3f { return thr(min(textureSampleLevel(src, smp, uv + o * ts, 0.0).rgb, vec3f(64.0))); }
// 13-tap downsample (the one Call of Duty used): stable, no shimmering on small bright stars
fn dn(uv: vec2f, first: bool) -> vec3f {
  let ts = 1.0 / vec2f(textureDimensions(src));
  var a: vec3f; var b: vec3f; var c: vec3f; var d: vec3f; var e: vec3f; var f: vec3f; var g: vec3f; var h: vec3f; var i: vec3f;
  var j: vec3f; var k: vec3f; var l: vec3f; var m: vec3f;
  if (first) {
    a = tapT(uv, vec2f(-2.0, -2.0), ts); b = tapT(uv, vec2f(0.0, -2.0), ts); c = tapT(uv, vec2f(2.0, -2.0), ts);
    d = tapT(uv, vec2f(-2.0, 0.0), ts);  e = tapT(uv, vec2f(0.0, 0.0), ts);  f = tapT(uv, vec2f(2.0, 0.0), ts);
    g = tapT(uv, vec2f(-2.0, 2.0), ts);  h = tapT(uv, vec2f(0.0, 2.0), ts);  i = tapT(uv, vec2f(2.0, 2.0), ts);
    j = tapT(uv, vec2f(-1.0, -1.0), ts); k = tapT(uv, vec2f(1.0, -1.0), ts); l = tapT(uv, vec2f(-1.0, 1.0), ts); m = tapT(uv, vec2f(1.0, 1.0), ts);
  } else {
    a = tap(uv, vec2f(-2.0, -2.0), ts); b = tap(uv, vec2f(0.0, -2.0), ts); c = tap(uv, vec2f(2.0, -2.0), ts);
    d = tap(uv, vec2f(-2.0, 0.0), ts);  e = tap(uv, vec2f(0.0, 0.0), ts);  f = tap(uv, vec2f(2.0, 0.0), ts);
    g = tap(uv, vec2f(-2.0, 2.0), ts);  h = tap(uv, vec2f(0.0, 2.0), ts);  i = tap(uv, vec2f(2.0, 2.0), ts);
    j = tap(uv, vec2f(-1.0, -1.0), ts); k = tap(uv, vec2f(1.0, -1.0), ts); l = tap(uv, vec2f(-1.0, 1.0), ts); m = tap(uv, vec2f(1.0, 1.0), ts);
  }
  return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}
@fragment fn fsPre(v: PV) -> @location(0) vec4f { return vec4f(dn(v.uv, true), 1.0); }
@fragment fn fsDown(v: PV) -> @location(0) vec4f { return vec4f(dn(v.uv, false), 1.0); }
// 3x3 tent upsample, added onto the larger level (the pipeline blends additively)
@fragment fn fsUp(v: PV) -> @location(0) vec4f {
  let ts = 1.0 / vec2f(textureDimensions(src));
  var c = tap(v.uv, vec2f(0.0, 0.0), ts) * 4.0;
  c += (tap(v.uv, vec2f(-1.0, 0.0), ts) + tap(v.uv, vec2f(1.0, 0.0), ts) + tap(v.uv, vec2f(0.0, -1.0), ts) + tap(v.uv, vec2f(0.0, 1.0), ts)) * 2.0;
  c += tap(v.uv, vec2f(-1.0, -1.0), ts) + tap(v.uv, vec2f(1.0, -1.0), ts) + tap(v.uv, vec2f(-1.0, 1.0), ts) + tap(v.uv, vec2f(1.0, 1.0), ts);
  return vec4f(c / 16.0 * 0.7, 1.0);
}
fn hash12(p: vec2f) -> f32 {
  var q = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + vec3f(33.33));
  return fract((q.x + q.y) * q.z);
}
@fragment fn fsComp(v: PV) -> @location(0) vec4f {
  let p = v.uv * 2.0 - vec2f(1.0);
  let fx = pp.b.x;
  let r2 = dot(p, p);
  // during a warp light bends toward the edges: a slight zoom, and the colour channels pull apart
  let uz = vec2f(0.5) + (v.uv - vec2f(0.5)) * (1.0 - fx * 0.05);
  let k = fx * 0.045;
  let cr = textureSampleLevel(src, smp, uz - p * r2 * k, 0.0).r;
  let cg = textureSampleLevel(src, smp, uz - p * r2 * k * 0.7, 0.0).g;
  let cb = textureSampleLevel(src, smp, uz - p * r2 * k * 0.4, 0.0).b;
  var c = vec3f(cr, cg, cb) + textureSampleLevel(bl, smp, uz, 0.0).rgb * pp.a.z;
  c += vec3f(0.75, 0.85, 1.0) * pp.b.w * (1.0 - 0.55 * sqrt(r2));
  c = c * pp.a.w;
  c = c * (1.0 - pp.b.y * smoothstep(0.5, 1.5, sqrt(r2)));
  var o = tm(c);
  o += vec3f((hash12(v.pos.xy + vec2f(fract(pp.b.z) * 113.0, fract(pp.b.z * 1.7) * 71.0)) - 0.5) / 255.0);
  return vec4f(o, 1.0);
}
`;
