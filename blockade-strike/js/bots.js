// =============================================================
// bots.js — BOT 隊友（房主本地 AI，自動加入連線房，無需房號）
// 職業分化：
//   🎯 阿凱 狙擊手 —— 遠距離高傷，保持 20~50m，單發重擊
//   💚 小琳 醫療兵 —— 靠近隊友脈衝回血，武器較弱
//   ⚡ 阿志/阿豪 衝鋒手 —— 貼臉猛攻，高速突進連射
// 透過快照同步給加入者（id 90+）
// =============================================================
import * as THREE from 'three';
import { Soldier, losClear } from './enemies.js';

const ROLES = [
  { key: 'sniper', name: 'BOT-阿凱', weapon: '狙擊槍', band: 0x8a4ad8, bandEm: 0x4a1a88, tracer: 0xc09aff, modelIdx: 3,
    minD: 20, maxD: 50, sight: 65, burst: 1, pause: [1.9, 2.6], dmg: [42, 58], acc: 0.92, accDrop: 0.004, speed: 2.7 },
  { key: 'medic', name: 'BOT-小琳', weapon: '衝鋒槍', band: 0x2ad86a, bandEm: 0x1a7a3a, tracer: 0x8affb0, modelIdx: 3,
    minD: 6, maxD: 18, sight: 35, burst: 2, pause: [1.2, 1.8], dmg: [6, 10], acc: 0.62, accDrop: 0.010, speed: 3.3, medic: true },
  { key: 'rusher', name: 'BOT-阿志', weapon: '霰彈槍', band: 0xd85a2a, bandEm: 0x7a2a10, tracer: 0xffb060, modelIdx: 2,
    minD: 3, maxD: 9, sight: 45, burst: 5, pause: [0.8, 1.3], dmg: [6, 9], acc: 0.72, accDrop: 0.012, speed: 3.9 },
  { key: 'rusher', name: 'BOT-阿豪', weapon: '霰彈槍', band: 0xd85a2a, bandEm: 0x7a2a10, tracer: 0xffb060, modelIdx: 2,
    minD: 3, maxD: 9, sight: 45, burst: 5, pause: [0.8, 1.3], dmg: [6, 9], acc: 0.72, accDrop: 0.012, speed: 3.9 },
];

class BotMate extends Soldier {
  constructor(scene, role, id) {
    super(scene, role.name, role.modelIdx);   // 綁定職業外觀：sniper/medic 用 hazmat 重裝,rusher 用 enemy 匪徒
    this.role = role;
    this.id = id;              // 快照玩家 id（90+）
    this.alive = true;
    this.isBot = true;
    this.vel = new THREE.Vector3();   // 敵人 AI 預判走位用
    this.noRespawn = true;     // 重生由 BotManager 控制
    // 職業色臂章：隊友識別
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.15),
      new THREE.MeshStandardMaterial({ color: role.band, roughness: 0.7, emissive: role.bandEm, emissiveIntensity: 0.5 }));
    band.position.set(-0.33, 1.5, 0);
    this.group.add(band);
    if (this._marker) this._marker.visible = false;   // BOT 隊友不顯示敵人標記
    // 黃金加特林持有者標記（50 殺獎勵槍，死亡立即消失）
    this.hasGatling = false;
    this.riding = false;   // 乘坐載具中（吉普車槍手，AI 由載具系統接管）
    const gb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.13, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xaa7a10, emissiveIntensity: 0.9, metalness: 0.9, roughness: 0.3 }));
    gb.position.set(0.33, 1.5, 0);
    gb.visible = false;
    this.goldBand = gb;
    this.group.add(gb);
    this.deadT = 0;
    this.healT = 1.5;
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
    if (this._glb) { this._glbDeath = false; this._curAnim = null; this._setAnim('idle'); }
    this._sync();
  }

  takeDamage(dmg) {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flinchT = 0.16;
    if (this.hp <= 0) {
      this.hp = 0; this.alive = false; this.state = 'dead'; this.deadT = 0;
      this.hasGatling = false;                 // 黃金加特林死亡立即消失
      if (this.goldBand) this.goldBand.visible = false;
      // GLB 模組有死亡動畫就播放
      const dn = this._animNames?.death;
      if (dn && this._actions?.[dn]) {
        const a = this._actions[dn];
        this.mixer.stopAllAction();
        a.reset();
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
        a.play();
        this._curAnim = dn;
        this._glbDeath = true;
      }
      return true;   // 陣亡
    }
    return false;
  }

  // ctx: { player, bots, enemies, now, onKill(e, bot), tracer(from, to, hit, color), heal(target, amt, medicName) }
  update(dt, ctx) {
    if (this.state === 'dead') {
      this.deadT += dt;
      if (this._glbDeath) {
        if (this.mixer) this.mixer.update(dt);
      } else {
        const t = Math.min(1, this.deadT / 0.35);
        this.group.rotation.z = t * Math.PI / 2 * (this._fallDir || (this._fallDir = Math.random() < .5 ? 1 : -1));
        this.group.position.y = -t * 0.25;
      }
      if (this.deadT > 1.2) this.group.visible = false;
      return;
    }
    if (this.riding) { this._sync(); return; }   // 乘坐載具中：位置由載具系統控制
    const R = this.role;
    const { player, enemies, now } = ctx;
    const spd = R.speed;
    this.moving = false;

    // 💚 醫療兵：治療脈衝（優先最缺血隊友，含玩家）
    if (R.medic) {
      this.healT -= dt;
      if (this.healT <= 0) {
        this.healT = 2.5;
        let ally = null, need = 0;
        if (player.alive && player.hp < 100 && this.pos.distanceTo(player.pos) < 8) { ally = 'player'; need = 100 - player.hp; }
        for (const b of ctx.bots) {
          if (b !== this && b.alive && b.hp < 100 && this.pos.distanceTo(b.pos) < 8 && (100 - b.hp) > need) { ally = b; need = 100 - b.hp; }
        }
        if (ally) {
          const tp = (ally === 'player' ? ctx.player.pos : ally.pos).clone(); tp.y += 1.3;
          ctx.tracer(this.muzzleWorld(), tp, true, 0x5aff8a);
          ctx.heal(ally, 16, this.name);
        }
      }
    }

    // 找最近可視敵人（視野依職業）
    const eye = this.pos.clone(); eye.y += 1.6;
    let tgt = null, best = R.sight;
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
      // 走位：保持職業交戰距離，偶爾橫移；卡住則繞行
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.8 + Math.random() * 1.2; this.strafeDir = Math.random() < .5 ? -1 : 1; }
      if (this._detourT > 0) {
        this._detourT -= dt;
        this._move(dt, -dz / dist * this._detourDir + dx / dist * 0.25, dx / dist * this._detourDir + dz / dist * 0.25, spd);
        this.moving = true;
      } else {
        let mx = -dz / dist * this.strafeDir, mz = dx / dist * this.strafeDir;
        if (dist > R.maxD) { mx += dx / dist * 1.4; mz += dz / dist * 1.4; }        // 太遠 → 壓上
        else if (dist < R.minD) { mx -= dx / dist * 1.4; mz -= dz / dist * 1.4; }   // 太近 → 拉開
        const ml = Math.hypot(mx, mz) || 1;
        this._move(dt, mx / ml, mz / ml, spd);
        this.moving = true;
      }
      // 開火（命中掃描，依職業點放數 / 間隔 / 傷害 / 命中率）
      if (this.goldBand) this.goldBand.visible = this.hasGatling;   // 加特林持有者金臂章
      if (this.burstLeft > 0) {
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = this.hasGatling ? 0.07 : 0.14; this.burstLeft--;
          this._shootAt(tgt, ctx);
        }
      } else {
        this.pauseT -= dt;
        if (this.pauseT <= 0) {
          this.burstLeft = this.hasGatling ? 14 : R.burst;   // 加特林：長點放
          this.pauseT = this.hasGatling ? 0.5 + Math.random() * 0.5 : R.pause[0] + Math.random() * (R.pause[1] - R.pause[0]);
        }
      }
    } else {
      // 無敵人：跟隨玩家（醫療兵貼更近）
      const followD = R.medic ? 3 : 5;
      const p = player.pos;
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      if (this._detourT > 0) {
        this._detourT -= dt;
        this._move(dt, -dz / dist * this._detourDir, dx / dist * this._detourDir, spd);
        this.moving = true;
      } else if (dist > followD) {
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

    // 動畫：GLB 模組用邏輯動畫；方塊模型走程序化擺動
    if (this._glb) {
      // 射擊中不切換動畫 — 沿用當前姿態 (Idle_Gun / Walk / Run) + 程式觸發 muzzle flash
      // swat.glb 全部 *Shoot* 動畫都前傾 15-27° (瞄準姿態)，保持原姿態視覺更自然
      let want;
      if (!this.moving) want = 'idle';
      else want = tgt ? 'run' : 'walk';
      this._setAnim(want);
      if (this.mixer) this.mixer.update(dt);
      if (this.state !== 'dead') this._uprightTorso();   // 導正 Body/Torso/Chest 累積 pitch/roll
    } else {
      const lerp = Math.min(1, dt * 10);
      if (this.moving) this.walkPh += dt * spd * 3.4;
      const sw = this.moving ? 1 : 0;
      this.legL.rotation.x += (Math.sin(this.walkPh) * 0.55 * sw - this.legL.rotation.x) * lerp;
      this.legR.rotation.x += (-Math.sin(this.walkPh) * 0.55 * sw - this.legR.rotation.x) * lerp;
      const armTarget = tgt ? -1.05 : Math.sin(this.walkPh + Math.PI) * 0.32 * sw;
      this.armL.rotation.x += (armTarget - this.armL.rotation.x) * lerp;
      this.armR.rotation.x = this.armL.rotation.x;
    }
    if (this.flinchT > 0) this.flinchT -= dt;
    // flinch 動畫：GLB 模型用 group.rotation 會跟骨架動畫衝突 → 身體斜斜。方塊模型仍可用
    if (!this._glb) {
      this.group.rotation.x = -Math.max(0, this.flinchT) * 1.5;
    } else {
      this.group.rotation.x = 0;
    }
    this._sync();
  }

  _shootAt(tgt, ctx) {
    const R = this.role;
    const from = this.muzzleWorld();
    const aim = tgt.pos.clone(); aim.y += 1.25;
    const dist = from.distanceTo(aim);
    const hit = Math.random() < Math.max(0.3, R.acc - dist * R.accDrop);
    // 曳光：命中打到敵人胸口，未命中飛過頭（加特林持有者金色曳光）
    const to = aim.clone();
    if (!hit) { to.x += (Math.random() - .5) * 1.6; to.y += 0.3 + Math.random() * 0.7; to.z += (Math.random() - .5) * 1.6; }
    ctx.tracer(from, to, hit, this.hasGatling ? 0xffd24a : R.tracer);
    if (hit && tgt.state !== 'dead') {
      const dmg = (R.dmg[0] + Math.random() * (R.dmg[1] - R.dmg[0])) * (this.hasGatling ? 2.5 : 1);
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

  // 房主建房：自動補滿 n 個 BOT 隊友（依序指派職業）
  ensure(n, playerPos) {
    while (this.bots.length < n) {
      const i = this.bots.length;
      const b = new BotMate(this.scene, ROLES[i % ROLES.length], 90 + i);
      b.bounds = { minX: -90, maxX: 90, minZ: -95, maxZ: 95 };
      b.placeNear(playerPos);
      this.bots.push(b);
    }
  }

  // 房主建房 / 調整：BOT 隊友數量設為 n
  setCount(n, playerPos) {
    while (this.bots.length > n) {
      const b = this.bots.pop();
      this.scene.remove(b.group); this.scene.remove(b._lodMesh);
    }
    this.ensure(n, playerPos);
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

  // 曳光彈視覺（職業色 / 治療綠光）
  tracer(from, to, hit, color = 0xffe0a0) {
    const mat = this._tracerMat.clone();
    mat.color.set(color);
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this._tracers.push({ line, t: 0.07 });
  }

  damage(bot, dmg) { return bot.takeDamage(dmg); }

  update(dt, ctx) {
    ctx.bots = this.bots;
    for (const b of this.bots) {
      b.update(dt, ctx);
      if (!b.alive && b.deadT > 6) { b._fallDir = 0; b.riding = false; b.placeNear(ctx.player.pos); }   // 陣亡 6 秒後重生
    }
    for (let i = this._tracers.length - 1; i >= 0; i--) {
      const t = this._tracers[i];
      t.t -= dt;
      t.line.material.opacity = Math.max(0, t.t / 0.07) * 0.9;
      if (t.t <= 0) { this.scene.remove(t.line); t.line.geometry.dispose(); this._tracers.splice(i, 1); }
    }
  }
}
