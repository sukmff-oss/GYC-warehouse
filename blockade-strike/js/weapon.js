import * as THREE from 'three';
import { colliders } from './map.js';
import { audio } from './audio.js';
import { gunMetalTex, gunWoodTex, texMat } from './textures.js';

// ---------- 武器配置（10 种） ----------
export const WEAPON_ORDER = ['ak', 'm4', 'mp5', 'p90', 'm870', 'awp', 'm82', 'm249', 'deagle', 'rpg'];
export const WEAPONS = {
  ak:     { name: 'AK-47', auto: true,  interval: 0.1,   dmg: 34,  mag: 30,  reserve: 210, spreadHip: 0.016, spreadAds: 0.004,  heatSpread: 0.014, zoomFov: 51, kick: 0.045, recoil: 0.011, reloadTime: 1.9, sight: 'reddot', sightH: 0.085, muzzleZ: -0.78 },
  m4:     { name: 'M4A1',  auto: true,  interval: 0.08,  dmg: 26,  mag: 30,  reserve: 210, spreadHip: 0.014, spreadAds: 0.0035, heatSpread: 0.012, zoomFov: 50, kick: 0.04,  recoil: 0.009, reloadTime: 1.8, sight: 'reddot', sightH: 0.088, muzzleZ: -0.82 },
  mp5:    { name: 'MP5',   auto: true,  interval: 0.067, dmg: 22,  mag: 30,  reserve: 240, spreadHip: 0.013, spreadAds: 0.004,  heatSpread: 0.01,  zoomFov: 56, kick: 0.032, recoil: 0.007, reloadTime: 1.7, sight: 'reddot', sightH: 0.08,  muzzleZ: -0.6 },
  p90:    { name: 'P90',   auto: true,  interval: 0.075, dmg: 21,  mag: 50,  reserve: 250, spreadHip: 0.015, spreadAds: 0.005,  heatSpread: 0.011, zoomFov: 55, kick: 0.034, recoil: 0.007, reloadTime: 2.1, sight: 'iron',   sightH: 0.075, muzzleZ: -0.62 },
  m870:   { name: 'M870',  auto: false, interval: 0.9,   dmg: 12,  pellets: 8, mag: 7,  reserve: 42,  spreadHip: 0.05,  spreadAds: 0.032,  heatSpread: 0,      zoomFov: 60, kick: 0.11,  recoil: 0.03,  reloadTime: 2.4, sight: 'iron',   sightH: 0.058, muzzleZ: -0.85, pump: true },
  awp:    { name: 'AWP',   auto: false, interval: 1.4,   dmg: 100, mag: 5,   reserve: 25,  spreadHip: 0.05,  spreadAds: 0.0008, heatSpread: 0,      zoomFov: 18, kick: 0.12,  recoil: 0.035, reloadTime: 2.6, sight: 'scope',  sightH: 0.105, muzzleZ: -1.0,  bolt: true, zooms: [36, 18, 9], zoomNames: ['2×', '4×', '8×'] },
  m82:    { name: 'M82 巴雷特', auto: false, interval: 1.8, dmg: 150, mag: 5, reserve: 15,  spreadHip: 0.06,  spreadAds: 0.0006, heatSpread: 0,      zoomFov: 14, kick: 0.2,   recoil: 0.06,  reloadTime: 3.0, sight: 'scope',  sightH: 0.108, muzzleZ: -1.15, bolt: true, pierce: true, zooms: [30, 14, 7], zoomNames: ['3×', '6×', '12×'] },
  m249:   { name: 'M249',  auto: true,  interval: 0.075, dmg: 28,  mag: 100, reserve: 200, spreadHip: 0.022, spreadAds: 0.008,  heatSpread: 0.02,  zoomFov: 54, kick: 0.05,  recoil: 0.012, reloadTime: 3.5, sight: 'iron',   sightH: 0.08,  muzzleZ: -0.9 },
  deagle: { name: '沙漠之鷹', auto: false, interval: 0.35, dmg: 50,  mag: 7,   reserve: 49,  spreadHip: 0.02,  spreadAds: 0.006,  heatSpread: 0.01,  zoomFov: 58, kick: 0.09,  recoil: 0.025, reloadTime: 1.6, sight: 'iron',   sightH: 0.055, muzzleZ: -0.42, pistol: true },
  rpg:    { name: 'RPG-7', auto: false, interval: 1.2,   dmg: 0,   mag: 1,   reserve: 4,   spreadHip: 0.01,  spreadAds: 0.002,  heatSpread: 0,      zoomFov: 50, kick: 0.15,  recoil: 0.04,  reloadTime: 3.0, sight: 'iron',   sightH: 0.07,  muzzleZ: -1.1,  rocket: true }
};

// 射线 vs 场景 AABB
export function rayVsWorld(origin, dir, maxDist) {
  let bestT = maxDist, bestN = null;
  for (const c of colliders) {
    let tmin = 0, tmax = bestT, axis = -1, sign = 0, ok = true;
    for (let a = 0; a < 3; a++) {
      const o = origin.getComponent(a), d = dir.getComponent(a);
      const mn = c.min.getComponent(a), mx = c.max.getComponent(a);
      if (Math.abs(d) < 1e-8) {
        if (o < mn || o > mx) { ok = false; break; }
      } else {
        let t1 = (mn - o) / d, t2 = (mx - o) / d, s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (ok && tmin > 0.001 && tmin < bestT) {
      bestT = tmin;
      bestN = new THREE.Vector3();
      if (axis >= 0) bestN.setComponent(axis, sign);
    }
  }
  return bestN ? { t: bestT, normal: bestN } : null;
}

// ---------- 枪械材质 ----------
let GM, GW, GP;
function gunMats() {
  if (!GM) {
    GM = texMat(0x8a8d94, gunMetalTex(), { rough: 0.4, metal: 0.85 });
    GW = texMat(0x9a6a3c, gunWoodTex(), { rough: 0.75, metal: 0.05 });
    GP = texMat(0x50555e, gunMetalTex(), { rough: 0.6, metal: 0.5 }); // 聚合物
  }
  return { GM, GW, GP };
}

export class Weapon {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;
    this.activeId = 'ak';
    this.state = {};
    for (const id of WEAPON_ORDER) this.state[id] = { ammo: WEAPONS[id].mag, reserve: WEAPONS[id].reserve, zoomIdx: WEAPONS[id].zooms ? 1 : 0, boost: 1 };
    this.grenades = 2;
    this.reloading = 0; this.cooldown = 0;
    this.switchT = 0; this.pendingId = null;
    this.boltT = 0; this.throwT = 0; this._thrown = false;
    this.onThrow = null;
    this.ads = 0; this.adsTarget = 0;
    this.heat = 0; this.kick = 0; this.swayX = 0;
    this.tracers = []; this.shells = []; this.decals = [];
    this.mags = {}; this.bolts = {};
    this.guns = {};
    for (const id of WEAPON_ORDER) {
      const g = this._build(id);
      g.visible = false;
      g.scale.setScalar(0.8);
      camera.add(g);
      this.guns[id] = g;
    }
    this.gun = this.guns.ak;
    this.gun.visible = true;
    this.hipPos = new THREE.Vector3(0.25, -0.26, -0.5);
    this.gun.position.copy(this.hipPos);
    for (const k in this.mags) this.mags[k].userData.y0 = this.mags[k].position.y;
    this._buildFlash();
  }

  get cfg() { return WEAPONS[this.activeId]; }
  get ammo() { return this.state[this.activeId].ammo; }
  set ammo(v) { this.state[this.activeId].ammo = v; }
  get reserve() { return this.state[this.activeId].reserve; }
  set reserve(v) { this.state[this.activeId].reserve = v; }
  // 可变倍镜
  get zoomFov() { const c = this.cfg; return c.zooms ? c.zooms[this.state[this.activeId].zoomIdx] : c.zoomFov; }
  get zoomName() { return this.cfg.zooms ? this.cfg.zoomNames[this.state[this.activeId].zoomIdx] : null; }
  // 稀有/史诗加成武器显示名
  get displayName() {
    const b = this.state[this.activeId].boost || 1;
    return (b >= 1.4 ? '黃金·' : b > 1.01 ? '改良·' : '') + this.cfg.name;
  }
  cycleZoom() {
    if (!this.cfg.zooms) return null;
    const st = this.state[this.activeId];
    st.zoomIdx = (st.zoomIdx + 1) % this.cfg.zooms.length;
    return this.zoomName;
  }
  get adsPos() { return new THREE.Vector3(0, -this.cfg.sightH * 0.8, -0.3); }

  _mesh(g, geo, mt, x, y, z, rx = 0, ry = 0, rz = 0) {
    const mm = new THREE.Mesh(geo, mt);
    mm.position.set(x, y, z); mm.rotation.set(rx, ry, rz);
    mm.castShadow = false; mm.frustumCulled = false; g.add(mm); return mm;
  }

  _reddot(g, y, z) {
    const { GM } = gunMats();
    const sight = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.09, 14, 1, true), GM);
    tube.rotation.x = Math.PI / 2; sight.add(tube);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.006, 8, 16), GM);
    rim.position.z = -0.045; sight.add(rim);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.028, 16),
      new THREE.MeshBasicMaterial({ color: 0x88aabb, transparent: true, opacity: 0.25 }));
    lens.position.z = -0.044; lens.rotation.y = Math.PI; sight.add(lens);
    // 后盖 + 红点（朝向玩家一侧读作光学瞄具）
    const rear = new THREE.Mesh(new THREE.CircleGeometry(0.028, 16),
      new THREE.MeshBasicMaterial({ color: 0x14161c }));
    rear.position.z = 0.044; sight.add(rear);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.007, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    dot.position.z = 0.0455; sight.add(dot);
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.07), GM);
    mount.position.y = -0.045; sight.add(mount);
    sight.position.set(0, y, z);
    g.add(sight);
  }

  _scope(g, y, z, big = false) {
    const { GM } = gunMats();
    const scope = new THREE.Group();
    const r = big ? 0.042 : 0.036;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(r, r, big ? 0.34 : 0.3, 14), GM);
    tube.rotation.x = Math.PI / 2; scope.add(tube);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.012, r + 0.004, 0.08, 14), GM);
    bell.rotation.x = Math.PI / 2; bell.position.z = -(big ? 0.19 : 0.17); scope.add(bell);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(r + 0.006, 16),
      new THREE.MeshBasicMaterial({ color: 0x6a9ac0, transparent: true, opacity: 0.3 }));
    lens.position.z = bell.position.z - 0.041; lens.rotation.y = Math.PI; scope.add(lens);
    for (const mz of [-0.06, 0.08]) {
      const mount = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.045, 0.03), GM);
      mount.position.set(0, -0.055, mz); scope.add(mount);
    }
    scope.position.set(0, y, z);
    g.add(scope);
  }

  _iron(g, y, z) {
    const { GM } = gunMats();
    this._mesh(g, new THREE.BoxGeometry(0.012, 0.04, 0.012), GM, 0, y, z - 0.25);
    this._mesh(g, new THREE.BoxGeometry(0.04, 0.03, 0.012), GM, 0, y, z + 0.15);
  }

  _gloves(g, z1, z2) {
    const { GP } = gunMats();
    this._mesh(g, new THREE.BoxGeometry(0.07, 0.07, 0.14), GP, 0.01, -0.09, z1);
    this._mesh(g, new THREE.BoxGeometry(0.075, 0.075, 0.16), GP, 0.02, -0.11, z2);
  }

  _build(id) {
    const { GM, GW, GP } = gunMats();
    const g = new THREE.Group();
    const B = (w, h, d, mt, x, y, z, rx = 0, rz = 0) =>
      this._mesh(g, new THREE.BoxGeometry(w, h, d), mt, x, y, z, rx, 0, rz);
    const C = (r1, r2, l, mt, x, y, z, rx = Math.PI / 2) =>
      this._mesh(g, new THREE.CylinderGeometry(r1, r2, l, 12), mt, x, y, z, rx);

    switch (id) {
      case 'ak':
        B(0.075, 0.09, 0.46, GM, 0, 0, -0.1);
        C(0.018, 0.018, 0.42, GM, 0, 0.012, -0.52);
        B(0.07, 0.075, 0.26, GW, 0, 0, -0.42);
        B(0.065, 0.1, 0.24, GW, 0, -0.015, 0.22, 0.06);
        B(0.05, 0.12, 0.06, GW, 0, -0.1, 0.05, 0.35);
        this.mags.ak = B(0.055, 0.2, 0.09, GP, 0, -0.14, -0.12, 0.5);
        B(0.012, 0.05, 0.012, GM, 0, 0.055, -0.6);
        this._reddot(g, 0.085, -0.08);
        this._gloves(g, -0.32, 0.12);
        break;
      case 'm4':
        B(0.07, 0.085, 0.5, GM, 0, 0, -0.12);
        C(0.016, 0.016, 0.44, GM, 0, 0.008, -0.58);
        B(0.06, 0.065, 0.3, GP, 0, 0, -0.42);
        B(0.05, 0.09, 0.2, GP, 0, -0.01, 0.24, 0.05);
        B(0.045, 0.11, 0.055, GP, 0, -0.1, 0.06, 0.3);
        this.mags.m4 = B(0.05, 0.17, 0.075, GP, 0, -0.125, -0.1, 0.25);
        B(0.06, 0.03, 0.1, GM, 0, 0.06, -0.02); // 提把
        this._reddot(g, 0.088, -0.1);
        this._gloves(g, -0.34, 0.12);
        break;
      case 'mp5':
        B(0.07, 0.08, 0.36, GM, 0, 0, -0.08);
        C(0.015, 0.015, 0.3, GM, 0, 0.008, -0.42);
        C(0.028, 0.028, 0.1, GP, 0, 0.008, -0.32); // 护木筒
        B(0.055, 0.08, 0.16, GP, 0, -0.005, 0.16, 0.04);
        B(0.045, 0.1, 0.05, GP, 0, -0.09, 0.05, 0.3);
        this.mags.mp5 = B(0.045, 0.16, 0.06, GP, 0, -0.12, -0.08, 0.45);
        this._reddot(g, 0.08, -0.06);
        this._gloves(g, -0.24, 0.1);
        break;
      case 'p90':
        B(0.09, 0.12, 0.42, GP, 0, 0, -0.05);       // 无托机身
        C(0.016, 0.016, 0.3, GM, 0, 0.01, -0.42);
        this.mags.p90 = B(0.05, 0.035, 0.3, GP, 0, 0.085, -0.1); // 顶部横置弹匣
        B(0.06, 0.1, 0.14, GP, 0, -0.06, 0.16, 0.25);  // 握把区
        this._iron(g, 0.075, -0.2);
        this._gloves(g, -0.3, 0.12);
        break;
      case 'm870': {
        C(0.02, 0.02, 0.55, GM, 0, 0.01, -0.5);       // 枪管
        C(0.024, 0.024, 0.4, GM, 0, -0.03, -0.42);    // 管状弹仓
        this.bolts.m870 = B(0.07, 0.06, 0.14, GW, 0, -0.03, -0.38); // 滑动护木
        B(0.07, 0.08, 0.3, GM, 0, 0, -0.05);
        B(0.06, 0.1, 0.26, GW, 0, -0.02, 0.22, 0.06);
        B(0.012, 0.04, 0.012, GM, 0, 0.055, -0.72);   // 珠形准星
        this._gloves(g, -0.38, 0.1);
        break;
      }
      case 'awp':
        C(0.02, 0.022, 0.78, GM, 0, 0.01, -0.62);
        B(0.07, 0.09, 0.5, GP, 0, 0, -0.12);
        B(0.024, 0.05, 0.1, GM, 0, 0.01, -1.0);
        B(0.06, 0.1, 0.3, GP, 0, -0.02, 0.24, 0.05);
        B(0.05, 0.12, 0.07, GP, 0, -0.1, 0.06, 0.3);
        this.mags.awp = B(0.05, 0.12, 0.1, GP, 0, -0.1, -0.14);
        this.bolts.awp = C(0.012, 0.012, 0.08, GM, 0.06, 0.03, -0.02, 0);
        this._mesh(g, new THREE.SphereGeometry(0.02, 8, 8), GM, 0.1, 0.03, -0.02);
        this._scope(g, 0.105, -0.1);
        this._gloves(g, -0.4, 0.14);
        break;
      case 'm82':
        C(0.024, 0.026, 1.0, GM, 0, 0.012, -0.72);
        B(0.08, 0.1, 0.55, GM, 0, 0, -0.1);
        B(0.05, 0.08, 0.16, GM, 0, 0.012, -1.22);     // 大型制退器
        B(0.065, 0.11, 0.3, GM, 0, -0.02, 0.26, 0.05);
        B(0.05, 0.12, 0.07, GM, 0, -0.11, 0.06, 0.3);
        this.mags.m82 = B(0.055, 0.14, 0.11, GM, 0, -0.11, -0.13);
        this.bolts.m82 = C(0.014, 0.014, 0.08, GM, 0.07, 0.035, -0.02, 0);
        this._scope(g, 0.108, -0.08, true);
        B(0.015, 0.12, 0.02, GM, -0.035, -0.08, -0.6, 0.4); // 两脚架
        B(0.015, 0.12, 0.02, GM, 0.035, -0.08, -0.6, 0.4);
        this._gloves(g, -0.42, 0.14);
        break;
      case 'm249':
        B(0.09, 0.11, 0.55, GM, 0, 0, -0.1);
        C(0.022, 0.022, 0.5, GM, 0, 0.012, -0.62);
        B(0.085, 0.09, 0.22, GM, 0, -0.01, -0.45);    // 散热罩
        this.mags.m249 = B(0.09, 0.12, 0.14, GP, 0, -0.13, -0.05); // 弹链箱
        B(0.06, 0.1, 0.22, GP, 0, -0.02, 0.26, 0.05);
        B(0.05, 0.11, 0.06, GP, 0, -0.11, 0.08, 0.3);
        this._iron(g, 0.08, -0.3);
        B(0.015, 0.12, 0.02, GM, -0.04, -0.09, -0.5, 0.4);
        B(0.015, 0.12, 0.02, GM, 0.04, -0.09, -0.5, 0.4);
        this._gloves(g, -0.35, 0.12);
        break;
      case 'deagle':
        B(0.045, 0.055, 0.24, GM, 0, 0.01, -0.06);    // 套筒
        B(0.04, 0.05, 0.1, GM, 0, -0.01, 0.06);
        this.mags.deagle = B(0.042, 0.12, 0.06, GP, 0, -0.09, 0.07, 0.25);
        B(0.01, 0.03, 0.01, GM, 0, 0.05, -0.16);      // 准星
        this._gloves(g, 0.06, 0.09);
        break;
      case 'rpg': {
        C(0.045, 0.045, 0.9, GP, 0, 0.02, -0.3);      // 发射筒
        C(0.06, 0.045, 0.12, GP, 0, 0.02, -0.75);     // 喇叭口
        const head = this._mesh(g, new THREE.ConeGeometry(0.055, 0.16, 10), GM, 0, 0.02, -0.88, -Math.PI / 2);
        head.castShadow = false;
        B(0.05, 0.1, 0.06, GW, 0, -0.08, -0.1, 0.3);  // 握把
        B(0.012, 0.05, 0.012, GM, 0, 0.09, -0.3);     // 表尺
        this._gloves(g, -0.15, 0.05);
        break;
      }
    }
    g.traverse(o => { o.frustumCulled = false; });
    // ===== 通用细节件：导轨 / 拉机柄 / 弹匣卡榫 / 扳机护圈 / 枪口装置 =====
    this._detailKit(g, WEAPONS[id]);

    return g;
  }

  _detailKit(g, cfg) {
    const { GM, GP: GD } = gunMats();
    const mz = cfg.muzzleZ;
    // 顶部皮卡汀尼导轨（齿条）
    for (let i = 0; i < 5; i++)
      this._mesh(g, new THREE.BoxGeometry(0.024, 0.008, 0.03), GD || GM, 0, 0.068, mz + 0.16 + i * 0.045);
    this._mesh(g, new THREE.BoxGeometry(0.02, 0.01, 0.26), GM, 0, 0.062, mz + 0.26);
    // 拉机柄（右側）
    this._mesh(g, new THREE.BoxGeometry(0.03, 0.014, 0.05), GM, 0.04, 0.035, mz + 0.42);
    // 弹匣卡榫
    this._mesh(g, new THREE.BoxGeometry(0.012, 0.02, 0.03), GM, 0.035, -0.045, mz + 0.5);
    // 扳机护圈
    this._mesh(g, new THREE.BoxGeometry(0.014, 0.05, 0.09), GM, 0, -0.078, mz + 0.58);
    this._mesh(g, new THREE.BoxGeometry(0.014, 0.012, 0.09), GM, 0, -0.1, mz + 0.58);
    // 枪口消焰器（环纹）
    if (!cfg.rocket) {
      const fh = this._mesh(g, new THREE.CylinderGeometry(0.02, 0.02, 0.07, 10), GM, 0, 0.012, mz + 0.035, Math.PI / 2);
      for (const oz of [0.02, 0.045, 0.065])
        this._mesh(g, new THREE.TorusGeometry(0.021, 0.0035, 6, 12), GD || GM, 0, 0.012, mz + oz);
    }
  }

  _buildFlash() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g2 = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g2.addColorStop(0, 'rgba(255,240,180,1)'); g2.addColorStop(0.4, 'rgba(255,160,60,.8)');
    g2.addColorStop(1, 'rgba(255,120,20,0)');
    c.fillStyle = g2; c.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.material.color.setRGB(2.6, 1.9, 1.0);   // HDR 发光（触发 Bloom）
    this.flash.scale.set(0.28, 0.28, 1);
    this.flash.position.set(0, 0.012, WEAPONS.ak.muzzleZ);
    this.flash.visible = false;
    this.guns.ak.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffa040, 0, 9);
    this.scene.add(this.flashLight);
    this.impactTex = tex;
  }

  switchWeapon(id) {
    if (id === this.activeId || this.switchT > 0 || !WEAPONS[id]) return;
    this.switchT = 0.8;
    this.pendingId = id;
    this.reloading = 0; this.boltT = 0;
    this.gun.rotation.set(0, 0, 0);
    audio.reload();
  }

  cycle() {
    const i = WEAPON_ORDER.indexOf(this.activeId);
    this.switchWeapon(WEAPON_ORDER[(i + 1) % WEAPON_ORDER.length]);
  }

  pickup(id) { // 拾取武器：补弹并切换
    this.state[id].ammo = WEAPONS[id].mag;
    this.state[id].reserve = Math.max(this.state[id].reserve, WEAPONS[id].reserve);
    this.switchWeapon(id);
  }

  startReload() {
    if (this.reloading > 0 || this.ammo === this.cfg.mag || this.reserve <= 0 || this.switchT > 0) return;
    this.reloading = this.cfg.reloadTime;
    audio.reload();
  }

  throwGrenade() {
    if (this.grenades <= 0 || this.throwT > 0 || this.reloading > 0 || this.switchT > 0) return false;
    this.grenades--;
    this.throwT = 0.75;
    this._thrown = false;
    return true;
  }

  _fireRay(player, spreadBase, hitTest) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    dir.x += (Math.random() - 0.5) * spreadBase * 2;
    dir.y += (Math.random() - 0.5) * spreadBase * 2;
    dir.normalize();
    const origin = this.camera.position.clone();
    const eHit = hitTest(origin, dir, 250);
    const wHit = rayVsWorld(origin, dir, 250);
    let end, enemy = null, enemy2 = null;
    if (eHit && (!wHit || eHit.t < wHit.t)) {
      end = origin.clone().addScaledVector(dir, eHit.t);
      enemy = eHit;
      this._impact(end, null, true);
      // M82 穿透：越过第一名敌人继续搜索下一名（伤害衰减 35%）
      if (this.cfg.pierce) {
        const o2 = end.clone().addScaledVector(dir, 0.5);
        const eHit2 = hitTest(o2, dir, 250);
        const wHit2 = rayVsWorld(o2, dir, 250);
        if (eHit2 && eHit2.soldier !== eHit.soldier && (!wHit2 || eHit2.t < wHit2.t)) {
          end = o2.clone().addScaledVector(dir, eHit2.t);
          enemy2 = { ...eHit2, dmgMult: 2 / 3 };   // 穿透第二目标 150→100
          this._impact(end, null, true);
        } else if (wHit2 && wHit2.t < 30) {
          const pend = o2.clone().addScaledVector(dir, wHit2.t);
          this._impact(pend, wHit2.normal, false);
          this._decal(pend, wHit2.normal);
        }
      }
    } else if (wHit) {
      end = origin.clone().addScaledVector(dir, wHit.t);
      this._impact(end, wHit.normal, false);
      this._decal(end, wHit.normal);
    } else {
      end = origin.clone().addScaledVector(dir, 250);
    }
    return { enemy, enemy2, end, dir, origin };
  }

  tryFire(now, player, hitTest) {
    if (this.cooldown > 0 || this.reloading > 0 || this.ammo <= 0 || this.switchT > 0 || this.throwT > 0) return null;
    const cfg = this.cfg;
    this.cooldown = cfg.interval;
    this.ammo--;
    if (cfg.bolt || cfg.pump) { audio.sniperShot(); this.boltT = 0.9; }
    else audio.shot(0);

    const moveFactor = Math.min(1, Math.hypot(player.vel.x, player.vel.z) / 6);
    const spread = (this.ads > 0.7 ? cfg.spreadAds : cfg.spreadHip) + this.heat * cfg.heatSpread + moveFactor * 0.014;
    this.heat = Math.min(1, this.heat + 0.16);

    // RPG：火箭弹（由 main 生成飞行体）
    if (cfg.rocket) {
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.kick = Math.min(0.18, this.kick + cfg.kick);
      player.recoilPitch += cfg.recoil;
      this._flashFX();
      return { rocket: true, dir, origin: this.camera.position.clone() };
    }

    // 霰弹多弹丸 / 普通单发
    const pellets = cfg.pellets || 1;
    const hits = [];
    for (let i = 0; i < pellets; i++) {
      const r = this._fireRay(player, spread, hitTest);
      if (i === 0 || i % 2 === 0) this._tracer(r.end);
      if (r.enemy) hits.push(r.enemy);
      if (r.enemy2) hits.push(r.enemy2);
    }

    this._ejectShell();
    this.kick = Math.min(0.2, this.kick + cfg.kick);
    player.recoilPitch += this.ads > 0.7 ? cfg.recoil * 0.6 : cfg.recoil;
    player.pitch += (Math.random() - 0.5) * 0.0015;
    this._flashFX();
    return { hits, dmg: cfg.dmg * (this.state[this.activeId].boost || 1) };
  }

  _flashFX() {
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * 6.3;
    this.flashT = 0.045;
    const mw = new THREE.Vector3(0, 0.012, this.cfg.muzzleZ).applyMatrix4(this.gun.matrixWorld);
    this.flashLight.position.copy(mw);
    this.flashLight.intensity = 26;
    // 枪口青烟（连续射击时更浓）
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion).multiplyScalar(0.35);
    back.y += 0.45;
    this._smokePuff(mw, 0.1, 3.5, 0.7, 0xb8b8b0, 0.22 + this.heat * 0.2, back);
    if (this.heat > 0.55) {
      const mw2 = mw.clone(); mw2.y += 0.04;
      this._smokePuff(mw2, 0.14, 4, 0.9, 0xa8a8a0, 0.3, back.clone().multiplyScalar(1.4));
    }
  }

  _tracer(end) {
    const start = new THREE.Vector3(0, 0.012, this.cfg.muzzleZ).applyMatrix4(this.gun.matrixWorld);
    // 拖尾亮线
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffd890, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending
    }));
    this.scene.add(line);
    this.tracers.push({ obj: line, life: 0.1, maxLife: 0.1 });
    // 曳光弹芯：高速飞行的亮点
    const dist = start.distanceTo(end);
    if (dist > 5) {
      const core = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.impactTex, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      core.material.color.setRGB(2.4, 1.8, 0.9);   // HDR 曳光弹芯
      core.scale.set(0.085, 0.085, 1);
      core.position.copy(start);
      this.scene.add(core);
      const vel = end.clone().sub(start).normalize().multiplyScalar(150);
      this.tracers.push({ obj: core, vel, life: dist / 150, maxLife: Math.max(0.05, dist / 150), sprite: true });
    }
  }

  // 烟团（枪口青烟 / 弹着烟尘共用）
  _smokePuff(pos, s0, grow, life, color, op, vel) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.impactTex, color, transparent: true, opacity: op, depthWrite: false
    }));
    sp.position.copy(pos);
    sp.scale.set(s0, s0, 1);
    this.scene.add(sp);
    this.shells.push({ obj: sp, vel: vel || new THREE.Vector3(0, 0.5, 0), life, maxLife: life, smoke: true, s0, grow, op });
  }

  _impact(pos, normal, isFlesh) {
    const n = isFlesh ? 6 : 9;
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.impactTex, transparent: true, depthWrite: false,
        color: isFlesh ? 0xaa2222 : 0xd8c8a0
      }));
      sp.position.copy(pos);
      sp.scale.set(0.12, 0.12, 1);
      const v = new THREE.Vector3((Math.random() - .5), Math.random() * .9, (Math.random() - .5));
      if (normal) v.addScaledVector(normal, 1.2);
      v.multiplyScalar(isFlesh ? 1.6 : 3.2);
      this.scene.add(sp);
      this.shells.push({ obj: sp, vel: v, life: 0.32, maxLife: 0.32, particle: true });
    }
    if (!isFlesh) {
      // 弹着烟尘团
      const pv = normal ? normal.clone().multiplyScalar(0.8) : new THREE.Vector3(0, 0.8, 0);
      pv.y += 0.4;
      this._smokePuff(pos, 0.16, 3.2, 0.65, 0xcabfa8, 0.4, pv);
      // 金属火花
      for (let i = 0; i < 4; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.impactTex, transparent: true, depthWrite: false,
          color: 0xffc860, blending: THREE.AdditiveBlending
        }));
        sp.position.copy(pos);
        sp.scale.set(0.05, 0.05, 1);
        const v = new THREE.Vector3((Math.random() - .5) * 2, Math.random() * 2, (Math.random() - .5) * 2);
        if (normal) v.addScaledVector(normal, 3.5);
        this.scene.add(sp);
        this.shells.push({ obj: sp, vel: v, life: 0.22, maxLife: 0.22, particle: true });
      }
      // 中远距离跳弹啸声
      if (normal && Math.random() < 0.45 && this.camera.position.distanceTo(pos) > 9) audio.ricochet();
    }
  }

  _decal(pos, normal) {
    if (!normal) return;
    if (this.decals.length > 60) { const d = this.decals.shift(); this.scene.remove(d); }
    const m2 = new THREE.Mesh(new THREE.CircleGeometry(0.045, 8),
      new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.85, depthWrite: false }));
    m2.position.copy(pos).addScaledVector(normal, 0.012);
    m2.lookAt(pos.clone().add(normal));
    this.scene.add(m2);
    this.decals.push(m2);
  }

  _ejectShell() {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.035),
      new THREE.MeshStandardMaterial({ color: 0xc8a038, metalness: 0.8, roughness: 0.3 }));
    const p = new THREE.Vector3(0.04, 0.02, -0.15).applyMatrix4(this.gun.matrixWorld);
    sh.position.copy(p);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const vel = right.multiplyScalar(1.8).add(new THREE.Vector3(0, 2.2, 0));
    vel.x += (Math.random() - .5); vel.z += (Math.random() - .5);
    this.scene.add(sh);
    this.shells.push({ obj: sh, vel, life: 0.9, particle: false, spin: true });
  }

  update(dt, player, adsHeld) {
    this.cooldown -= dt;
    this.heat = Math.max(0, this.heat - dt * 1.4);
    this.kick *= Math.pow(0.0005, dt);

    // ---- 武器切换 ----
    let switchDip = 0;
    if (this.switchT > 0) {
      this.switchT -= dt;
      const t = 1 - this.switchT / 0.8;
      switchDip = Math.sin(Math.min(1, t) * Math.PI);
      if (t >= 0.5 && this.pendingId) {
        this.gun.visible = false;
        this.activeId = this.pendingId;
        this.pendingId = null;
        this.gun = this.guns[this.activeId];
        this.gun.visible = true;
        this.gun.add(this.flash);
        this.flash.position.set(0, 0.012, this.cfg.muzzleZ);
      }
    }

    // ---- 栓动/泵动 ----
    if (this.boltT > 0) {
      this.boltT -= dt;
      const bt = 1 - this.boltT / 0.9;
      const bolt = this.bolts[this.activeId];
      if (bolt) {
        if (this.activeId === 'm870') bolt.position.z = -0.38 + Math.sin(bt * Math.PI) * 0.08;
        else { bolt.position.z = -0.02 + Math.sin(bt * Math.PI) * 0.05; bolt.rotation.y = Math.sin(bt * Math.PI) * 0.6; }
      }
    }

    // ---- 投掷 ----
    let throwDip = 0;
    if (this.throwT > 0) {
      this.throwT -= dt;
      const t = 1 - this.throwT / 0.75;
      throwDip = t < 0.45 ? t / 0.45 : (1 - (t - 0.45) / 0.55);
      if (!this._thrown && t > 0.42) {
        this._thrown = true;
        if (this.onThrow) this.onThrow();
      }
    }

    this.adsTarget = (adsHeld && this.reloading <= 0 && this.switchT <= 0 && this.throwT <= 0) ? 1 : 0;
    this.ads += (this.adsTarget - this.ads) * Math.min(1, dt * 11);

    // ---- 换弹 ----
    const mag = this.mags[this.activeId];
    if (this.reloading > 0) {
      this.reloading -= dt;
      const t = 1 - this.reloading / this.cfg.reloadTime;
      this.gun.rotation.z = Math.sin(t * Math.PI) * 0.5;
      this.gun.rotation.x = Math.sin(t * Math.PI) * 0.3;
      if (mag) mag.position.y = mag.userData.y0 - Math.sin(t * Math.PI) * 0.12;
      if (this.reloading <= 0) {
        const need = this.cfg.mag - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take; this.reserve -= take;
        this.gun.rotation.set(0, 0, 0);
        if (mag) mag.position.y = mag.userData.y0;
      }
    }

    // ---- 冲刺姿态系数 ----
    const hSpeed = Math.hypot(player.vel.x, player.vel.z);
    const sprinting = hSpeed > 6.2 && player.onGround && this.ads < 0.3 ? 1 : 0;
    this.sprintK = (this.sprintK || 0) + ((sprinting ? 1 : 0) - (this.sprintK || 0)) * Math.min(1, dt * 7);

    // ---- 持枪惯性（视角转动滞后）----
    const dyaw = player.yaw - (this._lastYaw ?? player.yaw);
    const dpitch = player.pitch - (this._lastPitch ?? player.pitch);
    this._lastYaw = player.yaw; this._lastPitch = player.pitch;
    this.lagX = (this.lagX || 0) + dyaw * 0.12;
    this.lagY = (this.lagY || 0) + dpitch * 0.09;
    this.lagX *= Math.pow(0.002, dt); this.lagY *= Math.pow(0.002, dt);
    this.lagX = Math.max(-0.05, Math.min(0.05, this.lagX));
    this.lagY = Math.max(-0.04, Math.min(0.04, this.lagY));

    // ---- 位置 ----
    const pos = this.hipPos.clone().lerp(this.adsPos, this.ads);
    const bob = Math.min(1, hSpeed / 5) * (1 - this.ads * 0.8);
    pos.y += Math.sin(player.bobT * 2) * 0.014 * bob;
    pos.x += Math.cos(player.bobT) * 0.009 * bob;
    // 呼吸微晃
    const breathe = 0.0032 * (1 - this.ads * 0.75);
    pos.y += Math.sin(performance.now() * 0.0016) * breathe;
    pos.x += Math.cos(performance.now() * 0.0011) * breathe * 0.6;
    pos.z += this.kick;
    pos.y += this.kick * 0.4;
    pos.y -= switchDip * 0.28 + throwDip * 0.3;
    pos.x -= throwDip * 0.1;
    // 冲刺下放姿态 + 惯性滞后
    pos.y -= this.sprintK * 0.07;
    pos.x += this.sprintK * 0.05;
    pos.x += this.lagX;
    pos.y += this.lagY;
    this.gun.position.copy(pos);
    if (this.reloading <= 0) {
      this.gun.rotation.z = this.kick * 0.7 - switchDip * 0.4 - throwDip * 0.5
        + Math.sin(performance.now() * 0.0009) * 0.004 * (1 - this.ads) + this.sprintK * 0.3 + this.lagX * 0.8;
      this.gun.rotation.x = this.kick * 1.4 - switchDip * 0.3 - throwDip * 0.45
        + this.sprintK * 0.42 + this.lagY * 1.2;
    }

    // 开镜隐藏枪身（狙击镜类）
    if (this.cfg.sight === 'scope') this.gun.visible = this.ads < 0.85 && this.switchT <= 0;

    // FOV（冲刺扩张 + 开镜缩放）
    const baseFov = 72 + this.sprintK * 8 * (1 - this.ads);
    const targetFov = baseFov - this.ads * (baseFov - this.zoomFov);
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 11);
      this.camera.updateProjectionMatrix();
    }

    if (this.flash.visible) {
      this.flashT -= dt;
      this.flashLight.intensity *= Math.pow(0.0001, dt);
      if (this.flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; }
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.obj.material.opacity = Math.max(0, t.life / (t.maxLife || 0.07)) * 0.9;
      if (t.vel) t.obj.position.addScaledVector(t.vel, dt);
      if (t.life <= 0) {
        this.scene.remove(t.obj);
        if (!t.sprite && t.obj.geometry) t.obj.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life -= dt;
      if (s.smoke) { // 烟团：减速上飘 + 膨胀淡出
        s.vel.multiplyScalar(Math.pow(0.15, dt));
        s.vel.y += 0.5 * dt;
        s.obj.position.addScaledVector(s.vel, dt);
        const g = 1 + (1 - s.life / s.maxLife) * (s.grow || 2);
        s.obj.scale.set(s.s0 * g, s.s0 * g, 1);
        s.obj.material.opacity = Math.max(0, s.life / s.maxLife) * (s.op ?? 0.35);
      } else {
        s.vel.y -= (s.particle ? 4 : 12) * dt;
        s.obj.position.addScaledVector(s.vel, dt);
        if (s.spin) { s.obj.rotation.x += dt * 20; s.obj.rotation.z += dt * 14; }
        if (s.particle) s.obj.material.opacity = Math.max(0, s.life / (s.maxLife || 0.32));
      }
      if (s.life <= 0 || (!s.smoke && s.obj.position.y < 0)) {
        this.scene.remove(s.obj); this.shells.splice(i, 1);
      }
    }
  }
}
