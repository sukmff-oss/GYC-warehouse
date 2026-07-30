import * as THREE from 'three';
import { colliders, enemySpawns, patrolPoints } from './map.js';
import { rayVsWorld } from './weapon.js';
import { audio } from './audio.js';
import { BulletPool } from './lod-mesh.js';

const NAMES = ['VIPER', 'JACKAL', 'COBRA', 'FALCON', 'GHOST', 'HYENA', 'RAZOR', 'WOLF', 'SNAKE', 'TALON', 'BEAR', 'HAWK'];
const UNIFORMS = [0x4f5c3a, 0x665232, 0x465262, 0x64552e];
const VESTS = [0x3d472c, 0x4a3d28, 0x333c46, 0x453a28];

export function losClear(a, b) {
  const dir = b.clone().sub(a);
  const dist = dir.length(); dir.normalize();
  const hit = rayVsWorld(a, dir, dist - 0.5);
  return !hit;
}

export class Soldier {
  constructor(scene, name) {
    this.scene = scene;
    this.name = name;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.hp = 100;
    this.state = 'patrol';       // patrol | engage | dead
    this.target = new THREE.Vector3();
    this.fireT = 0; this.burstLeft = 0; this.pauseT = 0;
    this.strafeT = 0; this.strafeDir = 1;
    this.deadT = 0;
    this.lastShotT = -10;
    this.speed = 2.6 + Math.random() * 0.8;
    this.hunter = false;        // 猎手：无视野也会主动索敌推进
    this.isBoss = false;        // BOSS：高血量高伤害，不重生
    this.noRespawn = false;
    this.playerSpawn = null;    // 玩家出生点（禁区）
    this.bounds = { minX: -28.5, maxX: 28.5, minZ: -90, maxZ: 90 };
    this._stuckT = 0;           // 卡住偵測：想移動但位移過小的累計時間
    this._lastX = 0; this._lastZ = 0;
    this._detourT = 0;          // 繞行計時（卡住時橫向繞過障礙）
    this._detourDir = 1;
    this._build();
    this.hitMeshes = [this.headM, this.torsoM, this.legsM];
  }

  _build() {
    const g = new THREE.Group();
    // 外观随机：军服 / 防弹衣配色
    const uniCol = UNIFORMS[(Math.random() * UNIFORMS.length) | 0];
    const vestCol = VESTS[(Math.random() * VESTS.length) | 0];
    const uni = new THREE.MeshStandardMaterial({ color: uniCol, roughness: 0.92 });
    const uniD = new THREE.MeshStandardMaterial({ color: new THREE.Color(uniCol).multiplyScalar(0.75), roughness: 0.95 });
    const skin = new THREE.MeshStandardMaterial({ color: [0xc9a184, 0xa87f62, 0x8a6a50][(Math.random() * 3) | 0], roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2e2f33, roughness: 0.55, metalness: 0.5 });
    const vest = new THREE.MeshStandardMaterial({ color: vestCol, roughness: 0.95 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 0.8 });
    const goggleMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.4 });

    const M = (geo, mt, x, y, z, parent = g) => {
      const m = new THREE.Mesh(geo, mt);
      m.position.set(x, y, z); m.castShadow = true;
      parent.add(m); return m;
    };

    // ===== 腿部（髋部组 + 可摆动小腿）=====
    this.legsM = M(new THREE.BoxGeometry(0.4, 0.3, 0.26), uniD, 0, 0.98, 0);  // 髋（命中区）
    this.legL = new THREE.Group(); this.legL.position.set(-0.115, 0.86, 0); g.add(this.legL);
    this.legR = new THREE.Group(); this.legR.position.set(0.115, 0.86, 0); g.add(this.legR);
    const mkLeg = (grp) => {
      M(new THREE.BoxGeometry(0.16, 0.5, 0.18), uni, 0, -0.25, 0, grp);                    // 大腿
      M(new THREE.BoxGeometry(0.14, 0.36, 0.15), uniD, 0, -0.63, 0.01, grp);               // 小腿
      M(new THREE.BoxGeometry(0.15, 0.11, 0.26), boot, 0, -0.86, 0.05, grp);               // 军靴
      M(new THREE.BoxGeometry(0.17, 0.12, 0.2), vest, 0, -0.48, 0.06, grp);                // 护膝
    };
    mkLeg(this.legL); mkLeg(this.legR);

    // ===== 躯干（战术背心）=====
    this.torsoM = M(new THREE.BoxGeometry(0.52, 0.55, 0.32), vest, 0, 1.36, 0);  // 命中区
    M(new THREE.BoxGeometry(0.46, 0.2, 0.3), uni, 0, 1.62, 0);                   // 肩部作战服
    for (let i = -1; i <= 1; i++)                                                 // 胸前附包 ×3
      M(new THREE.BoxGeometry(0.13, 0.15, 0.08), uniD, i * 0.15, 1.3, 0.2);
    M(new THREE.BoxGeometry(0.5, 0.09, 0.3), dark, 0, 1.06, 0);                  // 腰带
    M(new THREE.BoxGeometry(0.36, 0.44, 0.18), uniD, 0, 1.36, -0.27);            // 背包
    M(new THREE.BoxGeometry(0.3, 0.1, 0.12), vest, 0, 1.06, -0.24);              // 腰后包

    // ===== 手臂（肩组可摆动 / 交战前指）=====
    this.armL = new THREE.Group(); this.armL.position.set(-0.33, 1.56, 0); g.add(this.armL);
    this.armR = new THREE.Group(); this.armR.position.set(0.33, 1.56, 0); g.add(this.armR);
    const mkArm = (grp) => {
      M(new THREE.SphereGeometry(0.1, 8, 8), uniD, 0, 0.02, 0, grp);              // 肩甲
      M(new THREE.BoxGeometry(0.13, 0.34, 0.14), uni, 0, -0.2, 0, grp);           // 上臂
      M(new THREE.BoxGeometry(0.11, 0.3, 0.12), uniD, 0, -0.48, 0.03, grp);       // 前臂
      M(new THREE.BoxGeometry(0.09, 0.09, 0.1), skin, 0, -0.66, 0.04, grp);       // 手套
    };
    mkArm(this.armL); mkArm(this.armR);

    // ===== 头部（球面 + 头盔 + 护目镜）=====
    this.headM = M(new THREE.SphereGeometry(0.145, 12, 10), skin, 0, 1.74, 0);   // 命中区
    if (Math.random() < 0.72) {
      M(new THREE.SphereGeometry(0.175, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), Math.random() < 0.5 ? dark : uni, 0, 1.78, 0); // 头盔
      M(new THREE.BoxGeometry(0.3, 0.05, 0.28), dark, 0, 1.74, 0);               // 盔沿
    } else {
      M(new THREE.BoxGeometry(0.26, 0.08, 0.26), vest, 0, 1.86, 0);              // 便帽
    }
    M(new THREE.BoxGeometry(0.2, 0.055, 0.03), goggleMat, 0, 1.75, 0.135);            // 护目镜（微紅光，夜晚可辨）
    M(new THREE.BoxGeometry(0.1, 0.08, 0.1), skin, 0, 1.6, 0.06);                // 颈部/下颌

    // ===== 步枪（机匣/枪管/弹匣/枪托/瞄具）=====
    const gun = new THREE.Group(); gun.position.set(0.16, 1.34, 0.28); g.add(gun);
    M(new THREE.BoxGeometry(0.06, 0.1, 0.42), dark, 0, 0, 0.1, gun);             // 机匣
    const barrel = M(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), dark, 0, 0.01, 0.48, gun);
    barrel.rotation.x = Math.PI / 2;
    M(new THREE.BoxGeometry(0.05, 0.16, 0.08), dark, 0, -0.11, 0.06, gun);       // 弹匣
    M(new THREE.BoxGeometry(0.05, 0.09, 0.18), dark, 0, -0.01, -0.2, gun);       // 枪托
    M(new THREE.BoxGeometry(0.03, 0.05, 0.06), dark, 0, 0.09, 0.12, gun);        // 瞄具
    this.muzzleLocal = new THREE.Vector3(0.16, 1.35, 0.78);

    // 体型微差
    g.scale.setScalar(0.94 + Math.random() * 0.14);

    this.walkPh = Math.random() * 7;
    this.flinchT = 0;
    this.moving = false;
    // 敵人頭頂標記：紅色倒三角，遠距離 / 夜晚清楚可辨
    {
      const mkc = document.createElement('canvas'); mkc.width = mkc.height = 64;
      const mkx = mkc.getContext('2d');
      mkx.fillStyle = '#ff3838';
      mkx.beginPath(); mkx.moveTo(14, 16); mkx.lineTo(50, 16); mkx.lineTo(32, 46); mkx.closePath(); mkx.fill();
      this._marker = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(mkc), transparent: true, depthWrite: false, fog: false, opacity: 0.92
      }));
      this._marker.scale.set(0.6, 0.6, 1);
      this._marker.position.y = 2.35;
      g.add(this._marker);
    }
    this.headM.userData = { soldier: this, part: 'head' };
    this.torsoM.userData = { soldier: this, part: 'body' };
    this.legsM.userData = { soldier: this, part: 'body' };
    this.group = g;
    this.scene.add(g);

    // === LOD 簡化模型 ===
    this._lodMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.7, 0.35),
      new THREE.MeshStandardMaterial({ color: uniCol, roughness: 0.95 })
    );
    this._lodMesh.position.copy(g.position);
    this._lodMesh.visible = false;
    this._lodMesh.userData = { soldier: this, part: 'body' };
    this.scene.add(this._lodMesh);
  }

  spawn(playerPos) {
    // 45% 概率全图随机区域出现（距玩家 >20m 且不在掩体内），其余走出生点
    let placed = false;
    const ps = this.playerSpawn;
    if (Math.random() < 0.45) {
      for (let i = 0; i < 24; i++) {
        const x = this.bounds.minX + 2 + Math.random() * (this.bounds.maxX - this.bounds.minX - 4);
        const z = this.bounds.minZ + 2 + Math.random() * (this.bounds.maxZ - this.bounds.minZ - 4);
        if (Math.hypot(x - playerPos.x, z - playerPos.z) > 20
          && (!ps || Math.hypot(x - ps.x, z - ps.z) > 25)   // 玩家出生点禁区
          && !this._blocked(x, z)) {
          this.pos.set(x, 0, z); placed = true; break;
        }
      }
    }
    if (!placed) {
      const far = enemySpawns.filter(p => p.distanceTo(playerPos) > 20
        && (!ps || p.distanceTo(ps) > 25));
      const pool = far.length ? far : enemySpawns;
      // 出生點 + 隨機偏移後必須不在掩體內，否則換點重試（避免卡進建築物）
      for (let i = 0; i < 14 && !placed; i++) {
        const p = pool[(Math.random() * pool.length) | 0];
        const x = p.x + (Math.random() - .5) * 3, z = p.z + (Math.random() - .5) * 3;
        if (!this._blocked(x, z)) { this.pos.set(x, 0, z); placed = true; }
      }
      if (!placed) {   // 兜底：全圖隨機找空點
        for (let i = 0; i < 24 && !placed; i++) {
          const x = this.bounds.minX + 2 + Math.random() * (this.bounds.maxX - this.bounds.minX - 4);
          const z = this.bounds.minZ + 2 + Math.random() * (this.bounds.maxZ - this.bounds.minZ - 4);
          if (!this._blocked(x, z)) { this.pos.set(x, 0, z); placed = true; }
        }
      }
      if (!placed) this.pos.copy(pool[0]);
    }
    this.hp = 100;
    this.state = 'patrol';
    this.group.visible = true;
    this.group.rotation.set(0, 0, 0);
    this._pickPatrol();
    this._sync();
  }

  _pickPatrol() {
    // 巡邏目標不能在建築物/掩體內，多試幾次避開壞點
    for (let i = 0; i < 8; i++) {
      const p = patrolPoints[(Math.random() * patrolPoints.length) | 0];
      if (!this._blocked(p.x, p.z)) { this.target.copy(p); return; }
    }
    this.target.copy(patrolPoints[0]);
  }

  _sync() {
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    if (this._lodMesh) {
      this._lodMesh.position.copy(this.pos);
      this._lodMesh.rotation.y = this.yaw;
    }
  }

  _move(dt, dirX, dirZ, speed) {
    const nx = this.pos.x + dirX * speed * dt;
    const nz = this.pos.z + dirZ * speed * dt;
    // X 轴
    if (!this._blocked(nx, this.pos.z)) this.pos.x = nx;
    if (!this._blocked(this.pos.x, nz)) this.pos.z = nz;
    this.pos.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.pos.x));
    this.pos.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.pos.z));
  }

  _blocked(x, z) {
    const r = 0.4;
    for (const c of colliders) {
      if (c.max.y < 0.4 || c.min.y > 1.5) continue;
      if (x + r > c.min.x && x - r < c.max.x && z + r > c.min.z && z - r < c.max.z) return true;
    }
    return false;
  }

  damage(amount, part, now) {
    if (this.state === 'dead') return false;
    this.flinchT = 0.16;   // 受击后仰
    this.hp -= part === 'head' ? 100 : amount;
    if (this.hp <= 0) {
      this.state = 'dead'; this.deadT = 0;
      this.respawnAt = 1.5 + Math.random() * 1.5;   // 快速刷新：1.5~3s 后随机点重生
      return true;
    }
    // 被打后进入交战
    if (this.state === 'patrol') this.state = 'engage';
    return false;
  }

  muzzleWorld() {
    return this.muzzleLocal.clone().applyMatrix4(this.group.matrixWorld);
  }

  update(dt, playerOrTargets, now, fx) {
    // 多人連線：可傳入目標陣列，敵人自動找最近的存活玩家
    const targets = (Array.isArray(playerOrTargets) ? playerOrTargets : [playerOrTargets]).filter(p => p && p.alive);
    let player = targets[0] || (Array.isArray(playerOrTargets) ? null : playerOrTargets);
    if (targets.length > 1) {
      let best = Infinity;
      for (const t of targets) {
        const d = this.pos.distanceTo(t.pos);
        if (d < best) { best = d; player = t; }
      }
    }
    if (this.state === 'dead') {
      this.deadT += dt;
      // 倒地
      const t = Math.min(1, this.deadT / 0.35);
      this.group.rotation.z = t * Math.PI / 2 * (this._fallDir || (this._fallDir = Math.random() < .5 ? 1 : -1));
      this.group.position.y = -t * 0.25;
      if (this.deadT > 2.2) this.group.visible = false;
      if (!this.noRespawn && this.deadT > this.respawnAt) { this._fallDir = 0; this.spawn(player ? player.pos : this.pos); }
      return;
    }
    if (!player) { this._sync(); return; }   // 無存活目標：待機

    const eye = this.pos.clone().add(new THREE.Vector3(0, 1.6, 0));
    const pEye = player.pos.clone().add(new THREE.Vector3(0, 1.55, 0));
    const dist = this.pos.distanceTo(player.pos);
    const canSee = player.alive && dist < 60 && losClear(eye, pEye);

    if (canSee) this.state = 'engage';
    else if (this.hunter && player.alive && dist < 90) this.state = 'engage'; // 猎手主动索敌
    else if (this.state === 'engage' && dist > 70) this.state = 'patrol';

    const spd = this.hunter ? this.speed * 1.3 : this.speed;
    this.moving = false;

    if (this.state === 'patrol') {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.5) this._pickPatrol();
      else {
        this.yaw = Math.atan2(dx, dz);
        this._move(dt, dx / d, dz / d, spd * 0.7);
        this.moving = true;
      }
    } else { // engage
      const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
      this.yaw = Math.atan2(dx, dz);
      // 走位：保持距离 + 横移
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = 0.8 + Math.random() * 1.2; this.strafeDir = Math.random() < .5 ? -1 : 1; }
      if (this._detourT > 0) {
        // 卡住繞行：沿障礙切線方向走一段
        this._detourT -= dt;
        const ml = dist || 1;
        this._move(dt, -dz / ml * this._detourDir + dx / ml * 0.25, dx / ml * this._detourDir + dz / ml * 0.25, spd);
        this.moving = true;
      } else if (canSee) {
        const px = -dz / (dist || 1) * this.strafeDir, pz = dx / (dist || 1) * this.strafeDir;
        let mx = px, mz = pz;
        if (dist > 30) { mx += dx / dist * 0.8; mz += dz / dist * 0.8; }
        else if (dist < 9) { mx -= dx / dist; mz -= dz / dist; }
        const ml = Math.hypot(mx, mz) || 1;
        this._move(dt, mx / ml, mz / ml, spd);
        this.moving = true;
      } else {
        // 失去视野则向玩家推进（猎手全程如此）
        this._move(dt, dx / (dist || 1), dz / (dist || 1), spd * 0.9);
        this.moving = true;
      }

      // 开火
      if (canSee && now - this.lastShotT > 0.05) {
        if (this.burstLeft > 0) {
          this.fireT -= dt;
          if (this.fireT <= 0) {
            this.fireT = 0.13;
            this.burstLeft--;
            this._shoot(player, dist, fx, now);
          }
        } else {
          this.pauseT -= dt;
          if (this.pauseT <= 0) {
            this.burstLeft = 3 + (Math.random() * 3 | 0);
            this.pauseT = 0.7 + Math.random() * 1.1;
          }
        }
      }
    }
    // ===== 卡住偵測：想動卻動不了 → 換巡邏點或橫向繞行 =====
    if (this.moving) {
      const moved = Math.hypot(this.pos.x - this._lastX, this.pos.z - this._lastZ);
      if (moved < 0.3 * spd * dt) this._stuckT += dt; else this._stuckT = 0;
      if (this._stuckT > 1.0) {
        this._stuckT = 0;
        if (this.state === 'patrol') this._pickPatrol();
        else { this._detourT = 0.9; this._detourDir = Math.random() < .5 ? -1 : 1; }
      }
    } else this._stuckT = 0;
    this._lastX = this.pos.x; this._lastZ = this.pos.z;

    // ===== 程序化动画：行走摆动 / 交战持枪 / 受击后仰 =====
    const lerp = Math.min(1, dt * 10);
    if (this.moving) this.walkPh += dt * spd * 3.4;
    const sw = this.moving ? 1 : 0;
    this.legL.rotation.x += (Math.sin(this.walkPh) * 0.55 * sw - this.legL.rotation.x) * lerp;
    this.legR.rotation.x += (-Math.sin(this.walkPh) * 0.55 * sw - this.legR.rotation.x) * lerp;
    const armTarget = this.state === 'engage'
      ? -1.05 + Math.sin(now * 2 + this.walkPh) * 0.03           // 持枪前指 + 呼吸微晃
      : Math.sin(this.walkPh + Math.PI) * 0.32 * sw;             // 巡逻摆臂
    this.armL.rotation.x += (armTarget - this.armL.rotation.x) * lerp;
    this.armR.rotation.x = this.armL.rotation.x;
    // 受击后仰
    if (this.flinchT > 0) this.flinchT -= dt;
    this.group.rotation.x = -Math.max(0, this.flinchT) * 1.5;

    this._sync();

    // LOD 切換
    if (this._lodMesh) {
      const cam = window.__game?.player?.pos;
      if (cam) {
        const dist = this.pos.distanceTo(cam);
        const useLOD = dist > 100;   // 100m 內保持完整模型，遠方敵人清楚可見
        if (this.group.visible !== !useLOD || this._lodMesh.visible !== useLOD) {
          this.group.visible = !useLOD;
          this._lodMesh.visible = useLOD;
        }
      }
    }
  }

  _shoot(player, dist, fx, now) {
    this.lastShotT = now;
    const from = this.muzzleWorld();
    // 实体弹道：瞄准胸口，误差随距离与玩家机动增长（BOSS 更准）
    const aim = player.pos.clone(); aim.y += 1.25;
    const moveP = Math.min(1, Math.hypot(player.vel.x, player.vel.z) / 6);
    let err = 0.22 + dist * 0.028 + moveP * 0.85;
    if (this.isBoss) err *= 0.5;
    aim.x += (Math.random() - .5) * err * 2;
    aim.y += (Math.random() - .5) * err * 1.1;
    aim.z += (Math.random() - .5) * err * 2;
    const dir = aim.sub(from).normalize();
    const speed = this.isBoss ? 110 : 85;
    let dmg = this.isBoss ? 13 + Math.random() * 9 : 7 + Math.random() * 7;
    dmg *= Math.max(0.4, 1 - dist / 140);   // 射程衰减（最低 40%）
    fx.enemyBullet(from, dir, speed, dmg, this.isBoss);
    audio.shot(dist);
  }
}

export class EnemyManager {
  constructor(scene, count = 12) {
    this.scene = scene;
    this.soldiers = [];
    this.raycaster = new THREE.Raycaster();
    this.tracers = [];
    this.bulletPool = new BulletPool(scene, 50);
    this._li = 0;
    // 曳光材质（共享）
    this.bulletHeadMat = new THREE.SpriteMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.bulletHeadMat.color.setRGB(2.4, 1.1, 0.4);   // HDR 曳光（触发 Bloom）
    this.bulletLineMat = new THREE.LineBasicMaterial({
      color: 0xff8a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending
    });
    this.bossLineMat = new THREE.LineBasicMaterial({
      color: 0xffd040, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending
    });
    // 枪口火光点光池
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const L = new THREE.PointLight(0xff9040, 0, 9);
      scene.add(L); this.lights.push(L);
    }
    for (let i = 0; i < count; i++) {
      const s = new Soldier(scene, NAMES[i % NAMES.length] + '-' + (i + 1));
      s.hunter = i % 5 < 2 && i < 11;   // 约 40% 猎手：主动进攻
      this.soldiers.push(s);
    }
  }

  // 生成一颗实体敌方子弹（85~110 m/s，射程 140m）
  fireBullet(from, dir, speed, dmg, boss = false) {
    const b = this.bulletPool.acquire(from, dir, speed, dmg, boss);
    // 枪口火光
    const L = this.lights[this._li++ % this.lights.length];
    L.position.copy(from); L.intensity = 9;
    return b;
  }

  updateBullets(dt, playerOrTargets, fx) {
    const targets = (Array.isArray(playerOrTargets) ? playerOrTargets : [playerOrTargets]).filter(p => p && p.alive);
    const active = this.bulletPool.getActive();
    for (let i = active.length - 1; i >= 0; i--) {
      const b = active[i];
      const d = b.data;
      const prev = d.pos.clone();
      d.life -= dt;
      d.pos.addScaledVector(d.vel, dt);
      // 曳光拖尾
      const arr = b.line.geometry.attributes.position.array;
      arr[0] = d.pos.x - d.vel.x * 0.055; arr[1] = d.pos.y - d.vel.y * 0.055; arr[2] = d.pos.z - d.vel.z * 0.055;
      arr[3] = d.pos.x; arr[4] = d.pos.y; arr[5] = d.pos.z;
      b.line.geometry.attributes.position.needsUpdate = true;
      b.head.position.copy(d.pos);
      let dead = d.life <= 0;
      // 命中玩家（逐一檢查所有目標）
      if (!dead) {
        for (const tgt of targets) {
          const sx = d.pos.x - prev.x, sz = d.pos.z - prev.z;
          const L2 = sx * sx + sz * sz;
          let t = L2 > 1e-9 ? ((tgt.pos.x - prev.x) * sx + (tgt.pos.z - prev.z) * sz) / L2 : 0;
          t = Math.max(0, Math.min(1, t));
          const cx = prev.x + sx * t, cz = prev.z + sz * t;
          const cy = prev.y + (d.pos.y - prev.y) * t;
          const hd = Math.hypot(tgt.pos.x - cx, tgt.pos.z - cz);
          const relY = cy - tgt.pos.y;
          if (hd < 0.42 && relY > -0.1 && relY < 1.85) {
            fx.playerHit(d.dmg, d.from, tgt);
            dead = true; break;
          } else if (!d.whizzed && hd < 2.2 && relY > -0.2 && relY < 2.2) {
            d.whizzed = true;
            audio.whizz();
          }
        }
      }
      // 命中世界
      if (!dead) {
        const seg = d.pos.clone().sub(prev);
        const L = seg.length();
        if (L > 1e-6) {
          seg.normalize();
          const wHit = rayVsWorld(prev, seg, L + 0.05);
          if (wHit) { fx.enemyImpact(prev.clone().addScaledVector(seg, wHit.t)); dead = true; }
        }
        if (!dead && d.pos.y <= 0.02) { fx.enemyImpact(d.pos.clone()); dead = true; }
      }
      if (dead) {
        this.bulletPool.release(b);
      }
    }
    // 枪口火光衰减
    for (const L of this.lights) if (L.intensity > 0.01) L.intensity *= Math.pow(0.0001, dt);
  }

  clearBullets() {
    this.bulletPool.clear();
  }

  setBounds(b, playerSpawn = null) {
    for (const s of this.soldiers) { s.bounds = b; if (playerSpawn) s.playerSpawn = playerSpawn; }
    this.playerSpawn = playerSpawn;
  }

  // 生成 BOSS（不重生，金色王冠标记）
  spawnBoss(pos, { hp = 600, scale = 1.45, name = 'BOSS·軍閥', rare = false } = {}) {
    const s = new Soldier(this.scene, name);
    s.isBoss = true; s.noRespawn = true; s.hunter = true;
    s.maxHp = hp; s.hp = hp;
    s.speed = 3.4;
    s.group.scale.setScalar(scale);
    // 王冠 / 远古守卫金面
    const crownMat = new THREE.MeshStandardMaterial({ color: rare ? 0xffd700 : 0xd8a828, metalness: 0.9, roughness: 0.25, emissive: 0x6a4a00, emissiveIntensity: 0.6 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.14, 8), crownMat);
    crown.position.y = 1.92; s.group.add(crown);
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), crownMat);
      const a = i * Math.PI / 2;
      spike.position.set(Math.cos(a) * 0.2, 2.05, Math.sin(a) * 0.2);
      s.group.add(spike);
    }
    s.pos.copy(pos); s.state = 'patrol'; s.group.visible = true; s._sync();
    s.bounds = this.soldiers[0] ? this.soldiers[0].bounds : s.bounds;
    s.playerSpawn = this.playerSpawn || null;
    this.soldiers.push(s);
    return s;
  }

  // 重建普通士兵（奇遇地图换编制用）
  reset(count, bounds, playerSpawn) {
    for (const s of this.soldiers) this.scene.remove(s.group);
    this.soldiers.length = 0;
    for (let i = 0; i < count; i++) {
      const s = new Soldier(this.scene, NAMES[i % NAMES.length] + '-' + (i + 1));
      s.hunter = i % 5 < 2 && i < 11;
      if (bounds) s.bounds = bounds;
      if (playerSpawn) s.playerSpawn = playerSpawn;
      this.soldiers.push(s);
    }
  }

  removeBosses() {
    for (let i = this.soldiers.length - 1; i >= 0; i--) {
      if (this.soldiers[i].isBoss) { this.scene.remove(this.soldiers[i].group); this.soldiers.splice(i, 1); }
    }
  }

  spawnAll(playerPos) {
    for (const s of this.soldiers) s.spawn(playerPos);
  }

  aliveCount() { return this.soldiers.filter(s => s.state !== 'dead').length; }

  // 玩家射线命中检测
  hitTest(origin, dir, maxDist) {
    const meshes = [];
    for (const s of this.soldiers) {
      if (s.state === 'dead') continue;
      meshes.push(...s.hitMeshes);
    }
    this.raycaster.set(origin, dir);
    this.raycaster.far = maxDist;
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const h = hits[0];
    return { t: h.distance, soldier: h.object.userData.soldier, part: h.object.userData.part, point: h.point };
  }

  update(dt, player, now, fx) {
    for (const s of this.soldiers) s.update(dt, player, now, fx);
    this.updateBullets(dt, player, fx);
    // 敌方曳光
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt; t.obj.material.opacity = Math.max(0, t.life / 0.09);
      if (t.life <= 0) { this.scene.remove(t.obj); t.obj.geometry.dispose(); this.tracers.splice(i, 1); }
    }
  }
}
