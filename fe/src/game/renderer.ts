// Three.js view of the match (PRD 9.2): orthographic isometric camera, instanced voxel
// terrain textured with assetv2 tiles, 2D billboard sprites for raiders, enemies and props,
// flat decals for traps, sprite VFX, tilt-shift + bloom post-processing.
// The renderer only reads snapshots; it never decides game outcomes.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { HorizontalTiltShiftShader } from "three/addons/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "three/addons/shaders/VerticalTiltShiftShader.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";
import { GAME } from "../shared/config";
import { TILE, tileHeight } from "../shared/generateMap";
import type {
  ChestState,
  EnemyState,
  GameEvent,
  LootPile,
  MapData,
  PlayerState,
  Snapshot,
} from "../shared/types";
import type { GameAssets, Img, SpriteSheet, VfxName, WeaponArt } from "./assets";

const ISO = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(40);
const VIEW_HALF_HEIGHT = 8.5;
const SCREEN_RIGHT = new THREE.Vector2(1, -1).normalize();
const WATER_Y = 0.35;
const RARITY_HEX = GAME.rarity.map((r) => new THREE.Color(r.color));
/** World units per sprite pixel: a 64 px raider frame is 2.4 tiles, so the raider stands ~1.8 tiles. */
const PX = 2.4 / 64;
/** The iso camera shortens ground depth by sin(35.26°); decals undo it so they match the art. */
const FORESHORTEN = 1 / Math.sqrt(3);
/** Fixed camera orientation, so static billboards can face it without per-frame work. */
const BILLBOARD_Q = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().lookAt(ISO, new THREE.Vector3(), new THREE.Vector3(0, 1, 0)),
);
/** Hue tints so minion camps read apart (README: tint crawler per camp). */
const CAMP_TINTS = ["#ffffff", "#b9ffc8", "#a8f0ff", "#e2c4ff", "#ffd2a6"].map((c) => new THREE.Color(c));

const TILE_TOP: Record<number, "grass" | "dirt" | "stone" | "sand"> = {
  [TILE.GRASS]: "grass",
  [TILE.DIRT]: "dirt",
  [TILE.STONE]: "stone",
  [TILE.SAND]: "sand",
};
const TILE_SIDE = { grass: "side_soil", dirt: "side_soil", stone: "side_metal", sand: "side_concrete" } as const;
/** Visible sides are always in shade; lift each texture so it reads without blowing out. */
const SIDE_LIFT = { side_soil: 2.1, side_metal: 1.8, side_concrete: 1.2 } as const;

/** Plane whose origin sits on the image pivot (feet / base), for upright billboards. */
function billboardGeo(w: number, h: number, pivot: [number, number]) {
  return new THREE.PlaneGeometry(w * PX, h * PX).translate((w / 2 - pivot[0]) * PX, (pivot[1] - h / 2) * PX, 0);
}

/** Flat ground plane, rotated so the image's up points screen-up, with depth un-foreshortened. */
function decalGeo(img: Img, width: number) {
  return new THREE.PlaneGeometry(width, (width * img.h) / img.w / FORESHORTEN)
    .rotateX(-Math.PI / 2)
    .rotateY(Math.PI / 4);
}

/** Screen-space angle of a ground direction, for rotating sprite VFX toward it. */
function screenAngle(face: number) {
  const right = Math.cos(face) * SCREEN_RIGHT.x + Math.sin(face) * SCREEN_RIGHT.y;
  const up = -(Math.cos(face) + Math.sin(face)) * Math.SQRT1_2 * FORESHORTEN;
  return Math.atan2(up, right);
}

/** Frame index for an animation from the manifest, looping or clamped to its last frame. */
function frameOf(sheet: SpriteSheet, name: string, elapsed: number) {
  const a = sheet.anims[name] ?? sheet.anims.idle;
  const i = Math.floor(elapsed * a.fps);
  return a.frames[a.loop ? i % a.frames.length : Math.min(a.frames.length - 1, i)];
}

function showFrame(tex: THREE.Texture, sheet: SpriteSheet, frame: number, flip: boolean) {
  tex.repeat.set((flip ? -1 : 1) / sheet.count, 1);
  tex.offset.set((frame + (flip ? 1 : 0)) / sheet.count, 0);
}

interface PlayerView {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  tex: THREE.Texture;
  sheet: SpriteSheet;
  sheetKey: string;
  shadow: THREE.Mesh;
  label: HTMLDivElement;
  hpFill: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  action: string;
  actionStart: number;
  flash: number;
  bubble?: THREE.Sprite;
  stunFx?: THREE.Sprite;
}

interface EnemyView {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  tex: THREE.Texture;
  sheet: SpriteSheet;
  tint: THREE.Color;
  shadow: THREE.Mesh;
  bar: HTMLDivElement;
  fill: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  flash: number;
  ai: string;
  aiStart: number;
  ring?: THREE.Mesh;
  stunFx?: THREE.Sprite;
}

interface FloatText {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  life: number;
}
interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  color: THREE.Color;
}
/** Short-lived effect: fades out over its life, sprites can also grow. */
interface Flash {
  obj: THREE.Object3D;
  mat: THREE.Material & { opacity: number };
  life: number;
  max: number;
  opacity: number;
  /** owned geometry / texture clone to dispose when done (shared ones are not listed) */
  geo?: THREE.BufferGeometry;
  tex?: THREE.Texture;
  size?: number;
  grow?: number;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private tiltH: ShaderPass;
  private tiltV: ShaderPass;
  private sun: THREE.DirectionalLight;
  private overlay: HTMLElement;
  private container: HTMLElement;
  private map: MapData;
  private selfId: string;
  private ro: ResizeObserver;
  private terrainMat: THREE.MeshLambertMaterial;
  private zoneUniforms = {
    uZone: { value: new THREE.Vector3(32, 32, 32) },
    uNext: { value: new THREE.Vector3(32, 32, 22) },
    uTime: { value: 0 },
  };
  private zoneWall: THREE.Mesh;
  private camTarget = new THREE.Vector3();
  private shake = 0;
  private players = new Map<string, PlayerView>();
  private enemies = new Map<string, EnemyView>();
  private chests = new Map<
    number,
    {
      group: THREE.Group;
      mat: THREE.MeshBasicMaterial;
      closed: THREE.Texture;
      open: THREE.Texture;
      glow: THREE.Mesh;
      label: HTMLDivElement;
    }
  >();
  private loot = new Map<string, THREE.Group>();
  private projectiles = new Map<string, THREE.Mesh>();
  private barrels = new Map<number, THREE.Object3D>();
  private spikes: { mat: THREE.MeshBasicMaterial; on: boolean } | null = null;
  private lavaMat: THREE.MeshBasicMaterial | null = null;
  private waterTex: THREE.Texture | null = null;
  private floats: FloatText[] = [];
  private flashes: Flash[] = [];
  private particles: Particle[] = [];
  private particleMesh: THREE.InstancedMesh;
  private assets: GameAssets;
  private baseTextures = new Map<string, THREE.CanvasTexture>();
  /** Billboard plane per sprite sheet (pivot differs per character). */
  private sheetGeos = new Map<SpriteSheet, THREE.PlaneGeometry>();
  /** Decal plane per image at width 1, scaled per use. */
  private decalGeos = new Map<Img, THREE.BufferGeometry>();
  private shadowGeo = new THREE.CircleGeometry(0.38, 20).rotateX(-Math.PI / 2);
  private shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  private disposables: { dispose(): void }[] = [];
  private tmp = new THREE.Vector3();
  private dummy = new THREE.Object3D();
  private raycaster = new THREE.Raycaster();
  private time = 0;
  private lastSnapT = 0;

  constructor(
    container: HTMLElement,
    overlay: HTMLElement,
    map: MapData,
    selfId: string,
    assets: GameAssets,
  ) {
    this.container = container;
    this.overlay = overlay;
    this.map = map;
    this.selfId = selfId;
    this.assets = assets;

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    const bg = new THREE.Color("#17304a");
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(bg, 70, 130);

    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 300);

    // Light from the top-left of the screen, matching the sprites' shading.
    this.scene.add(new THREE.HemisphereLight("#cfe3ff", "#5a4630", 1.4));
    this.sun = new THREE.DirectionalLight("#fff0d4", 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 24;
    sc.bottom = -24;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.terrainMat = this.buildTerrain();
    this.buildWater();
    this.buildObstacles();
    this.buildChests();
    this.zoneWall = this.buildZoneWall();

    this.particleMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      600,
    );
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.count = 0;
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);
    this.disposables.push(
      this.particleMesh.geometry,
      this.particleMesh.material as THREE.Material,
    );

    // Post-processing: bloom, tilt-shift (the "HD-2D" diorama look), vignette.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(512, 512),
      0.45,
      0.55,
      0.82,
    );
    this.composer.addPass(this.bloom);
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    this.tiltH.uniforms.r.value = 0.5;
    this.tiltV.uniforms.r.value = 0.5;
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms.offset.value = 0.95;
    vignette.uniforms.darkness.value = 1.15;
    this.composer.addPass(vignette);
    this.composer.addPass(new OutputPass());

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();

    const s = map.spawns[0];
    this.camTarget.set(s.x, 1, s.z);
  }

  // ---------------------------------------------------------------- world build

  private groundY(x: number, z: number) {
    const h = tileHeight(this.map, x, z);
    return h < 0 ? WATER_Y : h + 1;
  }

  private buildTerrain() {
    const { size, height, type } = this.map;
    const byTop = new Map<keyof typeof TILE_SIDE, number[]>();
    for (let i = 0; i < size * size; i++) {
      if (type[i] === TILE.WATER) continue;
      const top = TILE_TOP[type[i]] ?? "grass";
      if (!byTop.has(top)) byTop.set(top, []);
      byTop.get(top)!.push(i);
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const sideMats = new Map<string, THREE.MeshLambertMaterial>();
    const color = new THREE.Color();
    let topMat: THREE.MeshLambertMaterial | null = null;
    for (const [top, tiles] of byTop) {
      const sideName = TILE_SIDE[top];
      let side = sideMats.get(sideName);
      if (!side) {
        side = this.terrainMaterial(this.assets.tiles[sideName], SIDE_LIFT[sideName]);
        sideMats.set(sideName, side);
      }
      const topM = this.terrainMaterial(this.assets.tiles[top]);
      topMat ??= topM;
      // BoxGeometry groups: +x, -x, +y (top), -y, +z, -z
      const mesh = new THREE.InstancedMesh(geo, [side, side, topM, side, side, side], tiles.length);
      tiles.forEach((i, n) => {
        const x = i % size,
          z = Math.floor(i / size);
        const h = height[i] + 1;
        this.dummy.position.set(x + 0.5, h / 2, z + 0.5);
        this.dummy.scale.set(1, h, 1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(n, this.dummy.matrix);
        // Slight per-tile brightness jitter so large fields of one tile don't look stamped.
        color.setScalar(0.9 + (((x * 7 + z * 13 + height[i]) % 5) / 5) * 0.1);
        mesh.setColorAt(n, color);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.disposables.push(topM);
    }
    this.disposables.push(geo, ...sideMats.values());
    return topMat ?? new THREE.MeshLambertMaterial();
  }

  /** Lambert + the bluezone shader tweak: tint outside the circle, next zone as a white line. */
  /** `sideLift` set = side faces: the iso camera only ever sees the shaded +x/+z sides. */
  private terrainMaterial(tex: THREE.Texture, sideLift?: number) {
    const side = sideLift !== undefined;
    const mat = new THREE.MeshLambertMaterial({ map: tex, color: new THREE.Color().setScalar(sideLift ?? 1) });
    mat.customProgramCacheKey = () => (side ? "terrain-side" : "terrain-top");
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.zoneUniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vObjN;\nvarying vec2 vW;")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvObjN = normal;\nvW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;",
        );
      // Side faces repeat the texture once per block of height instead of stretching it.
      if (side)
        shader.vertexShader = shader.vertexShader.replace(
          "#include <uv_vertex>",
          "#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.y *= length(instanceMatrix[1].xyz);\n#endif",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vObjN;\nvarying vec2 vW;\nuniform vec3 uZone;\nuniform vec3 uNext;\nuniform float uTime;",
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          float dOut = length(vW - uZone.xy) - uZone.z;
          if (dOut > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.32, 0.75), 0.5);
          diffuseColor.rgb += vec3(0.25, 0.55, 1.0) * (1.0 - smoothstep(0.0, 0.35, abs(dOut))) * 0.9;
          float dNext = abs(length(vW - uNext.xy) - uNext.z);
          if (vObjN.y > 0.5 && uNext.z > 0.1) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), (1.0 - smoothstep(0.04, 0.12, dNext)) * 0.85);`,
        );
    };
    return mat;
  }

  private buildWater() {
    const span = this.map.size * 4;
    const floorGeo = new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2);
    // Clones share the GPU image but get their own repeat/offset.
    const sand = this.assets.tiles.sand.clone();
    sand.repeat.set(span, span);
    const water = this.assets.tiles.water.clone();
    water.repeat.set(span, span);
    this.waterTex = water;
    const floor = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ map: sand, color: "#8a8270" }));
    floor.position.set(this.map.size / 2, 0, this.map.size / 2);
    floor.receiveShadow = true;
    const sea = new THREE.Mesh(
      floorGeo,
      new THREE.MeshLambertMaterial({ map: water, transparent: true, opacity: 0.88 }),
    );
    sea.position.set(this.map.size / 2, WATER_Y, this.map.size / 2);
    sea.receiveShadow = true;
    this.scene.add(floor, sea);
    this.disposables.push(floorGeo, floor.material, sea.material, sand, water);
  }

  private spriteMaterial(img: Img | THREE.Texture) {
    return new THREE.MeshBasicMaterial({ map: img instanceof THREE.Texture ? img : img.tex, alphaTest: 0.5 });
  }

  private decal(img: Img) {
    let g = this.decalGeos.get(img);
    if (!g) {
      g = decalGeo(img, 1);
      this.decalGeos.set(img, g);
    }
    return g;
  }

  private buildObstacles() {
    const obs = this.map.obstacles;
    const { props, traps } = this.assets;

    // Trees: two instanced billboards (tree_a / tree_b), all facing the fixed camera.
    const trees = obs.filter((o) => o.kind === "tree");
    const shadows = new THREE.InstancedMesh(this.shadowGeo, this.shadowMat, trees.length);
    (["tree_a", "tree_b"] as const).forEach((name, variant) => {
      const list = trees.filter((t) => t.id % 2 === variant);
      const img = props[name];
      const geo = billboardGeo(img.w, img.h, img.pivot);
      const mat = this.spriteMaterial(img);
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, i) => {
        const s = 0.9 + ((t.id * 37) % 10) / 40;
        this.dummy.position.set(t.x, this.groundY(t.x, t.z), t.z);
        this.dummy.quaternion.copy(BILLBOARD_Q);
        this.dummy.scale.setScalar(s);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      });
      this.scene.add(mesh);
      this.disposables.push(geo, mat);
    });
    trees.forEach((t, i) => {
      this.dummy.position.set(t.x, this.groundY(t.x, t.z) + 0.02, t.z);
      this.dummy.quaternion.identity();
      this.dummy.scale.setScalar(1.5);
      this.dummy.updateMatrix();
      shadows.setMatrixAt(i, this.dummy.matrix);
    });
    this.scene.add(shadows);
    this.dummy.scale.setScalar(1);

    // Spikes: one flat decal each; the shared material flips between spike_off / spike_on.
    const spikeMat = new THREE.MeshBasicMaterial({ map: traps.spike_off.tex, transparent: true, depthWrite: false });
    for (const s of obs.filter((o) => o.kind === "spike")) {
      const m = new THREE.Mesh(this.decal(traps.spike_off), spikeMat);
      m.scale.setScalar(1.05);
      m.position.set(s.x, this.groundY(s.x, s.z) + 0.02, s.z);
      m.renderOrder = 1;
      this.scene.add(m);
    }
    this.spikes = { mat: spikeMat, on: false };

    // Lava pools: flat decal, over-bright so bloom makes them glow.
    const lava = new THREE.MeshBasicMaterial({ map: traps.lava_pool.tex, transparent: true, depthWrite: false, toneMapped: false });
    for (const p of obs.filter((o) => o.kind === "pool")) {
      const m = new THREE.Mesh(this.decal(traps.lava_pool), lava);
      m.scale.setScalar(p.r * 2.3);
      m.position.set(p.x, this.groundY(p.x, p.z) + 0.02, p.z);
      m.renderOrder = 1;
      this.scene.add(m);
    }
    this.lavaMat = lava;

    // Explosive barrels: billboards, hidden once they blow.
    const barrelGeo = billboardGeo(props.barrel.w, props.barrel.h, props.barrel.pivot);
    const barrelMat = this.spriteMaterial(props.barrel);
    for (const b of obs.filter((o) => o.kind === "barrel")) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(barrelGeo, barrelMat);
      body.quaternion.copy(BILLBOARD_Q);
      body.scale.setScalar(0.8);
      const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
      shadow.position.y = 0.02;
      g.add(body, shadow);
      g.position.set(b.x, this.groundY(b.x, b.z), b.z);
      this.scene.add(g);
      this.barrels.set(b.id, g);
    }
    this.disposables.push(barrelGeo, barrelMat, spikeMat, lava, shadows);
  }

  private buildChests() {
    const glowGeo = new THREE.RingGeometry(0.9, 1.1, 32).rotateX(-Math.PI / 2);
    this.disposables.push(glowGeo);
    const geos = new Map<string, THREE.PlaneGeometry>();
    for (const camp of this.map.camps) {
      const closed = this.assets.chests[`chest_${camp.tier}`];
      const open = this.assets.chests[`chest_${camp.tier}_open`];
      let geo = geos.get(camp.tier);
      if (!geo) {
        geo = billboardGeo(closed.w, closed.h, closed.pivot);
        geos.set(camp.tier, geo);
        this.disposables.push(geo);
      }
      const g = new THREE.Group();
      const mat = this.spriteMaterial(closed);
      const sprite = new THREE.Mesh(geo, mat);
      sprite.quaternion.copy(BILLBOARD_Q);
      const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
      shadow.position.y = 0.02;
      shadow.scale.setScalar(camp.tier === "boss" ? 2 : 1.4);
      const glow = new THREE.Mesh(
        glowGeo,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(1.5, 1.2, 0.4),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      glow.position.y = 0.04;
      glow.scale.setScalar(camp.tier === "boss" ? 1.6 : 1);
      g.add(shadow, glow, sprite);
      g.position.set(camp.x, this.groundY(camp.x, camp.z), camp.z);
      this.scene.add(g);
      const label = document.createElement("div");
      label.className = "wlabel chest";
      this.overlay.appendChild(label);
      this.chests.set(camp.id, { group: g, mat, closed: closed.tex, open: open.tex, glow, label });
      this.disposables.push(mat, glow.material as THREE.Material);
    }
  }

  private buildZoneWall() {
    // Short energy wall that fades out upward, so its near side never hides the arena.
    // The zone_wall sprite (a hex-energy column) is tiled around the circle.
    const geo = new THREE.CylinderGeometry(1, 1, 3.2, 128, 1, true).translate(
      0,
      1.6,
      0,
    );
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.zoneUniforms, uTex: { value: this.assets.vfx.zone_wall.tex } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      vertexShader:
        "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform float uTime; uniform sampler2D uTex; varying vec2 vUv;
        void main() {
          float fade = pow(1.0 - vUv.y, 2.2);
          float bands = 0.6 + 0.4 * sin(vUv.y * 18.0 - uTime * 3.0);
          vec4 hex = texture2D(uTex, vec2(fract(vUv.x * 96.0 + uTime * 0.05), clamp(vUv.y * 1.6, 0.0, 1.0)));
          vec3 col = mix(vec3(0.35, 0.7, 1.6), hex.rgb * 2.0, hex.a);
          gl_FragColor = vec4(col, fade * bands * (0.35 + hex.a * 0.5));
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 10;
    this.scene.add(mesh);
    this.disposables.push(geo, mat);
    return mesh;
  }

  // ---------------------------------------------------------------- per frame

  resize() {
    const w = this.container.clientWidth || 1,
      h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    const aspect = w / h;
    this.camera.left = -VIEW_HALF_HEIGHT * aspect;
    this.camera.right = VIEW_HALF_HEIGHT * aspect;
    this.camera.top = VIEW_HALF_HEIGHT;
    this.camera.bottom = -VIEW_HALF_HEIGHT;
    this.camera.updateProjectionMatrix();
    this.tiltH.uniforms.h.value = 2.2 / w;
    this.tiltV.uniforms.v.value = 2.2 / h;
  }

  /** World X/Z under a screen point (for aiming). */
  groundPoint(clientX: number, clientY: number, y: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -y),
      hit,
    );
    return { x: hit.x, z: hit.z };
  }

  selfGroundY() {
    return this.players.get(this.selfId)?.y ?? 1;
  }

  render(snap: Snapshot | null, events: GameEvent[], dt: number) {
    this.time += dt;
    if (snap) {
      if (snap.t !== this.lastSnapT) this.lastSnapT = snap.t;
      this.syncPlayers(snap.players, dt);
      this.syncEnemies(snap.enemies, dt);
      this.syncChests(snap.chests, snap.players);
      this.syncLoot(snap.loot);
      this.syncProjectiles(snap);
      this.syncHazards(snap);
      const z = snap.zone;
      this.zoneUniforms.uZone.value.set(z.cx, z.cz, z.r);
      this.zoneUniforms.uNext.value.set(
        z.next.cx,
        z.next.cz,
        z.phase >= GAME.zone.length - 1 ? 0 : z.next.r,
      );
      this.zoneWall.visible = z.r > 0.2;
      this.zoneWall.position.set(z.cx, 0, z.cz);
      this.zoneWall.scale.set(Math.max(0.01, z.r), 1, Math.max(0.01, z.r));
      for (const e of events) this.onEvent(e, snap);
    }
    this.zoneUniforms.uTime.value = this.time;
    if (this.lavaMat) this.lavaMat.color.setScalar(1.25 + Math.sin(this.time * 3) * 0.2);
    if (this.waterTex) this.waterTex.offset.set(this.time * 0.04, this.time * 0.025);
    this.updateCamera(snap, dt);
    this.updateFx(dt);
    this.updateLabels();
    this.composer.render(dt);
  }

  private updateCamera(snap: Snapshot | null, dt: number) {
    let focus = this.players.get(this.selfId);
    const me = snap?.players.find((p) => p.id === this.selfId);
    if (me && !me.alive && snap) {
      // Spectate the richest survivor.
      const lead = snap.players
        .filter((p) => p.alive)
        .sort((a, b) => b.coins - a.coins)[0];
      if (lead) focus = this.players.get(lead.id);
    }
    if (focus) this.tmp.set(focus.x, focus.y, focus.z);
    else this.tmp.copy(this.camTarget);
    this.camTarget.lerp(this.tmp, 1 - Math.exp(-dt * 8));
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sx = (Math.random() - 0.5) * this.shake,
      sy = (Math.random() - 0.5) * this.shake;
    this.camera.position.copy(this.camTarget).add(ISO);
    this.camera.position.x += sx;
    this.camera.position.y += sy;
    this.camera.lookAt(
      this.camTarget.x + sx,
      this.camTarget.y + sy,
      this.camTarget.z,
    );
    this.sun.position.set(
      this.camTarget.x - 22,
      this.camTarget.y + 34,
      this.camTarget.z - 6,
    );
    this.sun.target.position.copy(this.camTarget);
  }

  private sheetGeo(sheet: SpriteSheet) {
    let g = this.sheetGeos.get(sheet);
    if (!g) {
      g = billboardGeo(sheet.frameW, sheet.frameH, sheet.pivot);
      this.sheetGeos.set(sheet, g);
    }
    return g;
  }

  /** Sprite VFX that stays attached to an actor (stun stars, immune bubble). */
  private attachFx(name: VfxName, size: number, opacity: number) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.assets.vfx[name].tex,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    s.scale.setScalar(size);
    s.visible = false;
    this.scene.add(s);
    return s;
  }

  private dropFx(s?: THREE.Sprite) {
    if (!s) return;
    this.scene.remove(s);
    s.material.dispose();
  }

  private syncPlayers(list: PlayerState[], dt: number) {
    const seen = new Set<string>();
    const k = 1 - Math.exp(-dt * 18);
    for (const p of list) {
      seen.add(p.id);
      let v = this.players.get(p.id);
      const weaponArt: WeaponArt =
        p.weapon &&
        (p.weapon.kind === "sword" ||
          p.weapon.kind === "staff" ||
          p.weapon.kind === "bow")
          ? p.weapon.kind
          : "unarmed";
      const key = `${p.skin}:${weaponArt}`;
      const sheet = this.assets.raider[weaponArt];
      if (!v) {
        const tex = this.sheetTexture(key, p.skin, weaponArt);
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          alphaTest: 0.5,
          color: 0xffffff,
        });
        const mesh = new THREE.Mesh(this.sheetGeo(sheet), mat);
        const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
        this.scene.add(mesh, shadow);
        const label = document.createElement("div");
        label.className =
          "wlabel player" + (p.id === this.selfId ? " self" : "");
        label.innerHTML = `<span class="nm"></span><div class="hp"><div></div></div>`;
        (label.querySelector(".nm") as HTMLElement).textContent = p.name;
        this.overlay.appendChild(label);
        v = {
          mesh,
          mat,
          tex,
          sheet,
          sheetKey: key,
          shadow,
          label,
          hpFill: label.querySelector(".hp div") as HTMLDivElement,
          x: p.x,
          y: this.groundY(p.x, p.z),
          z: p.z,
          action: p.action,
          actionStart: this.time,
          flash: 0,
        };
        this.players.set(p.id, v);
      }
      if (v.sheetKey !== key) {
        v.tex.dispose();
        v.tex = this.sheetTexture(key, p.skin, weaponArt);
        v.mat.map = v.tex;
        v.sheet = sheet;
        v.sheetKey = key;
      }
      v.x += (p.x - v.x) * k;
      v.z += (p.z - v.z) * k;
      v.y += (this.groundY(v.x, v.z) - v.y) * (1 - Math.exp(-dt * 14));
      if (p.action !== v.action) {
        v.action = p.action;
        v.actionStart = this.time;
      }
      v.mesh.position.set(v.x, v.y, v.z);
      v.mesh.quaternion.copy(this.camera.quaternion);
      v.shadow.position.set(v.x, v.y + 0.02, v.z);
      v.shadow.visible = p.alive;

      // Animation frame: manifest anims, with "hit" while the damage flash is on.
      const el = this.time - v.actionStart;
      let anim: string;
      if (!p.alive || p.action === "dead") anim = "dead";
      else if (v.flash > 0 && p.action !== "defend" && p.action !== "parry") anim = "hit";
      else if (p.action === "parry") anim = "defend";
      else anim = p.action;
      const frame = frameOf(
        v.sheet,
        anim,
        anim === "attack" || anim === "cast" ? el : this.time,
      );
      const flip =
        Math.cos(p.face) * SCREEN_RIGHT.x + Math.sin(p.face) * SCREEN_RIGHT.y <
        0;
      showFrame(v.tex, v.sheet, frame, flip);

      v.flash = Math.max(0, v.flash - dt);
      const c = v.mat.color;
      if (v.flash > 0) c.setRGB(3, 3, 3);
      else if (p.action === "parry") c.setRGB(2.2, 2, 0.8);
      else if (p.action === "stun") c.setRGB(0.8, 0.8, 1.3);
      else if (p.speedBuff) c.setRGB(0.85, 1.15, 1.3);
      else if (!p.alive) c.setRGB(0.5, 0.5, 0.55);
      else c.setRGB(1, 1, 1);

      // Immune bubble and stun stars come from the vfx sheet instead of tinting.
      if (p.invuln && p.alive) {
        v.bubble ??= this.attachFx("immune_bubble", 2.3, 0.75);
        v.bubble.visible = true;
        v.bubble.position.set(v.x, v.y + 0.9, v.z);
        v.bubble.material.opacity = 0.55 + Math.sin(this.time * 10) * 0.2;
      } else if (v.bubble) v.bubble.visible = false;
      if (p.action === "stun" && p.alive) {
        v.stunFx ??= this.attachFx("stun", 0.9, 1);
        v.stunFx.visible = true;
        v.stunFx.position.set(v.x, v.y + 2.05, v.z);
        v.stunFx.material.rotation = this.time * 4;
      } else if (v.stunFx) v.stunFx.visible = false;

      v.label.style.display = p.alive ? "" : "none";
      v.hpFill.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    }
    for (const [id, v] of this.players)
      if (!seen.has(id)) {
        this.removePlayer(v);
        this.players.delete(id);
      }
  }

  private sheetTexture(key: string, skin: number, weapon: WeaponArt) {
    let base = this.baseTextures.get(key);
    if (!base) {
      base = new THREE.CanvasTexture(this.assets.playerSheet(skin, weapon));
      base.magFilter = THREE.NearestFilter;
      base.minFilter = THREE.NearestFilter;
      base.generateMipmaps = false;
      base.colorSpace = THREE.SRGBColorSpace;
      this.baseTextures.set(key, base);
    }
    const t = base.clone();
    t.needsUpdate = true;
    return t;
  }

  private removePlayer(v: PlayerView) {
    this.scene.remove(v.mesh, v.shadow);
    v.tex.dispose();
    v.mat.dispose();
    v.label.remove();
    this.dropFx(v.bubble);
    this.dropFx(v.stunFx);
  }

  private enemyTexture(sheet: SpriteSheet) {
    const key = `enemy:${sheet.frameW}:${sheet.count}`;
    let base = this.baseTextures.get(key);
    if (!base) {
      base = new THREE.CanvasTexture(sheet.canvas);
      base.magFilter = THREE.NearestFilter;
      base.minFilter = THREE.NearestFilter;
      base.generateMipmaps = false;
      base.colorSpace = THREE.SRGBColorSpace;
      this.baseTextures.set(key, base);
    }
    const t = base.clone();
    t.needsUpdate = true;
    return t;
  }

  private syncEnemies(list: EnemyState[], dt: number) {
    const seen = new Set<string>();
    const k = 1 - Math.exp(-dt * 16);
    for (const e of list) {
      seen.add(e.id);
      let v = this.enemies.get(e.id);
      if (!v) {
        const sheet = this.assets.enemies[e.kind];
        const tex = this.enemyTexture(sheet);
        const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5 });
        const mesh = new THREE.Mesh(this.sheetGeo(sheet), mat);
        const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
        const s = e.kind === "boss" ? 3 : e.kind === "elite" ? 1.6 : 1;
        shadow.scale.setScalar(s);
        this.scene.add(mesh, shadow);
        const bar = document.createElement("div");
        bar.className = `wlabel ebar ${e.kind}`;
        bar.innerHTML = "<div></div>";
        this.overlay.appendChild(bar);
        v = {
          mesh,
          mat,
          tex,
          sheet,
          tint: e.kind === "minion" ? CAMP_TINTS[e.campId % CAMP_TINTS.length] : CAMP_TINTS[0],
          shadow,
          bar,
          fill: bar.firstChild as HTMLDivElement,
          x: e.x,
          y: this.groundY(e.x, e.z),
          z: e.z,
          flash: 0,
          ai: e.ai,
          aiStart: this.time,
        };
        this.enemies.set(e.id, v);
      }
      if (e.ai !== v.ai) {
        v.ai = e.ai;
        v.aiStart = this.time;
      }
      v.x += (e.x - v.x) * k;
      v.z += (e.z - v.z) * k;
      v.y += (this.groundY(v.x, v.z) - v.y) * (1 - Math.exp(-dt * 14));
      v.mesh.position.set(v.x, v.y, v.z);
      v.mesh.quaternion.copy(this.camera.quaternion);
      // Squash during windup.
      const def = GAME.enemies[e.kind];
      const w = e.ai === "windup" ? 1 - e.windup / def.windup : 0;
      v.mesh.scale.set(1 + w * 0.1, 1 - w * 0.08, 1);
      v.shadow.position.set(v.x, v.y + 0.02, v.z);

      // Animation: the strike frame (attack / slam) plays briefly when windup turns into recover.
      const sheet = v.sheet;
      const el = this.time - v.aiStart;
      let anim: string;
      if (v.flash > 0 && sheet.anims.hit) anim = "hit";
      else if (e.ai === "chase" || e.ai === "return") anim = sheet.anims.move ? "move" : "walk";
      else if (e.ai === "recover") anim = el < 0.2 ? (sheet.anims.attack ? "attack" : "slam") : "recover";
      else anim = e.ai;
      const flip =
        Math.cos(e.face) * SCREEN_RIGHT.x + Math.sin(e.face) * SCREEN_RIGHT.y < 0;
      showFrame(v.tex, sheet, frameOf(sheet, anim, anim === "move" || anim === "walk" || anim === "idle" ? this.time + v.x : el), flip);

      v.flash = Math.max(0, v.flash - dt);
      const c = v.mat.color.copy(v.tint);
      if (v.flash > 0) c.setRGB(3, 3, 3);
      else if (e.ai === "windup") c.lerp(new THREE.Color(2.2, 0.5, 0.4), w * 0.7);
      else if (e.ai === "stun") c.multiply(new THREE.Color(0.8, 0.85, 1.4));

      if (e.ai === "stun") {
        v.stunFx ??= this.attachFx("stun", e.kind === "boss" ? 1.8 : 0.9, 1);
        v.stunFx.visible = true;
        v.stunFx.position.set(v.x, v.y + sheet.pivot[1] * PX * 0.95, v.z);
        v.stunFx.material.rotation = this.time * 4;
      } else if (v.stunFx) v.stunFx.visible = false;

      // Boss slam telegraph: red circle that fills up.
      if (e.kind === "boss") {
        if (!v.ring) {
          const g = new THREE.CircleGeometry(
            GAME.enemies.boss.slamRadius,
            40,
          ).rotateX(-Math.PI / 2);
          v.ring = new THREE.Mesh(
            g,
            new THREE.MeshBasicMaterial({
              color: new THREE.Color(1.6, 0.1, 0.1),
              transparent: true,
              opacity: 0,
              depthWrite: false,
              toneMapped: false,
            }),
          );
          this.scene.add(v.ring);
        }
        v.ring.position.set(v.x, v.y + 0.05, v.z);
        (v.ring.material as THREE.MeshBasicMaterial).opacity =
          e.ai === "windup" ? 0.15 + w * 0.4 : 0;
        v.ring.scale.setScalar(e.ai === "windup" ? 0.3 + w * 0.7 : 1);
      }
      v.bar.style.display = e.hp < e.maxHp ? "" : "none";
      v.fill.style.width = `${(e.hp / e.maxHp) * 100}%`;
    }
    for (const [id, v] of this.enemies) {
      if (seen.has(id)) continue;
      this.corpse(v);
      this.removeEnemy(v);
      this.enemies.delete(id);
    }
  }

  private removeEnemy(v: EnemyView) {
    this.scene.remove(v.mesh, v.shadow);
    if (v.ring) {
      this.scene.remove(v.ring);
      v.ring.geometry.dispose();
      (v.ring.material as THREE.Material).dispose();
    }
    this.dropFx(v.stunFx);
    v.tex.dispose();
    v.mat.dispose();
    v.bar.remove();
  }

  /** The "dead" frame lingers and fades where an enemy fell. */
  private corpse(v: EnemyView) {
    const tex = v.tex.clone();
    showFrame(tex, v.sheet, frameOf(v.sheet, "dead", 0), tex.repeat.x < 0);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: v.tint });
    const mesh = new THREE.Mesh(v.mesh.geometry, mat);
    mesh.position.copy(v.mesh.position);
    mesh.quaternion.copy(v.mesh.quaternion);
    this.scene.add(mesh);
    this.flashes.push({ obj: mesh, mat, life: 0.9, max: 0.9, opacity: 1, tex });
  }

  private syncChests(list: ChestState[], players: PlayerState[]) {
    const me = players.find((p) => p.id === this.selfId);
    for (const c of list) {
      const v = this.chests.get(c.id);
      if (!v) continue;
      const art = c.opened ? v.open : v.closed;
      if (v.mat.map !== art) v.mat.map = art;
      const gm = v.glow.material as THREE.MeshBasicMaterial;
      gm.opacity =
        !c.opened && !c.locked ? 0.55 + Math.sin(this.time * 4) * 0.25 : 0;
      const near = me && Math.hypot(me.x - c.x, me.z - c.z) < 9;
      const show = !c.opened && near;
      v.label.style.display = show ? "" : "none";
      if (show) {
        const txt = c.locked
          ? `${c.tier.toUpperCase()} · ${c.guardsLeft} guard${c.guardsLeft === 1 ? "" : "s"}`
          : `${c.tier.toUpperCase()} · unlocked`;
        if (v.label.textContent !== txt) v.label.textContent = txt;
        v.label.classList.toggle("open", !c.locked);
      }
    }
  }

  private syncLoot(list: LootPile[]) {
    const seen = new Set<string>();
    for (const l of list) {
      seen.add(l.id);
      let g = this.loot.get(l.id);
      const best = l.items.reduce((a, i) => (i.rarity > a.rarity ? i : a), l.items[0]);
      const rarity = best?.rarity ?? 0;
      if (!g) {
        g = new THREE.Group();
        const col = RARITY_HEX[rarity];
        // Dropped bags have no art of their own yet, so they show a big coin.
        const icon = l.bag || !best ? this.assets.items.coin : this.assets.items[best.kind];
        const item = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: icon.tex, alphaTest: 0.5 }),
        );
        item.center.set(0.5, 0);
        item.scale.setScalar(l.bag ? 0.95 : 0.75);
        item.position.y = 0.35;
        item.name = "item";
        const beam = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.assets.vfx.loot_beam.tex,
            color: col.clone().multiplyScalar(1.6),
            transparent: true,
            opacity: rarity === 2 ? 0.95 : rarity === 1 ? 0.7 : 0.45,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
          }),
        );
        beam.center.set(0.5, 0);
        beam.scale.set(1.1, 3.2, 1);
        const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
        shadow.position.y = 0.02;
        shadow.scale.setScalar(0.8);
        g.add(shadow, beam, item);
        g.position.set(l.x, this.groundY(l.x, l.z), l.z);
        this.scene.add(g);
        this.loot.set(l.id, g);
      }
      const item = g.getObjectByName("item");
      if (item) item.position.y = 0.3 + Math.sin(this.time * 3 + l.x) * 0.08;
    }
    for (const [id, g] of this.loot) {
      if (seen.has(id)) continue;
      this.scene.remove(g);
      this.disposeLoot(g);
      this.loot.delete(id);
    }
  }

  /** Loot groups own their sprite materials; geometry (sprite quad, shadow disc) is shared. */
  private disposeLoot(g: THREE.Group) {
    g.traverse((o) => {
      if (o instanceof THREE.Sprite) o.material.dispose();
    });
  }

  private arrowGeo = new THREE.BoxGeometry(0.6, 0.05, 0.05);
  private arrowMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.4, 1.3, 1.0),
    toneMapped: false,
  });

  private syncProjectiles(snap: Snapshot) {
    const seen = new Set<string>();
    for (const p of snap.projectiles) {
      seen.add(p.id);
      let m = this.projectiles.get(p.id);
      if (!m) {
        m = new THREE.Mesh(this.arrowGeo, this.arrowMat);
        this.scene.add(m);
        this.projectiles.set(p.id, m);
        m.position.set(p.x, this.groundY(p.x, p.z) + 0.8, p.z);
      }
      m.position.x += (p.x - m.position.x) * 0.6;
      m.position.z += (p.z - m.position.z) * 0.6;
      m.position.y = Math.max(
        m.position.y - 0.01,
        this.groundY(p.x, p.z) + 0.6,
      );
      m.rotation.y = -Math.atan2(p.vz, p.vx);
    }
    for (const [id, m] of this.projectiles)
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.projectiles.delete(id);
      }
  }

  private syncHazards(snap: Snapshot) {
    for (const id of snap.brokenBarrels) {
      const b = this.barrels.get(id);
      if (b?.visible) b.visible = false;
    }
    if (this.spikes) {
      const sp = GAME.obstacles.spike;
      const phase = snap.t % sp.period;
      const on = phase < sp.activeFor;
      if (on !== this.spikes.on) {
        this.spikes.on = on;
        this.spikes.mat.map = on ? this.assets.traps.spike_on.tex : this.assets.traps.spike_off.tex;
      }
    }
  }

  // ---------------------------------------------------------------- events + fx

  private posOf(id: string | undefined, snap: Snapshot) {
    if (!id) return null;
    const p = this.players.get(id);
    if (p) return p;
    const e = this.enemies.get(id);
    if (e) return e;
    const sp = snap.players.find((x) => x.id === id);
    return sp ? { x: sp.x, y: this.groundY(sp.x, sp.z), z: sp.z } : null;
  }

  private onEvent(e: GameEvent, snap: Snapshot) {
    switch (e.type) {
      case "hit": {
        const y = this.groundY(e.x, e.z);
        const self = e.target === this.selfId;
        this.floatText(
          `${e.amount}`,
          e.x,
          y + 1.6,
          e.z,
          self ? "dmg self" : e.source === this.selfId ? "dmg mine" : "dmg",
        );
        const pv = this.players.get(e.target);
        if (pv) pv.flash = 0.1;
        const ev = this.enemies.get(e.target);
        if (ev) ev.flash = 0.1;
        this.spriteFx("hit", e.x, y + 0.8, e.z, 1, 0.22, { color: self ? "#ff6a6a" : undefined, grow: 0.4 });
        this.burst(e.x, y + 0.7, e.z, self ? "#ff4a4a" : "#ffffff", 4, 3);
        if (self) this.shake = Math.min(0.5, this.shake + 0.25);
        break;
      }
      case "blocked": {
        const y = this.groundY(e.x, e.z);
        this.floatText("BLOCK", e.x, y + 2, e.z, "tag block");
        this.spriteFx("hit", e.x, y + 0.8, e.z, 0.8, 0.2, { color: "#9ad0ff" });
        break;
      }
      case "immune": {
        const y = this.groundY(e.x, e.z);
        this.floatText("IMMUNE", e.x, y + 2, e.z, "tag immune");
        this.spriteFx("immune_bubble", e.x, y + 0.9, e.z, 2.3, 0.3, { grow: 0.15 });
        break;
      }
      case "parry": {
        const y = this.groundY(e.x, e.z);
        this.floatText("PARRY!", e.x, y + 2.1, e.z, "tag parry");
        this.spriteFx("parry", e.x, y + 0.9, e.z, 1.8, 0.35, { grow: 0.5 });
        this.burst(e.x, y + 0.9, e.z, "#ffe14a", 10, 5);
        if (e.target === this.selfId || e.attacker === this.selfId)
          this.shake = Math.min(0.6, this.shake + 0.3);
        break;
      }
      case "swing": {
        const src = this.posOf(e.id, snap);
        if (src && e.weapon !== "bow") {
          const reach = e.weapon === "sword" ? 0.8 : 0.55;
          this.spriteFx(
            "slash",
            src.x + Math.cos(e.face) * reach,
            src.y + 0.7,
            src.z + Math.sin(e.face) * reach,
            e.weapon === "sword" ? 1.7 : 1.2,
            0.16,
            // The crescent art bulges left (angle π); turn the bulge toward the swing.
            { rotation: screenAngle(e.face) - Math.PI, color: e.id.startsWith("e") ? "#ff8a6a" : undefined },
          );
        }
        break;
      }
      case "cast":
        this.decalFx(
          "cast_ring",
          e.x,
          this.groundY(e.x, e.z) + 0.05,
          e.z,
          GAME.weapons.staff.aoe * 2.3,
          GAME.weapons.staff.cast,
        );
        break;
      case "blast": {
        const y = this.groundY(e.x, e.z);
        this.spriteFx("staff_impact", e.x, y + 0.6, e.z, e.r * 2, 0.35, { grow: 0.3 });
        this.burst(e.x, y + 0.4, e.z, e.color, 10, 5);
        break;
      }
      case "explode": {
        const y = this.groundY(e.x, e.z);
        this.spriteFx("explosion", e.x, y + 0.9, e.z, e.r * 1.8, 0.45, { grow: 0.35 });
        this.burst(e.x, y + 0.5, e.z, "#4a4a4a", 14, 3);
        this.shake = Math.min(0.8, this.shake + 0.4);
        break;
      }
      case "slam": {
        const y = this.groundY(e.x, e.z);
        this.decalFx("slam", e.x, y + 0.05, e.z, e.r * 2.4, 0.45);
        this.burst(e.x, y + 0.2, e.z, "#9a7448", 20, 6);
        this.shake = Math.min(0.9, this.shake + 0.5);
        break;
      }
      case "guardBreak": {
        const p = this.players.get(e.id);
        if (p) this.floatText("GUARD BREAK", p.x, p.y + 2.2, p.z, "tag break");
        break;
      }
      case "chestOpened": {
        const c = this.map.camps[e.id];
        const y = this.groundY(c.x, c.z);
        this.spriteFx("chest_burst", c.x, y + 0.2, c.z, 2.6, 0.7, { grow: 0.2, anchorBottom: true });
        this.burst(c.x, y + 0.8, c.z, "#ffe14a", 14, 4);
        break;
      }
      case "pickup": {
        const p = this.players.get(e.id);
        if (p)
          for (const it of e.items)
            this.burst(p.x, p.y + 0.8, p.z, GAME.rarity[it.rarity].color, 6, 2);
        break;
      }
      case "useItem": {
        const p = this.players.get(e.id);
        const col = {
          heal: "#5aff7a",
          speed: "#5ad8ff",
          maxhp: "#ff5577",
          invuln: "#ffe14a",
        }[e.kind as string];
        if (p && col) {
          this.burst(p.x, p.y + 0.8, p.z, col, 14, 3);
          this.decalFx("cast_ring", p.x, p.y + 0.05, p.z, 1.8, 0.4, col);
        }
        break;
      }
      case "enemyDown": {
        const y = this.groundY(e.x, e.z);
        const n = e.kind === "boss" ? 40 : e.kind === "elite" ? 20 : 10;
        this.burst(e.x, y + 0.6, e.z, "#b06bff", n, 4);
        break;
      }
      case "kill": {
        const p = this.players.get(e.victim);
        if (p) {
          this.spriteFx("hit", p.x, p.y + 0.8, p.z, 1.6, 0.35, { color: "#ff5a5a", grow: 0.5 });
          this.burst(p.x, p.y + 0.8, p.z, "#ff3b3b", 20, 5);
          this.burst(p.x, p.y + 0.8, p.z, "#e8c547", 10, 4);
        }
        if (e.victim === this.selfId) this.shake = 1;
        break;
      }
    }
  }

  private floatText(
    text: string,
    x: number,
    y: number,
    z: number,
    cls: string,
  ) {
    const el = document.createElement("div");
    el.className = `ftext ${cls}`;
    el.textContent = text;
    this.overlay.appendChild(el);
    this.floats.push({
      el,
      x: x + (Math.random() - 0.5) * 0.4,
      y,
      z,
      life: 0.9,
    });
  }

  private burst(
    x: number,
    y: number,
    z: number,
    color: string,
    n: number,
    speed: number,
  ) {
    const c = new THREE.Color(color).multiplyScalar(1.4);
    for (let i = 0; i < n && this.particles.length < 600; i++) {
      const a = Math.random() * Math.PI * 2,
        u = Math.random();
      this.particles.push({
        x,
        y,
        z,
        vx: Math.cos(a) * speed * (0.3 + u),
        vz: Math.sin(a) * speed * (0.3 + u),
        vy: 2 + Math.random() * speed,
        life: 0.4 + Math.random() * 0.4,
        max: 0.8,
        size: 0.06 + Math.random() * 0.08,
        color: c,
      });
    }
  }

  /** Camera-facing VFX sprite from assetv2/vfx, additive so it glows under bloom. */
  private spriteFx(
    name: VfxName,
    x: number,
    y: number,
    z: number,
    size: number,
    life: number,
    opts: { color?: string; rotation?: number; grow?: number; anchorBottom?: boolean } = {},
  ) {
    const mat = new THREE.SpriteMaterial({
      map: this.assets.vfx[name].tex,
      color: opts.color ? new THREE.Color(opts.color).multiplyScalar(1.3) : new THREE.Color(1.15, 1.15, 1.15),
      rotation: opts.rotation ?? 0,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const s = new THREE.Sprite(mat);
    if (opts.anchorBottom) s.center.set(0.5, 0);
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.renderOrder = 5;
    this.scene.add(s);
    this.flashes.push({ obj: s, mat, life, max: life, opacity: 1, size, grow: opts.grow ?? 0 });
  }

  /** Ground-aligned VFX (cast ring, slam) that keeps the art's own perspective. */
  private decalFx(name: VfxName, x: number, y: number, z: number, width: number, life: number, color?: string) {
    const mat = new THREE.MeshBasicMaterial({
      map: this.assets.vfx[name].tex,
      color: color ? new THREE.Color(color).multiplyScalar(1.4) : new THREE.Color(1.2, 1.2, 1.2),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const m = new THREE.Mesh(this.decal(this.assets.vfx[name]), mat);
    m.position.set(x, y, z);
    m.scale.setScalar(width);
    m.renderOrder = 2;
    this.scene.add(m);
    this.flashes.push({ obj: m, mat, life, max: life, opacity: 1, size: width, grow: 0.1 });
  }

  private updateFx(dt: number) {
    // Particles.
    let n = 0;
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (const p of this.particles) {
      p.vy -= 12 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const floor = this.groundY(p.x, p.z) + p.size / 2;
      if (p.y < floor) {
        p.y = floor;
        p.vy *= -0.3;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      const s = p.size * Math.min(1, p.life / 0.25);
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.scale.setScalar(s);
      this.dummy.rotation.set(p.life * 5, p.life * 3, 0);
      this.dummy.updateMatrix();
      this.particleMesh.setMatrixAt(n, this.dummy.matrix);
      this.particleMesh.setColorAt(n, p.color);
      n++;
    }
    this.particleMesh.count = n;
    this.particleMesh.instanceMatrix.needsUpdate = true;
    if (this.particleMesh.instanceColor)
      this.particleMesh.instanceColor.needsUpdate = true;

    // Sprite / decal flashes: fade out, optionally grow.
    this.flashes = this.flashes.filter((f) => {
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      f.mat.opacity = k * f.opacity;
      if (f.size && f.grow) f.obj.scale.setScalar(f.size * (1 + f.grow * (1 - k)));
      if (f.life <= 0) {
        this.disposeFlash(f);
        return false;
      }
      return true;
    });

    // Floating text.
    this.floats = this.floats.filter((f) => {
      f.life -= dt;
      f.y += dt * 1.4;
      if (f.life <= 0) {
        f.el.remove();
        return false;
      }
      f.el.style.opacity = `${Math.min(1, f.life / 0.3)}`;
      return true;
    });
  }

  private disposeFlash(f: Flash) {
    this.scene.remove(f.obj);
    f.mat.dispose();
    f.geo?.dispose();
    f.tex?.dispose();
  }

  private project(x: number, y: number, z: number) {
    this.tmp.set(x, y, z).project(this.camera);
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    return {
      sx: (this.tmp.x * 0.5 + 0.5) * w,
      sy: (-this.tmp.y * 0.5 + 0.5) * h,
    };
  }

  private place(el: HTMLElement, x: number, y: number, z: number) {
    const { sx, sy } = this.project(x, y, z);
    el.style.transform = `translate(-50%, -100%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
  }

  private updateLabels() {
    for (const v of this.players.values())
      if (v.label.style.display !== "none")
        this.place(v.label, v.x, v.y + 2.1, v.z);
    for (const v of this.enemies.values()) {
      if (v.bar.style.display === "none") continue;
      this.place(v.bar, v.x, v.y + v.sheet.pivot[1] * PX * 0.85 + 0.15, v.z);
    }
    for (const [id, c] of this.chests) {
      if (c.label.style.display === "none") continue;
      const camp = this.map.camps[id];
      this.place(c.label, camp.x, c.group.position.y + 1.4, camp.z);
    }
    for (const f of this.floats) this.place(f.el, f.x, f.y, f.z);
  }

  dispose() {
    this.ro.disconnect();
    for (const v of this.players.values()) this.removePlayer(v);
    for (const v of this.enemies.values()) this.removeEnemy(v);
    for (const c of this.chests.values()) c.label.remove();
    for (const f of this.floats) f.el.remove();
    for (const g of this.loot.values()) this.disposeLoot(g);
    for (const f of this.flashes) this.disposeFlash(f);
    // Asset textures are shared across matches (see ./assets) and stay loaded;
    // only the per-match clones, geometries and materials are released here.
    this.baseTextures.forEach((t) => t.dispose());
    this.sheetGeos.forEach((g) => g.dispose());
    this.decalGeos.forEach((g) => g.dispose());
    this.disposables.forEach((d) => d.dispose());
    [this.shadowGeo, this.shadowMat, this.arrowGeo, this.arrowMat].forEach((d) => d.dispose());
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    void this.terrainMat;
  }
}
