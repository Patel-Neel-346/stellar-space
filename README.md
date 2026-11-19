# Stellar Garden

A procedural solar system you fly a spaceship through, rendered with raw **WebGPU**. It has landable planets with
biomes and vegetation, an asteroid belt, comets, a space station you can dock with, wrecks you can salvage, and fully
procedural audio. No assets or models: everything is generated in code. The game builds to **one self-contained
`index.html`** (fonts embedded).

## 1. Just play it (no install)

Open `index.html` in **desktop Chrome or Edge (version 113+)** on a computer with a decent GPU.

- Double-clicking the file works. If your browser blocks it, serve the folder instead (see section 3).
- WebGPU must be on. Check `chrome://gpu` and look for "WebGPU: Hardware accelerated". If it isn't, update your GPU
  drivers, and make sure Chrome is using the dedicated GPU (Windows: Settings > System > Display > Graphics).
- Firefox and Safari are not supported. Phones are not supported.

## 2. Controls

| Key | Action |
|---|---|
| Mouse | Steer (click the game to capture the mouse) |
| W / S | Forward / back |
| A / D | Strafe left / right |
| Space / C | Up / down |
| Q / E | Roll left / right |
| Shift | Boost |
| X | Brake |
| **F** | **Dock with the station / salvage a wreck** (when the prompt shows) |
| V | Toggle cockpit / third-person view |
| 1 ... 9, 0 | Warp to a planet (the Sun, then the planets in order) |
| - / = / [ / ] / \ | Warp to the station / asteroid belt / comet Aurelia / Kestrel wreck / comet Vesper |
| H | Show the FPS counter |
| M | Mute |
| Esc | Pause menu (settings, graphics, audio, saves) |

**Landing:** fly slowly toward a solid planet and ease off the throttle. Hold W or Space to take off.
**Docking:** go to Haven Station (orbits Verdant, key `-`), line up with a port at either end of the hub, slow below
90 u/s, press F. Hull repairs while docked; W to undock.
**Salvage:** get within about 170 units of a wreck, slow down, press F, and stay close for 4 seconds.
**Hull:** crashing costs hull. At 0% a recovery beacon puts you back near Verdant.

## 3. Run it from source

You need **Node.js 18+** (https://nodejs.org).

```bash
npm install          # installs esbuild (the only dependency)
npm run build        # bundles src/*.js + template.html into index.html
```

Then open `index.html`, or serve the folder:

```bash
npx serve .          # or: python3 -m http.server 8000   then visit http://localhost:8000
```

Other build modes: `npm run build:readable` (unminified, easier to debug).

After editing anything in `src/` or `template.html`, run `npm run build` again and reload.

## 3b. Project layout

```
src/quality.js   graphics presets and settings (saved in localStorage)
src/math.js      math + noise helpers (the CPU noise mirrors the GPU noise)
src/shaders.js   all WGSL: sky, planets, atmosphere, rings, ship, glow, dust, post, vegetation, asteroids, comet tails
src/world.js     planet definitions, terrain, ship/vegetation meshes
src/space.js     asteroid belt, comets, station, wrecks, their meshes
src/sim.js       flight physics, landing, collisions, hull, docking, salvage, warp, saves (no DOM, testable in Node)
src/cockpit.js   cockpit frame and instruments (2D canvas)
src/main.js      WebGPU setup, per-frame rendering, input, menus, HUD, radio subtitles
src/audio.js     procedural Web Audio: ambience, engines, warp, wildlife, entry, radio, impacts
template.html    page shell and CSS
build.mjs        bundler (concatenates src in order, minifies, embeds fonts)
assets/          Rajdhani font (OFL license)
tests/           Node tests and a browser test
```

File order in `build.mjs` matters: everything shares one scope, so later files can use earlier ones.

## 4. Graphics settings

Esc > Graphics: Low / Medium / High / Ultra presets plus per-option controls (resolution scale, anti-aliasing, bloom,
nebula, planet detail, texture detail, particles, vegetation, asteroids). Resolution, bloom, particles, vegetation and
asteroids apply instantly; anti-aliasing, nebula, planet and texture quality need a restart. If the frame rate is low,
lower Vegetation and Asteroids first, or the resolution scale. The game also adapts its render scale automatically.

## 5. Tests

Node tests (no browser needed):

```bash
node tests/simtest.mjs     # flight, landing, warp to every body
node tests/spacetest.mjs   # comets, station, wrecks, meshes
node tests/colltest.mjs    # collisions, docking, salvage, save/load
node tests/audiotest.mjs   # 5 minutes of audio events against a stubbed Web Audio
```

Browser test (needs Playwright with Chromium and Python Pillow; uses a software WebGPU renderer, so it is slow):

```bash
npm install playwright && npx playwright install chromium && pip install pillow
cd tests/browser && OUT=../../shots node t12.js
```

It plays through a rolled cockpit view, docking and a collision, and saves screenshots to `shots/`.

## 6. Known limits (honest list)

- The ship is the procedural model. To use a glTF/GLB ship you would need to add a loader and supply the file.
- Performance was only tested on a software renderer, never measured on a real GPU.
- The audio was only checked for errors with a stub; the radio "voice" is synthesized babble with subtitles, not words.
- Wreck colliders are two capsules each, an approximation of the mesh.
- Atmospheric entry has sound but no heat glow on the ship.
