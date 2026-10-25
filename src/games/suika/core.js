import Matter from 'matter-js';

const { Bodies, Body, Composite, Engine } = Matter;

export const WORLD = Object.freeze({
  width: 440, height: 620, left: 16, right: 424, bottom: 600, dangerY: 126, spawnY: 58,
});

export const FRUITS = Object.freeze([
  { name: '樱桃', radius: 13, color: '#e6485e' },
  { name: '草莓', radius: 18, color: '#fb5b75' },
  { name: '葡萄', radius: 24, color: '#9366c9' },
  { name: '柑橘', radius: 30, color: '#ffad46' },
  { name: '柿子', radius: 37, color: '#f78341' },
  { name: '苹果', radius: 44, color: '#ed5b45' },
  { name: '梨', radius: 52, color: '#ced45f' },
  { name: '桃子', radius: 61, color: '#ffa0a2' },
  { name: '菠萝', radius: 70, color: '#e8be47' },
  { name: '蜜瓜', radius: 81, color: '#9dce77' },
  { name: '西瓜', radius: 94, color: '#43ad73' },
].map(Object.freeze));

const STEP_MS = 1000 / 60;
const MAX_STEPS = 6;
const DROP_COOLDOWN_MS = 400;
const DROP_GRACE_MS = 1500;
const DANGER_LIMIT_MS = 3000;
const COLLISION_COOLDOWN_MS = 140;
const MAX_SPEED = 12; // Matter velocities are pixels per base (60 Hz) tick.
const MAX_ANGULAR_SPEED = 0.15;
const MAX_FRUITS = 256;
const MAX_AGE_MS = 1_000_000_000;
const MAX_SAVED_ID = 1_000_000_000;
const EPSILON = 1e-7;
const TAU = Math.PI * 2;
const PHASES = new Set(['ready', 'playing', 'paused', 'over']);

const finite = value => typeof value === 'number' && Number.isFinite(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = (value, min, max, fallback = min) => finite(value) ? clamp(value, min, max) : fallback;
const integer = (value, min, max, fallback = min) => Math.floor(number(value, min, max, fallback));
const validTier = (value, max = FRUITS.length - 1) => Number.isInteger(value) && value >= 0 && value <= max;
const remaining = (value, elapsed) => value - elapsed <= EPSILON ? 0 : value - elapsed;
const scoreFor = tier => (tier + 1) * (tier + 2) / 2;

function boundedVelocity(vx, vy) {
  const x = number(vx, -MAX_SPEED, MAX_SPEED, 0);
  const y = number(vy, -MAX_SPEED, MAX_SPEED, 0);
  const scale = Math.min(1, MAX_SPEED / (Math.hypot(x, y) || 1));
  return { x: x * scale, y: y * scale };
}

// Validate the envelope before salvaging individual values. Never import another
// mode's score, tools or fruit. Broken optional counters cannot refill tools.
function restoreSnapshot(input, mode) {
  try {
    if (!object(input) || input.version !== 1 || input.mode !== mode ||
        !PHASES.has(input.phase) || !Array.isArray(input.fruits) ||
        !validTier(input.current, 4) || !validTier(input.next, 4)) return null;

    const fruits = [];
    const ids = new Set();
    let repairId = 1;
    for (const value of input.fruits.slice(0, MAX_FRUITS)) {
      if (!object(value) || !validTier(value.tier) || !finite(value.x) || !finite(value.y)) continue;
      // Collection mode never persists a watermelon: it was already collected.
      if (mode === 'collect' && value.tier === FRUITS.length - 1) continue;
      let id = value.id;
      if (!Number.isInteger(id) || id < 1 || id > MAX_SAVED_ID || ids.has(id)) {
        while (ids.has(repairId)) repairId++;
        id = repairId++;
      }
      ids.add(id);
      const radius = FRUITS[value.tier].radius;
      const x = clamp(value.x, WORLD.left + radius, WORLD.right - radius);
      const y = clamp(value.y, -WORLD.height, WORLD.bottom - radius);
      const ageMs = number(value.ageMs, 0, MAX_AGE_MS, DROP_GRACE_MS);
      const velocity = boundedVelocity(value.vx, value.vy);
      fruits.push({
        id, tier: value.tier, x, y,
        angle: finite(value.angle) ? value.angle % TAU : 0,
        vx: velocity.x, vy: velocity.y,
        angularVelocity: number(value.angularVelocity, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED, 0),
        ageMs,
        entered: value.entered === true || y - radius >= WORLD.dangerY,
        graceMs: number(value.graceMs, 0, Math.max(0, DROP_GRACE_MS - ageMs), 0),
      });
    }
    return {
      phase: input.phase === 'over' ? 'over' : 'paused',
      score: integer(input.score, 0, Number.MAX_SAFE_INTEGER),
      watermelons: integer(input.watermelons, 0, Number.MAX_SAFE_INTEGER),
      current: input.current,
      next: input.next,
      tools: {
        remove: integer(input.tools?.remove, 0, 2),
        shake: integer(input.tools?.shake, 0, 1),
      },
      dangerMs: number(input.dangerMs, 0, DANGER_LIMIT_MS, input.phase === 'over' ? DANGER_LIMIT_MS : 0),
      cooldownMs: number(input.cooldownMs, 0, DROP_COOLDOWN_MS),
      collisionCooldownMs: number(input.collisionCooldownMs, 0, COLLISION_COOLDOWN_MS),
      accumulatorMs: number(input.accumulatorMs, 0, STEP_MS - EPSILON),
      nextId: Math.max(integer(input.nextId, 1, MAX_SAVED_ID + 1), ...fruits.map(fruit => fruit.id + 1)),
      fruits,
    };
  } catch {
    // JSON values are usual, but even a damaged object/getter must not crash load.
    return null;
  }
}

export class FruitGame {
  #mode;
  #phase = 'ready';
  #score = 0;
  #watermelons = 0;
  #current;
  #next;
  #tools = { remove: 2, shake: 1 };
  #dangerMs = 0;
  #cooldownMs = 0;
  #collisionCooldownMs = 0;
  #accumulatorMs = 0;
  #nextId = 1;
  #fruits = new Map();
  #byBody = new Map();
  #engine;
  #random;
  #onEvent;
  #destroyed = false;
  #stepping = false;

  constructor(mode, { snapshot, random = Math.random, onEvent = () => {} } = {}) {
    if (mode !== 'classic' && mode !== 'collect') throw new TypeError('Unknown fruit game mode');
    this.#mode = mode;
    this.#random = typeof random === 'function' ? random : Math.random;
    this.#onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.#engine = Engine.create({ positionIterations: 10, velocityIterations: 8 });
    this.#engine.gravity.y = 1;
    this.#engine.gravity.scale = 0.001;

    // Walls extend above the visible playfield, but there is deliberately no lid.
    const wall = { isStatic: true, friction: 0.4, restitution: 0.05 };
    const wallTop = -WORLD.height * 2;
    const wallHeight = WORLD.bottom + 80 - wallTop;
    Composite.add(this.#engine.world, [
      Bodies.rectangle(WORLD.left - 40, wallTop + wallHeight / 2, 80, wallHeight, wall),
      Bodies.rectangle(WORLD.right + 40, wallTop + wallHeight / 2, 80, wallHeight, wall),
      Bodies.rectangle(WORLD.width / 2, WORLD.bottom + 40, WORLD.width + 160, 80, wall),
    ]);

    const restored = restoreSnapshot(snapshot, mode);
    if (restored) {
      this.#phase = restored.phase;
      this.#score = restored.score;
      this.#watermelons = restored.watermelons;
      this.#current = restored.current;
      this.#next = restored.next;
      this.#tools = restored.tools;
      this.#dangerMs = restored.dangerMs;
      this.#cooldownMs = restored.cooldownMs;
      this.#collisionCooldownMs = restored.collisionCooldownMs;
      this.#accumulatorMs = restored.accumulatorMs;
      this.#nextId = restored.nextId;
      for (const fruit of restored.fruits) this.#addFruit(fruit);
      if (this.#phase !== 'over' && !this.#dangerousFruit()) this.#dangerMs = 0;
    } else {
      this.#current = this.#drawTier();
      this.#next = this.#drawTier();
    }
  }

  getState() {
    return {
      mode: this.#mode,
      phase: this.#phase,
      score: this.#score,
      watermelons: this.#watermelons,
      current: this.#current,
      next: this.#next,
      tools: { ...this.#tools },
      dangerMs: this.#dangerMs,
      cooldownMs: this.#cooldownMs,
      fruits: [...this.#fruits.values()].map(fruit => this.#fruitState(fruit)),
    };
  }

  snapshot() {
    return {
      version: 1,
      ...this.getState(),
      nextId: this.#nextId,
      accumulatorMs: this.#accumulatorMs,
      collisionCooldownMs: this.#collisionCooldownMs,
      fruits: [...this.#fruits.values()].map(fruit => ({
        ...this.#fruitState(fruit), ageMs: fruit.ageMs, entered: fruit.entered, graceMs: fruit.graceMs,
      })),
    };
  }

  start() {
    if (this.#destroyed || (this.#phase !== 'ready' && this.#phase !== 'paused')) return false;
    this.#phase = 'playing';
    return true;
  }

  pause() {
    if (this.#destroyed || this.#phase !== 'playing') return false;
    this.#phase = 'paused';
    return true;
  }

  drop(x) {
    if (this.#destroyed || this.#phase !== 'playing' || !finite(x) ||
        this.#cooldownMs > EPSILON || this.#fruits.size >= MAX_FRUITS) return false;
    const tier = this.#current;
    const radius = FRUITS[tier].radius;
    const fruit = this.#addFruit({
      id: this.#nextId++, tier,
      x: clamp(x, WORLD.left + radius, WORLD.right - radius), y: WORLD.spawnY,
      angle: 0, vx: 0, vy: 0, angularVelocity: 0, ageMs: 0, entered: false, graceMs: DROP_GRACE_MS,
    });
    this.#current = this.#next;
    this.#next = this.#drawTier();
    this.#cooldownMs = DROP_COOLDOWN_MS;
    this.#emit([{ type: 'drop', x: fruit.body.position.x, y: fruit.body.position.y, tier }]);
    return true;
  }

  step(dtMs) {
    if (this.#destroyed || this.#stepping || this.#phase !== 'playing' || !finite(dtMs) || dtMs <= 0) return false;
    // Discard excess wall-clock time, rather than simulating a tab suspension and
    // instantly losing. All gameplay clocks advance only with these fixed ticks.
    this.#accumulatorMs += Math.min(dtMs, STEP_MS * MAX_STEPS);
    this.#stepping = true;
    try {
      let steps = 0;
      while (this.#accumulatorMs + EPSILON >= STEP_MS && steps < MAX_STEPS &&
             !this.#destroyed && this.#phase === 'playing') {
        this.#accumulatorMs = Math.max(0, this.#accumulatorMs - STEP_MS);
        this.#tick();
        steps++;
      }
    } finally {
      this.#stepping = false;
    }
    return true;
  }

  removeAt(x, y) {
    if (this.#destroyed || this.#phase !== 'playing' || this.#tools.remove <= 0 || !finite(x) || !finite(y)) return false;
    let selected = null;
    let nearest = Infinity;
    for (const fruit of this.#fruits.values()) {
      const radius = FRUITS[fruit.tier].radius;
      const distance = ((fruit.body.position.x - x) ** 2 + (fruit.body.position.y - y) ** 2) / radius ** 2;
      if (distance <= 1 && distance <= nearest) {
        selected = fruit;
        nearest = distance;
      }
    }
    if (!selected) return false;
    const position = { ...selected.body.position };
    this.#deleteFruit(selected);
    this.#tools.remove--;
    if (!this.#dangerousFruit()) this.#dangerMs = 0;
    this.#emit([{ type: 'remove', ...position, tier: selected.tier }]);
    return true;
  }

  shake() {
    if (this.#destroyed || this.#phase !== 'playing' || this.#tools.shake <= 0 || !this.#fruits.size) return false;
    for (const fruit of this.#fruits.values()) {
      const body = fruit.body;
      const inward = (WORLD.width / 2 - body.position.x) / WORLD.width;
      Body.setVelocity(body, {
        x: clamp(body.velocity.x * 0.2 + (this.#unitRandom() - 0.5) * 5 + inward, -3.5, 3.5),
        y: -2.5 - this.#unitRandom() * 2,
      });
      Body.setAngularVelocity(body, (this.#unitRandom() - 0.5) * 0.12);
      this.#confine(fruit);
    }
    this.#tools.shake--;
    this.#emit([{ type: 'shake' }]);
    return true;
  }

  destroy() {
    if (this.#destroyed) return false;
    this.#destroyed = true;
    if (this.#phase === 'playing') this.#phase = 'paused';
    this.#onEvent = () => {};
    Composite.clear(this.#engine.world, false);
    Engine.clear(this.#engine);
    this.#fruits.clear();
    this.#byBody.clear();
    return true;
  }

  #unitRandom() {
    try {
      const value = this.#random();
      return finite(value) ? clamp(value, 0, 1 - Number.EPSILON) : 0;
    } catch {
      return 0;
    }
  }

  #drawTier() {
    const value = this.#unitRandom();
    // 38%, 28%, 18%, 11%, 5%; only the first five fruit can be dropped.
    return value < 0.38 ? 0 : value < 0.66 ? 1 : value < 0.84 ? 2 : value < 0.95 ? 3 : 4;
  }

  #fruitState(fruit) {
    const { id, tier, body } = fruit;
    return {
      id, tier, x: body.position.x, y: body.position.y, angle: body.angle,
      vx: body.velocity.x, vy: body.velocity.y, angularVelocity: body.angularVelocity,
    };
  }

  #addFruit(data) {
    const body = Bodies.circle(data.x, data.y, FRUITS[data.tier].radius, {
      density: 0.0015, friction: 0.35, frictionStatic: 0.7,
      frictionAir: 0.012, restitution: 0.08, slop: 0.01,
    }, 40);
    Body.setAngle(body, data.angle);
    Body.setVelocity(body, { x: data.vx, y: data.vy });
    Body.setAngularVelocity(body, data.angularVelocity);
    const fruit = {
      id: data.id, tier: data.tier, body,
      ageMs: data.ageMs, entered: data.entered, graceMs: data.graceMs,
    };
    this.#fruits.set(fruit.id, fruit);
    this.#byBody.set(body.id, fruit);
    Composite.add(this.#engine.world, body);
    return fruit;
  }

  #deleteFruit(fruit) {
    Composite.remove(this.#engine.world, fruit.body);
    this.#fruits.delete(fruit.id);
    this.#byBody.delete(fruit.body.id);
  }

  #confine(fruit) {
    const body = fruit.body;
    const radius = FRUITS[fruit.tier].radius;
    const x = clamp(body.position.x, WORLD.left + radius, WORLD.right - radius);
    const y = Math.min(body.position.y, WORLD.bottom - radius);
    const velocity = boundedVelocity(body.velocity.x, body.velocity.y);
    if (x !== body.position.x) velocity.x = x > body.position.x ? Math.max(0, velocity.x) : Math.min(0, velocity.x);
    if (y !== body.position.y) velocity.y = Math.min(0, velocity.y);
    if (x !== body.position.x || y !== body.position.y) Body.setPosition(body, { x, y });
    if (velocity.x !== body.velocity.x || velocity.y !== body.velocity.y) Body.setVelocity(body, velocity);
    if (Math.abs(body.angularVelocity) > MAX_ANGULAR_SPEED) {
      Body.setAngularVelocity(body, clamp(body.angularVelocity, -MAX_ANGULAR_SPEED, MAX_ANGULAR_SPEED));
    }
  }

  #dangerousFruit() {
    for (const fruit of this.#fruits.values()) {
      if ((fruit.entered || fruit.graceMs <= EPSILON) &&
          fruit.body.position.y - FRUITS[fruit.tier].radius < WORLD.dangerY) return fruit;
    }
    return null;
  }

  #tick() {
    const events = [];
    const previousVelocity = new Map();
    this.#cooldownMs = remaining(this.#cooldownMs, STEP_MS);
    this.#collisionCooldownMs = remaining(this.#collisionCooldownMs, STEP_MS);
    for (const fruit of this.#fruits.values()) {
      fruit.ageMs = Math.min(MAX_AGE_MS, fruit.ageMs + STEP_MS);
      fruit.graceMs = remaining(fruit.graceMs, STEP_MS);
      this.#confine(fruit);
      previousVelocity.set(fruit.body.id, { ...fruit.body.velocity });
    }
    Engine.update(this.#engine, STEP_MS);
    for (const fruit of this.#fruits.values()) {
      this.#confine(fruit);
      if (fruit.body.position.y - FRUITS[fruit.tier].radius >= WORLD.dangerY) fruit.entered = true;
    }

    // Decide all pairs from this tick's collision set before adding any new body.
    // Sorting by our own saved IDs also makes triple contacts deterministic.
    const contacts = [];
    for (const pair of this.#engine.pairs.list) {
      if (!pair.isActive) continue;
      const a = this.#byBody.get(pair.bodyA.id);
      const b = this.#byBody.get(pair.bodyB.id);
      if (a && b && a.tier === b.tier && a.tier < FRUITS.length - 1) {
        contacts.push(a.id < b.id ? [a, b] : [b, a]);
      }
    }
    contacts.sort((a, b) => a[0].id - b[0].id || a[1].id - b[1].id);
    const consumed = new Set();
    for (const [a, b] of contacts) {
      if (consumed.has(a.id) || consumed.has(b.id)) continue;
      consumed.add(a.id);
      consumed.add(b.id);
      const tier = a.tier + 1;
      const radius = FRUITS[tier].radius;
      const x = clamp((a.body.position.x + b.body.position.x) / 2, WORLD.left + radius, WORLD.right - radius);
      const y = Math.min((a.body.position.y + b.body.position.y) / 2, WORLD.bottom - radius);
      const collected = this.#mode === 'collect' && tier === FRUITS.length - 1;
      this.#deleteFruit(a);
      this.#deleteFruit(b);
      this.#score = Math.min(Number.MAX_SAFE_INTEGER, this.#score + scoreFor(tier));
      if (tier === FRUITS.length - 1) this.#watermelons = Math.min(Number.MAX_SAFE_INTEGER, this.#watermelons + 1);
      if (!collected) {
        this.#addFruit({
          id: this.#nextId++, tier, x, y,
          angle: (a.body.angle + b.body.angle) / 2,
          vx: (a.body.velocity.x + b.body.velocity.x) * 0.35,
          vy: (a.body.velocity.y + b.body.velocity.y) * 0.35,
          angularVelocity: (a.body.angularVelocity + b.body.angularVelocity) * 0.25,
          ageMs: 0,
          entered: a.entered || b.entered || y - radius >= WORLD.dangerY,
          // Merging cannot renew immunity for fruit already trapped at the top.
          graceMs: Math.min(a.graceMs, b.graceMs),
        });
      }
      events.push({ type: 'merge', x, y, tier, collected });
    }

    if (this.#collisionCooldownMs <= EPSILON) {
      let loudest = null;
      let speed = 1.2;
      for (const pair of this.#engine.pairs.collisionStart) {
        const a = this.#byBody.get(pair.bodyA.id);
        const b = this.#byBody.get(pair.bodyB.id);
        if ((!a && !pair.bodyA.isStatic) || (!b && !pair.bodyB.isStatic) || (!a && !b)) continue;
        const va = previousVelocity.get(pair.bodyA.id) || { x: 0, y: 0 };
        const vb = previousVelocity.get(pair.bodyB.id) || { x: 0, y: 0 };
        const impact = Math.hypot(va.x - vb.x, va.y - vb.y);
        if (impact <= speed) continue;
        speed = impact;
        const fruit = a || b;
        loudest = {
          type: 'collision',
          x: a && b ? (a.body.position.x + b.body.position.x) / 2 : fruit.body.position.x,
          y: a && b ? (a.body.position.y + b.body.position.y) / 2 : fruit.body.position.y,
          tier: Math.max(a?.tier ?? 0, b?.tier ?? 0),
        };
      }
      if (loudest) {
        this.#collisionCooldownMs = COLLISION_COOLDOWN_MS;
        events.push(loudest);
      }
    }

    const danger = this.#dangerousFruit();
    this.#dangerMs = danger ? Math.min(DANGER_LIMIT_MS, this.#dangerMs + STEP_MS) : 0;
    if (this.#dangerMs >= DANGER_LIMIT_MS - EPSILON) {
      this.#dangerMs = DANGER_LIMIT_MS;
      this.#phase = 'over';
      this.#accumulatorMs = 0;
      events.push({ type: 'over', x: danger.body.position.x, y: danger.body.position.y, tier: danger.tier });
    }
    // Notifications are emitted only after score, bodies, timers and phase commit.
    this.#emit(events);
  }

  #emit(events) {
    for (const event of events) {
      if (this.#destroyed) break;
      try {
        this.#onEvent(event);
      } catch {
        // A renderer/audio/storage observer must not interrupt the simulation.
      }
    }
  }
}
