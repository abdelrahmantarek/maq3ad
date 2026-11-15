import * as THREE from 'three';

/** Band between two concentric ellipses at (possibly) different heights. */
export function ellipseBand(
  a1: number, b1: number, y1: number,
  a2: number, b2: number, y2: number,
  t0 = 0, t1 = Math.PI * 2, segments = 160, uRepeat = 1,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const t = t0 + (t1 - t0) * f;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pos.push(a1 * c, y1, b1 * s, a2 * c, y2, b2 * s);
    uv.push(f * uRepeat, 0, f * uRepeat, 1);
  }
  for (let i = 0; i < segments; i++) {
    const k = i * 2;
    idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export const PITCH = { length: 105, width: 68 };

export function pitchTexture(): THREE.CanvasTexture {
  const scale = 16; // px per metre
  const marginX = 9;
  const marginZ = 7;
  const W = (PITCH.length + marginX * 2) * scale;
  const H = (PITCH.width + marginZ * 2) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1f7a3a';
  ctx.fillRect(0, 0, W, H);

  const ox = marginX * scale;
  const oz = marginZ * scale;
  const stripes = 18;
  const stripeW = (PITCH.length * scale) / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#2a9148' : '#237f3e';
    ctx.fillRect(ox + i * stripeW, oz, stripeW + 1, PITCH.width * scale);
  }

  const m = (v: number) => v * scale;
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = Math.max(2, m(0.14));
  const cx = ox + m(PITCH.length / 2);
  const cz = oz + m(PITCH.width / 2);

  ctx.strokeRect(ox, oz, m(PITCH.length), m(PITCH.width));
  ctx.beginPath();
  ctx.moveTo(cx, oz);
  ctx.lineTo(cx, oz + m(PITCH.width));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cz, m(9.15), 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cz, m(0.35), 0, Math.PI * 2);
  ctx.fill();

  for (const side of [0, 1]) {
    const dir = side === 0 ? 1 : -1;
    const gx = side === 0 ? ox : ox + m(PITCH.length);
    ctx.strokeRect(Math.min(gx, gx + dir * m(16.5)), cz - m(20.16), m(16.5), m(40.32));
    ctx.strokeRect(Math.min(gx, gx + dir * m(5.5)), cz - m(9.16), m(5.5), m(18.32));
    const spot = gx + dir * m(11);
    ctx.beginPath();
    ctx.arc(spot, cz, m(0.3), 0, Math.PI * 2);
    ctx.fill();
    const half = Math.acos(5.5 / 9.15);
    ctx.beginPath();
    if (side === 0) ctx.arc(spot, cz, m(9.15), -half, half);
    else ctx.arc(spot, cz, m(9.15), Math.PI - half, Math.PI + half);
    ctx.stroke();
  }
  for (const [x, z, start] of [
    [ox, oz, 0],
    [ox + m(PITCH.length), oz, Math.PI / 2],
    [ox + m(PITCH.length), oz + m(PITCH.width), Math.PI],
    [ox, oz + m(PITCH.width), (Math.PI * 3) / 2],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, z, m(1), start, start + Math.PI / 2);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function pitchPlaneSize(): [number, number] {
  return [PITCH.length + 18, PITCH.width + 14];
}

export function ledTexture(text: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '700 40px system-ui, "Segoe UI", Tahoma, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const slots = 4;
  for (let i = 0; i < slots; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#ffffff' : accent;
    ctx.fillText(text, (canvas.width / slots) * (i + 0.5), 34);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

export function facadeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#10151f';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8; i++) {
    const x = i * 32;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(120,200,255,0.05)');
    grad.addColorStop(0.5, 'rgba(120,200,255,0.55)');
    grad.addColorStop(1, 'rgba(120,200,255,0.08)');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 12, 14, 6, 228);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(40, 1);
  return tex;
}

export interface ScoreboardInfo {
  home: string;
  away: string;
  homeColor: string;
  awayColor: string;
}

export class Scoreboard {
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private lastMinute = -1;

  constructor(private readonly info: ScoreboardInfo) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 384;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.draw(0);
  }

  update(matchSeconds: number): void {
    const minute = Math.floor(matchSeconds / 60) % 90;
    if (minute !== this.lastMinute) this.draw(minute);
  }

  private draw(minute: number): void {
    this.lastMinute = minute;
    const { ctx, canvas, info } = this;
    ctx.fillStyle = '#04060a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = info.homeColor;
    ctx.fillRect(40, 60, 24, 150);
    ctx.fillStyle = info.awayColor;
    ctx.fillRect(canvas.width - 64, 60, 24, 150);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 150px system-ui, "Segoe UI", Tahoma, sans-serif';
    ctx.fillText('0 : 0', canvas.width / 2, 140);
    ctx.font = '700 64px system-ui, "Segoe UI", Tahoma, sans-serif';
    ctx.fillText(info.home, 230, 140);
    ctx.fillText(info.away, canvas.width - 230, 140);
    ctx.fillStyle = '#facc15';
    ctx.font = '700 72px system-ui, "Segoe UI", Tahoma, sans-serif';
    ctx.fillText(`${String(minute).padStart(2, '0')}'`, canvas.width / 2, 300);
    this.texture.needsUpdate = true;
  }
}

export function starField(count = 1800, radius = 1400): THREE.Points {
  const pos = new Float32Array(count * 3);
  let seed = 1337;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const theta = rnd() * Math.PI * 2;
    const phi = Math.acos(rnd() * 0.96);
    pos[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = radius * Math.cos(phi) + 20;
    pos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xdbe7ff, size: 2.2, sizeAttenuation: false, fog: false });
  return new THREE.Points(g, m);
}

export function goal(x: number, facing: 1 | -1): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const w = 7.32;
  const h = 2.44;
  const d = 2;
  const post = (len: number) => new THREE.CylinderGeometry(0.07, 0.07, len, 8);
  const add = (geo: THREE.BufferGeometry, px: number, py: number, pz: number, rx = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px, py, pz);
    mesh.rotation.set(rx, 0, rz);
    group.add(mesh);
  };
  add(post(h), 0, h / 2, -w / 2);
  add(post(h), 0, h / 2, w / 2);
  add(post(w), 0, h, 0, Math.PI / 2);
  add(post(w), -d * facing, 0.05, 0, Math.PI / 2);
  add(post(d), (-d / 2) * facing, 0.05, -w / 2, 0, Math.PI / 2);
  add(post(d), (-d / 2) * facing, 0.05, w / 2, 0, Math.PI / 2);
  const net = new THREE.Mesh(
    new THREE.BoxGeometry(d, h, w),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.18 }),
  );
  net.position.set((-d / 2) * facing, h / 2, 0);
  group.add(net);
  group.position.x = x;
  return group;
}
