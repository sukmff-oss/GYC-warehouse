// =============================================================
// lod-mesh.js — LOD 系統與 Mesh 合併優化
// for 街區突擊 / BLOCKADE STRIKE
// =============================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { perf } from './performance-config.js';

// =============================================================
// 1. 建築 Mesh 合併系統
// =============================================================
// 在 buildMap 期間收集相同材質的 box，結束時一次性合併
// 大幅減少 draw call（從數百個降到幾十個）
// =============================================================

const _batchMap = new Map(); // materialKey → [{geo, matrix}]
let _batchTargetGroup = null;

export function batchBegin(group) {
  _batchMap.clear();
  _batchTargetGroup = group;
}

export function batchBox(w, h, d, material, x, y, z, opts = {}) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const matrix = new THREE.Matrix4();
  matrix.makeTranslation(x, y, z);
  if (opts.ry) {
    const rot = new THREE.Matrix4().makeRotationY(opts.ry);
    matrix.multiply(rot);
  }
  if (opts.rz) {
    const rot = new THREE.Matrix4().makeRotationZ(opts.rz);
    matrix.multiply(rot);
  }
  if (opts.rx) {
    const rot = new THREE.Matrix4().makeRotationX(opts.rx);
    matrix.multiply(rot);
  }
  geo.applyMatrix4(matrix);

  const key = material.uuid;
  if (!_batchMap.has(key)) _batchMap.set(key, { material, geos: [] });
  _batchMap.get(key).geos.push(geo);
}

export function batchEnd() {
  if (!_batchTargetGroup) return;
  for (const { material, geos } of _batchMap.values()) {
    if (geos.length === 0) continue;
    if (geos.length === 1) {
      const m = new THREE.Mesh(geos[0], material);
      m.castShadow = true; m.receiveShadow = true;
      _batchTargetGroup.add(m);
    } else {
      const merged = mergeGeometries(geos, false);
      const m = new THREE.Mesh(merged, material);
      m.castShadow = true; m.receiveShadow = true;
      _batchTargetGroup.add(m);
      // 清理原始 geometry
      for (const g of geos) g.dispose();
    }
  }
  _batchMap.clear();
  _batchTargetGroup = null;
}

// =============================================================
// 2. 敵人 LOD 系統
// =============================================================
// 每個 Soldier 同時維護「精細模型」和「簡化模型」
// 根據與玩家的距離自動切換
// =============================================================

export class LODSoldier extends THREE.Group {
  constructor() {
    super();
    this._detail = null;   // 精細模型 Group
    this._simple = null;   // 簡化模型 Mesh
    this._current = null;
    this.lodDistance = 25; // 超過此距離切換簡化模型
  }

  setDetail(group) {
    this._detail = group;
    this.add(group);
    this._current = 'detail';
  }

  setSimple(mesh) {
    this._simple = mesh;
    this.add(mesh);
    mesh.visible = false;
  }

  updateLOD(cameraPos, myPos) {
    if (!this._detail || !this._simple) return;
    const dist = myPos.distanceTo(cameraPos);
    const useSimple = dist > this.lodDistance;
    if (useSimple && this._current !== 'simple') {
      this._detail.visible = false;
      this._simple.visible = true;
      this._simple.position.copy(this._detail.position);
      this._simple.rotation.copy(this._detail.rotation);
      this._current = 'simple';
    } else if (!useSimple && this._current !== 'detail') {
      this._detail.visible = true;
      this._simple.visible = false;
      this._current = 'detail';
    }
  }

  // 無論當前顯示哪個模型，都同步位置和旋轉
  sync(pos, yaw) {
    this.position.copy(pos);
    this.rotation.y = yaw;
    if (this._simple) {
      this._simple.position.set(0, 0, 0);
      this._simple.rotation.set(0, 0, 0);
    }
  }
}

// =============================================================
// 3. 物件池系統
// =============================================================
// 避免頻繁創建/銷毀 Three.js 物件（手雷、彈殼、子彈拖尾）
// =============================================================

export class ObjectPool {
  constructor(createFn, resetFn, size = 16) {
    this._create = createFn;
    this._reset = resetFn;
    this._pool = [];
    this._active = [];
    for (let i = 0; i < size; i++) {
      const obj = createFn();
      obj.visible = false;
      this._pool.push(obj);
    }
  }

  acquire() {
    let obj = this._pool.pop();
    if (!obj) {
      obj = this._create();
      console.warn('ObjectPool expanded beyond initial size');
    }
    obj.visible = true;
    this._active.push(obj);
    return obj;
  }

  release(obj) {
    const idx = this._active.indexOf(obj);
    if (idx >= 0) this._active.splice(idx, 1);
    this._reset(obj);
    obj.visible = false;
    this._pool.push(obj);
  }

  releaseAll() {
    for (const obj of this._active) {
      this._reset(obj);
      obj.visible = false;
      this._pool.push(obj);
    }
    this._active.length = 0;
  }

  getActive() { return this._active; }
}

// =============================================================
// 4. 敵人子彈物件池（專門優化 EnemyManager 的 bullets）
// =============================================================

export class BulletPool {
  constructor(scene, maxSize = 60) {
    this.scene = scene;
    this._pool = [];
    this._active = [];
    // 預建共享材質
    this.headMat = new THREE.SpriteMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      color: new THREE.Color(2.4, 1.1, 0.4)
    });
    this.lineMat = new THREE.LineBasicMaterial({
      color: 0xff8a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending
    });
    this.bossLineMat = new THREE.LineBasicMaterial({
      color: 0xffd040, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending
    });
    // 預建 geometry
    this._headGeo = null;
    this._lineGeo = null;
    for (let i = 0; i < maxSize; i++) {
      this._pool.push(this._createBullet());
    }
  }

  _createBullet() {
    const head = new THREE.Sprite(this.headMat);
    head.scale.setScalar(0.1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, this.lineMat);
    line.frustumCulled = false;
    this.scene.add(head, line);
    return { head, line, active: false, data: null };
  }

  acquire(from, dir, speed, dmg, boss = false) {
    let b = this._pool.pop();
    if (!b) {
      b = this._createBullet();
      console.warn('BulletPool expanded');
    }
    b.head.scale.setScalar(boss ? 0.16 : 0.1);
    b.line.material = boss ? this.bossLineMat : this.lineMat;
    b.head.position.copy(from);
    b.line.position.set(0, 0, 0);
    b.active = true;
    b.data = {
      pos: from.clone(),
      from: from.clone(),
      vel: dir.clone().multiplyScalar(speed),
      life: 140 / speed,
      dmg,
      whizzed: false
    };
    b.head.visible = true;
    b.line.visible = true;
    this._active.push(b);
    return b;
  }

  release(b) {
    const idx = this._active.indexOf(b);
    if (idx >= 0) this._active.splice(idx, 1);
    b.active = false;
    b.data = null;
    b.head.visible = false;
    b.line.visible = false;
    this._pool.push(b);
  }

  getActive() { return this._active; }

  clear() {
    for (const b of this._active) {
      b.active = false;
      b.data = null;
      b.head.visible = false;
      b.line.visible = false;
      this._pool.push(b);
    }
    this._active.length = 0;
  }
}
