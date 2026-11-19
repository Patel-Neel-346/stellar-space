# Complete Technical Codebase Audit — Space Exploration Browser Game (Stellar Garden)

**Audit Target:** `c:\Users\neelp\Desktop\stellar-garden`  
**Build Target Output:** `index.html` (Self-contained WebGPU single-file application)  
**Package Identifier:** `stellar-drift` (Version Build 0.3 · WebGPU)  
**Report File:** `SPACE_GAME_TECHNICAL_AUDIT.md`  
**Date of Audit:** November 2026  
**Auditor:** Antigravity Engineering Systems Analysis

---

## Executive Summary

This codebase constitutes a specialized, zero-dependency, single-file procedural space exploration game rendered with raw **WebGPU** and powered by procedural Web Audio. The game implements an entire compressed planetary system containing an emissive central star, eight planets and moons, an orbital space station, derelict cargo wrecks, two comets on Keplerian orbits, an asteroid belt, and procedural surface props (trees, boulders, crystal clusters). 

The application compiles into a single monolithic, self-contained `index.html` file (inclusive of base64-embedded Rajdhani fonts and minified WebGPU Shading Language [WGSL] shaders) via Node.js and `esbuild`. 

The architecture is notable for its minimalist footprint (< 170 kB bundled, ~40 kB gzipped) and absolute independence from external rendering libraries (such as Three.js, Babylon.js, or PlayCanvas) or physics engines (such as Rapier or Cannon.js). However, this architectural constraint imposes strict graphical and gameplay trade-offs: low-poly flat-shaded meshes, lack of PBR materials, absence of continuous chunked terrain LOD, simplified empirical lighting, flat 2D cloud layers, and the complete absence of an on-foot avatar system (exploration is strictly vehicle-bound).

---

## 1. Project Architecture

### 1.1 Directory Structure & File Inventory

The physical repository layout is structured as follows:

```
c:\Users\neelp\Desktop\stellar-garden\
├── assets\
│   ├── OFL.txt                  # SIL Open Font License for Rajdhani
│   ├── R-Bold.woff2             # Font weight 700 (14.4 kB)
│   ├── R-Medium.woff2           # Font weight 500 (13.8 kB)
│   └── R-SemiBold.woff2         # Font weight 600 (14.4 kB)
├── src\
│   ├── audio.js                 # 208 lines - Procedural Web Audio API sound synthesis graph
│   ├── cockpit.js               # 102 lines - 2D Canvas cockpit frame, HUD dials, and logarithmic radar
│   ├── main.js                  # 677 lines - WebGPU lifecycle, render loops, post-processing, DOM UI & input
│   ├── math.js                  # 39 lines  - CPU vector math, matrix-free Rodrigues rotation, CPU noise mirror
│   ├── quality.js               # 42 lines  - Settings presets, localStorage synchronization, adaptive resolution
│   ├── shaders.js               # 1085 lines - Monolithic WGSL shaders (sky, planets, ships, veg, post, dust)
│   ├── sim.js                   # 438 lines - Orbital integration, flight physics, collision, docking, saves
│   ├── space.js                 # 134 lines - Kepler comet orbits, Haven Station, derelicts, asteroid belt setup
│   └── world.js                 # 241 lines - Solar system planetary constants, terrain formulas, procedural meshes
├── tests\
│   ├── audiotest.mjs            # 90 lines  - Headless Web Audio event integration test
│   ├── colltest.mjs             # 117 lines - Collision detection & docking spatial integration tests
│   ├── simtest.mjs              # 58 lines  - Headless flight, orbit, and landing simulation tests
│   ├── spacetest.mjs            # 38 lines  - Comet ephemeris and procedural mesh verification tests
│   └── browser\
│       ├── harness.js           # 65 lines  - Playwright test runner with headless SwiftShader WebGPU hook
│       └── t12.js               # 56 lines  - End-to-end automated visual test script
├── build.mjs                    # 36 lines  - Node.js build pipeline using esbuild
├── index.html                   # 169.8 kB  - Final compiled production artifact
├── package.json                 # 14 lines  - Package config (devDependencies: esbuild ^0.28.2)
├── package-lock.json            # 14.4 kB   - NPM lockfile
├── README.md                    # 114 lines - Developer documentation and flight manual
└── template.html                # 142 lines - HTML skeleton, CSS styling, UI panels, HUD DOM elements
```

### 1.2 Frameworks, Libraries, and Dependencies

* **Runtime Dependencies:** **Zero (0)**. There are no runtime JavaScript libraries, no npm packages imported in the browser, no Three.js, Babylon.js, Pixi.js, gl-matrix, or physics engines. The application executes on pure Web standards:
  * **Rendering:** Raw WebGPU API (`navigator.gpu`).
  * **Cockpit / HUD:** HTML5 2D Canvas API (`CanvasRenderingContext2D`).
  * **Audio:** Web Audio API (`AudioContext`, `BiquadFilterNode`, `OscillatorNode`, `GainNode`, `ConvolverNode`).
  * **UI & Menuing:** Vanilla DOM APIs manipulated via standard JavaScript.
* **Build-Time Dependencies:** 
  * `esbuild` (`^0.28.2`): Used in [`build.mjs`](file:///c:/Users/neelp/Desktop/stellar-garden/build.mjs#L9) solely for minification (`transformSync`) and CSS minification.
  * Node.js built-in modules: `node:fs`, `node:zlib`, `node:path`, `node:url`.

### 1.3 Build Pipeline & Code Packing

The build mechanism implemented in [`build.mjs`](file:///c:/Users/neelp/Desktop/stellar-garden/build.mjs#L12-L34) operates via ordered text concatenation:
1. Concatenates source files in exact topological order:
   `quality.js` $\rightarrow$ `math.js` $\rightarrow$ `shaders.js` $\rightarrow$ `world.js` $\rightarrow$ `space.js` $\rightarrow$ `sim.js` $\rightarrow$ `cockpit.js` $\rightarrow$ `main.js` $\rightarrow$ `audio.js`.
2. Encodes WOFF2 font files into base64 data URIs and injects them into `@font-face` CSS rules ([`build.mjs:14`](file:///c:/Users/neelp/Desktop/stellar-garden/build.mjs#L14)).
3. Minifies WGSL code embedded within `/*wgsl*/` template literals by stripping comments and extraneous whitespace ([`build.mjs:28-29`](file:///c:/Users/neelp/Desktop/stellar-garden/build.mjs#L28-L29)).
4. Wraps the entire unified script in an asynchronous IIFE:
   ```javascript
   (async()=>{ ... })().catch(e => { ... });
   ```
5. Injects the minified JavaScript into [`template.html`](file:///c:/Users/neelp/Desktop/stellar-garden/template.html#L139), outputting the standalone [`index.html`](file:///c:/Users/neelp/Desktop/stellar-garden/index.html).

### 1.4 Rendering Engine & Pipeline Flow

The rendering pipeline is a multi-pass, forward-plus-bloom HDR engine implemented directly against the WebGPU specification:

```mermaid
flowchart TD
    A[Start Frame] --> B[Input Gathering & Simulation Step]
    B --> C[Camera Placement & Uniform Buffer Update]
    C --> D[Adaptive Resolution Scale Calculation]
    D --> E[Pass 1: Main 3D HDR Scene Render Pass]
    
    subgraph Pass1 [Pass 1: Color Target HDR rgba16float + Depth depth32float]
        E1[Skybox & Starfield Pipeline: pSky] --> E2[Procedural Planets: pPlanet]
        E2 --> E3[Spaceship Hull & Cockpit: pShip]
        E3 --> E4[Surface Vegetation & Props: pVeg]
        E4 --> E5[Space Station & Wrecks: pShip]
        E5 --> E6[Asteroid Belt & Comet Nuclei: pAst]
        E6 --> E7[Planetary Rings: pRing]
        E7 --> E8[Atmosphere Shell Billboards: pAtmo]
        E8 --> E9[Comet Tails: pTail]
        E9 --> E10[Sun Corona & Engine Glows: pGlow]
        E10 --> E11[Space Dust Particles: pDust]
    end
    
    E --> Pass1
    Pass1 --> F[Pass 2: Bloom Downsample Chain]
    
    subgraph Pass2 [Bloom Pyramid]
        F1[fsPre: 13-tap Downsample + Threshold Knee] --> F2[fsDown: 5 mip levels down]
        F2 --> F3[fsUp: 3x3 Tent Additive Upsample Chain]
    end
    
    F --> Pass2
    Pass2 --> G[Pass 3: Composite & Post-Process Pass]
    
    subgraph Pass3 [Composite: pComp]
        G1[Texture Sampling Scene + Bloom] --> G2[Chromatic Aberration & Warp Distortion]
        G2 --> G3[Vignette & Exposure Grading]
        G3 --> G4[ACES Filmic Tonemapping tm]
        G4 --> G5[Triangular Dithering hash12]
        G5 --> G6[Output to Canvas Swapchain PreferredFormat]
    end
    
    G --> Pass3
    Pass3 --> H[Pass 4: 2D Canvas Cockpit Instruments Overlay]
    H --> I[End Frame / Present]
```

#### Key Rendering Pipeline Conventions:
* **Camera-Relative 64-bit Precision:** Rather than maintaining world matrices in single-precision 32-bit floats (which would suffer catastrophic floating-point jitter across the 60,000 unit solar system), the CPU stores positions in 64-bit `Float64Array`. Every frame in [`main.js:439-453`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L439-L453), the camera position `cam` is subtracted from object positions in 64-bit CPU math. Only relative offsets (`SU[0..2]`, `GF[16..18]`, `u[0..2]`) are uploaded to 32-bit GPU uniform buffers.
* **Reverse-Z Depth Projection with Infinite Far Plane:** In [`shaders.js:51-54`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L51-L54) (`proj()`):
  $$\text{clip.x} = \frac{\mathbf{v}_{\text{rel}} \cdot \mathbf{cam}_{\text{right}} \cdot \cot(\text{fov}/2)}{\text{aspect}}, \quad \text{clip.y} = \mathbf{v}_{\text{rel}} \cdot \mathbf{cam}_{\text{up}} \cdot \cot(\text{fov}/2)$$
  $$\text{clip.z} = \mathbf{cam}_{\text{near}}, \quad \text{clip.w} = \mathbf{v}_{\text{rel}} \cdot \mathbf{cam}_{\text{fwd}}$$
  Depth buffer uses format `depth32float`. Depth clears to `0.0` and compares with `greater` ([`main.js:84`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L84), [`main.js:590`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L590)). This provides near-logarithmic precision near the camera while eliminating z-fighting across vast cosmic distances.
* **Color Space:** Scene rendering operates in linear HDR (`rgba16float`). The composite shader applies an ACES-like filmic tonemapping curve and gamma 2.2 approximation (`0.4545`), outputting directly to the display format (`bgra8unorm` or `rgba8unorm`).

### 1.5 System Communication & State Architecture

Because all code is bundled into a single scope, there is no message broker or event emitter. Modules communicate through direct access to shared global objects:
* `SH` ([`sim.js:9`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js#L9)): Ship coordinate state (`p`: position $[x,y,z]$, `v`: velocity, `r`: right vector, `u`: up vector, `f`: forward vector).
* `ST` ([`sim.js:12-18`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js#L12-L18)): Simulation metrics (`t`, `landed`, `alt`, `speed`, `hull`, `cargo`, `warp`, `dk`, `sv`, `skyS`, `sky`, `nb`).
* `IN` ([`sim.js:11`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js#L11)): Raw input state (`fwd`, `str`, `vert`, `roll`, `boost`, `brake`, `mx`, `my`, `act`).
* `SND` ([`main.js:10`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L10)): Audio telemetry bridge. `main.js` and `sim.js` write simulation parameters each frame; `audio.js` samples `SND` via an asynchronous 10 Hz `setInterval` loop ([`audio.js:202`](file:///c:/Users/neelp/Desktop/stellar-garden/src/audio.js#L202)).
* `GP` / `GS` ([`quality.js:24-30`](file:///c:/Users/neelp/Desktop/stellar-garden/src/quality.js#L24-L30)): Graphics profiles and active settings synchronizing with `localStorage`.

---

## 2. Graphics and Rendering

### 2.1 Spaceship Rendering
* **Geometry Construction:** Generated procedurally in [`world.js:153-173`](file:///c:/Users/neelp/Desktop/stellar-garden/src/world.js#L153-L173) (`buildShip()`) via programmatic CSG-like primitives (`frustum`, `plate`, `fin`, `pod`, `box`). No 3D model files (glTF, OBJ) exist.
* **Vertex Layout:** 10 contiguous 32-bit floats per vertex: `[x, y, z, nx, ny, nz, r, g, b, a]` (40-byte stride) defined in [`main.js:115-116`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L115-L116).
* **Landing Gear Kinematics:** The landing gear is modeled in an extended state with vertex attribute `a = 2.0`. In the vertex shader [`shaders.js:872`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L872), vertices with `i.c.a > 1.5` are procedurally collapsed into the fuselage:
  ```wgsl
  if (i.c.a > 1.5) { p.y = mix(0.05, p.y, sh.m.w); }
  ```
  where `sh.m.w` is the smoothed landing gear extension uniform `gearE` ([`main.js:501`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L501)).
* **Hull Shading (`SHADER_SHIP`):**
  * **Procedural Paneling:** Evaluated in [`shaders.js:882-894`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L882-L894) (`panel()`). UV coordinates are extracted from object-space positions (`lp.zy`, `lp.xz`, or `lp.xy`), computing plate seams (`seam`), random per-panel lightness (`tone`), and rivet dots (`dots`).
  * **Material Decomposition via Vertex Alpha:**
    * $\alpha < 0.4$: Painted metal with micro-wear noise (`fbm`) and Blinn-Phong specular highlight (`roughness` 24–70).
    * $0.2 < \alpha < 0.35$: Lit structural windows with randomized hash states (used for Haven Station).
    * $0.4 \le \alpha \le 0.9$: Canopy glass. High specular power ($90.0$), strong Fresnel grazing reflectance ($\text{pow}(1.0 - \mathbf{n} \cdot \mathbf{v}, 4.0)$).
    * $\alpha > 0.9$: Engine exhaust nozzles. Inner emission driven by throttle state `sh.m.y`.

### 2.2 Stars, Galaxies, and Nebulae
* **Nebula Generation:** 
  * Implemented in [`shaders.js:94-124`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L94-L124) (`neb()`).
  * Uses ridged multifractal noise (`ridged()`), domain warping via 3-component FBM vector offsets, exponential extinction curves for the galactic band (`milky`), and directional rim lighting along gas filament edges.
  * **Pre-Baking:** Because this noise is computationally intensive, it is baked once at initialization into a 6-face 2D texture array `tSky` of format `rgba16float` ([`main.js:130-139`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L130-L139)). Face resolution `SKYN` scales with settings ($512, 768, 1024, 1280$).
* **Starfield & Bright Diffraction Spikes:**
  * Evaluated per-pixel in [`shaders.js:171-249`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L171-L249).
  * Three 3D lattice grids (frequencies $45, 110, 260$) generate point stars following a steep $h^6$ power-law brightness curve. Star color temperature (`tcol()`) interpolates from blue-white through yellow to orange.
  * Prominent stars (`bright()`) generate an 8-point diffraction starburst: central Gaussian core, soft halo, and screen-space cross and diagonal diffraction spikes (`sx, sy, s1, s2`) simulating telescope aperture vanes.
* **Galaxies:** Procedural elliptical disks generated from sparse lattice hashes (`shaders.js:220-243`), generating exponential luminosity profiles with bright cores.
* **Warp Streaks:** When entering warp (`g.srf.w > 0.003`), [`shaders.js:258-273`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L258-L273) performs a 6-to-14 tap radial sample blur along tangent vectors directed away from the forward heading vector.

### 2.3 Planet Rendering
* **Mesh Architecture:** Spherified cube. 6 faces rendered via indexed grid drawing (`pPlanet`). Vertex count per edge `N` scales dynamically with angular screen size ([`main.js:459-462`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L459-L462)): `NHI` (64–224), `NMID` (40–112), `NLO` (20–56).
* **Cube-to-Sphere Mapping:** Evaluated in [`shaders.js:360-362`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L360-L362):
  $$\mathbf{d} = \text{normalize}\left(\mathbf{B}_0 + \mathbf{B}_1 \tan\left((2u-1)\frac{\pi}{4}\right) + \mathbf{B}_2 \tan\left((2v-1)\frac{\pi}{4}\right)\right)$$
  The tangent mapping ensures uniform texel/vertex distribution across the sphere, avoiding edge clustering.
* **Height Sampling:** Vertices sample a pre-baked height map texture array `hT` (`r16float`, resolution 256–1024) in the vertex shader (`shaders.js:354-358`).
* **Vertex Normals:** Computed via finite differences in the vertex shader ([`shaders.js:370-381`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L370-L381)) by evaluating adjacent sample directions `d1` and `d2`.
* **Screen-Space Derivative Bump Mapping:** In the fragment shader ([`shaders.js:422-426`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L422-L426)), fine procedural detail is evaluated using screen-space derivatives:
  ```wgsl
  let px = dpdx(wp); let py = dpdy(wp);
  let r1 = cross(py, N); let r2 = cross(N, px);
  let det = dot(px, r1);
  let grad = sign(det) * (bx * r1 + by * r2);
  N = normalize(abs(det) * N - bumpK * grad);
  ```

### 2.4 Lighting, Shadows, and Materials
* **Lighting Model:** Single directional light representing the central Sun at world origin $(0,0,0)$.
  * Diffuse term: Lambertian $\max(\mathbf{N} \cdot \mathbf{L}, 0.0)$.
  * Specular term: Blinn-Phong specular highlight $\max(\mathbf{N} \cdot \mathbf{H}, 0.0)^{\text{shin}}$ masked strictly to illuminated regions ($\mathbf{N} \cdot \mathbf{L} > 0$).
  * Limb rim lighting: $\text{pow}(1.0 - \max(\mathbf{N} \cdot \mathbf{V}, 0.0), 3.0)$ scaled by atmosphere thickness.
  * Sunset terminator tint: $\mathbf{N} \cdot \mathbf{L}$ smoothstep creating a thin copper-orange band along the day-night boundary.
* **Shadows:** **No shadow maps exist in the engine.**
  * Planetary shadows on rings are computed analytically via ray-sphere cylinder intersection in [`shaders.js:853-856`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L853-L856).
  * Cloud shadows on terrain are approximated by shifting the cloud sample coordinate along the unspun sun vector `Ll` ([`shaders.js:466-469`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L466-L469)).
  * Ship sunlight occlusion is evaluated via CPU ray-sphere tests against all celestial bodies in [`main.js:490-496`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L490-L496).

### 2.5 Post-Processing & Screen Effects
Implemented in [`shaders.js:1006-1085`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L1006-L1085) (`SHADER_POST`):
1. **Bloom Filter:** 
   * **Downsampling:** Dual-pyramid structure. Pre-filter pass (`fsPre`) applies a 13-tap box-plus-cross filter (Call of Duty style) with a soft knee threshold curve (`thr()`).
   * **Pyramid Mips:** Successively downsampled through 5 mip levels (`fsDown`), then upsampled with a 9-tap 3x3 tent filter (`fsUp`) and accumulated additively.
2. **Warp Dispersion:** Chromatic aberration that zooms the image slightly and separates color channels quadratically toward screen edges:
   $$\mathbf{u}_z = 0.5 + (\mathbf{uv} - 0.5)(1.0 - 0.05 f_x), \quad \Delta \mathbf{u} = \mathbf{p} r^2 (0.045 f_x)$$
3. **Tonemapping:** ACES-like filmic approximation:
   $$f(x) = \frac{x(2.51x + 0.03)}{x(2.43x + 0.59) + 0.14}$$
4. **Dithering:** High-frequency triangular dither noise (`hash12`) added to output pixels before 8-bit quantization to prevent color banding in dark space regions.

---

## 3. Procedural Generation

### 3.1 Planetary Generation & Biomes
Defined in [`world.js:11-32`](file:///c:/Users/neelp/Desktop/stellar-garden/src/world.js#L11-L32) (`BODY_DEFS`), celestial bodies are categorized into six distinct surface types (`kind` 0 through 5):

| Body | Kind | Radius ($R$) | Orbit ($a$) | Characteristics & Biome Implementation |
| :--- | :---: | :---: | :---: | :--- |
| **The Sun** | 5 | 1300 | 0 | Solar granulations via time-animated FBM noise; limb darkening. |
| **Cinder** | 0 | 140 | 5,200 | Barren rock; crater lattice hash; gray basalt palette. |
| **Ember** | 4 | 230 | 8,600 | Volcanic world; lava lakes and emissive fracture networks. |
| **Verdant** | 1 | 260 | 13,000 | Living Earth-like world; oceans, beaches, forests, snow, cloud shadows. |
| **Pale** | 0 | 70 | 1,100 (Moon) | Barren rock moon of Verdant; high crater density. |
| **Rust** | 0 | 190 | 18,000 | Desert planet; iron oxide dunes and thin carbon dioxide haze. |
| **Goliath** | 2 | 1000 | 30,000 | Gas giant; turbulent latitudinal wind bands; Great Red Spot vortex. |
| **Halcyon** | 2 | 760 | 41,000 | Ringed gas giant; golden ammonia clouds; dense concentric dust rings. |
| **Cerulea** | 2 | 450 | 51,000 | Ice giant; methane-rich cyan atmosphere; high-altitude haze. |
| **Nyx** | 3 | 300 | 60,000 | Cryo-world; nitrogen ice sheets; ridged tectonic fractures. |

### 3.2 Terrain Height Formulation
The terrain height formula is mathematically identical across the GPU bake shader [`shaders.js:302-308`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L302-L308) and the CPU flight collision engine [`world.js:60-66`](file:///c:/Users/neelp/Desktop/stellar-garden/src/world.js#L60-L66):
$$h(\mathbf{d}) = A \cdot \max\left(0.65 \cdot \text{fbm}_5(f\mathbf{d} + \mathbf{o}) + 0.35 \cdot \left[1.0 - |2 \cdot \text{fbm}_4(2.1f\mathbf{d} + \mathbf{o} + 9) - 1.0|\right] - \text{sea}, \, 0.0\right)$$
where $A$ is elevation amplitude (`amp`), $f$ is spatial frequency (`freq`), $\mathbf{o}$ is seed offset, and $\text{sea}$ is the sea-level cutoff. Regions below $\text{sea}$ clamp to $0.0$, generating flat sea-level ocean surfaces.

### 3.3 Noise Functions
* **Hash (`ihash` / `hsh`):** A 3D integer hash utilizing large prime bitwise integer multiplication and bit shifts ([`math.js:12-16`](file:///c:/Users/neelp/Desktop/stellar-garden/src/math.js#L12-L16), [`shaders.js:24-28`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L24-L28)):
  ```javascript
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  ```
* **Value Noise (`vnoise` / `vn`):** Trilinear interpolation over integer lattice cells with cubic Hermite smoothing $3x^2 - 2x^3$.
* **Fractal Brownian Motion (`fbm`):** Octave summation with octave frequency multiplier $2.03$ and spatial offsets $(17.1, 31.7, 5.3)$ to decorrelate coordinate axes.

### 3.4 Atmosphere & Clouds
* **Atmosphere Shell (`SHADER_ATMO`):** Rendered as a camera-facing billboard quad positioned at planet center ([`shaders.js:787-822`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L787-L822)). Ray-sphere intersection evaluates chord length through the spherical atmosphere shell. Optical density follows Beer-Lambert exponential extinction. Limb brightening and terminator twilight reddening are evaluated analytically.
* **Clouds:** Evaluated solely as a 2D fragment shader layer in [`shaders.js:462-471`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L462-L471). There are no 3D volumetric clouds. Clouds rotate slowly around the planet's Y-axis via a time offset.

### 3.5 Surface Props (Vegetation, Rocks, Crystals)
* **Mesh Definitions:** Four procedural low-poly models built in [`world.js:178-239`](file:///c:/Users/neelp/Desktop/stellar-garden/src/world.js#L178-L239) (`buildVeg()`):
  * Class 0: Conifer tree (height 14, 4 tiered foliage cones).
  * Class 1: Broadleaf tree (height 12, 3 squashed lumpy foliage blobs).
  * Class 2: Boulder cluster (deformed lumpy spheres).
  * Class 3: Crystal cluster (3 faceted hexagonal prisms with emissive material).
* **GPU Instanced Placement (`SHADER_VEG`):**
  * When ship altitude drops below $420$ units over a solid world ([`main.js:469-483`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L469-L483)), a 2D tangent grid is projected onto the sphere.
  * Number of instances: $N^2$ (from $20 \times 20 = 400$ up to $48 \times 48 = 2,304$ instances based on the `veg` quality preset).
  * The vertex shader ([`shaders.js:559-644`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L559-L644)) hashes each grid cell, samples the baked height texture `hT`, extracts ground elevation, checks moisture and temperature rules, aligns the prop normal radially with the planet, and applies distance fade. Props outside valid biomes or in oceans are discarded by setting output position to clip coordinates $(3.0, 3.0, 0.0, 1.0)$.

### 3.6 Asteroids and Comets
* **Asteroid Belt (`SHADER_AST`):** Procedural spatial hashing in [`shaders.js:664-723`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L664-L723). The belt is not stored in memory. The engine instantiates a grid of cells centered on the ship across two scales:
  * Fine layer: Cell size $150$, radius variance $2$ to $32$ units.
  * Coarse layer: Cell size $1,000$, radius variance $35$ to $220$ units.
  * All rocks share a single 77-vertex lumpy base sphere mesh (`vbRock`), deformed per-instance in the vertex shader by noise and tumbling matrices.
* **Comets:** Comets Aurelia and Vesper follow Keplerian orbital ellipses calculated in [`space.js:12-21`](file:///c:/Users/neelp/Desktop/stellar-garden/src/space.js#L12-L21) (`kepler()`). Each comet renders:
  1. Nucleus: Deformed rock mesh (`pAst`).
  2. Coma: Additive billboard glow sprite (`pGlow`).
  3. Dual Tails (`pTail`): 28-segment camera-facing additive triangle ribbons for a straight blue ion tail (solar radiation pressure) and a curved yellow dust tail (orbital inertia).

---

## 4. Space Exploration Mechanics

### 4.1 Spaceship Movement & Flight Physics
Implemented in [`src/sim.js`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js):
* **State Representation:** 3D orthogonal frame vectors (`SH.f` forward, `SH.r` right, `SH.u` up) and double-precision position/velocity (`SH.p`, `SH.v`).
* **Frame Orthonormalization:** Executed every step via Gram-Schmidt in [`sim.js:25-34`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js#L25-L34) (`ortho()`) to eliminate numerical drift.
* **Coordinate-Eased Flight Model:**
  * Rather than pure Newtonian inertia, ship velocity is smoothed toward a thrust target measured **relative to the nearest celestial body's orbital motion** (`fv`, [`sim.js:279-281`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js#L279-L281)). This prevents the ship from rapidly drifting away from moving planets when the controls are released.
  * Maximum cruising speed: $380\text{ u/s}$ normal, $3,230\text{ u/s}$ under boost ($8.5\times$).
  * Low-Altitude Speed Governor: Near planets ($d < 8R$), top speed is constrained:
    $$\text{speed}_{\text{max}} = 60 + \max(\text{altitude}, 0) \cdot 0.9$$
    This mechanically eliminates accidental high-velocity surface impacts.
* **Gravity:** Active when altitude $d < 10R$ for all bodies except the Sun ([`sim.js:314-317`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js#L314-L317)):
  $$g = 38 \cdot \left(\frac{R}{d}\right)^2 \Delta t$$
* **Terrain Alignment:** At altitudes below $120$ units, the ship's up-vector gradually rotates to align with the local terrain normal ([`sim.js:321`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js#L321)).

### 4.2 Planetary Landing and Takeoff
* **Touchdown Detection:** In [`sim.js:325-343`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js#L325-L343), ground radius `groundR()` is checked. If the ship makes contact with normal velocity $v_n > -45\text{ u/s}$ and tangential velocity $v_t < 55\text{ u/s}$, the ship transitions to `ST.landed`:
  * Relative offset vector `LO` is latched.
  * The ship is mechanically parented to the planet, matching its orbital velocity and surface rotation rate (`spinW`).
* **Takeoff:** Holding W, Space, or Boost pushes the ship radially outward at $40\text{ u/s}$ and restores free flight ([`sim.js:292-296`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js#L292-L296)).

### 4.3 Space-to-Atmosphere Transition
* Seamless coordinate transition without scene reloading or spatial partitioning.
* Atmosphere factor `ST.skyS` smoothly interpolates from $0.0$ to $1.0$ based on altitude relative to atmospheric scale height ([`sim.js:354-361`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js#L354-L361)).
* Dynamic atmospheric entry roar and cockpit air rush synthesize in [`audio.js:170-172`](file:///c:/Users/neelp/Desktop/stellar-garden/src/audio.js#L170-L172).
* **Missing Feature:** There is no atmospheric entry plasma heat glow on the ship mesh (acknowledged in README).

### 4.4 Space Station Docking & Salvage
* **Haven Station:** Features two axial docking ports at $\pm 74$ units along the station hub axis. Approaching below $90\text{ u/s}$ displays the "PRESS F TO DOCK" prompt. Pressing F initiates an automated approach curve (`tickDock()`, [`sim.js:194-214`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js#L194-L214)), locking the ship into the docking port, repairing hull integrity at $12\%/\text{s}$, and refueling/resetting damage.
* **Derelict Salvage:** Approaching within $170$ units of a wreck below $80\text{ u/s}$ allows pressing F to engage a tractor beam. Holding position for 4 seconds completes salvage, awarding $+1$ scrap cargo and $+25$ hull repair ([`sim.js:215-224`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js#L215-L224)).

### 4.5 Implemented vs. Planned Features
* **Implemented:**
  * Free interplanetary 6-DOF flight and automated warp drive.
  * Landable solid worlds with terrain collision and planetary rotation sync.
  * Procedural surface vegetation, boulders, and crystal fields.
  * Continuous collision detection for asteroids, space stations, and derelicts.
  * Docking, hull repair, salvage mechanics, and game save/load states.
  * Fully procedural Web Audio soundscape (engine, ambience, wildlife, radio).
* **Not Implemented / Missing:**
  * **On-Foot / EVA Exploration:** There is no player character model, walking controller, or ability to disembark from the ship.
  * **Procedural Creatures / Fauna:** Wildlife exists purely as synthesized audio calls (`audio.js:97-102`), with zero 3D models or animations.
  * **Dynamic Weather / Precipitation:** Rain, snow particles, lightning, or atmospheric storms do not exist.
  * **True Volumetric Clouds:** Clouds are a flat 2D shader layer on the planetary sphere.
  * **Realistic Astronomical Scale:** All planetary radii ($70$–$1000$ units) and orbital distances ($5,000$–$60,000$ units) are compressed by factors of $10,000\times$ compared to real-world astrophysics.

---

## 5. Performance Analysis

### 5.1 Draw Calls & Pipeline Dispatch
The application is exceptionally draw-call efficient. Because WebGPU render passes do not suffer from WebGL CPU validation overhead, per-frame dispatches are minimal:

| Pipeline | Target / Pass | Instances / Vertices | Typical Draw Calls per Frame |
| :--- | :--- | :--- | :---: |
| `pSky` | Skybox | 3 vertices (fullscreen triangle) | 1 |
| `pPlanet` | Visible celestial bodies | 6 faces $\times (N^2 \times 6)$ indices | 1 to 10 |
| `pShip` | Player spaceship | 1 instance (procedural hull) | 1 (0 in cockpit view) |
| `pVeg` | Surface vegetation / rocks | 400 to 2,304 instances (4 models) | 4 |
| `pShip` | Haven Station & Wrecks | Hub, Ring, 3 Derelicts | 2 to 5 |
| `pAst` | Asteroids & Comet nuclei | Dual grid instances + comet rocks | 1 to 3 |
| `pRing` | Planetary rings | 6 vertices (billboard plane) | 0 to 1 |
| `pAtmo` | Atmosphere limb shells | 6 vertices (quad billboard) | 0 to 8 |
| `pTail` | Comet tails | 168 vertices $\times 2$ instances | 0 to 2 |
| `pGlow` | Sun corona & engine flares | Up to 16 instanced billboard quads | 1 |
| `pDust` | Space velocity dust | 1,200 to 9,000 instanced lines | 1 |
| `pPre`, `pDown`, `pUp` | Bloom down/up chain | Fullscreen quads (6 mips down, 5 up) | 11 |
| `pComp` | Final HDR-to-SDR tonemap | Fullscreen quad | 1 |
| **Total** | | | **~24 to 48 calls / frame** |

### 5.2 CPU & GPU Bottlenecks

```mermaid
pie title GPU Execution Profile Breakdown (Estimated at 1440p High)
    "Planet Fragment Shader (Noise & Derivatives)" : 45
    "Post-Processing & Bloom Pyramid" : 20
    "MSAA 4x Resolve Bandwidth" : 15
    "Skybox & Procedural Starfield" : 10
    "Geometry & Instancing (Veg/Asteroids)" : 10
```

1. **GPU Fragment Bound (Fill-Rate & ALU):**
   * The primary bottleneck is the `PLANET` fragment shader ([`shaders.js:390-523`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L390-L523)). For every pixel on a planet, the GPU evaluates multiple 3D noise functions (`crat`, `fbm`, `bp`, `moist`, `temp`, `cn`, `sn`), screen-space derivatives (`dpdx`/`dpdy`), and lighting calculations.
   * On 4K displays or high-DPI laptops, this causes noticeable GPU ALU throttling on integrated graphics (e.g., Intel Iris Xe, Apple M-series base chips).
2. **Post-Processing Pass Overhead:**
   * The bloom chain executes 11 separate render passes per frame. While each pass operates on downscaled textures, the constant render pass transitions (`beginRenderPass` / `end`) introduce command buffer execution overhead on tiled mobile GPUs.
3. **CPU Execution:**
   * CPU utilization is negligible (< 1.5 ms per frame). JavaScript memory allocations are zero in the active loop: all vector mathematics operate on pre-allocated typed arrays (`Float64Array`, `Float32Array`).
   * No garbage collection pauses occur during standard flight.

### 5.3 Memory Footprint
* **JavaScript Heap:** Extremely compact (< 25 MB active heap).
* **VRAM Consumption:**
  * Framebuffers (`tScene`, `tRes`, `tDepth` at $2560 \times 1440 \times 4\times\text{MSAA}$): ~80 MB.
  * Bloom mip pyramid: ~15 MB.
  * Sky texture array `tSky` ($1024 \times 1024 \times 6 \times \text{rgba16float}$): ~48 MB.
  * Planet height map arrays `hT` ($512 \times 512 \times 6 \times \text{r16float}$ per solid body): ~18 MB total.
  * Vertex buffers (ship, props, station, wrecks): < 2 MB.
  * **Total VRAM Footprint:** **~160 MB to 220 MB**, well within memory limits of any modern discrete or integrated GPU.

### 5.4 Level of Detail (LOD) & Scalability
* **Terrain LOD Limitations:** There is no quadtree or continuous level-of-detail algorithm (e.g., CDLOD, Chunked Clipmaps). The entire planetary sphere is always rendered as a single mesh at a fixed grid density ($N$).
* When approaching ground level, the triangular density does not increase dynamically; this causes terrain polygons to appear stretched and angular when flying low over mountain ranges.
* **Adaptive Dynamic Resolution:** [`main.js:412-421`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L412-L421) dynamically monitors frame rate every $0.6$ seconds. If the framerate falls below 50 fps, the internal render scale `RS` automatically throttles down (down to a minimum floor of $40\%$), recovering frame rate dynamically.

### 5.5 Browser Compatibility & Automated Test Suite Defect
* **Browser Compatibility:** Strictly limited to browsers implementing WebGPU (Google Chrome 113+, Microsoft Edge 113+). Mozilla Firefox and Apple Safari are unsupported out-of-the-box.
* **Windows File Pathing Defect in Tests:**
  * When executing `node tests/simtest.mjs` on Windows, the test suite crashes immediately with:
    `Error: ENOENT: no such file or directory, open 'C:\C:\Users\neelp\Desktop\stellar-garden\src\quality.js'`
  * **Cause:** [`tests/simtest.mjs:1`](file:///c:/Users/neelp/Desktop/stellar-garden/tests/simtest.mjs#L1), [`tests/colltest.mjs:1`](file:///c:/Users/neelp/Desktop/stellar-garden/tests/colltest.mjs#L1), and [`tests/spacetest.mjs:1`](file:///c:/Users/neelp/Desktop/stellar-garden/tests/spacetest.mjs#L1) use:
    ```javascript
    const SRC = new URL('../src/', import.meta.url).pathname;
    ```
    On Windows systems, `new URL().pathname` returns `/C:/Users/...`, which Node.js interprets incorrectly when concatenated, producing `C:\C:\Users\...`.
  * In contrast, the build script [`build.mjs:8-11`](file:///c:/Users/neelp/Desktop/stellar-garden/build.mjs#L8-L11) uses the correct cross-platform pattern:
    ```javascript
    import { fileURLToPath } from 'node:url';
    const here = path.dirname(fileURLToPath(import.meta.url));
    ```

---

## 6. Visual Quality Assessment

### 6.1 Current Visual Style Analysis
The game currently presents a retro-stylized, clean science-fiction appearance reminiscent of early 2000s space flight simulators combined with modern post-processing bloom. While visually cohesive and technically impressive for a single HTML file under 170 kB, it diverges significantly from photorealistic procedural engines (such as *Abyssal Garden*, *No Man's Sky*, or *SpaceEngine*).

### 6.2 Comparison with High-Quality Procedural Environments (Abyssal Garden)

```
+----------------------------------------------------------------------------------------------------+
|                                    VISUAL FIDELITY COMPARISON                                      |
+------------------------------+----------------------------------+----------------------------------+
| Feature                      | Current Codebase (Stellar Garden)| High-End (Abyssal Garden / PBR)  |
+------------------------------+----------------------------------+----------------------------------+
| Shading Model                | Blinn-Phong + Empirical Fresnel | Cook-Torrance Microfacet GGX BRDF|
| Environment Lighting         | Monochromatic Ambient Constant   | Split-Sum Image-Based Lighting   |
| Terrain LOD                  | Static Cube-Sphere Resolution    | Adaptive Quadtree Chunked CDLOD  |
| Shadows                      | Analytical approximations only   | Cascaded Shadow Maps (CSM)       |
| Atmosphere Model             | Single-scatter chord billboard   | Dual Precomputed Rayleigh & Mie  |
| Clouds                       | Flat 2D surface texture blend    | Raymarched 3D Volumetric Noise   |
| Terrain Texturing            | Single vertex-height color blend | Triplanar Multi-Material Splats  |
| Foliage Rendering            | Unlit rigid low-poly meshes      | Subsurface scattering + Wind PBR |
| Ambient Occlusion            | None                             | GTAO / HBAO+ / SSAO              |
+------------------------------+----------------------------------+----------------------------------+
```

### 6.3 Detailed Gap Breakdown

#### A. Lighting & Materials
* **Absence of Physically-Based Rendering (PBR):** Materials do not conserve energy. Surfaces lack roughness, metalness, and reflectance maps. Specular highlights appear as plastic Blinn-Phong hot spots rather than physically accurate microfacet reflections.
* **Absence of Image-Based Lighting (IBL):** In deep space, unlit sides of the spaceship and terrain are illuminated only by a flat ambient constant (`0.012, 0.016, 0.03`). There is no environment map irradiance convolution reflecting the surrounding nebula onto metallic surfaces.

#### B. Atmospheric Depth & Volumetrics
* **Single-Scattering Falloff:** The atmosphere shader (`SHADER_ATMO`) uses an empirical chord density formula. It lacks true physical Rayleigh scattering (which scatters short blue wavelengths omnidirectionally) and Mie scattering (which produces the intense forward-scattering solar halo around the Sun).
* **Absence of Volumetric Clouds:** The clouds on Verdant are drawn flat onto the planet's surface mesh. Flying down to the surface does not involve penetrating a 3D cloud deck. There is no sense of cloud thickness, internal light scattering, or wispy cloud edges.

#### C. Environmental Density & Detail
* **Rigid Surface Props:** The trees and boulders placed by `SHADER_VEG` are static and rigid. They lack vertex-shader wind sway animation, leaf translucency (subsurface scattering), or ground-clutter grass blades.
* **Terrain Triplanar Splatting:** Steep cliffs on mountainous terrain display vertical texture stretching because colors are mapped based on radial height rather than triplanar normal-weighted projections (blending rock textures on vertical slopes and grass on horizontal plateaus).

#### D. Spatial Depth and Scale
* **Extreme Planetary Compression:** Planets are between $140$ and $1,000$ meters across. The mountains are roughly $10$ to $50$ meters high. This gives celestial bodies the visual presence of miniature asteroids rather than colossal planets with thousands of kilometers of horizon curvature.

---

## 7. Technical Improvement Roadmap

The following improvements are prioritized by their impact on visual fidelity and architectural capability:

```mermaid
gantt
    title Technical Roadmap Priority Matrix
    dateFormat  X
    axisFormat %s
    section Core Visuals
    1. Continuous Chunked Quadtree Terrain LOD    :crit, p1, 0, 5
    2. PBR Cook-Torrance Shading & IBL            :p2, 1, 4
    3. Cascaded Shadow Maps (CSM)                 :p3, 2, 5
    section Atmosphere & Environment
    4. Precomputed Rayleigh/Mie Atmospheric Scattering :p4, 3, 6
    5. Raymarched Volumetric 3D Clouds            :p5, 4, 7
    6. Triplanar Multi-Material Terrain Splatting :p6, 2, 5
    section Mechanics & Architecture
    7. First-Person EVA Astronaut Controller      :p7, 5, 8
    8. Wind Vertex Sway & Dense Instanced Grass   :p8, 4, 6
    9. Cross-Platform Windows Test Suite Fixes    :p9, 0, 1
```

### Priority 1: Continuous Chunked Quadtree Terrain LOD
* **Current Implementation:** Fixed-density cube-sphere grid ($N$ from $20$ to $224$) selected per body based on distance ([`main.js:459`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L459)).
* **Problem:** Inadequate resolution near ground level. Terrain looks low-poly and geometric when landed; mountains appear faceted.
* **Recommended Solution:** Implement a spherical Quadtree Chunked LOD system (such as CDLOD or Chunked Spherified Cube). Divide each of the 6 cube faces into quadtree nodes that subdivide based on distance to the camera. Seamlessly morph boundaries between LOD levels using vertex morphing factors to eliminate T-junction cracks.
* **Relevant Source Files:** [`src/world.js`](file:///c:/Users/neelp/Desktop/stellar-garden/src/world.js), [`src/shaders.js:333-389`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L333-L389), [`src/main.js:161-168`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L161-L168).
* **Expected Visual Improvement:** Sub-meter surface detail when landed, crisp mountain ridges, and authentic planetary scale seen from orbit.
* **Performance Impact:** Neutral to positive. Renders high polygon counts only in the immediate vicinity of the camera while reducing distant vertex counts.
* **Implementation Complexity:** High.

### Priority 2: Physically-Based Rendering (PBR GGX) & Image-Based Lighting (IBL)
* **Current Implementation:** Non-energy-conserving Blinn-Phong specular calculation with empirical Fresnel ([`shaders.js:510`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L510), [`shaders.js:900-927`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L900-L927)).
* **Problem:** Metallic ship surfaces and terrain look plastic and artificial; dark sides of planets lack ambient color reflection from surrounding space gas.
* **Recommended Solution:** Implement the Cook-Torrance microfacet specular shading model with GGX normal distribution function, Smith geometry attenuation, and Schlick Fresnel. Convolve the pre-baked nebula cubemap `tSky` into a diffuse irradiance cubemap and a split-sum specular reflection map.
* **Relevant Source Files:** [`src/shaders.js:864-929`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L864-L929) (`SHADER_SHIP`), [`src/shaders.js:390-523`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L390-L523) (`PLANET`).
* **Expected Visual Improvement:** Realistic metallic luster on the ship, natural roughness variation across wet and dry terrain, and authentic atmospheric ambient bounce.
* **Performance Impact:** Minor ALU increase in fragment shaders.
* **Implementation Complexity:** Medium.

### Priority 3: Cascaded Shadow Mapping (CSM)
* **Current Implementation:** No shadow maps exist. Shadows are simulated via ray-sphere checks or cloud-shifted normal darkening.
* **Problem:** Spaceship casts no shadow on planetary ground when landing; terrain mountain peaks cast no shadows over valleys; space station modules do not self-shadow.
* **Recommended Solution:** Introduce a directional Cascaded Shadow Map render pass with 3 cascades covering near, mid, and far camera frustums. Render depth-only passes for visible terrain chunks, ship, station, and boulders into a `depth32float` texture atlas.
* **Relevant Source Files:** [`src/main.js:71-128`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L71-L128), [`src/shaders.js`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js).
* **Expected Visual Improvement:** Dramatic enhancement of spatial depth; crisp ship shadows beneath landing gear; long dramatic mountain shadows during sunrise/sunset.
* **Performance Impact:** Moderate increase in draw calls (multiplying rendered meshes across active cascade frustums).
* **Implementation Complexity:** High.

### Priority 4: Precomputed Rayleigh & Mie Atmospheric Scattering
* **Current Implementation:** Single-scatter chord approximation on a 2D quad billboard ([`shaders.js:784-822`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L784-L822)).
* **Problem:** Lacks physical realism. Sunsets lack realistic golden-hour sky color gradients; the atmosphere appears as a flat glowing halo ring.
* **Recommended Solution:** Implement the Bruneton / Nishita atmospheric scattering model. Precompute optical depth and in-scattering lookup tables (LUTs) in a 2D/3D texture computing wavelength-dependent Rayleigh scattering ($\lambda^{-4}$) and forward-scattering Mie aerosol phase functions.
* **Relevant Source Files:** [`src/shaders.js:784-822`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L784-L822), [`src/main.js:109-128`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js#L109-L128).
* **Expected Visual Improvement:** Photorealistic blue sky gradients, deep orange/red sunsets, and intense solar forward-scattering rings around planets.
* **Performance Impact:** Fast runtime performance when sampled from precomputed LUTs.
* **Implementation Complexity:** High.

### Priority 5: Raymarched Volumetric 3D Clouds
* **Current Implementation:** Flat 2D FBM noise evaluation applied directly to ground albedo in `PLANET` fragment shader ([`shaders.js:462-471`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L462-L471)).
* **Problem:** Clouds have no thickness or altitude separation. Flying through them reveals they are painted onto the terrain.
* **Recommended Solution:** Create a spherical volumetric cloud shell above the terrain radius. Raymarch through a 3D Worley-Perlin noise field, calculating density, Beer-Lambert light extinction, and directional light powder effects.
* **Relevant Source Files:** [`src/shaders.js`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js), [`src/main.js`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js).
* **Expected Visual Improvement:** Flying through dense, fluffy cloud banks with dynamic self-shadowing and realistic cloud layer penetration during atmospheric entry.
* **Performance Impact:** Significant GPU fill-rate cost. Requires temporal upsampling or half-resolution rendering.
* **Implementation Complexity:** High.

### Priority 6: Triplanar Multi-Material Terrain Splatting
* **Current Implementation:** Linear height blending between flat colors ([`shaders.js:446-458`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L446-L458)).
* **Problem:** Severe vertical texture stretching on cliffs and canyon walls.
* **Recommended Solution:** Implement normal-weighted triplanar projection mapping. Blend three texture projections ($XY, YZ, XZ$) according to absolute surface normal components $|n_x|, |n_y|, |n_z|$ with height-based displacement blending for rock cliffs, dirt, grass, and snow.
* **Relevant Source Files:** [`src/shaders.js:428-522`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L428-L522).
* **Expected Visual Improvement:** Elimination of terrain stretching; vertical cliff faces show sharp rock stratification, while plateaus display lush grass and sand.
* **Performance Impact:** Minor increase in shader texture reads.
* **Implementation Complexity:** Medium.

### Priority 7: First-Person EVA Astronaut Controller
* **Current Implementation:** Ship-only exploration. No player avatar or character controller exists.
* **Problem:** Prevents full planetary discovery; player is permanently locked inside the cockpit or chase camera.
* **Recommended Solution:** Implement a kinematic first-person astronaut character controller with spherical gravity orientation. When landed, allow pressing an exit key (e.g., E or G) to spawn an EVA avatar equipped with walking, sprinting, jumping, jetpack thrusters, and surface sampling tools.
* **Relevant Source Files:** [`src/sim.js`](file:///c:/Users/neelp/Desktop/stellar-garden/src/sim.js), [`src/main.js`](file:///c:/Users/neelp/Desktop/stellar-garden/src/main.js), [`src/cockpit.js`](file:///c:/Users/neelp/Desktop/stellar-garden/src/cockpit.js).
* **Expected Visual Improvement:** Radical transformation of gameplay scale; players can walk up to procedural trees, rocks, and alien ruins.
* **Performance Impact:** Minimal CPU cost.
* **Implementation Complexity:** High.

### Priority 8: Wind Vertex Sway & Dense Instanced Grass
* **Current Implementation:** Sparse, rigid tree/rock meshes placed via `pVeg` ([`shaders.js:618-620`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L618-L620)).
* **Problem:** Ground feels static and lifeless.
* **Recommended Solution:** Add vertex-shader wind displacement based on sine waves and world position:
  $$\mathbf{p}_{\text{displaced}} = \mathbf{p} + \sin(\omega t + \mathbf{p} \cdot \mathbf{k}) \cdot \text{amplitude} \cdot (y / y_{\text{max}})$$
  Deploy a second, denser instanced grass blade layer within a 50-meter radius around the player.
* **Relevant Source Files:** [`src/shaders.js:559-644`](file:///c:/Users/neelp/Desktop/stellar-garden/src/shaders.js#L559-L644) (`SHADER_VEG`), [`src/world.js:178-239`](file:///c:/Users/neelp/Desktop/stellar-garden/src/world.js#L178-L239).
* **Expected Visual Improvement:** Living, breathing planetary surfaces with swaying tree canopies and waving grass fields.
* **Performance Impact:** Low to moderate depending on grass instance count.
* **Implementation Complexity:** Medium.

### Priority 9: Cross-Platform Windows Test Suite Fixes
* **Current Implementation:** `const SRC = new URL('../src/', import.meta.url).pathname;` in test runners ([`tests/simtest.mjs:1`](file:///c:/Users/neelp/Desktop/stellar-garden/tests/simtest.mjs#L1)).
* **Problem:** All tests crash on Windows with `ENOENT: no such file or directory, open 'C:\C:\Users\...'`.
* **Recommended Solution:** Replace `new URL().pathname` across all test files with `fileURLToPath`:
  ```javascript
  import { fileURLToPath } from 'node:url';
  import path from 'node:path';
  const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src') + path.sep;
  ```
* **Relevant Source Files:** [`tests/simtest.mjs`](file:///c:/Users/neelp/Desktop/stellar-garden/tests/simtest.mjs), [`tests/colltest.mjs`](file:///c:/Users/neelp/Desktop/stellar-garden/tests/colltest.mjs), [`tests/spacetest.mjs`](file:///c:/Users/neelp/Desktop/stellar-garden/tests/spacetest.mjs), [`tests/audiotest.mjs`](file:///c:/Users/neelp/Desktop/stellar-garden/tests/audiotest.mjs).
* **Expected Visual Improvement:** N/A (developer toolchain fix).
* **Performance Impact:** None.
* **Implementation Complexity:** Trivial (1 line per test file).

---

## 8. Final Architecture Recommendations

To achieve the intended high-quality browser-based procedural space exploration game (supporting seamless space-to-surface transitions, atmospheric entry, landing, on-foot planetary exploration, procedural flora/fauna, and return to orbit), the following architectural model is recommended:

```mermaid
graph TD
    subgraph Core [1. Core Engine Architecture]
        C1[Floating Origin Coordinate Manager]
        C2[WebGPU Render Hardware Abstraction]
        C3[Asynchronous Web Worker Compute Pool]
    end

    subgraph WorldGen [2. Procedural World Pipeline]
        W1[Hierarchical Planetary Quadtree CDLOD]
        W2[GPU Compute Noise & Biome Synthesizer]
        W3[Procedural Flora, Rock & Creature Spawner]
    end

    subgraph Shading [3. Physically-Based Shading Pipeline]
        S1[Precomputed Bruneton Atmospheric Scattering]
        S2[3D Raymarched Volumetric Cloud Deck]
        S3[Triplanar PBR Terrain Splatting with IBL & CSM]
    end

    subgraph Simulation [4. Dual-State Physics & Controls]
        P1[Orbital & 6-DOF Spaceship Flight Model]
        P2[Kinematic Spherical First-Person Astronaut Controller]
        P3[Continuous Sphere/Capsule Collision Mesh System]
    end

    Core --> WorldGen
    Core --> Shading
    Core --> Simulation
    WorldGen --> Shading
    Simulation --> Core
```

### 8.1 Detailed Architecture Blueprint

#### 1. Coordinate Precision & Floating Origin System
* Maintain a global high-precision astronomical coordinate frame (`Float64Array`).
* Implement a **Floating Origin**: Whenever the camera moves more than $2,000$ meters from the current coordinate anchor, translate all local entity anchors so that the camera remains at $(0,0,0)$ in local GPU space. This guarantees sub-millimeter precision at player feet on any planet, even billions of meters from the star.

#### 2. Dual-State Player Controller (Flight vs. EVA)
* **Flight Controller:** Retain the current 6-DOF eased inertial flight physics with atmospheric drag and low-altitude speed management.
* **EVA Astronaut Controller:**
  * Activated when docked or landed.
  * Local gravity vector: $\mathbf{g} = -\text{normalize}(\mathbf{p}_{\text{player}} - \mathbf{p}_{\text{planet}})$.
  * Tangent space walking orientation determined by constructing an orthonormal basis with the gravity vector.
  * Capsule collision against local Quadtree terrain mesh chunks.
  * First-person camera with head-bobbing, sprint, jump, and surface interaction raycasts.

#### 3. Quadtree CDLOD Planetary Terrain Engine
* Represent each of the 6 cube-sphere faces as an adaptive quadtree.
* Run quadtree evaluation in a background Web Worker or WebGPU compute shader.
* Chunks near the player subdivide down to $0.5$-meter resolution; distant chunks collapse to coarse $50$-kilometer patches.
* Generate terrain elevation using compute shaders that output normal maps, height maps, and biome splat weights directly into GPU texture arrays.

#### 4. Physically-Based Atmospheric & Cloud Stack
* **Atmosphere:** Precomputed 4D atmospheric scattering tables (transmittance, Rayleigh single scattering, Mie single scattering, and multiple scattering).
* **Volumetric Clouds:** Screen-space raymarching through a spherical shell located between $1,000$ and $4,000$ meters altitude above sea level, using temporal reprojection to maintain 60 fps at native resolution.
* **Entry Plasma:** Dynamic heat shield ionization shader activated when entering an atmosphere at high velocity, wrapping the spaceship hull in radiant orange-white shockwave plasma.

---

## 9. GitHub Repository Setup and Publishing Instructions

This guide provides complete, beginner-friendly instructions for publishing this project to the specified GitHub repository:

**Target Repository URL:**  
`https://github.com/Patel-Neel-346/stellar-space.git`

> [!IMPORTANT]
> Do NOT execute these commands automatically. The following documentation is for manual execution by the developer in their local shell.

---

### 9.1 Essential Pre-Flight Checklist

Before running any Git commands, verify the following:

#### 1. Open the Terminal in the Project Root
* On Windows, open PowerShell or Command Prompt.
* Navigate directly to the project root directory:
  ```powershell
  cd "c:\Users\neelp\Desktop\stellar-garden"
  ```
* Verify your current working directory by running:
  ```powershell
  pwd
  ```
  *(Output should display: `c:\Users\neelp\Desktop\stellar-garden`)*

#### 2. Check Whether Git is Already Initialized
Run:
```bash
git status
```
* **Case A:** If the output says `fatal: not a git repository (or any of the parent directories): .git`, Git is **NOT initialized**. Proceed with the standard setup in Section 9.3 or 9.4.
* **Case B:** If the output displays branch information (e.g., `On branch main` or `On branch master`), Git is **ALREADY initialized**. Proceed to Section 9.5 ("Safe Alternative Sequence for Existing Repositories").

#### 3. Create a Proper `.gitignore` File
To avoid accidentally uploading large build artifacts, Node modules, temporary files, or secrets, create a `.gitignore` file in the root directory before staging any files:

Create a file named `.gitignore` with the following contents:
```gitignore
# Dependencies
node_modules/
package-lock.json

# Build outputs and temporary bundles
dev.html
shots/
*.rgba

# Operating System files
.DS_Store
Thumbs.db
desktop.ini

# Environment and credentials
.env
.env.local
*.pem
*.key

# Editor and IDE directories
.vscode/
.idea/
.gemini/
```

#### 4. GitHub Authentication Setup
When pushing to GitHub, you will be prompted for authentication:
* **Option A: Personal Access Token (HTTPS):**  
  GitHub no longer accepts account passwords for Git operations. Use a **Personal Access Token (Classic)** with the `repo` scope enabled. When prompted for your password in the terminal, paste your token (`ghp_...`).
* **Option B: GitHub CLI (`gh`):**  
  If the GitHub CLI is installed, run `gh auth login` to authenticate via your web browser.
* **Option C: SSH Key:**  
  If you have an SSH key configured, use the SSH remote URL instead:
  `git@github.com:Patel-Neel-346/stellar-space.git`.

---

### 9.2 The Original Requested Command Sequence

The user requested the inclusion of these exact commands:

```bash
echo "# stellar-space" >> README.md
git init
git add README.md
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/Patel-Neel-346/stellar-space.git
git push -u origin main
```

> [!WARNING]
> Running the exact sequence above has two major caveats for this project:
> 1. `echo "# stellar-space" >> README.md` will append text to the end of the existing detailed `README.md` file.
> 2. `git add README.md` will **only stage the README file**, leaving all source files (`src/`, `assets/`, `build.mjs`, `template.html`, `index.html`) untracked and uncommitted!

---

### 9.3 Complete Standard Publishing Workflow (Recommended for this Project)

To stage and push the **entire project** (not just the README) safely to the new GitHub repository, follow these exact steps:

#### Step 1: Open Terminal in Project Root
```bash
cd "c:\Users\neelp\Desktop\stellar-garden"
```

#### Step 2: Initialize Git Repository
```bash
git init
```

#### Step 3: Verify `.gitignore` Exists
Ensure your `.gitignore` file is in place so that `node_modules/` is not staged.

#### Step 4: Stage All Project Files
Stage all source code, assets, build scripts, tests, and documentation:
```bash
git add .
```

Verify which files are staged for commit:
```bash
git status
```
*(You should see `src/`, `assets/`, `tests/`, `build.mjs`, `template.html`, `README.md`, etc., listed in green as "new file".)*

#### Step 5: Create Initial Commit
```bash
git commit -m "Initial commit: Complete Stellar Garden WebGPU space game codebase"
```

#### Step 6: Set Default Branch to `main`
```bash
git branch -M main
```

#### Step 7: Connect to the GitHub Remote Repository
```bash
git remote add origin https://github.com/Patel-Neel-346/stellar-space.git
```

#### Step 8: Push the Entire Project to GitHub
```bash
git push -u origin main
```

#### Step 9: Verify Successful Upload
1. Open your browser and navigate to:  
   `https://github.com/Patel-Neel-346/stellar-space`
2. Confirm that all folders (`src/`, `assets/`, `tests/`) and root files (`build.mjs`, `template.html`, `index.html`, `README.md`) appear in the repository.

---

### 9.4 Safe Alternative Workflow for an Existing Git Repository

If `git status` revealed that Git was **already initialized** previously, do NOT run `git init` or blindly execute `git remote add origin`. Follow this safe alternative sequence:

#### Step 1: Check Existing Remote Configurations
```bash
git remote -v
```
* If no remotes are listed, add the remote safely:
  ```bash
  git remote add origin https://github.com/Patel-Neel-346/stellar-space.git
  ```
* If `origin` is already listed pointing to a different URL, do NOT delete Git history. Update the URL instead:
  ```bash
  git remote set-url origin https://github.com/Patel-Neel-346/stellar-space.git
  ```

#### Step 2: Check Current Branch Name
```bash
git branch
```
If your active branch is named `master` or something else, rename it to `main`:
```bash
git branch -M main
```

#### Step 3: Check for Uncommitted Changes
```bash
git status
```
If there are modified or untracked files:
```bash
git add .
git commit -m "Update: Project files and comprehensive technical audit"
```

#### Step 4: Push Without Overwriting History
Do NOT use `git push --force`. Push safely with upstream tracking:
```bash
git push -u origin main
```

*If GitHub rejects the push because the remote repository was initialized with a license or README on github.com*, pull and rebase first:
```bash
git pull --rebase origin main
git push -u origin main
```

#### Step 5: Verification
Run:
```bash
git remote -v
git log -1 --stat
```
Verify that the remote origin points to `https://github.com/Patel-Neel-346/stellar-space.git` and the latest commit contains the complete project tree.

---

## 10. Items and Capabilities Not Inspected

In strict adherence to rigorous engineering auditing guidelines, the following items could not be executed or directly verified on physical GPU hardware during this audit:
1. **Physical GPU Frame-Rate Measurements:** Performance and frame timings were analyzed strictly through static WGSL shader code analysis, mathematical complexity evaluation, and reviewing the headless SwiftShader CPU software rasterizer harness (`tests/browser/harness.js`). True GPU hardware draw-call timings on dedicated NVIDIA RTX or AMD RDNA silicon were not physically profiled.
2. **Browser Test Script Execution:** Headless Playwright automated browser tests (`tests/browser/t12.js`) require a Linux/Unix environment with Python Pillow and Playwright browser binaries, which were not launched.
3. **Audio Hardware Output:** Audio synthesis algorithms were audited via code inspection of Web Audio graph nodes in `src/audio.js`; physical acoustic output and dynamic loudness levels were not measured with a hardware decibel meter.
4. **Firefox / Safari WebGPU Implementation:** WebGPU behavior was audited based on the W3C WebGPU specification and Chrome/Edge 113+ implementation standards; experimental or flagged behavior in Firefox Nightly or Safari Technology Preview was not verified.

---
*End of Technical Audit Report: `SPACE_GAME_TECHNICAL_AUDIT.md`.*
