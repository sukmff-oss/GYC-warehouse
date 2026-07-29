import * as THREE from 'three';
import { colliders } from './map.js';
import { audio } from './audio.js';

const GRAVITY = 22, WALK = 5.2, SPRINT = 8.2, JUMP = 8.2;   // 跳跃可登上汽车引擎盖/木箱
const EYE = 1.66, RADIUS = 0.42;

export class Player {
  constructor(camera, dom) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 0, 78);   // 脚底位置
    this.vel = new THREE.Vector3();
    this.yaw = 0;                              // 面向 -z（北）
    this.pitch = 0;
    this.onGround = true;
    this.keys = {};
    this.hp = 100;
    this.armor = 0;
    this.alive = true;
    this.sprinting = false;
    this.bobT = 0;
    this.recoilPitch = 0;
    this.lastDamageT = -10;
    this.protectT = 0;          // 出生保护剩余秒数（敌方攻击无效）
    this._stepT = 0;
    this.touchMove = { f: 0, s: 0 };   // 手机摇杆
    this.touchSprint = false;
    this.bounds = { minX: -28.5, maxX: 28.5, minZ: -90, maxZ: 90 };

    document.addEventListener('keydown', e => { this.keys[e.code] = true; });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== dom || !this.alive) return;
      this.yaw -= e.movementX * 0.0021;
      this.pitch -= e.movementY * 0.0021;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
  }

  look(dx, dy) {   // 触屏视角
    if (!this.alive) return;
    this.yaw -= dx * 0.0042;
    this.pitch -= dy * 0.0042;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  setBounds(b) { this.bounds = b; }

  spawn(p) {
    this.pos.copy(p); this.vel.set(0, 0, 0);
    this.hp = 100; this.armor = 0; this.alive = true;
    this.yaw = 0; this.pitch = 0;
    this.lastDamageT = -10;
    this.protectT = 10;   // 出生保护 10 秒
  }

  damage(amount, fromPos, now) {
    if (!this.alive) return false;
    // 护甲吸收 60% 伤害
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.6);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.hp -= amount;
    this.lastDamageT = now;
    audio.hurt();
    if (this.hp <= 0) { this.hp = 0; this.alive = false; return true; }
    return false;
  }

  _collideAxis() {
    // 胶囊近似为 AABB，逐轴滑动
    const p = this.pos;
    for (const c of colliders) {
      if (p.x + RADIUS < c.min.x || p.x - RADIUS > c.max.x) continue;
      if (p.z + RADIUS < c.min.z || p.z - RADIUS > c.max.z) continue;
      if (p.y + 1.8 < c.min.y || p.y + 0.1 > c.max.y) continue;
      // 可站立面
      if (this.vel.y <= 0 && p.y > c.max.y - 0.45 && p.y < c.max.y + 0.6) {
        p.y = c.max.y; this.vel.y = 0; this.onGround = true; continue;
      }
      // 水平推离：选穿透最浅的轴
      const dx1 = (c.max.x + RADIUS) - p.x, dx2 = p.x - (c.min.x - RADIUS);
      const dz1 = (c.max.z + RADIUS) - p.z, dz2 = p.z - (c.min.z - RADIUS);
      const m = Math.min(dx1, dx2, dz1, dz2);
      if (m === dx1) p.x = c.max.x + RADIUS;
      else if (m === dx2) p.x = c.min.x - RADIUS;
      else if (m === dz1) p.z = c.max.z + RADIUS;
      else p.z = c.min.z - RADIUS;
    }
  }

  update(dt, ads) {
    if (!this.alive) return;
    if (this.protectT > 0) this.protectT -= dt;
    const k = this.keys;
    let f = (k['KeyW'] ? 1 : 0) - (k['KeyS'] ? 1 : 0) + this.touchMove.f;
    let s = (k['KeyD'] ? 1 : 0) - (k['KeyA'] ? 1 : 0) + this.touchMove.s;
    f = Math.max(-1, Math.min(1, f)); s = Math.max(-1, Math.min(1, s));
    this.sprinting = (!!k['ShiftLeft'] || this.touchSprint) && f > 0 && !ads;

    const speed = ads ? WALK * 0.55 : (this.sprinting ? SPRINT : WALK);
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // 前向 = (-sin, -cos)，右向 = (cos, -sin)... 以 yaw=0 朝 -z
    const dx = (-sin * f + cos * s), dz = (-cos * f - sin * s);
    const len = Math.hypot(dx, dz) || 1;
    const accel = this.onGround ? 14 : 4;
    this.vel.x += (dx / len * speed * (f || s ? 1 : 0) - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (dz / len * speed * (f || s ? 1 : 0) - this.vel.z) * Math.min(1, accel * dt);

    if (k['Space'] && this.onGround) { this.vel.y = JUMP; this.onGround = false; }
    this.vel.y -= GRAVITY * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // 地面（落地缓冲：按下落速度镜头下沉）
    if (this.pos.y <= 0) {
      if (!this.onGround && this.vel.y < -3) {
        this.landDip = Math.min(0.24, -this.vel.y * 0.016);
        this.recoilPitch -= this.landDip * 0.35;
      }
      this.pos.y = 0; this.vel.y = 0; this.onGround = true;
    }
    else this.onGround = false;
    this._collideAxis();

    // 边界
    const b = this.bounds;
    this.pos.x = Math.max(b.minX, Math.min(b.maxX, this.pos.x));
    this.pos.z = Math.max(b.minZ, Math.min(b.maxZ, this.pos.z));

    // 脚步声
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hSpeed > 1.5) {
      this._stepT += dt * hSpeed;
      if (this._stepT > 2.6) { this._stepT = 0; audio.step(); }
    }

    // 呼吸/步伐摆动量
    this.bobT += dt * (2 + hSpeed * 1.15);

    // 血量回复（5 秒未受击）
    // 由 main 依据 lastDamageT 处理

    // 相机
    this.recoilPitch *= Math.pow(0.0001, dt); // 后坐力回弹
    this.landDip = (this.landDip || 0) * Math.pow(0.001, dt);   // 落地缓冲回弹
    // 侧移侧倾（strafe lean）
    const latV = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    const rollTarget = Math.max(-0.045, Math.min(0.045, -latV * 0.011)) * (this.onGround ? 1 : 0.4);
    this.roll = (this.roll || 0) + (rollTarget - (this.roll || 0)) * Math.min(1, dt * 8);
    const spdK = Math.min(1, hSpeed / WALK) * (ads ? 0.3 : 1);
    const bobY = Math.sin(this.bobT * 2) * 0.03 * spdK - (this.landDip || 0);
    // 步伐横向晃动
    const side = Math.sin(this.bobT) * 0.022 * spdK;
    this.camera.position.set(
      this.pos.x + Math.cos(this.yaw) * side,
      this.pos.y + EYE + bobY,
      this.pos.z - Math.sin(this.yaw) * side);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + this.recoilPitch;
    this.camera.rotation.z = this.roll + Math.sin(this.bobT) * 0.005 * spdK;
  }
}
