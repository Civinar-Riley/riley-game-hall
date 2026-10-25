import { FRUITS } from './core.js';

// The same painted skins and crowns are used by the 3D fruit, the UI and the
// Canvas fallback. Nothing is loaded from the network, including the faces.
const TAU = Math.PI * 2;
const SKIN_WIDTH = 512;
const SKIN_HEIGHT = 256;
const ICON_SIZE = 256;
const ICON_RADIUS = 108;
const skinCache = new Map();
const spriteCache = new Map();
const iconCache = new Map();
const artCache = new Map();

const leaf = (x, y, angle, length, width, color = '#4f893e') => ({
  x, y, angle: angle * Math.PI / 180, length, width, color,
});
const stem = (y, dx, dy, width = 0.026) => ({ x: 0, y, dx, dy, width });

const STYLES = [
  { color: '#db4563', face: '#532b37', stem: stem(0.81, 0.12, 0.23),
    leaves: [leaf(0.055, 0.88, 68, 0.29, 0.10)] },
  { color: '#f06469', face: '#63382f',
    leaves: [-100, -52, 0, 52, 100].map((a) => leaf(0, 0.76, a, a === 0 ? 0.27 : 0.30, 0.10, '#527f3a')) },
  { color: '#9671bc', face: '#fff5df', stem: stem(0.80, 0.07, 0.19),
    leaves: [leaf(0.01, 0.79, 62, 0.32, 0.14), leaf(-0.01, 0.83, -62, 0.20, 0.09)] },
  { color: '#f5a43b', face: '#75462a', stem: stem(0.87, 0.02, 0.11),
    leaves: [leaf(0, 0.86, -105, 0.15, 0.06), leaf(0, 0.86, 100, 0.15, 0.06), leaf(0.02, 0.86, 57, 0.23, 0.085)] },
  { color: '#ee8544', face: '#703e2a',
    leaves: [-113, -49, 49, 113].map((a) => leaf(0, 0.75, a, 0.33, 0.155, '#4b743c')) },
  { color: '#df5860', face: '#60372e', stem: stem(0.80, -0.04, 0.24, 0.032),
    leaves: [leaf(0.005, 0.85, 68, 0.35, 0.13, '#5b8c43')] },
  { color: '#c8cf67', face: '#5d6032', stem: stem(0.83, 0.04, 0.21, 0.030),
    leaves: [leaf(0.025, 0.85, 75, 0.32, 0.11, '#548344')] },
  { color: '#f2ada0', face: '#855047', stem: stem(0.85, 0.02, 0.12),
    leaves: [leaf(-0.035, 0.79, -61, 0.38, 0.12, '#60954f')] },
  { color: '#e4b957', face: '#74572e',
    leaves: [-48, -24, 0, 24, 48].map((a) => leaf(a / 600, 0.63, a, a === 0 ? 0.45 : 0.40, 0.080, a === 0 ? '#4e8545' : '#64954d')) },
  { color: '#b9cb86', face: '#566b3e', stem: stem(0.85, 0.10, 0.17, 0.037),
    leaves: [leaf(0.015, 0.90, -74, 0.17, 0.065, '#6c914c')] },
  { color: '#70aa4d', face: '#274b32', stem: stem(0.85, -0.08, 0.17, 0.027),
    leaves: [leaf(-0.025, 0.88, 66, 0.19, 0.075, '#4a803f')] },
];

function tierIndex(tier) {
  return Math.max(0, Math.min(STYLES.length - 1, Number.isFinite(tier) ? Math.trunc(tier) : 0));
}

function canvas2D(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is unavailable for fruit artwork.');
  return { canvas, context };
}

function randomSource(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function ellipse(context, x, y, rx, ry, color, rotation = 0) {
  context.fillStyle = color;
  context.beginPath();
  context.ellipse(x, y, rx, ry, rotation, 0, TAU);
  context.fill();
}

/** Shared, read-only dimensions for the physical-sized art. Tiers are 0–10. */
export function getFruitArt(tier) {
  const index = tierIndex(tier);
  if (!artCache.has(index)) {
    const style = STYLES[index];
    const supplied = FRUITS[index]?.color;
    const color = typeof supplied === 'number'
      ? `#${supplied.toString(16).padStart(6, '0')}`
      : typeof supplied === 'string' ? supplied : style.color;
    artCache.set(index, Object.freeze({
      ...style,
      tier: index,
      color,
      depth: 0.72,
      leaves: Object.freeze(style.leaves.map((item) => Object.freeze({ ...item }))),
      stem: style.stem ? Object.freeze({ ...style.stem }) : null,
    }));
  }
  return artCache.get(index);
}

function paintSpeckles(context, random, count, color, size = 1) {
  context.fillStyle = color;
  for (let i = 0; i < count; i += 1) {
    const x = random() * SKIN_WIDTH;
    const y = random() * SKIN_HEIGHT;
    const r = size * (0.35 + random() * 0.65);
    context.beginPath();
    context.ellipse(x, y, r, r * 0.72, 0, 0, TAU);
    context.fill();
  }
}

function paintStripes(context, count, color, width, waviness = 3) {
  context.fillStyle = color;
  const spacing = SKIN_WIDTH / count;
  for (let stripe = -1; stripe <= count; stripe += 1) {
    const center = stripe * spacing + 9;
    context.beginPath();
    for (let y = 0; y <= SKIN_HEIGHT; y += 4) {
      const wave = Math.sin(y * 0.038 + stripe * 1.9) * waviness
        + Math.sin(y * 0.091 + stripe) * waviness * 0.25;
      const halfWidth = width * (0.43 + 0.07 * Math.sin(y * 0.057 + stripe));
      const x = center + wave - halfWidth;
      if (y === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    for (let y = SKIN_HEIGHT; y >= 0; y -= 4) {
      const wave = Math.sin(y * 0.038 + stripe * 1.9) * waviness
        + Math.sin(y * 0.091 + stripe) * waviness * 0.25;
      const halfWidth = width * (0.43 + 0.07 * Math.sin(y * 0.057 + stripe));
      context.lineTo(center + wave + halfWidth, y);
    }
    context.closePath();
    context.fill();
  }
}

function paintLattice(context, melon) {
  const spacing = melon ? 24 : 34;
  context.lineCap = 'round';
  for (const slope of [-0.78, 0.78]) {
    for (let start = -SKIN_HEIGHT; start < SKIN_WIDTH + SKIN_HEIGHT; start += spacing) {
      context.beginPath();
      for (let y = 0; y <= SKIN_HEIGHT; y += 4) {
        const drift = melon ? Math.sin(y * 0.13 + start) * 2.0 + Math.cos(y * 0.047) * 1.5 : 0;
        const x = start + y * slope + drift;
        if (y === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = melon ? 'rgba(89,116,55,0.12)' : 'rgba(138,91,26,0.30)';
      context.lineWidth = melon ? 2.8 : 3.1;
      context.stroke();
      context.strokeStyle = melon ? 'rgba(244,242,194,0.73)' : 'rgba(255,225,137,0.70)';
      context.lineWidth = melon ? 1.25 : 1.15;
      context.stroke();
    }
  }
  if (!melon) {
    for (let row = 0; row < 12; row += 1) {
      for (let column = 0; column < 16; column += 1) {
        const x = column * 34 + (row % 2) * 17;
        const y = row * 21.8 + 10;
        ellipse(context, x, y, 1.6, 2.5, 'rgba(139,94,28,0.27)');
        ellipse(context, x - 0.6, y - 1.4, 1.2, 0.7, 'rgba(255,236,165,0.58)');
      }
    }
  }
}

function paintFace(context, tier) {
  const art = getFruitArt(tier);
  context.save();
  // SphereGeometry's front meridian is u = 1/4. The face is painted onto the
  // skin, rather than billboarded, so the complete fruit rotates as one object.
  context.translate(SKIN_WIDTH * 0.25, SKIN_HEIGHT * 0.535);
  context.scale(SKIN_WIDTH / TAU, SKIN_HEIGHT / Math.PI);
  if (tier === 10) {
    const patch = context.createRadialGradient(0, 0.04, 0, 0, 0.04, 0.47);
    patch.addColorStop(0, 'rgba(184,213,105,0.35)');
    patch.addColorStop(1, 'rgba(184,213,105,0)');
    ellipse(context, 0, 0.04, 0.47, 0.37, patch);
  }
  const blush = tier === 2 ? 'rgba(241,184,212,0.40)' : 'rgba(233,109,105,0.30)';
  ellipse(context, -0.30, 0.075, 0.075, 0.038, blush);
  ellipse(context, 0.30, 0.075, 0.075, 0.038, blush);
  const eyeRadius = tier < 3 ? 0.043 : 0.037;
  for (const x of [-0.175, 0.175]) {
    ellipse(context, x, -0.020, eyeRadius, eyeRadius * 1.16, art.face);
    if (tier !== 2) ellipse(context, x - 0.010, -0.035, 0.010, 0.012, 'rgba(255,248,224,0.82)');
  }
  context.strokeStyle = art.face;
  context.lineWidth = 0.024;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(-0.068, 0.079);
  context.quadraticCurveTo(0, tier === 10 ? 0.18 : 0.151, 0.068, 0.079);
  context.stroke();
  context.restore();
}

/** A cached, unshaded equirectangular canvas for a Three.js CanvasTexture. */
export function fruitTexture(tier) {
  const index = tierIndex(tier);
  if (skinCache.has(index)) return skinCache.get(index);
  const { canvas, context } = canvas2D(SKIN_WIDTH, SKIN_HEIGHT);
  const art = getFruitArt(index);
  const random = randomSource(1517 + index * 367);
  context.fillStyle = art.color;
  context.fillRect(0, 0, SKIN_WIDTH, SKIN_HEIGHT);

  const warmth = context.createLinearGradient(0, 0, 0, SKIN_HEIGHT);
  warmth.addColorStop(0, 'rgba(255,232,160,0.12)');
  warmth.addColorStop(0.5, 'rgba(255,243,204,0)');
  warmth.addColorStop(1, 'rgba(96,67,43,0.045)');
  context.fillStyle = warmth;
  context.fillRect(0, 0, SKIN_WIDTH, SKIN_HEIGHT);

  switch (index) {
    case 0:
      paintStripes(context, 4, 'rgba(138,34,64,0.09)', 23, 5);
      paintSpeckles(context, random, 95, 'rgba(255,212,206,0.22)', 0.7);
      break;
    case 1:
      for (let row = 0; row < 8; row += 1) {
        for (let column = 0; column < 18; column += 1) {
          const x = (column + 0.5 * (row % 2)) * SKIN_WIDTH / 18 + 6;
          const y = row * SKIN_HEIGHT / 8 + 15 + random() * 5;
          ellipse(context, x, y + 0.8, 2.2, 3.7, 'rgba(144,48,47,0.20)', 0.18);
          ellipse(context, x - 0.4, y - 0.5, 1.45, 2.8, '#ffe4a7', 0.18);
        }
      }
      break;
    case 2:
      for (let row = -1; row < 7; row += 1) {
        for (let column = -1; column < 14; column += 1) {
          const x = column * 42 + (row % 2) * 21;
          const y = row * 39 + 12;
          const grape = context.createRadialGradient(x - 7, y - 9, 2, x, y, 23);
          grape.addColorStop(0, 'rgba(223,186,238,0.46)');
          grape.addColorStop(0.63, 'rgba(166,122,199,0.10)');
          grape.addColorStop(1, 'rgba(87,52,132,0.35)');
          ellipse(context, x, y, 20.5, 21, grape);
        }
      }
      break;
    case 3:
      paintSpeckles(context, random, 1700, 'rgba(177,101,30,0.15)', 1.0);
      paintSpeckles(context, random, 950, 'rgba(255,229,162,0.42)', 0.70);
      break;
    case 4:
      paintStripes(context, 5, 'rgba(188,81,28,0.10)', 6, 1.2);
      paintSpeckles(context, random, 200, 'rgba(255,216,143,0.22)', 0.7);
      break;
    case 5:
      paintStripes(context, 14, 'rgba(255,185,135,0.09)', 3.5, 6);
      paintSpeckles(context, random, 230, 'rgba(255,225,180,0.48)', 0.9);
      break;
    case 6:
      paintSpeckles(context, random, 850, 'rgba(117,113,40,0.32)', 0.9);
      paintSpeckles(context, random, 300, 'rgba(255,244,183,0.50)', 0.75);
      break;
    case 7: {
      const blush = context.createRadialGradient(163, 132, 6, 163, 132, 85);
      blush.addColorStop(0, 'rgba(235,115,131,0.47)');
      blush.addColorStop(1, 'rgba(243,160,156,0)');
      context.fillStyle = blush;
      context.fillRect(0, 0, SKIN_WIDTH, SKIN_HEIGHT);
      context.strokeStyle = 'rgba(166,89,71,0.27)';
      context.lineWidth = 1.7;
      context.beginPath();
      context.moveTo(128, 28);
      context.bezierCurveTo(111, 100, 118, 180, 131, 232);
      context.stroke();
      paintSpeckles(context, random, 950, 'rgba(255,237,209,0.22)', 0.55);
      break;
    }
    case 8:
      paintLattice(context, false);
      break;
    case 9:
      paintStripes(context, 10, 'rgba(115,145,66,0.10)', 9, 0.6);
      paintLattice(context, true);
      break;
    case 10:
      paintStripes(context, 9, '#367947', 27, 3.2);
      paintStripes(context, 9, 'rgba(29,95,54,0.17)', 8, 3.2);
      paintSpeckles(context, random, 800, 'rgba(219,232,145,0.14)', 0.8);
      break;
    default:
      break;
  }
  paintFace(context, index);
  skinCache.set(index, canvas);
  return canvas;
}

function paintCrown(context, art, center, radius) {
  context.save();
  context.translate(center, center);
  if (art.stem) {
    const s = art.stem;
    context.lineCap = 'round';
    context.strokeStyle = '#806244';
    context.lineWidth = radius * s.width;
    context.beginPath();
    context.moveTo(s.x * radius, -s.y * radius);
    context.quadraticCurveTo((s.x + s.dx * 0.2) * radius, -(s.y + s.dy * 0.8) * radius,
      (s.x + s.dx) * radius, -(s.y + s.dy) * radius);
    context.stroke();
  }
  for (const item of art.leaves) {
    context.save();
    context.translate(item.x * radius, -item.y * radius);
    context.rotate(item.angle);
    const length = item.length * radius;
    const width = item.width * radius;
    context.fillStyle = item.color;
    context.beginPath();
    context.moveTo(0, 0);
    context.bezierCurveTo(-width, -length * 0.32, -width * 0.75, -length * 0.78, 0, -length);
    context.bezierCurveTo(width * 0.75, -length * 0.78, width, -length * 0.32, 0, 0);
    context.fill();
    context.strokeStyle = 'rgba(209,229,147,0.50)';
    context.lineWidth = Math.max(0.6, radius * 0.008);
    context.beginPath();
    context.moveTo(0, -length * 0.1);
    context.lineTo(0, -length * 0.87);
    context.stroke();
    context.restore();
  }
  context.restore();
}

/** Cached high-resolution sprite; also makes the non-WebGL fallback inexpensive. */
export function fruitSprite(tier) {
  const index = tierIndex(tier);
  if (spriteCache.has(index)) return spriteCache.get(index);
  const source = fruitTexture(index).getContext('2d').getImageData(0, 0, SKIN_WIDTH, SKIN_HEIGHT).data;
  const { canvas, context } = canvas2D(ICON_SIZE, ICON_SIZE);
  const image = context.createImageData(ICON_SIZE, ICON_SIZE);
  const target = image.data;
  const center = ICON_SIZE / 2;

  // Orthographic ray projection of the skin. The tiny UI icons therefore agree
  // with their 3D counterparts without shipping an image or spinning up WebGL.
  for (let y = 0; y < ICON_SIZE; y += 1) {
    for (let x = 0; x < ICON_SIZE; x += 1) {
      const nx = (x + 0.5 - center) / ICON_RADIUS;
      const ny = (center - y - 0.5) / ICON_RADIUS;
      const distance = Math.hypot(nx, ny);
      if (distance >= 1 + 0.5 / ICON_RADIUS) continue;
      const edgeScale = distance > 1 ? 1 / distance : 1;
      const sx = nx * edgeScale;
      const sy = ny * edgeScale;
      const nz = Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy));
      const u = (Math.atan2(nz, -sx) / TAU + 1) % 1;
      const v = Math.acos(Math.max(-1, Math.min(1, sy))) / Math.PI;
      const tx = u * SKIN_WIDTH;
      const ty = Math.min(SKIN_HEIGHT - 1.001, v * SKIN_HEIGHT);
      const ix = Math.floor(tx) % SKIN_WIDTH;
      const iy = Math.floor(ty);
      const fx = tx - Math.floor(tx);
      const fy = ty - iy;
      const a = (iy * SKIN_WIDTH + ix) * 4;
      const b = (iy * SKIN_WIDTH + (ix + 1) % SKIN_WIDTH) * 4;
      const c = a + SKIN_WIDTH * 4;
      const d = b + SKIN_WIDTH * 4;
      const lambert = Math.max(0, -sx * 0.42 + sy * 0.62 + nz * 0.66);
      const shade = 0.72 + lambert * 0.31 - Math.max(0, -sy) * 0.035;
      const sheen = Math.pow(Math.max(0, -sx * 0.22 + sy * 0.33 + nz * 0.918), 24) * 12;
      const offset = (y * ICON_SIZE + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const top = source[a + channel] * (1 - fx) + source[b + channel] * fx;
        const bottom = source[c + channel] * (1 - fx) + source[d + channel] * fx;
        target[offset + channel] = Math.min(255, (top * (1 - fy) + bottom * fy) * shade + sheen);
      }
      target[offset + 3] = Math.round(Math.max(0, Math.min(1, (1 - distance) * ICON_RADIUS + 0.5)) * 255);
    }
  }
  context.putImageData(image, 0, 0);
  paintCrown(context, getFruitArt(index), center, ICON_RADIUS);
  spriteCache.set(index, canvas);
  return canvas;
}

/** A synchronous, cached PNG data URL for current/next fruit and the 11-tier atlas. */
export function fruitIcon(tier) {
  const index = tierIndex(tier);
  if (!iconCache.has(index)) iconCache.set(index, fruitSprite(index).toDataURL('image/png'));
  return iconCache.get(index);
}

// The transparent margin includes the modest stems/crowns, not the physics body.
export const FRUIT_SPRITE_SCALE = ICON_SIZE / (ICON_RADIUS * 2);
