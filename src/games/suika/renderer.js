import * as THREE from 'three';
import { FRUITS } from './core.js';
import { fruitTexture, fruitSprite, getFruitArt, FRUIT_SPRITE_SCALE } from './fruit-art.js';

const WIDTH = 440;
const HEIGHT = 620;
const LEFT = 16;
const RIGHT = 424;
const BOTTOM = 600;
const SPAWN_Y = 58;
const DEPTH = 0.72;
const MAX_DPR = 1.5;
const MAX_PARTICLES = 100;
const MAX_RINGS = 12;
const TAU = Math.PI * 2;
const EFFECT_TYPES = new Set(['merge', 'remove', 'drop', 'shake', 'over']);
const now = () => globalThis.performance?.now() ?? Date.now();
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const tierOf = (value) => Math.max(0, Math.min(FRUITS.length - 1, Math.trunc(finite(
  typeof value === 'object' && value !== null ? value.tier : value, 0,
))));
const radiusOf = (tier) => FRUITS[tierOf(tier)].radius;
const capacityFor = (count) => Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
const validFruit = (fruit) => fruit && Number.isFinite(fruit.x) && Number.isFinite(fruit.y);

function aimLanding(fruits, x, radius) {
  let y = BOTTOM - radius;
  for (const fruit of fruits) {
    if (!validFruit(fruit)) continue;
    const total = radius + radiusOf(fruit.tier);
    const dx = x - fruit.x;
    if (Math.abs(dx) >= total) continue;
    const reach = Math.sqrt(Math.max(0, total * total - dx * dx));
    if (fruit.y + reach < SPAWN_Y) continue;
    y = Math.min(y, Math.max(SPAWN_Y, fruit.y - reach));
  }
  return y;
}

function makeEffects(reducedMotion) {
  const particles = [];
  const rings = [];
  return {
    particles,
    rings,
    clear() {
      particles.length = 0;
      rings.length = 0;
    },
    prune(time) {
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        if (time - particles[i].start >= particles[i].life) particles.splice(i, 1);
      }
      for (let i = rings.length - 1; i >= 0; i -= 1) {
        if (time - rings[i].start >= rings[i].life) rings.splice(i, 1);
      }
    },
    burst(event) {
      if (!event || !EFFECT_TYPES.has(event.type)) return;
      const type = event.type;
      const tier = tierOf(event.tier);
      const radius = radiusOf(tier);
      const start = now();
      const x = finite(event.x, WIDTH / 2);
      const y = finite(event.y, type === 'shake' ? BOTTOM - 4 : type === 'drop' ? SPAWN_Y : 310);
      const color = type === 'remove' || type === 'over' ? '#d98478' : getFruitArt(tier).color;
      const count = reducedMotion ? (type === 'over' ? 0 : 2)
        : type === 'drop' ? 3 : type === 'over' ? 5 : event.collected ? 14 : 8;
      const palette = [color, '#e9bd62', '#9bbd70', '#f5dec0'];
      for (let i = 0; i < count; i += 1) {
        const angle = TAU * (i / Math.max(1, count)) + Math.random() * 0.28;
        const speed = (36 + Math.random() * 66) * (reducedMotion ? 0.28 : 1);
        particles.push({
          x: type === 'shake' ? LEFT + 20 + Math.random() * (RIGHT - LEFT - 40) : x,
          y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - (reducedMotion ? 5 : 24),
          size: 1.4 + Math.random() * (event.collected ? 2.2 : 1.6),
          color: palette[i % palette.length], start,
          life: reducedMotion ? 210 : 390 + Math.random() * 250,
          gravity: reducedMotion ? 24 : 105,
        });
      }
      rings.push({
        x, y, color, start,
        radius: type === 'over' ? 54 : type === 'shake' ? 21 : radius * (type === 'drop' ? 0.82 : 0.50),
        spread: reducedMotion ? 5 : type === 'drop' ? 11 : type === 'over' ? 32 : 24,
        life: reducedMotion ? 200 : type === 'over' ? 650 : 440,
        opacity: reducedMotion ? 0.20 : type === 'drop' ? 0.22 : 0.43,
      });
      if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
      if (rings.length > MAX_RINGS) rings.splice(0, rings.length - MAX_RINGS);
    },
  };
}

function particleAt(particle, time) {
  const age = Math.max(0, time - particle.start);
  const progress = Math.min(1, age / particle.life);
  const seconds = age / 1000;
  return {
    x: particle.x + particle.vx * seconds,
    y: particle.y + particle.vy * seconds + particle.gravity * seconds * seconds,
    size: particle.size * (1 - progress * 0.48),
    opacity: (1 - progress) ** 1.5,
  };
}

function frameFor(state, options) {
  const fruits = Array.isArray(state?.fruits) ? state.fruits : [];
  const tier = tierOf(state?.current);
  const radius = radiusOf(tier);
  const x = Math.max(LEFT + radius, Math.min(RIGHT - radius, finite(options.aimX, WIDTH / 2)));
  return {
    fruits, tier, radius, x,
    landing: aimLanding(fruits, x, radius),
    showAim: options.showAim !== false && !options.removeMode,
    removeMode: Boolean(options.removeMode),
    time: Number.isFinite(options.time) && options.time > 0 ? options.time : now(),
  };
}

function createCrownGeometry(art) {
  const positions = [];
  const colors = [];
  const indices = [];
  const color = new THREE.Color();
  const surface = (x, y) => Math.sqrt(Math.max(0.025, 1 - x * x - y * y)) * DEPTH;
  const vertex = (x, y, z, tint, brightness = 1) => {
    positions.push(x, y, z);
    color.set(tint).multiplyScalar(brightness);
    colors.push(color.r, color.g, color.b);
  };
  for (const item of art.leaves) {
    const offset = positions.length / 3;
    const steps = 8;
    for (let row = 0; row <= steps; row += 1) {
      const t = row / steps;
      const halfWidth = Math.sin(Math.PI * t) ** 0.85 * item.width * 0.88;
      for (let lane = -1; lane <= 1; lane += 1) {
        const lx = lane * halfWidth;
        const ly = t * item.length;
        const x = item.x + lx * Math.cos(item.angle) + ly * Math.sin(item.angle);
        const y = item.y - lx * Math.sin(item.angle) + ly * Math.cos(item.angle);
        const z = surface(x, y) + 0.025 + Math.sin(Math.PI * t) * (lane === 0 ? 0.065 : 0.015);
        vertex(x, y, z, item.color, lane === 0 ? 1.20 : 0.94);
      }
    }
    for (let row = 0; row < steps; row += 1) {
      for (let lane = 0; lane < 2; lane += 1) {
        const a = offset + row * 3 + lane;
        indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
      }
    }
  }
  if (art.stem) {
    const s = art.stem;
    const offset = positions.length / 3;
    const start = new THREE.Vector3(s.x, s.y, surface(s.x, s.y) + 0.02);
    const end = new THREE.Vector3(s.x + s.dx, s.y + s.dy, surface(s.x, s.y) + 0.05);
    const axis = end.clone().sub(start).normalize();
    const side = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 0, 1)).normalize();
    const front = new THREE.Vector3().crossVectors(side, axis).normalize();
    for (let endIndex = 0; endIndex < 2; endIndex += 1) {
      const center = endIndex ? end : start;
      const radius = s.width * (endIndex ? 0.40 : 0.56);
      for (let segment = 0; segment < 6; segment += 1) {
        const angle = segment / 6 * TAU;
        vertex(center.x + radius * (side.x * Math.cos(angle) + front.x * Math.sin(angle)),
          center.y + radius * (side.y * Math.cos(angle) + front.y * Math.sin(angle)),
          center.z + radius * (side.z * Math.cos(angle) + front.z * Math.sin(angle)), '#806244');
      }
    }
    for (let segment = 0; segment < 6; segment += 1) {
      const a = offset + segment;
      const b = offset + (segment + 1) % 6;
      indices.push(a, b, a + 6, b, b + 6, a + 6);
    }
    indices.push(offset + 6, offset + 8, offset + 7, offset + 6, offset + 9, offset + 8,
      offset + 6, offset + 10, offset + 9, offset + 6, offset + 11, offset + 10);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable for procedural shadows.');
  const gradient = context.createRadialGradient(32, 32, 3, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(60,82,39,0.25)');
  gradient.addColorStop(0.55, 'rgba(60,82,39,0.12)');
  gradient.addColorStop(1, 'rgba(60,82,39,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeWebGL(canvas, effects, reducedMotion, callbacks) {
  const renderer = new THREE.WebGLRenderer({
    canvas, alpha: true, antialias: true, premultipliedAlpha: true,
    powerPreference: 'high-performance', stencil: false,
  });
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const instances = new Set();
  const ownGeometry = (item) => { geometries.add(item); return item; };
  const ownMaterial = (item) => { materials.add(item); return item; };
  const ownTexture = (item) => { textures.add(item); return item; };
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, WIDTH, HEIGHT, 0, 0.1, 1500);
  camera.position.z = 800;
  let lost = false;
  let disposed = false;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  const contextLost = (event) => {
    event.preventDefault();
    lost = true;
    effects.clear();
    callbacks.onContextLost(event);
  };
  const contextRestored = (event) => {
    if (disposed) return;
    lost = false;
    for (const texture of textures) texture.needsUpdate = true;
    callbacks.onContextRestored(event);
  };

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('webglcontextlost', contextLost);
    canvas.removeEventListener('webglcontextrestored', contextRestored);
    for (const item of instances) item.dispose();
    for (const item of textures) item.dispose();
    for (const item of materials) item.dispose();
    for (const item of geometries) item.dispose();
    scene.clear();
    renderer.dispose();
  };

  try {
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.10;
    renderer.shadowMap.enabled = false;
    const sky = new THREE.HemisphereLight('#fff7e4', '#87966b', 1.65);
    const key = new THREE.DirectionalLight('#fff4dc', 3.05);
    key.position.set(-180, 900, 600);
    key.target.position.set(WIDTH / 2, HEIGHT / 2, 0);
    const fill = new THREE.DirectionalLight('#e6efdb', 0.68);
    fill.position.set(620, 300, 380);
    fill.target.position.set(WIDTH / 2, HEIGHT / 2, 0);
    scene.add(sky, key, key.target, fill, fill.target);

    const box = ownGeometry(new THREE.BoxGeometry(1, 1, 1));
    const plane = ownGeometry(new THREE.PlaneGeometry(2, 2));
    const sphere = ownGeometry(new THREE.SphereGeometry(1, 32, 22));
    sphere.scale(1, 1, DEPTH);
    const crownMaterial = ownMaterial(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.DoubleSide,
    }));
    const glass = ownMaterial(new THREE.MeshStandardMaterial({
      color: '#aecb9c', roughness: 0.72, transparent: true, opacity: 0.27, depthWrite: false,
    }));
    const edge = ownMaterial(new THREE.MeshBasicMaterial({
      color: '#91b27c', transparent: true, opacity: 0.65, depthWrite: false,
    }));
    const glint = ownMaterial(new THREE.MeshBasicMaterial({
      color: '#fffdf0', transparent: true, opacity: 0.74, depthWrite: false,
    }));
    const floorMaterial = ownMaterial(new THREE.MeshStandardMaterial({
      color: '#bbd19c', roughness: 0.88, metalness: 0,
    }));
    const backdropMaterial = ownMaterial(new THREE.MeshBasicMaterial({
      color: '#e0ebcb', transparent: true, opacity: 0.08, depthWrite: false,
    }));
    const addBox = (x, y, z, w, h, d, material, order = 0) => {
      const mesh = new THREE.Mesh(box, material);
      mesh.position.set(x, HEIGHT - y, z);
      mesh.scale.set(w, h, d);
      mesh.renderOrder = order;
      scene.add(mesh);
      return mesh;
    };
    const back = new THREE.Mesh(plane, backdropMaterial);
    back.position.set(WIDTH / 2, HEIGHT - 352, -77);
    back.scale.set((RIGHT - LEFT) / 2, 248, 1);
    back.renderOrder = -20;
    scene.add(back);
    addBox(220, 606, -8, 424, 12, 130, floorMaterial);
    addBox(220, 601.5, 61, 414, 2.5, 1, glint, 12);
    addBox(220, 612, 61, 412, 1, 1, edge, 12);
    for (const x of [LEFT - 4, RIGHT + 4]) {
      addBox(x, 352, -1, 8, 496, 122, glass, 10);
      addBox(x, 351, 61, 1.6, 494, 1, edge, 12);
      addBox(x - 2, 350, 62, 1.2, 488, 1, glint, 13);
      addBox(x, 104, 0, 8, 2, 122, edge, 11);
    }

    const fruitMaterials = new Map();
    const crownGeometries = new Map();
    const materialFor = (tier) => {
      if (!fruitMaterials.has(tier)) {
        const map = ownTexture(new THREE.CanvasTexture(fruitTexture(tier)));
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = Math.min(2, renderer.capabilities.getMaxAnisotropy());
        fruitMaterials.set(tier, ownMaterial(new THREE.MeshStandardMaterial({
          map, roughness: 0.84, metalness: 0, color: '#ffffff',
        })));
      }
      return fruitMaterials.get(tier);
    };
    const crownFor = (tier) => {
      if (!crownGeometries.has(tier)) crownGeometries.set(tier, ownGeometry(createCrownGeometry(getFruitArt(tier))));
      return crownGeometries.get(tier);
    };
    const makeInstances = (geometry, material, capacity, order = 0) => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      instances.add(mesh);
      scene.add(mesh);
      return mesh;
    };
    const removeInstances = (mesh) => {
      scene.remove(mesh);
      mesh.dispose();
      instances.delete(mesh);
    };
    const batches = new Map();
    const batchFor = (tier, count) => {
      let batch = batches.get(tier);
      if (!batch || batch.capacity < count) {
        if (batch) {
          removeInstances(batch.body);
          removeInstances(batch.crown);
        }
        const capacity = capacityFor(count);
        batch = {
          capacity,
          body: makeInstances(sphere, materialFor(tier), capacity),
          crown: makeInstances(crownFor(tier), crownMaterial, capacity),
          count: 0,
        };
        batches.set(tier, batch);
      }
      return batch;
    };
    const shadowMaterial = ownMaterial(new THREE.MeshBasicMaterial({
      map: ownTexture(createShadowTexture()), transparent: true, depthWrite: false, toneMapped: false,
    }));
    let shadowCapacity = 64;
    let shadows = makeInstances(plane, shadowMaterial, shadowCapacity, -10);
    const ringGeometry = ownGeometry(new THREE.RingGeometry(0.978, 1, 48));
    const removalMaterial = ownMaterial(new THREE.MeshBasicMaterial({
      color: '#d17c71', transparent: true, opacity: 0.48, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    let removalCapacity = 64;
    let removalRings = makeInstances(ringGeometry, removalMaterial, removalCapacity, 22);

    const preview = new THREE.Group();
    const previewBody = new THREE.Mesh(sphere, materialFor(0));
    const previewCrown = new THREE.Mesh(crownFor(0), crownMaterial);
    preview.add(previewBody, previewCrown);
    scene.add(preview);
    let previewTier = 0;
    const aimPositions = new Float32Array(6);
    const aimGeometry = ownGeometry(new THREE.BufferGeometry());
    aimGeometry.setAttribute('position', new THREE.BufferAttribute(aimPositions, 3).setUsage(THREE.DynamicDrawUsage));
    const aimDistances = new THREE.BufferAttribute(new Float32Array(2), 1).setUsage(THREE.DynamicDrawUsage);
    aimGeometry.setAttribute('lineDistance', aimDistances);
    const aimMaterial = ownMaterial(new THREE.LineDashedMaterial({
      color: '#829b68', dashSize: 4, gapSize: 6, transparent: true, opacity: 0.51,
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
    const aimLine = new THREE.Line(aimGeometry, aimMaterial);
    aimLine.frustumCulled = false;
    aimLine.renderOrder = 20;
    scene.add(aimLine);
    const landingMaterial = ownMaterial(new THREE.MeshBasicMaterial({
      color: '#8fac71', transparent: true, opacity: 0.23, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    const landing = new THREE.Mesh(ringGeometry, landingMaterial);
    landing.renderOrder = 20;
    scene.add(landing);

    const particlePositions = new Float32Array(MAX_PARTICLES * 3);
    const particleColors = new Float32Array(MAX_PARTICLES * 3);
    const particleSizes = new Float32Array(MAX_PARTICLES);
    const particleAlphas = new Float32Array(MAX_PARTICLES);
    const particleGeometry = ownGeometry(new THREE.BufferGeometry());
    for (const [name, array, size] of [
      ['position', particlePositions, 3], ['color', particleColors, 3],
      ['aSize', particleSizes, 1], ['aOpacity', particleAlphas, 1],
    ]) particleGeometry.setAttribute(name, new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage));
    const particleMaterial = ownMaterial(new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 } },
      vertexColors: true, transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
      vertexShader: `
        attribute float aSize;
        attribute float aOpacity;
        uniform float uScale;
        varying vec3 vTint;
        varying float vOpacity;
        void main() {
          vTint = color;
          vOpacity = aOpacity;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(1.0, aSize * uScale * 2.0);
        }
      `,
      fragmentShader: `
        varying vec3 vTint;
        varying float vOpacity;
        void main() {
          float distanceToCenter = length(gl_PointCoord - vec2(0.5));
          float alpha = (1.0 - smoothstep(0.32, 0.5, distanceToCenter)) * vOpacity;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(vTint, alpha);
          #include <colorspace_fragment>
        }
      `,
    }));
    const points = new THREE.Points(particleGeometry, particleMaterial);
    points.frustumCulled = false;
    points.renderOrder = 32;
    scene.add(points);
    const effectRings = Array.from({ length: MAX_RINGS }, () => {
      const material = ownMaterial(new THREE.MeshBasicMaterial({
        transparent: true, depthWrite: false, depthTest: false, toneMapped: false,
      }));
      const mesh = new THREE.Mesh(ringGeometry, material);
      mesh.visible = false;
      mesh.renderOrder = 31;
      scene.add(mesh);
      return mesh;
    });
    const dummy = new THREE.Object3D();
    const counts = new Uint32Array(FRUITS.length);
    const colorScratch = new THREE.Color();

    function resize(nextWidth, nextHeight) {
      const w = Math.max(1, finite(nextWidth, WIDTH));
      const h = Math.max(1, finite(nextHeight, HEIGHT));
      const dpr = Math.min(MAX_DPR, Math.max(1, globalThis.devicePixelRatio || 1));
      if (w === width && h === height && dpr === pixelRatio) return;
      width = w;
      height = h;
      pixelRatio = dpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      const scale = Math.min(w / WIDTH, h / HEIGHT);
      const viewWidth = w / scale;
      const viewHeight = h / scale;
      camera.left = (WIDTH - viewWidth) / 2;
      camera.right = (WIDTH + viewWidth) / 2;
      camera.top = (HEIGHT + viewHeight) / 2;
      camera.bottom = (HEIGHT - viewHeight) / 2;
      camera.updateProjectionMatrix();
      particleMaterial.uniforms.uScale.value = scale * dpr;
    }

    function render(frame) {
      if (disposed || lost) return;
      counts.fill(0);
      let total = 0;
      for (const fruit of frame.fruits) {
        if (!validFruit(fruit)) continue;
        counts[tierOf(fruit.tier)] += 1;
        total += 1;
      }
      for (const batch of batches.values()) batch.count = 0;
      for (let tier = 0; tier < counts.length; tier += 1) {
        if (counts[tier]) batchFor(tier, counts[tier]);
      }
      if (total > shadowCapacity) {
        removeInstances(shadows);
        shadowCapacity = capacityFor(total);
        shadows = makeInstances(plane, shadowMaterial, shadowCapacity, -10);
      }
      if (frame.removeMode && total > removalCapacity) {
        removeInstances(removalRings);
        removalCapacity = capacityFor(total);
        removalRings = makeInstances(ringGeometry, removalMaterial, removalCapacity, 22);
      }
      let index = 0;
      for (const fruit of frame.fruits) {
        if (!validFruit(fruit)) continue;
        const tier = tierOf(fruit.tier);
        const radius = radiusOf(tier);
        const batch = batches.get(tier);
        dummy.position.set(fruit.x, HEIGHT - fruit.y, 20);
        dummy.rotation.set(0, 0, -finite(fruit.angle, 0));
        dummy.scale.setScalar(radius);
        dummy.updateMatrix();
        batch.body.setMatrixAt(batch.count, dummy.matrix);
        batch.crown.setMatrixAt(batch.count, dummy.matrix);
        batch.count += 1;
        dummy.position.set(fruit.x + 3, HEIGHT - fruit.y - 5, -75);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(radius * 1.10, radius * 1.06, 1);
        dummy.updateMatrix();
        shadows.setMatrixAt(index, dummy.matrix);
        if (frame.removeMode) {
          dummy.position.set(fruit.x, HEIGHT - fruit.y, 105);
          dummy.scale.set(radius + 3, radius + 3, 1);
          dummy.updateMatrix();
          removalRings.setMatrixAt(index, dummy.matrix);
        }
        index += 1;
      }
      for (const batch of batches.values()) {
        batch.body.count = batch.count;
        batch.crown.count = batch.count;
        batch.body.instanceMatrix.needsUpdate = true;
        batch.crown.instanceMatrix.needsUpdate = true;
      }
      shadows.count = index;
      shadows.instanceMatrix.needsUpdate = true;
      removalRings.count = frame.removeMode ? index : 0;
      removalRings.instanceMatrix.needsUpdate = true;
      removalMaterial.opacity = reducedMotion ? 0.45 : 0.44 + Math.sin(frame.time * 0.004) * 0.07;
      preview.visible = frame.showAim;
      if (frame.showAim) {
        if (previewTier !== frame.tier) {
          previewBody.material = materialFor(frame.tier);
          previewCrown.geometry = crownFor(frame.tier);
          previewTier = frame.tier;
        }
        preview.position.set(frame.x, HEIGHT - SPAWN_Y, 22);
        preview.scale.setScalar(frame.radius);
        const start = SPAWN_Y + frame.radius + 6;
        aimLine.visible = frame.landing > start + 4;
        aimPositions.set([frame.x, HEIGHT - start, 110, frame.x, HEIGHT - frame.landing, 110]);
        aimGeometry.attributes.position.needsUpdate = true;
        aimDistances.setX(1, Math.abs(frame.landing - start));
        aimDistances.needsUpdate = true;
        landing.visible = frame.landing > SPAWN_Y + frame.radius * 1.5;
        landing.position.set(frame.x, HEIGHT - frame.landing, 108);
        landing.scale.set(frame.radius, frame.radius, 1);
      } else {
        aimLine.visible = false;
        landing.visible = false;
      }

      effects.particles.forEach((particle, particleIndex) => {
        const sample = particleAt(particle, frame.time);
        particlePositions.set([sample.x, HEIGHT - sample.y, 120], particleIndex * 3);
        colorScratch.set(particle.color);
        particleColors.set([colorScratch.r, colorScratch.g, colorScratch.b], particleIndex * 3);
        particleSizes[particleIndex] = sample.size;
        particleAlphas[particleIndex] = sample.opacity;
      });
      particleGeometry.setDrawRange(0, effects.particles.length);
      for (const attribute of Object.values(particleGeometry.attributes)) attribute.needsUpdate = true;
      for (let i = 0; i < effectRings.length; i += 1) {
        const mesh = effectRings[i];
        const ring = effects.rings[i];
        mesh.visible = Boolean(ring);
        if (!ring) continue;
        const t = Math.min(1, Math.max(0, (frame.time - ring.start) / ring.life));
        const radius = ring.radius + (1 - (1 - t) ** 2) * ring.spread;
        mesh.position.set(ring.x, HEIGHT - ring.y, 118);
        mesh.scale.set(radius, radius, 1);
        mesh.material.color.set(ring.color);
        mesh.material.opacity = ring.opacity * (1 - t) ** 2;
      }
      renderer.render(scene, camera);
    }

    canvas.addEventListener('webglcontextlost', contextLost, false);
    canvas.addEventListener('webglcontextrestored', contextRestored, false);
    return { kind: 'webgl', resize, render, dispose: cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function canvasSurface(canvas) {
  let context;
  try { context = canvas.getContext('2d', { alpha: true }); } catch { /* WebGL may own this canvas. */ }
  if (context) return { canvas, context, sync() {}, dispose() {} };

  // A driver can fail after claiming the original canvas for WebGL. Keep that
  // element (and its input listeners) intact and put a pointer-transparent 2D
  // surface above it. The ordinary unsupported-WebGL path needs no extra node.
  const surface = document.createElement('canvas');
  const parent = canvas.offsetParent || canvas.parentElement;
  if (!parent) throw new Error('A mounted canvas is required for the 2D fallback.');
  surface.setAttribute('aria-hidden', 'true');
  surface.style.cssText = 'position:absolute;pointer-events:none;background:transparent;';
  const opacity = canvas.style.opacity;
  canvas.style.opacity = '0';
  // Keep it below the existing HTML pause screen, danger line and tool hints.
  // The source element remains the sole pointer/focus/ResizeObserver target.
  canvas.insertAdjacentElement('afterend', surface);
  context = surface.getContext('2d', { alpha: true });
  if (!context) {
    surface.remove();
    canvas.style.opacity = opacity;
    throw new Error('Neither WebGL nor Canvas 2D is available.');
  }
  return {
    canvas: surface,
    context,
    sync() {
      const rect = canvas.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      surface.style.left = `${rect.left - parentRect.left + parent.scrollLeft - parent.clientLeft}px`;
      surface.style.top = `${rect.top - parentRect.top + parent.scrollTop - parent.clientTop}px`;
      surface.style.width = `${rect.width}px`;
      surface.style.height = `${rect.height}px`;
    },
    dispose() {
      surface.remove();
      canvas.style.opacity = opacity;
    },
  };
}

function makeCanvas(canvas, effects, reducedMotion) {
  const surface = canvasSurface(canvas);
  const context = surface.context;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  const shadow = document.createElement('canvas');
  shadow.width = 64;
  shadow.height = 64;
  const shadowContext = shadow.getContext('2d');
  if (shadowContext) {
    const gradient = shadowContext.createRadialGradient(32, 32, 2, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(62,85,43,0.15)');
    gradient.addColorStop(0.55, 'rgba(62,85,43,0.065)');
    gradient.addColorStop(1, 'rgba(62,85,43,0)');
    shadowContext.fillStyle = gradient;
    shadowContext.fillRect(0, 0, 64, 64);
  }

  function resize(nextWidth, nextHeight) {
    const w = Math.max(1, finite(nextWidth, WIDTH));
    const h = Math.max(1, finite(nextHeight, HEIGHT));
    const dpr = Math.min(MAX_DPR, Math.max(1, globalThis.devicePixelRatio || 1));
    surface.sync();
    if (w === width && h === height && dpr === pixelRatio) return;
    width = w;
    height = h;
    pixelRatio = dpr;
    surface.canvas.width = Math.max(1, Math.round(w * dpr));
    surface.canvas.height = Math.max(1, Math.round(h * dpr));
    scale = Math.min(w / WIDTH, h / HEIGHT);
    offsetX = (w - WIDTH * scale) / 2;
    offsetY = (h - HEIGHT * scale) / 2;
  }

  function drawFruit(tier, x, y, angle = 0) {
    const radius = radiusOf(tier);
    const size = radius * 2 * FRUIT_SPRITE_SCALE;
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.drawImage(fruitSprite(tier), -size / 2, -size / 2, size, size);
    context.restore();
  }

  function render(frame) {
    surface.sync();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    context.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, pixelRatio * offsetX, pixelRatio * offsetY);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.fillStyle = 'rgba(206,225,183,0.08)';
    context.fillRect(LEFT, 104, RIGHT - LEFT, BOTTOM - 104);
    for (const fruit of frame.fruits) {
      if (!validFruit(fruit)) continue;
      const radius = radiusOf(fruit.tier);
      context.drawImage(shadow, fruit.x - radius * 1.12 + 3, fruit.y - radius * 1.12 + 5, radius * 2.24, radius * 2.24);
    }
    if (frame.showAim) {
      const start = SPAWN_Y + frame.radius + 6;
      context.strokeStyle = 'rgba(125,153,96,0.52)';
      context.lineWidth = 1.2;
      context.setLineDash([4, 6]);
      if (frame.landing > start + 4) {
        context.beginPath();
        context.moveTo(frame.x, start);
        context.lineTo(frame.x, frame.landing);
        context.stroke();
      }
      context.setLineDash([]);
      if (frame.landing > SPAWN_Y + frame.radius * 1.5) {
        context.strokeStyle = 'rgba(135,163,104,0.25)';
        context.beginPath();
        context.arc(frame.x, frame.landing, frame.radius, 0, TAU);
        context.stroke();
      }
    }
    for (const fruit of frame.fruits) {
      if (validFruit(fruit)) drawFruit(tierOf(fruit.tier), fruit.x, fruit.y, finite(fruit.angle, 0));
    }
    if (frame.showAim) drawFruit(frame.tier, frame.x, SPAWN_Y);

    const floor = context.createLinearGradient(0, BOTTOM, 0, BOTTOM + 14);
    floor.addColorStop(0, '#d5e2b9');
    floor.addColorStop(1, '#abc48e');
    context.fillStyle = floor;
    context.fillRect(8, BOTTOM, WIDTH - 16, 13);
    context.lineCap = 'round';
    context.lineWidth = 7;
    context.strokeStyle = 'rgba(167,195,143,0.36)';
    for (const x of [LEFT - 4, RIGHT + 4]) {
      context.beginPath();
      context.moveTo(x, 104);
      context.lineTo(x, BOTTOM + 5);
      context.stroke();
    }
    context.lineWidth = 1.5;
    context.strokeStyle = 'rgba(135,167,111,0.67)';
    for (const x of [LEFT - 4, RIGHT + 4]) {
      context.beginPath();
      context.moveTo(x, 104);
      context.lineTo(x, BOTTOM + 6);
      context.stroke();
    }
    context.strokeStyle = 'rgba(255,253,238,0.85)';
    context.beginPath();
    context.moveTo(12, BOTTOM + 1.5);
    context.lineTo(WIDTH - 12, BOTTOM + 1.5);
    context.stroke();
    for (const x of [LEFT - 6, RIGHT + 2]) {
      context.beginPath();
      context.moveTo(x, 106);
      context.lineTo(x, BOTTOM - 3);
      context.stroke();
    }
    if (frame.removeMode) {
      const opacity = reducedMotion ? 0.45 : 0.44 + Math.sin(frame.time * 0.004) * 0.07;
      context.strokeStyle = `rgba(209,124,113,${opacity})`;
      context.lineWidth = 1.6;
      for (const fruit of frame.fruits) {
        if (!validFruit(fruit)) continue;
        context.beginPath();
        context.arc(fruit.x, fruit.y, radiusOf(fruit.tier) + 3, 0, TAU);
        context.stroke();
      }
    }
    for (const ring of effects.rings) {
      const t = Math.min(1, Math.max(0, (frame.time - ring.start) / ring.life));
      context.globalAlpha = ring.opacity * (1 - t) ** 2;
      context.strokeStyle = ring.color;
      context.lineWidth = 1.3;
      context.beginPath();
      context.arc(ring.x, ring.y, ring.radius + (1 - (1 - t) ** 2) * ring.spread, 0, TAU);
      context.stroke();
    }
    for (const particle of effects.particles) {
      const sample = particleAt(particle, frame.time);
      context.globalAlpha = sample.opacity;
      context.fillStyle = particle.color;
      context.beginPath();
      context.arc(sample.x, sample.y, sample.size, 0, TAU);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  return {
    kind: 'canvas', resize, render,
    dispose() {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
      surface.dispose();
      shadow.width = 0;
      shadow.height = 0;
    },
  };
}

/**
 * Rendering only: never steps Matter, mutates state or starts an animation loop.
 * All coordinates and angles use the core's y-down world; `time` is performance.now().
 */
export function createFruitRenderer(canvas, {
  reducedMotion = false,
  onContextLost = () => {},
  onContextRestored = () => {},
} = {}) {
  const effects = makeEffects(reducedMotion);
  let backend;
  let disposed = false;
  let requestedWidth = WIDTH;
  let requestedHeight = HEIGHT;
  try {
    backend = makeWebGL(canvas, effects, reducedMotion, { onContextLost, onContextRestored });
  } catch {
    backend = makeCanvas(canvas, effects, reducedMotion);
  }

  function resize(width = requestedWidth, height = requestedHeight) {
    if (disposed) return;
    requestedWidth = Math.max(1, finite(width, WIDTH));
    requestedHeight = Math.max(1, finite(height, HEIGHT));
    backend.resize(requestedWidth, requestedHeight);
  }
  resize(canvas.clientWidth || WIDTH, canvas.clientHeight || HEIGHT);

  return {
    kind: backend.kind,
    resize,
    render(state, { aimX = 220, showAim = true, removeMode = false, time = 0 } = {}) {
      if (disposed) return;
      // CSS controls the stage. Also catch orientation changes and DPR changes
      // even when the caller has not yet delivered its ResizeObserver callback.
      backend.resize(canvas.clientWidth || requestedWidth, canvas.clientHeight || requestedHeight);
      const frame = frameFor(state, { aimX, showAim, removeMode, time });
      effects.prune(frame.time);
      backend.render(frame);
    },
    burst(event) {
      if (!disposed) effects.burst(event);
    },
    clearEffects() {
      effects.clear();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      effects.clear();
      backend.dispose();
    },
  };
}
