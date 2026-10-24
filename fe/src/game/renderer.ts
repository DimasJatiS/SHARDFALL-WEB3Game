// Three.js view of the match (PRD 9.2): orthographic isometric camera, instanced voxel
// terrain, 2D billboard players, voxel enemies, tilt-shift + bloom post-processing.
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
import { creatureGeometry, disposeCreatureCache } from "./creatures";
import { FRAME_COUNT, FRAMES, playerSheet } from "./sprites";

const ISO = new THREE.Vector3(1, 1, 1).normalize().multiplyScalar(40);
const VIEW_HALF_HEIGHT = 8.5;
const SCREEN_RIGHT = new THREE.Vector2(1, -1).normalize();
const WATER_Y = 0.35;
const RARITY_HEX = GAME.rarity.map((r) => new THREE.Color(r.color));

const TILE_COLORS: Record<number, string[]> = {
  [TILE.GRASS]: ["#5fa84a", "#66b14f", "#58a044", "#6cb855"],
  [TILE.DIRT]: ["#9a7448", "#a37b4c", "#8f6c42"],
  [TILE.STONE]: ["#8a8f98", "#959aa3", "#7f848c"],
  [TILE.SAND]: ["#d8c48a", "#e0cc92", "#cfbb80"],
};

interface PlayerView {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  tex: THREE.Texture;
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
}

interface EnemyView {
  mesh: THREE.Mesh;
  mat: THREE.MeshLambertMaterial;
  shadow: THREE.Mesh;
  bar: HTMLDivElement;
  fill: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  flash: number;
  ring?: THREE.Mesh;
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
interface Flash {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  follow?: string;
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
      lid: THREE.Object3D;
      glow: THREE.Mesh;
      label: HTMLDivElement;
    }
  >();
  private loot = new Map<string, THREE.Group>();
  private projectiles = new Map<string, THREE.Mesh>();
  private barrels = new Map<number, THREE.Object3D>();
  private spikes: { mesh: THREE.InstancedMesh; ids: number[] } | null = null;
  private pools: THREE.Mesh[] = [];
  private floats: FloatText[] = [];
  private flashes: Flash[] = [];
  private particles: Particle[] = [];
  private particleMesh: THREE.InstancedMesh;
  private baseTextures = new Map<string, THREE.CanvasTexture>();
  private planeGeo = new THREE.PlaneGeometry(1.7, 1.7).translate(
    0,
    0.85 - 0.1,
    0,
  );
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
  ) {
    this.container = container;
    this.overlay = overlay;
    this.map = map;
    this.selfId = selfId;

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
    const land: number[] = [];
    for (let i = 0; i < size * size; i++)
      if (type[i] !== TILE.WATER) land.push(i);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    // Shader tweak: grassy tops with earthy sides, bluezone tint outside the circle,
    // and the next zone drawn as a white line on top of the terrain.
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.zoneUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vObjN;\nvarying vec2 vW;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvObjN = normal;\nvW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vObjN;\nvarying vec2 vW;\nuniform vec3 uZone;\nuniform vec3 uNext;\nuniform float uTime;",
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          if (vObjN.y < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.25, 0.16), 0.55) * 0.92;
          float dOut = length(vW - uZone.xy) - uZone.z;
          if (dOut > 0.0) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.32, 0.75), 0.5);
          diffuseColor.rgb += vec3(0.25, 0.55, 1.0) * (1.0 - smoothstep(0.0, 0.35, abs(dOut))) * 0.9;
          float dNext = abs(length(vW - uNext.xy) - uNext.z);
          if (vObjN.y > 0.5 && uNext.z > 0.1) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), (1.0 - smoothstep(0.04, 0.12, dNext)) * 0.85);`,
        );
    };
    const mesh = new THREE.InstancedMesh(geo, mat, land.length);
    const color = new THREE.Color();
    land.forEach((i, n) => {
      const x = i % size,
        z = Math.floor(i / size);
      const h = height[i] + 1;
      this.dummy.position.set(x + 0.5, h / 2, z + 0.5);
      this.dummy.scale.set(1, h, 1);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(n, this.dummy.matrix);
      const pal = TILE_COLORS[type[i]] ?? TILE_COLORS[TILE.GRASS];
      color.set(pal[(x * 7 + z * 13 + height[i]) % pal.length]);
      mesh.setColorAt(n, color);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.disposables.push(geo, mat);
    return mat;
  }

  private buildWater() {
    const span = this.map.size * 4;
    const floorGeo = new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(
      floorGeo,
      new THREE.MeshLambertMaterial({ color: "#c2ae7a" }),
    );
    floor.position.set(this.map.size / 2, 0, this.map.size / 2);
    floor.receiveShadow = true;
    const water = new THREE.Mesh(
      floorGeo,
      new THREE.MeshLambertMaterial({
        color: "#2b6fa8",
        transparent: true,
        opacity: 0.82,
      }),
    );
    water.position.set(this.map.size / 2, WATER_Y, this.map.size / 2);
    water.receiveShadow = true;
    this.scene.add(floor, water);
    this.disposables.push(floorGeo, floor.material, water.material);
  }

  private buildObstacles() {
    const obs = this.map.obstacles;
    const trees = obs.filter((o) => o.kind === "tree");
    const trunkGeo = new THREE.BoxGeometry(0.3, 0.9, 0.3).translate(0, 0.45, 0);
    const leafGeo = new THREE.BoxGeometry(1, 1, 1);
    const trunk = new THREE.InstancedMesh(
      trunkGeo,
      new THREE.MeshLambertMaterial({ color: "#6b4426" }),
      trees.length,
    );
    const leaves = new THREE.InstancedMesh(
      leafGeo,
      new THREE.MeshLambertMaterial({ color: "#ffffff" }),
      trees.length * 2,
    );
    const c = new THREE.Color();
    trees.forEach((t, i) => {
      const y = this.groundY(t.x, t.z);
      const s = 0.85 + ((t.id * 37) % 10) / 25;
      this.dummy.position.set(t.x, y, t.z);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      trunk.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.set(t.x, y + 1.2 * s, t.z);
      this.dummy.scale.set(1.15 * s, 0.9 * s, 1.15 * s);
      this.dummy.updateMatrix();
      leaves.setMatrixAt(i * 2, this.dummy.matrix);
      this.dummy.position.set(t.x, y + 1.85 * s, t.z);
      this.dummy.scale.set(0.7 * s, 0.55 * s, 0.7 * s);
      this.dummy.updateMatrix();
      leaves.setMatrixAt(i * 2 + 1, this.dummy.matrix);
      c.set(["#3f8a3a", "#4b9a3e", "#357a34"][t.id % 3]);
      leaves.setColorAt(i * 2, c);
      leaves.setColorAt(i * 2 + 1, c.clone().offsetHSL(0, 0, 0.05));
    });
    trunk.castShadow = leaves.castShadow = true;
    trunk.receiveShadow = leaves.receiveShadow = true;
    this.scene.add(trunk, leaves);
    this.disposables.push(
      trunkGeo,
      leafGeo,
      trunk.material as THREE.Material,
      leaves.material as THREE.Material,
    );

    // Spikes: base plate + cones raised when active.
    const spikes = obs.filter((o) => o.kind === "spike");
    const plateGeo = new THREE.BoxGeometry(0.9, 0.06, 0.9);
    const plateMat = new THREE.MeshLambertMaterial({ color: "#4a4450" });
    for (const s of spikes) {
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.position.set(s.x, this.groundY(s.x, s.z) + 0.03, s.z);
      plate.receiveShadow = true;
      this.scene.add(plate);
    }
    const coneGeo = new THREE.ConeGeometry(0.09, 0.45, 5).translate(0, 0.22, 0);
    const cones = new THREE.InstancedMesh(
      coneGeo,
      new THREE.MeshLambertMaterial({ color: "#d9dde3" }),
      spikes.length * 5,
    );
    cones.castShadow = true;
    this.spikes = { mesh: cones, ids: spikes.map((s) => s.id) };
    this.scene.add(cones);
    this.disposables.push(
      plateGeo,
      plateMat,
      coneGeo,
      cones.material as THREE.Material,
    );

    // Lava pools (bright so bloom makes them glow).
    const poolMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.6, 0.55, 0.12),
      toneMapped: false,
    });
    for (const p of obs.filter((o) => o.kind === "pool")) {
      const g = new THREE.CircleGeometry(p.r, 18).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, poolMat);
      m.position.set(p.x, this.groundY(p.x, p.z) + 0.02, p.z);
      this.scene.add(m);
      this.pools.push(m);
      this.disposables.push(g);
    }
    this.disposables.push(poolMat);

    // Explosive barrels.
    const barrelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.65, 10).translate(
      0,
      0.33,
      0,
    );
    const bandGeo = new THREE.CylinderGeometry(0.31, 0.31, 0.08, 10);
    const barrelMat = new THREE.MeshLambertMaterial({ color: "#c0392b" });
    const bandMat = new THREE.MeshLambertMaterial({ color: "#2b2b2b" });
    for (const b of obs.filter((o) => o.kind === "barrel")) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(barrelGeo, barrelMat);
      body.castShadow = true;
      const b1 = new THREE.Mesh(bandGeo, bandMat);
      b1.position.y = 0.15;
      const b2 = new THREE.Mesh(bandGeo, bandMat);
      b2.position.y = 0.5;
      g.add(body, b1, b2);
      g.position.set(b.x, this.groundY(b.x, b.z), b.z);
      this.scene.add(g);
      this.barrels.set(b.id, g);
    }
    this.disposables.push(barrelGeo, bandGeo, barrelMat, bandMat);
  }

  private buildChests() {
    const tierCol = {
      wood: "#8a5a2b",
      iron: "#8b96a3",
      boss: "#e8c547",
    } as const;
    const trimCol = {
      wood: "#e8c547",
      iron: "#3a3f47",
      boss: "#9b59ff",
    } as const;
    const baseGeo = new THREE.BoxGeometry(0.9, 0.5, 0.6).translate(0, 0.25, 0);
    const lidGeo = new THREE.BoxGeometry(0.9, 0.22, 0.6).translate(
      0,
      0.11,
      0.3,
    );
    const trimGeo = new THREE.BoxGeometry(0.16, 0.2, 0.05);
    const glowGeo = new THREE.RingGeometry(0.9, 1.1, 32).rotateX(-Math.PI / 2);
    this.disposables.push(baseGeo, lidGeo, trimGeo, glowGeo);
    for (const camp of this.map.camps) {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color: tierCol[camp.tier] });
      const trim = new THREE.MeshLambertMaterial({
        color: trimCol[camp.tier],
        emissive: camp.tier === "boss" ? "#5a2a9a" : "#000000",
      });
      const base = new THREE.Mesh(baseGeo, mat);
      base.castShadow = true;
      const lidPivot = new THREE.Object3D();
      lidPivot.position.set(0, 0.5, -0.3);
      const lid = new THREE.Mesh(lidGeo, mat);
      lid.castShadow = true;
      lidPivot.add(lid);
      const lock = new THREE.Mesh(trimGeo, trim);
      lock.position.set(0, 0.5, 0.31);
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
      g.add(base, lidPivot, lock, glow);
      const scale = camp.tier === "boss" ? 1.6 : camp.tier === "iron" ? 1.2 : 1;
      g.scale.setScalar(scale);
      g.position.set(camp.x, this.groundY(camp.x, camp.z), camp.z);
      g.rotation.y = Math.PI / 4;
      this.scene.add(g);
      const label = document.createElement("div");
      label.className = "wlabel chest";
      this.overlay.appendChild(label);
      this.chests.set(camp.id, { group: g, lid: lidPivot, glow, label });
      this.disposables.push(mat, trim, glow.material as THREE.Material);
    }
  }

  private buildZoneWall() {
    // Short energy wall that fades out upward, so its near side never hides the arena.
    const geo = new THREE.CylinderGeometry(1, 1, 3.2, 128, 1, true).translate(
      0,
      1.6,
      0,
    );
    const mat = new THREE.ShaderMaterial({
      uniforms: this.zoneUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      vertexShader:
        "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main() {
          float fade = pow(1.0 - vUv.y, 2.2);
          float bands = 0.6 + 0.4 * sin(vUv.y * 18.0 - uTime * 3.0);
          gl_FragColor = vec4(vec3(0.35, 0.7, 1.6), fade * bands * 0.55);
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
      this.syncLoot(snap.loot, dt);
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
    for (const p of this.pools) {
      const k = 1.3 + Math.sin(this.time * 3 + p.position.x) * 0.25;
      (p.material as THREE.MeshBasicMaterial).color.setRGB(k, k * 0.36, 0.1);
    }
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

  private syncPlayers(list: PlayerState[], dt: number) {
    const seen = new Set<string>();
    const k = 1 - Math.exp(-dt * 18);
    for (const p of list) {
      seen.add(p.id);
      let v = this.players.get(p.id);
      const weaponArt =
        p.weapon &&
        (p.weapon.kind === "sword" ||
          p.weapon.kind === "staff" ||
          p.weapon.kind === "bow")
          ? p.weapon.kind
          : "none";
      const key = `${p.skin}:${weaponArt}`;
      if (!v) {
        const tex = this.sheetTexture(key, p.skin, weaponArt);
        const mat = new THREE.MeshBasicMaterial({
          map: tex,
          alphaTest: 0.5,
          color: 0xffffff,
        });
        const mesh = new THREE.Mesh(this.planeGeo, mat);
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

      // Animation frame.
      const el = this.time - v.actionStart;
      let frame: number;
      switch (p.action) {
        case "walk":
          frame = FRAMES.walk[Math.floor(this.time * 9) % 4];
          break;
        case "attack":
          frame = FRAMES.attack[Math.min(2, Math.floor(el / 0.07))];
          break;
        case "cast":
          frame = FRAMES.cast[Math.floor(this.time * 7) % 2];
          break;
        case "defend":
        case "parry":
          frame = FRAMES.defend[0];
          break;
        case "stun":
          frame = FRAMES.stun[0];
          break;
        case "dead":
          frame = FRAMES.dead[0];
          break;
        default:
          frame = FRAMES.idle[Math.floor(this.time * 2) % 2];
      }
      const flip =
        Math.cos(p.face) * SCREEN_RIGHT.x + Math.sin(p.face) * SCREEN_RIGHT.y <
        0;
      v.tex.repeat.set((flip ? -1 : 1) / FRAME_COUNT, 1);
      v.tex.offset.set((frame + (flip ? 1 : 0)) / FRAME_COUNT, 0);

      v.flash = Math.max(0, v.flash - dt);
      const c = v.mat.color;
      if (v.flash > 0) c.setRGB(4, 4, 4);
      else if (p.action === "parry") c.setRGB(2.2, 2, 0.8);
      else if (p.invuln) {
        const s = 1.4 + Math.sin(this.time * 18) * 0.4;
        c.setRGB(s, s * 0.95, 0.6);
      } else if (p.action === "stun") c.setRGB(0.8, 0.8, 1.3);
      else if (p.speedBuff) c.setRGB(0.85, 1.15, 1.3);
      else if (!p.alive) c.setRGB(0.5, 0.5, 0.55);
      else c.setRGB(1, 1, 1);

      v.label.style.display = p.alive ? "" : "none";
      v.hpFill.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    }
    for (const [id, v] of this.players)
      if (!seen.has(id)) {
        this.removePlayer(v);
        this.players.delete(id);
      }
  }

  private sheetTexture(
    key: string,
    skin: number,
    weapon: "none" | "sword" | "staff" | "bow",
  ) {
    let base = this.baseTextures.get(key);
    if (!base) {
      base = new THREE.CanvasTexture(playerSheet(skin, weapon));
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
  }

  private syncEnemies(list: EnemyState[], dt: number) {
    const seen = new Set<string>();
    const k = 1 - Math.exp(-dt * 16);
    for (const e of list) {
      seen.add(e.id);
      let v = this.enemies.get(e.id);
      if (!v) {
        const seed = parseInt(e.id.slice(1), 10) * 7919 + this.map.seed;
        const mat = new THREE.MeshLambertMaterial({
          vertexColors: true,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(
          creatureGeometry(
            e.kind,
            e.kind === "minion" ? (seed % 6) + this.map.seed : seed,
          ),
          mat,
        );
        mesh.castShadow = true;
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
          shadow,
          bar,
          fill: bar.firstChild as HTMLDivElement,
          x: e.x,
          y: this.groundY(e.x, e.z),
          z: e.z,
          flash: 0,
        };
        this.enemies.set(e.id, v);
      }
      v.x += (e.x - v.x) * k;
      v.z += (e.z - v.z) * k;
      v.y += (this.groundY(v.x, v.z) - v.y) * (1 - Math.exp(-dt * 14));
      const bob =
        Math.abs(Math.sin(this.time * (e.ai === "chase" ? 10 : 3) + v.x)) *
        (e.ai === "chase" ? 0.12 : 0.04);
      v.mesh.position.set(v.x, v.y + bob, v.z);
      v.mesh.rotation.y = Math.atan2(Math.cos(e.face), Math.sin(e.face));
      // Squash during windup, stretch on release.
      const def = GAME.enemies[e.kind];
      const w = e.ai === "windup" ? 1 - e.windup / def.windup : 0;
      v.mesh.scale.set(1 + w * 0.15, 1 - w * 0.2, 1 + w * 0.15);
      v.shadow.position.set(v.x, v.y + 0.02, v.z);
      v.flash = Math.max(0, v.flash - dt);
      if (v.flash > 0) v.mat.emissive.setRGB(1.2, 1.2, 1.2);
      else if (e.ai === "windup") v.mat.emissive.setRGB(0.6 * w, 0, 0);
      else if (e.ai === "stun") v.mat.emissive.setRGB(0.2, 0.2, 0.5);
      else v.mat.emissive.setRGB(0, 0, 0);

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
      this.scene.remove(v.mesh, v.shadow);
      if (v.ring) {
        this.scene.remove(v.ring);
        v.ring.geometry.dispose();
        (v.ring.material as THREE.Material).dispose();
      }
      v.mat.dispose();
      v.bar.remove();
      this.enemies.delete(id);
    }
  }

  private syncChests(list: ChestState[], players: PlayerState[]) {
    const me = players.find((p) => p.id === this.selfId);
    for (const c of list) {
      const v = this.chests.get(c.id);
      if (!v) continue;
      v.lid.rotation.x += ((c.opened ? -1.9 : 0) - v.lid.rotation.x) * 0.2;
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

  private syncLoot(list: LootPile[], dt: number) {
    const seen = new Set<string>();
    for (const l of list) {
      seen.add(l.id);
      let g = this.loot.get(l.id);
      const best = Math.max(...l.items.map((i) => i.rarity), 0);
      if (!g) {
        g = new THREE.Group();
        const col = RARITY_HEX[best];
        if (l.bag) {
          const sack = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.45, 0.5),
            new THREE.MeshLambertMaterial({ color: "#8a6a3a" }),
          );
          sack.position.y = 0.23;
          sack.castShadow = true;
          const tie = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.15, 0.2),
            new THREE.MeshLambertMaterial({ color: "#5a3a1a" }),
          );
          tie.position.y = 0.52;
          g.add(sack, tie);
        } else {
          const gem = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.28),
            new THREE.MeshBasicMaterial({
              color: col.clone().multiplyScalar(1.8),
              toneMapped: false,
            }),
          );
          gem.position.y = 0.7;
          gem.name = "gem";
          g.add(gem);
        }
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.06, 3, 6).translate(0, 1.5, 0),
          new THREE.MeshBasicMaterial({
            color: col.clone().multiplyScalar(1.6),
            transparent: true,
            opacity: best === 2 ? 0.55 : best === 1 ? 0.35 : 0.18,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        g.add(beam);
        g.position.set(l.x, this.groundY(l.x, l.z), l.z);
        this.scene.add(g);
        this.loot.set(l.id, g);
      }
      const gem = g.getObjectByName("gem");
      if (gem) {
        gem.rotation.y += dt * 2;
        gem.position.y = 0.7 + Math.sin(this.time * 3) * 0.08;
      }
    }
    for (const [id, g] of this.loot) {
      if (seen.has(id)) continue;
      this.scene.remove(g);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      this.loot.delete(id);
    }
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
      const up =
        phase < sp.activeFor ? 1 : phase > sp.period - 0.4 ? 0.25 : 0.05;
      this.spikes.ids.forEach((id, i) => {
        const o = this.map.obstacles[id];
        const y = this.groundY(o.x, o.z);
        for (let k = 0; k < 5; k++) {
          const ox = k === 4 ? 0 : k % 2 ? 0.22 : -0.22,
            oz = k === 4 ? 0 : k < 2 ? 0.22 : -0.22;
          this.dummy.position.set(o.x + ox, y + 0.05, o.z + oz);
          this.dummy.scale.set(1, up, 1);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.updateMatrix();
          this.spikes!.mesh.setMatrixAt(i * 5 + k, this.dummy.matrix);
        }
      });
      this.spikes.mesh.instanceMatrix.needsUpdate = true;
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
        this.burst(e.x, y + 0.7, e.z, self ? "#ff4a4a" : "#ffffff", 6, 3);
        if (self) this.shake = Math.min(0.5, this.shake + 0.25);
        break;
      }
      case "blocked":
        this.floatText(
          "BLOCK",
          e.x,
          this.groundY(e.x, e.z) + 2,
          e.z,
          "tag block",
        );
        this.burst(e.x, this.groundY(e.x, e.z) + 0.8, e.z, "#9ad0ff", 5, 2);
        break;
      case "immune":
        this.floatText(
          "IMMUNE",
          e.x,
          this.groundY(e.x, e.z) + 2,
          e.z,
          "tag immune",
        );
        break;
      case "parry": {
        const y = this.groundY(e.x, e.z);
        this.floatText("PARRY!", e.x, y + 2.1, e.z, "tag parry");
        this.burst(e.x, y + 0.9, e.z, "#ffe14a", 16, 5);
        this.ringFlash(e.x, y + 0.1, e.z, 1.4, "#ffe14a", 0.3);
        if (e.target === this.selfId || e.attacker === this.selfId)
          this.shake = Math.min(0.6, this.shake + 0.3);
        break;
      }
      case "swing": {
        const src = this.posOf(e.id, snap);
        if (src && e.weapon !== "bow")
          this.arcFlash(
            src.x,
            src.y + 0.5,
            src.z,
            e.face,
            e.weapon === "sword" ? 1.6 : 1.1,
            e.id.startsWith("e") ? "#ff7a5a" : "#ffffff",
          );
        break;
      }
      case "cast":
        this.ringFlash(
          e.x,
          this.groundY(e.x, e.z) + 0.08,
          e.z,
          GAME.weapons.staff.aoe,
          "#b06bff",
          GAME.weapons.staff.cast,
        );
        break;
      case "blast": {
        const y = this.groundY(e.x, e.z);
        this.burst(e.x, y + 0.4, e.z, e.color, 22, 5);
        this.ringFlash(e.x, y + 0.1, e.z, e.r, e.color, 0.25);
        break;
      }
      case "explode": {
        const y = this.groundY(e.x, e.z);
        this.burst(e.x, y + 0.5, e.z, "#ff8a2a", 30, 7);
        this.burst(e.x, y + 0.5, e.z, "#4a4a4a", 14, 3);
        this.ringFlash(e.x, y + 0.1, e.z, e.r, "#ff8a2a", 0.35);
        this.shake = Math.min(0.8, this.shake + 0.4);
        break;
      }
      case "slam": {
        const y = this.groundY(e.x, e.z);
        this.burst(e.x, y + 0.2, e.z, "#9a7448", 30, 6);
        this.ringFlash(e.x, y + 0.1, e.z, e.r, "#ff3b3b", 0.3);
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
        this.burst(c.x, this.groundY(c.x, c.z) + 0.8, c.z, "#ffe14a", 26, 4);
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
          this.ringFlash(p.x, p.y + 0.1, p.z, 1, col, 0.4);
        }
        break;
      }
      case "enemyDown": {
        const y = this.groundY(e.x, e.z);
        const n = e.kind === "boss" ? 60 : e.kind === "elite" ? 30 : 16;
        this.burst(e.x, y + 0.6, e.z, "#6fbf4a", n, 4);
        this.burst(e.x, y + 0.6, e.z, "#2f3d2a", n / 2, 3);
        break;
      }
      case "kill": {
        const p = this.players.get(e.victim);
        if (p) {
          this.burst(p.x, p.y + 0.8, p.z, "#ff3b3b", 24, 5);
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

  private ringFlash(
    x: number,
    y: number,
    z: number,
    r: number,
    color: string,
    life: number,
  ) {
    const g = new THREE.RingGeometry(Math.max(0, r - 0.12), r, 40).rotateX(
      -Math.PI / 2,
    );
    const m = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(1.6),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    m.position.set(x, y, z);
    this.scene.add(m);
    this.flashes.push({ mesh: m, life, max: life });
  }

  private arcFlash(
    x: number,
    y: number,
    z: number,
    face: number,
    r: number,
    color: string,
  ) {
    const g = new THREE.RingGeometry(
      r * 0.45,
      r,
      20,
      1,
      -Math.PI / 4,
      Math.PI / 2,
    ).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(1.5),
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    m.position.set(x, y, z);
    m.rotation.y = -face;
    this.scene.add(m);
    this.flashes.push({ mesh: m, life: 0.15, max: 0.15 });
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

    // Ring and arc flashes.
    this.flashes = this.flashes.filter((f) => {
      f.life -= dt;
      const mat = f.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, f.life / f.max) * 0.9;
      if (f.life <= 0) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        mat.dispose();
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
        this.place(v.label, v.x, v.y + 1.75, v.z);
    for (const [id, v] of this.enemies) {
      if (v.bar.style.display === "none") continue;
      const h =
        id && v.mesh.geometry.boundingSphere
          ? v.mesh.geometry.boundingSphere.radius * 2 + 0.2
          : 1.5;
      this.place(v.bar, v.x, v.y + h, v.z);
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
    for (const v of this.enemies.values()) {
      v.mat.dispose();
      v.bar.remove();
    }
    for (const c of this.chests.values()) c.label.remove();
    for (const f of this.floats) f.el.remove();
    for (const g of this.loot.values())
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    for (const f of this.flashes) {
      f.mesh.geometry.dispose();
      (f.mesh.material as THREE.Material).dispose();
    }
    this.baseTextures.forEach((t) => t.dispose());
    this.disposables.forEach((d) => d.dispose());
    [
      this.planeGeo,
      this.shadowGeo,
      this.shadowMat,
      this.arrowGeo,
      this.arrowMat,
    ].forEach((d) => d.dispose());
    disposeCreatureCache();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    void this.terrainMat;
  }
}
