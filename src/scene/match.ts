import * as THREE from 'three';
import { PITCH } from './builders';

interface Player {
  team: 0 | 1;
  home: THREE.Vector2;
  pos: THREE.Vector2;
  pace: number;
}

// 4-4-2, as fractions of the half-pitch (x: own goal -1 → halfway 0, z: -1..1).
const FORMATION: [number, number][] = [
  [-0.95, 0],
  [-0.68, -0.7], [-0.72, -0.25], [-0.72, 0.25], [-0.68, 0.7],
  [-0.36, -0.75], [-0.4, -0.25], [-0.4, 0.25], [-0.36, 0.75],
  [-0.1, -0.3], [-0.1, 0.3],
];

/** Lightweight ambient match: players drift around a wandering ball. */
export class MatchSim {
  readonly group = new THREE.Group();
  elapsed = 0;

  private readonly players: Player[] = [];
  private readonly meshes: [THREE.InstancedMesh, THREE.InstancedMesh];
  private readonly referee: THREE.Mesh;
  private readonly ball: THREE.Mesh;
  private readonly ballPos = new THREE.Vector2(0, 0);
  private readonly ballFrom = new THREE.Vector2(0, 0);
  private readonly ballTo = new THREE.Vector2(8, 4);
  private ballT = 0;
  private ballDuration = 1.2;
  private readonly dummy = new THREE.Object3D();
  private seed = 20270122;

  constructor(homeColor: string, awayColor: string) {
    const body = new THREE.CapsuleGeometry(0.42, 1.25, 2, 8);
    body.translate(0, 1.05, 0);
    this.meshes = [
      new THREE.InstancedMesh(body, new THREE.MeshLambertMaterial({ color: homeColor }), 11),
      new THREE.InstancedMesh(body, new THREE.MeshLambertMaterial({ color: awayColor }), 11),
    ];
    for (const m of this.meshes) {
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.referee = new THREE.Mesh(body, new THREE.MeshLambertMaterial({ color: 0x111111 }));
    this.group.add(this.referee);
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    this.group.add(this.ball);

    const hx = PITCH.length / 2;
    const hz = PITCH.width / 2;
    for (const team of [0, 1] as const) {
      const sign = team === 0 ? 1 : -1;
      for (const [fx, fz] of FORMATION) {
        const home = new THREE.Vector2(fx * hx * sign, fz * hz * sign);
        this.players.push({ team, home, pos: home.clone(), pace: 5 + this.rnd() * 2.5 });
      }
    }
    this.update(0);
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  update(dt: number): void {
    this.elapsed += dt;
    const hx = PITCH.length / 2 - 2;
    const hz = PITCH.width / 2 - 2;

    this.ballT += dt / this.ballDuration;
    if (this.ballT >= 1) {
      this.ballFrom.copy(this.ballTo);
      const target = this.players[Math.floor(this.rnd() * this.players.length)];
      this.ballTo.set(
        THREE.MathUtils.clamp(target.pos.x + (this.rnd() - 0.5) * 10, -hx, hx),
        THREE.MathUtils.clamp(target.pos.y + (this.rnd() - 0.5) * 10, -hz, hz),
      );
      this.ballDuration = Math.max(0.6, this.ballFrom.distanceTo(this.ballTo) / 17);
      this.ballT = 0;
    }
    const e = this.ballT;
    this.ballPos.lerpVectors(this.ballFrom, this.ballTo, e);
    const lift = Math.sin(Math.PI * e) * Math.min(4, this.ballFrom.distanceTo(this.ballTo) * 0.08);
    this.ball.position.set(this.ballPos.x, 0.32 + lift, this.ballPos.y);

    const nearest: [number, number] = [-1, -1];
    const best: [number, number] = [Infinity, Infinity];
    this.players.forEach((p, i) => {
      const d = p.pos.distanceToSquared(this.ballPos);
      if (d < best[p.team]) {
        best[p.team] = d;
        nearest[p.team] = i;
      }
    });

    const target = new THREE.Vector2();
    const counts: [number, number] = [0, 0];
    this.players.forEach((p, i) => {
      if (i === nearest[p.team]) target.copy(this.ballPos);
      else target.set(p.home.x + this.ballPos.x * 0.38, p.home.y + this.ballPos.y * 0.3);
      const dx = target.x - p.pos.x;
      const dz = target.y - p.pos.y;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05) {
        const step = Math.min(dist, p.pace * dt);
        p.pos.x += (dx / dist) * step;
        p.pos.y += (dz / dist) * step;
      }
      this.dummy.position.set(p.pos.x, 0, p.pos.y);
      this.dummy.rotation.set(0, Math.atan2(dx, dz), 0);
      this.dummy.updateMatrix();
      this.meshes[p.team].setMatrixAt(counts[p.team]++, this.dummy.matrix);
    });
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;

    const rx = this.ballPos.x - 7;
    const rz = this.ballPos.y + 6;
    this.referee.position.x += (rx - this.referee.position.x) * Math.min(1, dt * 1.2);
    this.referee.position.z += (rz - this.referee.position.z) * Math.min(1, dt * 1.2);
  }
}
