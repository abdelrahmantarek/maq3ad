import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Venue } from '../config/venue';
import { SEAT_FREE, SEAT_MINE, SEAT_SOLD, type Layout } from '../domain/layout';
import { hash01 } from '../domain/rng';
import {
  ellipseBand,
  facadeTexture,
  goal,
  ledTexture,
  PITCH,
  pitchPlaneSize,
  pitchTexture,
  Scoreboard,
  starField,
} from './builders';
import { MatchSim } from './match';

export type ViewMode = 'stadium' | 'block' | 'seat';

export interface SceneEvents {
  onBlockHover(block: number | null, x: number, y: number): void;
  onBlockPick(block: number): void;
  onSeatHover(seat: number | null, x: number, y: number): void;
  onSeatPick(seat: number): void;
  onAutoRotateChange(on: boolean): void;
}

interface Tween {
  t: number;
  duration: number;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromLook: THREE.Vector3;
  toLook: THREE.Vector3;
  done: () => void;
}

const EYE_HEIGHT = 1.25;
const HOME_POS = new THREE.Vector3(0, 185, 215);
const HOME_LOOK = new THREE.Vector3(0, 8, 0);

const COLOR_SOLD = new THREE.Color('#333a49');
const COLOR_DIM = new THREE.Color('#1a202b');
const COLOR_MINE = new THREE.Color('#fb7185');
const COLOR_BASKET = new THREE.Color('#ffffff');

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class StadiumScene {
  mode: ViewMode = 'stadium';
  activeBlock = -1;
  activeSeat = -1;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.3, 4000);
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly seats: THREE.InstancedMesh;
  private readonly blockHits: THREE.Mesh[] = [];
  private readonly cursor: THREE.Mesh;
  private readonly match: MatchSim;
  private readonly scoreboard: Scoreboard;
  private readonly led: THREE.CanvasTexture;
  private readonly categoryColors = new Map<number, THREE.Color>();
  private readonly clock = new THREE.Clock();
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion: boolean;

  private basket = new Set<number>();
  private filter = new Set<number>();
  private tween: Tween | null = null;
  private readonly look = HOME_LOOK.clone();
  private yaw = 0;
  private pitch = 0;
  private hoverBlock = -1;
  private hoverSeat = -1;
  private autoRotate: boolean;
  private tourAngle = -1;
  private tourStart = 0;
  private pointerDown: { x: number; y: number; id: number } | null = null;
  private dragging = false;
  private frame = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly layout: Layout,
    private readonly venue: Venue,
    private readonly status: Uint8Array,
    private readonly events: SceneEvents,
  ) {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.autoRotate = !this.reducedMotion;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#05080f');
    this.scene.fog = new THREE.Fog('#05080f', 600, 1900);
    this.camera.position.copy(HOME_POS);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.addEventListener('start', () => this.stopAutoRotate());
    this.applyControlLimits();

    for (const c of venue.categories) {
      this.categoryColors.set(c.id, new THREE.Color(c.color));
      this.filter.add(c.id);
    }

    this.buildEnvironment();
    this.buildStands();
    this.seats = this.buildSeats();
    this.buildCrowd();
    this.buildBlockHits();

    const cursorGeo = new THREE.BoxGeometry(0.6, 0.52, 0.6);
    cursorGeo.translate(0, 0.26, 0);
    this.cursor = new THREE.Mesh(cursorGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.cursor.visible = false;
    this.scene.add(this.cursor);

    this.match = new MatchSim(venue.fixture.home.colors[0], venue.fixture.away.colors[0]);
    this.scene.add(this.match.group);

    this.scoreboard = new Scoreboard({
      home: venue.fixture.home.short,
      away: venue.fixture.away.short,
      homeColor: venue.fixture.home.colors[0],
      awayColor: venue.fixture.away.colors[0],
    });
    this.buildScoreboards();

    this.led = ledTexture('MAQ3AD', venue.fixture.home.colors[0]);
    this.buildLedRibbon();

    this.bindPointer();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.controls.target.copy(HOME_LOOK);
    this.controls.update();
    this.renderer.setAnimationLoop(() => this.render());
  }

  // ---------------------------------------------------------------- building

  private buildEnvironment(): void {
    const { a, b } = this.venue.bowl;
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.25));
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x18202c, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(60, 180, 40);
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1500, 64),
      new THREE.MeshBasicMaterial({ color: 0x090d15 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.2;
    this.scene.add(ground);

    const apron = new THREE.Mesh(
      ellipseBand(0.01, 0.01, 0, a + 0.4, b + 0.4, 0),
      new THREE.MeshBasicMaterial({ color: 0x1b3a2a, side: THREE.DoubleSide }),
    );
    this.scene.add(apron);

    const [pw, ph] = pitchPlaneSize();
    const pitchGeo = new THREE.PlaneGeometry(pw, ph);
    pitchGeo.rotateX(-Math.PI / 2);
    const pitch = new THREE.Mesh(pitchGeo, new THREE.MeshBasicMaterial({ map: pitchTexture() }));
    pitch.position.y = 0.03;
    this.scene.add(pitch);

    this.scene.add(goal(PITCH.length / 2, -1), goal(-PITCH.length / 2, 1));
    this.scene.add(starField());
  }

  private buildStands(): void {
    const { a, b } = this.venue.bowl;
    const concrete = new THREE.MeshLambertMaterial({ color: 0x2a3140, side: THREE.DoubleSide });
    const wall = new THREE.MeshLambertMaterial({ color: 0x1a202c, side: THREE.DoubleSide });

    for (const tier of this.venue.tiers) {
      const inner = tier.innerOffset - 0.6;
      const outer = tier.innerOffset + tier.rows * tier.rowDepth + 0.4;
      const y0 = tier.baseY - 0.25;
      const y1 = tier.baseY + tier.rows * tier.rowRise - 0.25;
      this.scene.add(new THREE.Mesh(ellipseBand(a + inner, b + inner, y0, a + outer, b + outer, y1), concrete));
      const floor = tier.id === 1 ? 0 : y0 - 2.4;
      this.scene.add(new THREE.Mesh(ellipseBand(a + inner, b + inner, floor, a + inner, b + inner, y0), wall));
      this.scene.add(new THREE.Mesh(ellipseBand(a + outer, b + outer, y1 - 3, a + outer, b + outer, y1 + 1.1), wall));
    }

    const top = this.venue.tiers[this.venue.tiers.length - 1];
    const rim = top.innerOffset + top.rows * top.rowDepth + 0.4;
    const rimY = top.baseY + top.rows * top.rowRise;
    const facadeOff = rim + 5;
    this.scene.add(
      new THREE.Mesh(ellipseBand(a + rim, b + rim, rimY - 0.2, a + facadeOff, b + facadeOff, rimY - 0.2), concrete),
    );
    this.scene.add(
      new THREE.Mesh(
        ellipseBand(a + facadeOff, b + facadeOff, 0, a + facadeOff, b + facadeOff, rimY + 5),
        new THREE.MeshBasicMaterial({ map: facadeTexture(), side: THREE.DoubleSide }),
      ),
    );

    const roofOuter = facadeOff + 1;
    const roofInner = rim - 15;
    this.scene.add(
      new THREE.Mesh(
        ellipseBand(a + roofOuter, b + roofOuter, rimY + 5.5, a + roofInner, b + roofInner, rimY + 9.5),
        new THREE.MeshBasicMaterial({
          color: 0xdfe9f5,
          transparent: true,
          opacity: 0.14,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    this.scene.add(
      new THREE.Mesh(
        ellipseBand(a + roofInner, b + roofInner, rimY + 9.5, a + roofInner - 0.45, b + roofInner - 0.45, rimY + 9.35),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          side: THREE.DoubleSide,
          fog: false,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        }),
      ),
    );
  }

  private buildLedRibbon(): void {
    const { a, b } = this.venue.bowl;
    const tier = this.venue.tiers[1];
    const off = tier.innerOffset - 0.68;
    const y = tier.baseY - 0.3;
    this.led.repeat.set(6, 1);
    this.scene.add(
      new THREE.Mesh(
        ellipseBand(a + off, b + off, y - 1.5, a + off, b + off, y, 0, Math.PI * 2, 200, 1),
        new THREE.MeshBasicMaterial({ map: this.led, side: THREE.DoubleSide, fog: false }),
      ),
    );
  }

  private buildScoreboards(): void {
    const { a } = this.venue.bowl;
    const top = this.venue.tiers[this.venue.tiers.length - 1];
    const x = a + top.innerOffset + top.rows * top.rowDepth - 6;
    const y = top.baseY + top.rows * top.rowRise + 3.5;
    const mat = new THREE.MeshBasicMaterial({ map: this.scoreboard.texture, fog: false });
    for (const side of [1, -1]) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(30, 11.25), mat);
      board.position.set(x * side, y, 0);
      board.rotation.y = (-Math.PI / 2) * side;
      this.scene.add(board);
    }
  }

  private buildSeats(): THREE.InstancedMesh {
    const geo = new THREE.BoxGeometry(0.44, 0.42, 0.44);
    geo.translate(0, 0.21, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), this.layout.seatCount);
    const dummy = new THREE.Object3D();
    const { pos, rotY } = this.layout;
    for (let i = 0; i < this.layout.seatCount; i++) {
      dummy.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      dummy.rotation.set(0, rotY[i], 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, this.colorFor(i));
    }
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  /** Supporters occupy the seats that were already sold. */
  private buildCrowd(): void {
    const { pos, rotY, seatBlock, blocks } = this.layout;
    const sold: number[] = [];
    for (let i = 0; i < this.layout.seatCount; i++) if (this.status[i] === SEAT_SOLD) sold.push(i);
    if (sold.length === 0) return;

    const geo = new THREE.BoxGeometry(0.34, 0.66, 0.24);
    geo.translate(0, 0.75, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), sold.length);
    const home = this.venue.fixture.home.colors.map((c) => new THREE.Color(c));
    const away = this.venue.fixture.away.colors.map((c) => new THREE.Color(c));
    const neutral = ['#cbd5e1', '#64748b', '#e2e8f0', '#94a3b8'].map((c) => new THREE.Color(c));
    const dummy = new THREE.Object3D();
    sold.forEach((seat, k) => {
      dummy.position.set(pos[seat * 3], pos[seat * 3 + 1], pos[seat * 3 + 2]);
      dummy.rotation.set(0, rotY[seat], 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(k, dummy.matrix);
      const r = hash01(7, seat);
      const palette = blocks[seatBlock[seat]].away ? away : home;
      const color = r < 0.72 ? palette[r < 0.5 ? 0 : 1] : neutral[Math.floor(r * 97) % neutral.length];
      mesh.setColorAt(k, color);
    });
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  private buildBlockHits(): void {
    const { a, b } = this.venue.bowl;
    for (const block of this.layout.blocks) {
      const pad = 0.012;
      const geo = ellipseBand(
        a + block.innerOffset, b + block.innerOffset, block.yMin + 0.9,
        a + block.outerOffset, b + block.outerOffset, block.yMax + 1.3,
        block.t0 + pad, block.t1 - pad, 6,
      );
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.userData.block = block.index;
      this.blockHits.push(mesh);
      this.scene.add(mesh);
    }
  }

  // ------------------------------------------------------------------ colours

  private colorFor(i: number): THREE.Color {
    const s = this.status[i];
    if (s === SEAT_MINE) return COLOR_MINE;
    if (this.basket.has(i)) return COLOR_BASKET;
    if (s !== SEAT_FREE) return COLOR_SOLD;
    const category = this.layout.blocks[this.layout.seatBlock[i]].category;
    if (!this.filter.has(category)) return COLOR_DIM;
    return this.categoryColors.get(category) ?? COLOR_DIM;
  }

  repaint(): void {
    for (let i = 0; i < this.layout.seatCount; i++) this.seats.setColorAt(i, this.colorFor(i));
    if (this.seats.instanceColor) this.seats.instanceColor.needsUpdate = true;
  }

  setBasket(basket: Set<number>): void {
    this.basket = new Set(basket);
    this.repaint();
  }

  setFilter(filter: Set<number>): void {
    this.filter = new Set(filter);
    this.repaint();
  }

  // ------------------------------------------------------------------- camera

  private applyControlLimits(): void {
    const c = this.controls;
    if (this.mode === 'stadium') {
      c.minDistance = 110;
      c.maxDistance = 470;
      c.minPolarAngle = 0.08;
      c.maxPolarAngle = 1.12;
      c.autoRotate = this.autoRotate;
    } else {
      c.minDistance = 7;
      c.maxDistance = 75;
      c.minPolarAngle = 0.2;
      c.maxPolarAngle = 1.5;
      c.autoRotate = false;
    }
  }

  private currentLook(): THREE.Vector3 {
    if (this.tween) return this.look.clone();
    if (this.mode === 'seat') return this.camera.position.clone().add(this.lookDir().multiplyScalar(20));
    return this.controls.target.clone();
  }

  private lookDir(): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  private flyTo(pos: THREE.Vector3, look: THREE.Vector3, done: () => void): void {
    const fromLook = this.currentLook();
    this.controls.enabled = false;
    this.tourAngle = -1;
    this.tween = {
      t: 0,
      duration: this.reducedMotion ? 0.001 : 1.25,
      fromPos: this.camera.position.clone(),
      toPos: pos,
      fromLook,
      toLook: look,
      done,
    };
    this.look.copy(fromLook);
  }

  private settleOrbit(look: THREE.Vector3): void {
    this.controls.target.copy(look);
    this.applyControlLimits();
    this.controls.enabled = true;
    this.controls.update();
  }

  flyToStadium(): void {
    this.mode = 'stadium';
    this.activeBlock = -1;
    this.activeSeat = -1;
    this.clearHover();
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.flyTo(HOME_POS.clone(), HOME_LOOK.clone(), () => this.settleOrbit(HOME_LOOK));
  }

  flyToBlock(index: number): void {
    const block = this.layout.blocks[index];
    if (!block) return;
    this.mode = 'block';
    this.activeBlock = index;
    this.activeSeat = -1;
    this.clearHover();
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    const center = new THREE.Vector3(...block.center);
    const inward = new THREE.Vector3(-block.normal[0], 0, -block.normal[1]);
    const pos = center.clone().addScaledVector(inward, 27).add(new THREE.Vector3(0, 8, 0));
    this.flyTo(pos, center, () => this.settleOrbit(center));
  }

  flyToSeat(index: number): void {
    if (index < 0 || index >= this.layout.seatCount) return;
    const { pos } = this.layout;
    this.mode = 'seat';
    this.activeSeat = index;
    this.activeBlock = this.layout.seatBlock[index];
    this.clearHover();
    const eye = new THREE.Vector3(pos[index * 3], pos[index * 3 + 1] + EYE_HEIGHT, pos[index * 3 + 2]);
    const toPitch = new THREE.Vector3(0, 0.5, 0).sub(eye);
    this.yaw = Math.atan2(toPitch.x, toPitch.z);
    this.pitch = Math.atan2(toPitch.y, Math.hypot(toPitch.x, toPitch.z));
    const look = eye.clone().add(this.lookDir().multiplyScalar(20));
    this.flyTo(eye, look, () => {
      this.camera.fov = 62;
      this.camera.updateProjectionMatrix();
    });
  }

  setAutoRotate(on: boolean): void {
    this.autoRotate = on && !this.reducedMotion;
    if (this.mode === 'stadium') this.controls.autoRotate = this.autoRotate;
    this.events.onAutoRotateChange(this.autoRotate);
  }

  private stopAutoRotate(): void {
    if (this.autoRotate) this.setAutoRotate(false);
  }

  /** One full lap around the bowl, then back to the overview. */
  startTour(): void {
    if (this.reducedMotion) return;
    this.mode = 'stadium';
    this.activeBlock = -1;
    this.activeSeat = -1;
    this.clearHover();
    this.tween = null;
    this.controls.enabled = false;
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();
    this.tourStart = Math.atan2(this.camera.position.z, this.camera.position.x);
    this.tourAngle = 0;
  }

  get touring(): boolean {
    return this.tourAngle >= 0;
  }

  // ------------------------------------------------------------------ picking

  private bindPointer(): void {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';

    el.addEventListener('pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY, id: e.pointerId };
      if (this.touring) this.flyToStadium();
      if (this.mode === 'seat' && !this.tween) {
        this.dragging = true;
        el.setPointerCapture(e.pointerId);
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (this.dragging && this.mode === 'seat') {
        this.yaw += e.movementX * 0.0045;
        this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.0045, -1.25, 1.25);
        return;
      }
      if (e.pointerType === 'mouse' && e.buttons === 0) this.hover(e.clientX, e.clientY);
    });

    const release = (e: PointerEvent) => {
      const down = this.pointerDown;
      this.pointerDown = null;
      this.dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (!down || down.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 7) this.click(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', () => {
      this.pointerDown = null;
      this.dragging = false;
    });
    el.addEventListener('pointerleave', () => this.clearHover());

    el.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'seat') return;
        e.preventDefault();
        this.camera.fov = THREE.MathUtils.clamp(this.camera.fov + Math.sign(e.deltaY) * 3, 28, 80);
        this.camera.updateProjectionMatrix();
      },
      { passive: false },
    );
  }

  private ndc(x: number, y: number): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  private pickBlock(x: number, y: number): number {
    this.raycaster.setFromCamera(this.ndc(x, y), this.camera);
    const hit = this.raycaster.intersectObjects(this.blockHits, false)[0];
    return hit ? (hit.object.userData.block as number) : -1;
  }

  private pickSeat(x: number, y: number): number {
    const block = this.layout.blocks[this.activeBlock];
    if (!block) return -1;
    const r = this.renderer.domElement.getBoundingClientRect();
    const { pos } = this.layout;
    const v = new THREE.Vector3();
    let best = -1;
    let bestD = 18 * 18;
    for (let i = block.seatStart; i < block.seatStart + block.seatCount; i++) {
      v.set(pos[i * 3], pos[i * 3 + 1] + 0.3, pos[i * 3 + 2]).project(this.camera);
      if (v.z < -1 || v.z > 1) continue;
      const px = r.left + ((v.x + 1) / 2) * r.width;
      const py = r.top + ((1 - v.y) / 2) * r.height;
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private setHoverBlock(index: number): void {
    if (index === this.hoverBlock) return;
    if (this.hoverBlock >= 0) (this.blockHits[this.hoverBlock].material as THREE.MeshBasicMaterial).opacity = 0;
    this.hoverBlock = index;
    if (index >= 0) (this.blockHits[index].material as THREE.MeshBasicMaterial).opacity = 0.3;
  }

  private setHoverSeat(index: number): void {
    this.hoverSeat = index;
    if (index < 0) {
      this.cursor.visible = false;
      return;
    }
    const { pos, rotY } = this.layout;
    this.cursor.position.set(pos[index * 3], pos[index * 3 + 1], pos[index * 3 + 2]);
    this.cursor.rotation.y = rotY[index];
    this.cursor.visible = true;
  }

  private clearHover(): void {
    this.setHoverBlock(-1);
    this.setHoverSeat(-1);
    this.renderer.domElement.style.cursor = '';
    this.events.onBlockHover(null, 0, 0);
    this.events.onSeatHover(null, 0, 0);
  }

  private hover(x: number, y: number): void {
    if (this.tween || this.touring) return;
    if (this.mode === 'stadium') {
      const block = this.pickBlock(x, y);
      this.setHoverBlock(block);
      this.renderer.domElement.style.cursor = block >= 0 ? 'pointer' : '';
      this.events.onBlockHover(block >= 0 ? block : null, x, y);
    } else if (this.mode === 'block') {
      const seat = this.pickSeat(x, y);
      if (seat !== this.hoverSeat) this.setHoverSeat(seat);
      this.renderer.domElement.style.cursor = seat >= 0 ? 'pointer' : '';
      this.events.onSeatHover(seat >= 0 ? seat : null, x, y);
    }
  }

  private click(x: number, y: number): void {
    if (this.tween) return;
    if (this.mode === 'stadium') {
      const block = this.pickBlock(x, y);
      if (block >= 0) this.events.onBlockPick(block);
    } else if (this.mode === 'block') {
      const seat = this.pickSeat(x, y);
      if (seat >= 0) {
        this.events.onSeatPick(seat);
        return;
      }
      const block = this.pickBlock(x, y);
      if (block >= 0 && block !== this.activeBlock) this.events.onBlockPick(block);
    }
  }

  // ------------------------------------------------------------------- render

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private render(): void {
    const dt = Math.min(0.05, this.clock.getDelta());
    this.frame++;

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const e = ease(tw.t);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      this.look.lerpVectors(tw.fromLook, tw.toLook, e);
      this.camera.lookAt(this.look);
      if (tw.t >= 1) {
        this.tween = null;
        tw.done();
      }
    } else if (this.touring) {
      this.tourAngle += (dt * Math.PI * 2) / 18;
      const angle = this.tourStart + this.tourAngle;
      const f = this.tourAngle / (Math.PI * 2);
      const radius = 215 - 60 * Math.sin(Math.PI * f);
      const height = 150 - 95 * Math.sin(Math.PI * f);
      this.camera.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
      this.camera.lookAt(HOME_LOOK);
      if (this.tourAngle >= Math.PI * 2) this.flyToStadium();
    } else if (this.mode === 'seat') {
      this.camera.lookAt(this.camera.position.clone().add(this.lookDir()));
    } else {
      this.controls.update();
    }

    if (!this.reducedMotion) {
      this.match.update(dt);
      this.led.offset.x = (this.led.offset.x + dt * 0.02) % 1;
    }
    if (this.frame % 30 === 0) this.scoreboard.update(this.match.elapsed * 20);

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
