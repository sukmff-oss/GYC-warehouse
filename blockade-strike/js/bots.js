// =============================================================
// bots.js — BOT 隊友（房主本地 AI，自動加入連線房，無需房號）
// 跟隨玩家、主動索敵開火；透過快照同步給加入者（id 90+）
// =============================================================
import * as THREE from 'three';
import { Soldier, losClear } from './enemies.js';

const BOT_NAMES = ['BOT-阿凱', 'BOT-小琳', 'BOT-阿志'];

class BotMate extends Soldier {
  constructor(scene, name, id) {
    super(scene, name);
    this.id = id;              // 快照玩家 id（90+）
    this.alive = true;
    this.isBot = true;
    this.vel = new THREE.Vector3();   // 敵人 AI 預判走位用
    this.noRespawn = true;     // 重生由 BotManager 控制
    // 藍色臂章：隊友識別
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.15),
      new THREE.MeshStandardMaterial({ color: 0x2a6ad8, roughness: 0.7, emissive: 0x1a3a78, emissiveIntensity: 0.5 }));
    band.position.set(-0.33, 1.5, 0);
    this.group.add(band);
    this.deadT = 0;
  }

  placeNear(p) {
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 3;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (!this._blocked(x, z)) { this.pos.set(x, 0, z); break; }
    }
    this.hp = 100; this.alive = true; this.state = 'patrol';
    this.group.visible = true; this.group.rotation.set(0, 0, 0);
    this.group.position.y = 0;
    this._sync();
  }

  takeDamage(dmg) {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flinchT = 0.16;
    if (this.hp <= 0) {
      this.hp = 0; this.alive = false; this.state = 'dead'; this.deadT = 0;
      return true;   // 陣亡
    }
    return false;
  }

  // ctx: { player, enemies, now, onKill(e, bot), tracer(from, to, hit) }
  update(dt, ctx) {
    if (this.state === 'dead') {
      this.deadT += dt;
      const t = Math.min(1, this.deadT / 0.35);
      this.group.rotation.z = t * Math.PI / 2 * (this._fallDir || (this._fallDir = Math.random() < .5 ? 1 : -1));
      this.group.position.y = -t * 0.25;
      if (this.deadT > 1.2) this.group.visible = false;
      return;
    }
    const { player, enemies, now } = ctx;
    const spd = 3.1;
    this.moving = false;

    // 找最近可視敵人
    const eye = this.pos.clone(); eye.y += 1.6;
    let tgt = null, best = 55;
    for (const e of enemies.soldiers) {
      if (e.state === 'dead') continue;
      const d = this.pos.distanceTo(e.pos);
      if (d < best) {
        const te = e.pos.clone(); te.y += 1.3;
        if (losClear(eye, te)) { best = d; tgt = e; }
      }
    }

    if (tgt) {
      const dx = tgt.pos.x - this.pos.x, dz = tgt.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      this.yaw = Math.atan2(dx, dz);
      // 走位：保持 8~26m，偶爾橫移；卡住則繞行
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.8 + Math.random() * 1.2; this.strafeDir = Math.random() < .5 ? -1 : 1; }
      if (this._detourT > 0) {
        this._detourT -= dt;
        this._move(dt, -dz / dist * this._detourDir + dx / dist * 0.25, dx / dist * this._detourDir + dz / dist * 0.25, spd);
        this.moving = true;
      } else {
        let mx = -dz / dist * this.strafeDir, mz = dx / dist * this.strafeDir;
        if (dist > 26) { mx += dx / dist; mz += dz / dist; }
        else if (dist < 8) { mx -= dx / dist; mz -= dz / dist; }
        const ml = Math.hypot(mx, mz) || 1;
        if (dist > 26 || dist < 8 || Math.random() < 0.7) {
          this._move(dt, mx / ml, mz / ml, spd);
          this.moving = true;
        }
      }
      // 開火（命中掃描，3 發點放）
      if (this.burstLeft > 0) {
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = 0.14; this.burstLeft--;
          this._shootAt(tgt, ctx);
        }
      } else {
        this.pauseT -= dt;
        if (this.pauseT <= 0) { this.burstLeft = 3; this.pauseT = 0.9 + Math.random() * 1.2; }
      }
    } else {
      // 無敵人：跟隨玩家（保持 3~6m）
      const p = player.pos;
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      if (this._detourT > 0) {
        this._detourT -= dt;
        this._move(dt, -dz / dist * this._detourDir, dx / dist * this._detourDir, spd);
        this.moving = true;
      } else if (dist > 5) {
        this.yaw = Math.atan2(dx, dz);
        this._move(dt, dx / dist, dz / dist, dist > 14 ? spd * 1.35 : spd);
        this.moving = true;
      } else {
        // 站在玩家旁邊，朝向玩家視線方向
        let dy = player.yaw - this.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.yaw += dy * Math.min(1, dt * 5);
      }
    }

    // 卡住偵測 → 橫向繞行
    if (this.moving) {
      const moved = Math.hypot(this.pos.x - this._lastX, this.pos.z - this._lastZ);
      if (moved < 0.3 * spd * dt) this._stuckT += dt; else this._stuckT = 0;
      if (this._stuckT > 1.0) { this._stuckT = 0; this._detourT = 0.9; this._detourDir = Math.random() < .5 ? -1 : 1; }
    } else this._stuckT = 0;
    this._lastX = this.pos.x; this._lastZ = this.pos.z;

    // 動畫
    const lerp = Math.min(1, dt * 10);
    if (this.moving) this.walkPh += dt * spd * 3.4;
    const sw = this.moving ? 1 : 0;
    this.legL.rotation.x += (Math.sin(this.walkPh) * 0.55 * sw - this.legL.rotation.x) * lerp;
    this.legR.rotation.x += (-Math.sin(this.walkPh) * 0.55 * sw - this.legR.rotation.x) * lerp;
    const armTarget = tgt ? -1.05 : Math.sin(this.walkPh + Math.PI) * 0.32 * sw;
    this.armL.rotation.x += (armTarget - this.armL.rotation.x) * lerp;
    this.armR.rotation.x = this.armL.rotation.x;
    if (this.flinchT > 0) this.flinchT -= dt;
    this.group.rotation.x = -Math.max(0, this.flinchT) * 1.5;
    this._sync();
  }

  _shootAt(tgt, ctx) {
    const from = this.muzzleWorld();
    const aim = tgt.pos.clone(); aim.y += 1.25;
    const dist = from.distanceTo(aim);
    const hit = Math.random() < Math.max(0.35, 0.8 - dist * 0.008);   // 越近越準
    // 曳光：命中打到敵人胸口，未命中飛過頭
    const to = aim.clone();
    if (!hit) { to.x += (Math.random() - .5) * 1.6; to.y += 0.3 + Math.random() * 0.7; to.z += (Math.random() - .5) * 1.6; }
    ctx.tracer(from, to, hit);
    if (hit && tgt.state !== 'dead') {
      const dmg = 12 + Math.random() * 8;
      const killed = tgt.damage(dmg, 'body', ctx.now);
      if (killed) ctx.onKill(tgt, this);
    }
  }
}

export class BotManager {
  constructor(scene) {
    this.scene = scene;
    this.bots = [];
    this._tracers = [];
    this._tracerMat = new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.9 });
  }

  get count() { return this.bots.length; }

  // 房主建房：自動補滿 n 個 BOT 隊友
  ensure(n, playerPos) {
    while (this.bots.length < n) {
      const i = this.bots.length;
      const b = new BotMate(this.scene, BOT_NAMES[i] || 'BOT-' + (i + 1), 90 + i);
      b.bounds = { minX: -90, maxX: 90, minZ: -95, maxZ: 95 };
      b.placeNear(playerPos);
      this.bots.push(b);
    }
  }

  setBounds(bounds) { for (const b of this.bots) b.bounds = bounds; }

  reset(playerPos) {
    for (const b of this.bots) { b._fallDir = 0; b.placeNear(playerPos); }
    for (const t of this._tracers) this.scene.remove(t.line);
    this._tracers.length = 0;
  }

  clear() {
    for (const b of this.bots) { this.scene.remove(b.group); this.scene.remove(b._lodMesh); }
    this.bots.length = 0;
    for (const t of this._tracers) this.scene.remove(t.line);
    this._tracers.length = 0;
  }

  // 敵人 AI 的目標 stub（BOT 本人即 stub：有 pos/alive/isBot/id/name）
  targetStubs() { return this.bots.filter(b => b.alive); }

  // 快照列（id 90+，加入者渲染成隊友化身）
  snapRows() {
    return this.bots.map(b => [b.id, +b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2),
      +b.yaw.toFixed(2), 0, b.hp, b.moving ? 1 : 0]);
  }

  // 曳光彈視覺
  tracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, this._tracerMat.clone());
    this.scene.add(line);
    this._tracers.push({ line, t: 0.07 });
  }

  damage(bot, dmg) { return bot.takeDamage(dmg); }

  update(dt, ctx) {
    for (const b of this.bots) {
      b.update(dt, ctx);
      if (!b.alive && b.deadT > 6) { b._fallDir = 0; b.placeNear(ctx.player.pos); }   // 陣亡 6 秒後重生
    }
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const t = this._tracers[i];
      t.t -= dt;
      t.line.material.opacity = Math.max(0, t.t / 0.07) * 0.9;
      if (t.t <= 0) { this.scene.remove(t.line); t.line.geometry.dispose(); this._tracers.splice(i, 1); }
    }
  }
}
