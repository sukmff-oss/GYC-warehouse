// =============================================================
// vehicles.js — 載具系統（台北101地圖）
//   🚗 汽車（快）/ 🛵 機車（中快）/ 🚲 腳踏車（慢）：E 自由上下車
//   🏆 金色 50 機槍吉普車：玩家駕駛 + BOT 槍手（無限子彈自動攻擊）
//   高速行駛可輾壓敵人
// =============================================================
import * as THREE from 'three';
import { colliders } from './map.js';

const TYPES = {
  car:     { name: '汽車',         maxF: 20, maxR: 5, accel: 12, turn: 1.7, r: 2.0, seatY: 0.55, seatZ: 0.2 },
  scooter: { name: '機車',         maxF: 11, maxR: 4, accel: 9,  turn: 2.4, r: 1.0, seatY: 0.75, seatZ: 0 },
  bicycle: { name: '腳踏車',       maxF: 6,  maxR: 2, accel: 6,  turn: 3.0, r: 0.8, seatY: 0.8,  seatZ: 0 },
  jeep:    { name: '50機槍吉普車', maxF: 16, maxR: 5, accel: 11, turn: 1.9, r: 2.1, seatY: 0.75, seatZ: 0.6, gun: true },
  gcar:    { name: '金色車子',     maxF: 24, maxR: 6, accel: 14, turn: 1.9, r: 2.0, seatY: 0.55, seatZ: 0.2 },
};

function boxM(g, w, h, d, mat, x, y, z, rx = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.set(rx, 0, rz);
  g.add(m); return m;
}

function buildMesh(type, color) {
  const g = new THREE.Group();
  const body = type === 'gcar'
    ? new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0x8a6808, emissiveIntensity: 0.45, metalness: 0.95, roughness: 0.28 })   // 純金屬光澤，不加光暈
    : new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262c, metalness: 0.3, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x8fb8d8, metalness: 0.9, roughness: 0.15 });
  if (type === 'car' || type === 'gcar') {
    boxM(g, 1.85, 0.55, 4.3, body, 0, 0.62, 0);
    boxM(g, 1.6, 0.5, 2.1, glass, 0, 1.12, 0.25);
    for (const [x, z] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12), dark);
      w.rotation.z = Math.PI / 2; w.position.set(x, 0.34, z);
      w.name = 'wheel'; g.add(w);
    }
  } else if (type === 'scooter') {
    boxM(g, 0.42, 0.5, 1.5, body, 0, 0.62, 0.1);
    boxM(g, 0.3, 0.4, 0.5, body, 0, 0.95, -0.55, 0.3);          // 龍頭
    boxM(g, 0.55, 0.08, 0.3, dark, 0, 1.15, -0.62);              // 手把
    boxM(g, 0.4, 0.12, 0.7, dark, 0, 0.86, 0.35);                // 坐墊
    for (const z of [0.75, -0.65]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.12, 12), dark);
      w.rotation.z = Math.PI / 2; w.position.set(0, 0.28, z);
      w.name = 'wheel'; g.add(w);
    }
  } else if (type === 'bicycle') {
    boxM(g, 0.06, 0.06, 1.1, body, 0, 0.62, 0);                  // 車架橫樑
    boxM(g, 0.06, 0.5, 0.06, body, 0, 0.5, 0.3, 0.25);           // 座管
    boxM(g, 0.06, 0.55, 0.06, body, 0, 0.55, -0.5, -0.2);        // 前管
    boxM(g, 0.4, 0.05, 0.05, dark, 0, 0.88, -0.58);              // 手把
    boxM(g, 0.24, 0.06, 0.2, dark, 0, 0.78, 0.32);               // 坐墊
    for (const z of [0.62, -0.62]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 8, 20), dark);
      w.position.set(0, 0.33, z);
      w.name = 'wheel'; g.add(w);
    }
  } else if (type === 'jeep') {
    const gold = new THREE.MeshStandardMaterial({
      color: 0xffd24a, emissive: 0x7a5a08, emissiveIntensity: 0.45, metalness: 0.95, roughness: 0.28 });
    boxM(g, 2.0, 0.7, 4.5, gold, 0, 0.75, 0);                    // 車身
    boxM(g, 1.8, 0.55, 1.4, glass, 0, 1.35, 1.1);                // 前座擋風
    boxM(g, 1.9, 0.35, 1.6, gold, 0, 1.25, -1.2);                // 後斗圍板
    for (const [x, z] of [[-0.95, 1.5], [0.95, 1.5], [-0.95, -1.5], [0.95, -1.5]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), dark);
      w.rotation.z = Math.PI / 2; w.position.set(x, 0.42, z);
      w.name = 'wheel'; g.add(w);
    }
    // M2 50 機槍（後斗槍架）
    const gun = new THREE.Group();
    const gm = new THREE.MeshStandardMaterial({ color: 0x3a3f46, metalness: 0.85, roughness: 0.35 });
    const tri = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 0.7, 8), gm);
    tri.position.y = 0.35; gun.add(tri);
    boxM(gun, 0.16, 0.18, 1.1, gm, 0, 0.85, 0);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.0, 8), gm);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.87, -0.95); gun.add(barrel);
    boxM(gun, 0.3, 0.22, 0.3, gm, 0, 0.72, 0.45);                // 彈藥箱
    gun.position.set(0, 1.42, -1.2);
    gun.name = 'gun';
    g.add(gun);
    // 金色光環（一眼認出獎勵車）
    const gc = document.createElement('canvas'); gc.width = gc.height = 64;
    const gx = gc.getContext('2d');
    const gr = gx.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,220,120,.85)'); gr.addColorStop(1, 'rgba(255,200,80,0)');
    gx.fillStyle = gr; gx.fillRect(0, 0, 64, 64);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(4.5, 4.5, 1); glow.position.y = 1.2;
    g.add(glow);
  }
  return g;
}

export class VehicleManager {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.playerV = null;      // 玩家駕駛中的載具
  }

  clear() {
    for (const v of this.list) this.scene.remove(v.mesh);
    this.list.length = 0;
    this.playerV = null;
  }

  _spawn(type, x, z, yaw, color) {
    const cfg = TYPES[type];
    const mesh = buildMesh(type, color ?? (cfg.gun ? 0xffd24a : [0x7a8a99, 0xb56a3a, 0x8a8f96, 0xc23a2a, 0x3f6d4e][(Math.random() * 5) | 0]));
    mesh.position.set(x, 0, z);
    mesh.rotation.y = yaw;
    this.scene.add(mesh);
    const v = { type, cfg, mesh, pos: mesh.position, yaw, speed: 0, driver: null, gunner: null, fireT: 0 };
    this.list.push(v);
    return v;
  }

  // 台北101街道配置（加大市區）：汽車/機車/腳踏車散佈各道路 + 隨機一台金色吉普
  spawnTaipei() {
    this._spawn('car', 3, -80, 0);
    this._spawn('car', -3, 40, Math.PI);
    this._spawn('car', -77.5, -30, 0);
    this._spawn('car', 42.5, 80, Math.PI);
    this._spawn('car', -60, -57.5, Math.PI / 2);
    this._spawn('car', 70, 2.5, Math.PI / 2);
    this._spawn('car', -20, 122.5, -Math.PI / 2);
    this._spawn('car', 30, -122.5, Math.PI / 2);
    this._spawn('scooter', 8, -100, 0.3);
    this._spawn('scooter', -8, -20, -0.2);
    this._spawn('scooter', -37.5, 60, 0.1);
    this._spawn('scooter', 77.5, -60, 0);
    this._spawn('scooter', 10, 140, 0.4);
    this._spawn('scooter', -10, -140, 0);
    this._spawn('bicycle', 12, -132, 0);
    this._spawn('bicycle', -12, -132, 0);
    this._spawn('bicycle', 6, 160, 0.5);
    this._spawn('bicycle', -6, 100, 0);
    this._spawn('bicycle', 82.5, 20, 0);
    this._spawn('bicycle', -82.5, -90, 0);
    const spots = [[0, -110, 0], [-77.5, 60, 0], [40, 57.5, -Math.PI / 2], [77.5, -60, Math.PI], [-40, -57.5, Math.PI / 2]];
    const [jx, jz, jy] = spots[(Math.random() * spots.length) | 0];   // 隨機位置
    this._spawn('jeep', jx, jz, jy);
  }

  nearest(pos, maxD = 2.6) {
    let best = null, bd = maxD;
    for (const v of this.list) {
      if (v.driver) continue;
      const d = Math.hypot(pos.x - v.pos.x, pos.z - v.pos.z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  // E 互動：上車 / 下車（回傳 true 表示已處理）
  interact(player, bots, hud) {
    if (this.playerV) { this.exit(player, bots, hud); return true; }
    const v = this.nearest(player.pos);
    if (!v) return false;
    this.mount(v, player, bots, hud);
    return true;
  }

  // 直接登上指定載具（E 互動或金色車子碰到自動上車）
  mount(v, player, bots, hud) {
    v.driver = 'player';
    v.speed = 0;
    this.playerV = v;
    player.driving = true;
    player.vel.set(0, 0, 0);
    player.yaw = v.yaw;   // 上車面向車頭
    if (v.type === 'jeep') {
      // 指派最近的存活 BOT 當槍手（無限子彈自動攻擊，距離不限直接跳上車）
      let gb = null, bd = Infinity;
      for (const b of bots) {
        if (!b.alive || b.riding) continue;
        const d = Math.hypot(b.pos.x - v.pos.x, b.pos.z - v.pos.z);
        if (d < bd) { bd = d; gb = b; }
      }
      if (gb) { v.gunner = gb; gb.riding = true; }
      hud?.sysmsg(gb ? `🏆 登上金色吉普車 · ${gb.name} 操作 50 機槍！W/S 油門 A/D 轉向 E 下車`
                     : '🏆 登上金色吉普車（無槍手）W/S 油門 A/D 轉向 E 下車', 3500);
    } else {
      hud?.sysmsg(`${{ car: '🚗', scooter: '🛵', bicycle: '🚲', gcar: '🏆' }[v.type]} 登上${v.cfg.name} · W/S 油門 A/D 轉向 E 下車`, 2600);
    }
  }

  exit(player, bots, hud) {
    const v = this.playerV;
    if (!v) return;
    v.driver = null;
    this.playerV = null;
    player.driving = false;
    // 下車放在車側
    const sx = v.pos.x + Math.cos(v.yaw) * (v.cfg.r + 0.9);
    const sz = v.pos.z - Math.sin(v.yaw) * (v.cfg.r + 0.9);
    player.pos.set(sx, 0, sz);
    player.vel.set(0, 0, 0);
    if (v.gunner) { v.gunner.riding = false; v.gunner = null; }
    hud?.sysmsg('已下車', 1000);
  }

  onPlayerDeath(player) {
    if (!this.playerV) return;
    const v = this.playerV;
    v.driver = null; v.speed = 0;
    this.playerV = null;
    player.driving = false;
    if (v.gunner) { v.gunner.riding = false; v.gunner = null; }
  }

  getPrompt(player) {
    if (this.playerV) {
      const v = this.playerV;
      const kmh = Math.round(Math.abs(v.speed) * 3.6);
      return `${v.cfg.name} · ${kmh} km/h<br>[E] 下車`;
    }
    const v = this.nearest(player.pos);
    return v ? `[E] 上車 · ${v.cfg.name}` : null;
  }

  _blocked(x, z, r) {
    for (const c of colliders) {
      if (c.max.y < 0.3 || c.min.y > 1.4) continue;
      if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) return true;
    }
    return false;
  }

  // ctx: { player, enemies, bots, bounds, now, isHost, onKill(soldier, weaponName), tracer(from,to,hit,color) }
  update(dt, ctx) {
    for (const v of this.list) {
      const driving = v.driver === 'player' && this.playerV === v;
      if (driving) {
        const k = ctx.player.keys;
        const th = (k['KeyW'] ? 1 : 0) - (k['KeyS'] ? 1 : 0);
        const st = (k['KeyA'] ? 1 : 0) - (k['KeyD'] ? 1 : 0);
        const target = th > 0 ? v.cfg.maxF : (th < 0 ? -v.cfg.maxR : 0);
        v.speed += (target - v.speed) * Math.min(1, (th ? v.cfg.accel : 5) * dt / v.cfg.maxF * 4);
        if (Math.abs(v.speed) > 0.15)
          v.yaw += st * v.cfg.turn * dt * Math.min(1, Math.abs(v.speed) / 6) * Math.sign(v.speed);
        const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
        const nx = v.pos.x + fx * v.speed * dt;
        const nz = v.pos.z + fz * v.speed * dt;
        const b = ctx.bounds;
        const hitWall = this._blocked(nx, nz, v.cfg.r * 0.7) ||
          nx < b.minX + 1 || nx > b.maxX - 1 || nz < b.minZ + 1 || nz > b.maxZ - 1;
        if (hitWall) v.speed *= -0.18;   // 撞牆小幅回彈
        else { v.pos.x = nx; v.pos.z = nz; }
        // 玩家位置跟隨駕駛座
        ctx.player.pos.set(
          v.pos.x - fx * v.cfg.seatZ, v.cfg.seatY, v.pos.z - fz * v.cfg.seatZ);
        // 高速輾壓敵人（僅房主/離線端结算）
        if (ctx.isHost && Math.abs(v.speed) > 4.5) {
          for (const s of ctx.enemies.soldiers) {
            if (s.state === 'dead') continue;
            if (Math.hypot(s.pos.x - v.pos.x, s.pos.z - v.pos.z) < v.cfg.r + 0.4) {
              const killed = s.damage(300, 'body', ctx.now);
              if (killed) ctx.onKill(s, `載具輾壓（${v.cfg.name}）`);
            }
          }
        }
      } else {
        v.speed *= Math.pow(0.001, dt);   // 滑行停止
      }
      v.mesh.rotation.y = v.yaw;
      // 輪子滾動
      const spin = v.speed * dt * 2.2;
      for (const ch of v.mesh.children)
        if (ch.name === 'wheel') ch.rotation.x += spin;

      // 吉普槍手 BOT：坐上槍位 + 自動攻擊（無限子彈）
      if (v.gunner) {
        const gb = v.gunner;
        if (!gb.alive) { v.gunner = null; gb.riding = false; }
        else {
          const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
          gb.pos.set(v.pos.x - fx * 1.2, 1.55, v.pos.z - fz * 1.2);
          gb.yaw = v.yaw;
          gb._sync?.();
          const gun = v.mesh.getObjectByName('gun');
          if (ctx.isHost && gb.alive) {
            v.fireT -= dt;
            // 找最近敵人
            let tgt = null, bd = 70;
            const eye = new THREE.Vector3(gb.pos.x, gb.pos.y + 0.9, gb.pos.z);
            for (const s of ctx.enemies.soldiers) {
              if (s.state === 'dead') continue;
              const d = Math.hypot(s.pos.x - v.pos.x, s.pos.z - v.pos.z);
              if (d < bd) { bd = d; tgt = s; }
            }
            if (tgt) {
              gb.yaw = Math.atan2(tgt.pos.x - gb.pos.x, tgt.pos.z - gb.pos.z);
              if (gun) gun.rotation.y = gb.yaw - v.yaw + Math.PI;
              if (v.fireT <= 0) {
                v.fireT = 0.13;   // 50 機槍射速 · 無限子彈
                const from = new THREE.Vector3(
                  gb.pos.x - Math.sin(gb.yaw) * 1.2, gb.pos.y + 0.9, gb.pos.z - Math.cos(gb.yaw) * 1.2);
                const aim = tgt.pos.clone(); aim.y += 1.2;
                const hit = Math.random() < 0.85;
                const to = aim.clone();
                if (!hit) { to.x += (Math.random() - .5) * 1.5; to.y += Math.random() * 0.8; to.z += (Math.random() - .5) * 1.5; }
                ctx.tracer(from, to, hit, 0xffd24a);
                if (hit && tgt.state !== 'dead') {
                  const killed = tgt.damage(48, 'body', ctx.now);
                  if (killed) ctx.onKill(tgt, 'M2 50機槍');
                }
              }
            }
          }
        }
      }
    }
  }
}
