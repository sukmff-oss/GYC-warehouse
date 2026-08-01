import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { colliders, enemySpawns, patrolPoints, isNight } from './map.js';
import { rayVsWorld } from './weapon.js';
import { audio } from './audio.js';
import { BulletPool } from './lod-mesh.js';

// ===== 3D 人物模組（兩款隨機混用；載入失敗靜默回退方塊模型）=====
// ① three.js 官方 Soldier.glb（戰術士兵）② Quaternius SWAT.glb（特警，CC0，正常比例）
const MODEL_DEFS = [
  { url: './assets/models/soldier.glb', scale: 1,    names: { idle: 'Idle', walk: 'Walk', run: 'Run' } },
  { url: './assets/models/swat.glb',    scale: 1,    rotY: 0, names: { idle: 'CharacterArmature|Idle', walk: 'CharacterArmature|Walk', run: 'CharacterArmature|Run', death: 'CharacterArmature|Death' } },
];
const _gl = new GLTFLoader();
const modelListP = Promise.all(MODEL_DEFS.map(d => new Promise(res => {
  _gl.load(d.url, gltf => res({ gltf, def: d }), undefined, () => res(null));
})));

const NAMES = ['VIPER', 'JACKAL', 'COBRA', 'FALCON', 'GHOST', 'HYENA', 'RAZOR', 'WOLF', 'SNAKE', 'TALON', 'BEAR', 'HAWK'];
const UNIFORMS = [0x8a7a52, 0x6b6a45, 0x4a5240, 0x7a6248];  // CS歹徒：沙漠褐 / 橄欖綠 / 游擊灰綠 / 土棕
const VESTS = [0x2e2a26, 0x3a332a, 0x46403a, 0x33302c];     // 深色戰術背心
const MASKS = [0x1e1e22, 0x3a3d32, 0x565048];               // 蒙面頭套：黑 / 墨綠 / 灰

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
    const bg = new THREE.Group();           // 方塊身體（GLB 載入後整組隱藏，僅留隱形命中體）
    g.add(bg);
    this.boxGroup = bg;
    // 外观随机：军服 / 防弹衣配色（夜晚自動提亮，敵人在暗夜中更突出）
    const nb = isNight() ? 1.55 : 1;
    const uniCol = UNIFORMS[(Math.random() * UNIFORMS.length) | 0];
    const vestCol = VESTS[(Math.random() * VESTS.length) | 0];
    this._tTint = uniCol;   // 匪徒染裝色（GLB 換裝後沿用方塊身配色，風格一致）
    this._tBand = [0x8a2a22, 0xcfc4a4, 0x2e2e33][(Math.random() * 3) | 0];   // 紅頭巾 / 沙漠巾 / 黑頭套
    const uni = new THREE.MeshStandardMaterial({ color: new THREE.Color(uniCol).multiplyScalar(nb), roughness: 0.92 });
    const uniD = new THREE.MeshStandardMaterial({ color: new THREE.Color(uniCol).multiplyScalar(0.75 * nb), roughness: 0.95 });
    const skin = new THREE.MeshStandardMaterial({ color: [0xc9a184, 0xa87f62, 0x8a6a50][(Math.random() * 3) | 0], roughness: 0.85 });
    if (isNight()) skin.color.multiplyScalar(1.2);
    const dark = new THREE.MeshStandardMaterial({ color: 0x2e2f33, roughness: 0.55, metalness: 0.5 });
    const vest = new THREE.MeshStandardMaterial({ color: new THREE.Color(vestCol).multiplyScalar(nb), roughness: 0.95 });
    const boot = new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 0.8 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x33302a, roughness: 0.9 });        // 露指手套
    const mask = new THREE.MeshStandardMaterial({ color: MASKS[(Math.random() * MASKS.length) | 0], roughness: 0.95 });
    const bandana = new THREE.MeshStandardMaterial({ color: 0x8a2a22, roughness: 0.9 });      // 紅頭巾
    const shemagh = new THREE.MeshStandardMaterial({ color: 0xcfc4a4, roughness: 0.95 });     // 沙漠頭巾
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.8 });         // AK 木件

    const M = (geo, mt, x, y, z, parent = bg) => {
      const m = new THREE.Mesh(geo, mt);
      m.position.set(x, y, z); m.castShadow = true;
      parent.add(m); return m;
    };

    // ===== 腿部（髋部组 + 可摆动小腿）=====
    this.legsM = M(new THREE.BoxGeometry(0.4, 0.3, 0.26), uniD, 0, 0.98, 0);  // 髋（命中区）
    this.legL = new THREE.Group(); this.legL.position.set(-0.115, 0.86, 0); bg.add(this.legL);
    this.legR = new THREE.Group(); this.legR.position.set(0.115, 0.86, 0); bg.add(this.legR);
    const mkLeg = (grp, side) => {
      M(new THREE.BoxGeometry(0.16, 0.5, 0.18), uni, 0, -0.25, 0, grp);                    // 大腿
      M(new THREE.BoxGeometry(0.07, 0.15, 0.08), uniD, side * 0.09, -0.28, 0.02, grp);     // 工作褲側袋
      M(new THREE.BoxGeometry(0.14, 0.36, 0.15), uniD, 0, -0.63, 0.01, grp);               // 小腿
      M(new THREE.BoxGeometry(0.15, 0.11, 0.26), boot, 0, -0.86, 0.05, grp);               // 军靴
      M(new THREE.BoxGeometry(0.17, 0.12, 0.2), vest, 0, -0.48, 0.06, grp);                // 护膝
    };
    mkLeg(this.legL, -1); mkLeg(this.legR, 1);

    // ===== 躯干（战术背心）=====
    this.torsoM = M(new THREE.BoxGeometry(0.52, 0.55, 0.32), vest, 0, 1.36, 0);  // 命中区
    M(new THREE.BoxGeometry(0.46, 0.2, 0.3), uni, 0, 1.62, 0);                   // 肩部作战服
    for (let i = -1; i <= 1; i++)                                                 // 胸前附包 ×3
      M(new THREE.BoxGeometry(0.13, 0.15, 0.08), uniD, i * 0.15, 1.3, 0.2);
    M(new THREE.BoxGeometry(0.5, 0.09, 0.3), dark, 0, 1.06, 0);                  // 腰带
    M(new THREE.BoxGeometry(0.36, 0.44, 0.18), uniD, 0, 1.36, -0.27);            // 背包
    M(new THREE.BoxGeometry(0.3, 0.1, 0.12), vest, 0, 1.06, -0.24);              // 腰后包
    const strap = M(new THREE.BoxGeometry(0.1, 0.66, 0.36), dark, -0.06, 1.38, 0);  // 斜挎彈藥帶
    strap.rotation.z = 0.52;
    for (let i = 0; i < 3; i++)                                                   // 彈藥帶彈匣包
      M(new THREE.BoxGeometry(0.09, 0.11, 0.05), uniD, -0.19 + i * 0.13, 1.48 - i * 0.13, 0.19);

    // ===== 手臂（肩组可摆动 / 交战前指）=====
    this.armL = new THREE.Group(); this.armL.position.set(-0.33, 1.56, 0); bg.add(this.armL);
    this.armR = new THREE.Group(); this.armR.position.set(0.33, 1.56, 0); bg.add(this.armR);
    const mkArm = (grp) => {
      M(new THREE.SphereGeometry(0.1, 8, 8), uniD, 0, 0.02, 0, grp);              // 肩甲
      M(new THREE.BoxGeometry(0.13, 0.34, 0.14), uni, 0, -0.2, 0, grp);           // 上臂（短袖作戰服）
      M(new THREE.BoxGeometry(0.11, 0.3, 0.12), skin, 0, -0.48, 0.03, grp);       // 前臂（露臂）
      M(new THREE.BoxGeometry(0.09, 0.09, 0.1), glove, 0, -0.66, 0.04, grp);      // 露指手套
    };
    mkArm(this.armL); mkArm(this.armR);

    // ===== 頭部（CS 歹徒：蒙面頭套 / 紅頭巾 / 沙漠頭巾）=====
    const maskStyle = (Math.random() * 3) | 0;
    if (maskStyle === 0) {
      // 蒙面頭套（只露雙眼）
      this.headM = M(new THREE.SphereGeometry(0.145, 12, 10), mask, 0, 1.74, 0);   // 命中区
      M(new THREE.BoxGeometry(0.2, 0.05, 0.03), skin, 0, 1.75, 0.132);             // 眼縫
      M(new THREE.BoxGeometry(0.05, 0.028, 0.015), dark, -0.045, 1.752, 0.15);     // 左眼
      M(new THREE.BoxGeometry(0.05, 0.028, 0.015), dark, 0.045, 1.752, 0.15);      // 右眼
      M(new THREE.BoxGeometry(0.1, 0.08, 0.1), mask, 0, 1.6, 0.06);                // 頸部頭套
    } else if (maskStyle === 1) {
      // 紅頭巾（游擊隊）
      this.headM = M(new THREE.SphereGeometry(0.145, 12, 10), skin, 0, 1.74, 0);   // 命中区
      M(new THREE.BoxGeometry(0.29, 0.08, 0.29), bandana, 0, 1.82, 0);             // 頭巾環
      M(new THREE.BoxGeometry(0.22, 0.1, 0.22), bandana, 0, 1.87, -0.02);          // 頭巾頂
      M(new THREE.BoxGeometry(0.09, 0.14, 0.04), bandana, 0.06, 1.72, -0.15);      // 頭巾垂尾
      M(new THREE.BoxGeometry(0.2, 0.055, 0.03), dark, 0, 1.75, 0.135);            // 墨鏡
      M(new THREE.BoxGeometry(0.1, 0.08, 0.1), skin, 0, 1.6, 0.06);                // 颈部/下颌
    } else {
      // 沙漠頭巾 shemagh
      this.headM = M(new THREE.SphereGeometry(0.145, 12, 10), shemagh, 0, 1.74, 0); // 命中区
      M(new THREE.BoxGeometry(0.3, 0.05, 0.3), dark, 0, 1.85, 0);                  // 頭箍 agal
      M(new THREE.BoxGeometry(0.24, 0.2, 0.05), shemagh, 0, 1.64, -0.13);          // 後披
      M(new THREE.BoxGeometry(0.2, 0.05, 0.03), skin, 0, 1.74, 0.132);             // 眼縫
      M(new THREE.BoxGeometry(0.05, 0.028, 0.015), dark, -0.045, 1.742, 0.15);     // 左眼
      M(new THREE.BoxGeometry(0.05, 0.028, 0.015), dark, 0.045, 1.742, 0.15);      // 右眼
      M(new THREE.BoxGeometry(0.1, 0.08, 0.1), shemagh, 0, 1.6, 0.06);             // 頸部圍巾
    }

    // ===== AK 步槍（木槍托/木護木/彈匣/瞄具）=====
    const gun = new THREE.Group(); gun.position.set(0.16, 1.34, 0.28); bg.add(gun);
    M(new THREE.BoxGeometry(0.06, 0.1, 0.42), dark, 0, 0, 0.1, gun);             // 机匣
    const barrel = M(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), dark, 0, 0.01, 0.48, gun);
    barrel.rotation.x = Math.PI / 2;
    M(new THREE.BoxGeometry(0.055, 0.07, 0.16), wood, 0, 0, 0.28, gun);          // 木護木
    M(new THREE.BoxGeometry(0.05, 0.16, 0.08), dark, 0, -0.11, 0.06, gun);       // 弹匣
    M(new THREE.BoxGeometry(0.05, 0.09, 0.18), wood, 0, -0.01, -0.2, gun);       // 木槍托
    M(new THREE.BoxGeometry(0.03, 0.05, 0.06), dark, 0, 0.09, 0.12, gun);        // 瞄具
    this.muzzleLocal = new THREE.Vector3(0.16, 1.35, 0.78);

    // 体型微差
    g.scale.setScalar(0.94 + Math.random() * 0.14);

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

    this.walkPh = Math.random() * 7;
    this.flinchT = 0;
    this.moving = false;
    this.headM.userData = { soldier: this, part: 'head' };
    this.torsoM.userData = { soldier: this, part: 'body' };
    this.legsM.userData = { soldier: this, part: 'body' };
    this.group = g;
    this.scene.add(g);
    // GLB 人物模組載入完成後換裝（方塊身體保留為隱形命中體）；兩款造型隨機混用
    this._modelIdx = (Math.random() * MODEL_DEFS.length) | 0;
    modelListP.then(list => {
      const m = list[this._modelIdx] || list.find(x => x);
      if (m) this._attachGlb(m.gltf, m.def);
    });

    // === LOD 簡化模型 ===
    this._lodMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.7, 0.35),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(uniCol).multiplyScalar(nb), roughness: 0.95 })
    );
    this._lodMesh.position.copy(g.position);
    this._lodMesh.visible = false;
    this._lodMesh.userData = { soldier: this, part: 'body' };
    this.scene.add(this._lodMesh);
  }

  // ===== 換裝 GLB 人物（SkinnedMesh 需 SkeletonUtils.clone；方塊轉為隱形命中體）=====
  _attachGlb(gltf, def) {
    if (this._glb || !this.group) return;
    const model = SkeletonUtils.clone(gltf.scene);
    const night = isNight();
    model.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.frustumCulled = false;  // 蒙皮邊界會亂跳，關閉剔除
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          // 夜晚：低亮度自發光勾出輪廓（不能超過 Bloom 閾值，也不能把 color 推成 HDR）
          if (night && m.emissive) m.emissive.setRGB(0.055, 0.06, 0.075);
        }
      }
    });
    // 蒙皮模型不能用幾何包盒推算尺寸，用各模組的手動比例
    model.scale.setScalar(def.scale);
    model.position.y = 0;
    model.rotation.y = def.rotY !== undefined ? def.rotY : Math.PI;   // GLB 面朝 -Z 的模組轉向與 group 的 +Z 前向一致；SWAT 原生朝 +Z 不轉
    this.group.add(model);
    this.boxGroup.visible = false;   // 方塊身體隱藏（raycast 不受 visible 影響，命中體照舊）
    // 動畫（各模組的邏輯名 → 實際 clip 名）
    this.mixer = new THREE.AnimationMixer(model);
    this._actions = {};
    for (const clip of gltf.animations) this._actions[clip.name] = this.mixer.clipAction(clip);
    this._animNames = def.names;
    this._curAnim = null;
    this._glb = true;
    if (!this.isBot) this._applyOutfit(model);   // 敵人：CS 經典染裝（BOT 隊友有自己的職業染裝）
  }

  // ===== CS 經典風：普通敵人沙漠匪徒染裝 + 頭巾；BOSS 暗黑重裝染裝 =====
  _applyOutfit(model) {
    const boss = this.isBoss;
    const tint = new THREE.Color(boss ? 0x3a3d46 : this._tTint);
    model.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map(m => {
        if (!m) return m;
        const c = m.clone();
        if (c.color) c.color.lerp(tint, boss ? 0.6 : 0.5);
        if (boss && c.emissive) { c.emissive.setRGB(0.10, 0.02, 0.02); c.emissiveIntensity = 0.5; }
        return c;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
    if (!boss) this._addBandana();
  }

  // ===== 匪徒頭巾（紅頭巾 / 沙漠巾 / 黑頭套隨機）=====
  _addBandana() {
    const bc = this._tBand;
    const bm = new THREE.MeshStandardMaterial({ color: bc, roughness: 0.95,
      emissive: new THREE.Color(bc).multiplyScalar(0.25), emissiveIntensity: 0.4 });
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.3), bm);
    ring.position.set(0, 1.82, 0);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.09, 0.24), bm);
    top.position.set(0, 1.88, -0.02);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.04), bm);
    tail.position.set(0.06, 1.72, -0.16);
    g.add(ring, top, tail);
    this.group.add(g);
  }

  _setAnim(logical) {
    const name = this._animNames ? this._animNames[logical] : logical;
    if (this._curAnim === name || !this._actions || !name) return;
    const next = this._actions[name];
    if (!next) return;
    const prev = this._curAnim ? this._actions[this._curAnim] : null;
    next.reset();
    next.time = Math.random() * next.getClip().duration;   // 錯開相位，避免整隊齊步走
    if (prev) { next.crossFadeFrom(prev, 0.18, false); }
    next.play();
    this._curAnim = name;
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
    // 重生後動畫歸位（清掉死亡動畫的停格）
    if (this._glb) { this._glbDeath = false; this._curAnim = null; this._setAnim('idle'); }
    if (this._marker) this._marker.visible = true;
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
      // GLB 模組有死亡動畫就播放（KayKit Death_A），否則沿用整體倒地
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
      if (this._marker) this._marker.visible = false;   // 屍體不再頂著紅色標記
      return true;
    }
    // 被打后进入交战
    if (this.state === 'patrol') this.state = 'engage';
    return false;
  }

  muzzleWorld() {
    return this.muzzleLocal.clone().applyMatrix4(this.group.matrixWorld);
  }

  update(dt, player, now, fx) {
    if (this.state === 'dead') {
      this.deadT += dt;
      if (this._glbDeath) {
        // 播放 GLB 死亡動畫，不再整體翻倒
        if (this.mixer) this.mixer.update(dt);
      } else {
        // 倒地
        const t = Math.min(1, this.deadT / 0.35);
        this.group.rotation.z = t * Math.PI / 2 * (this._fallDir || (this._fallDir = Math.random() < .5 ? 1 : -1));
        this.group.position.y = -t * 0.25;
      }
      if (this.deadT > 2.2) this.group.visible = false;
      if (!this.noRespawn && this.deadT > this.respawnAt) { this._fallDir = 0; this._glbDeath = false; this.spawn(player.pos); }
      return;
    }

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

    // ===== 動畫：GLB 模組用 idle/walk/run 邏輯名；方塊模型走程序化擺動 =====
    if (this._glb) {
      const want = !this.moving ? 'idle' : (this.state === 'engage' ? 'run' : 'walk');
      this._setAnim(want);
      if (this.mixer) this.mixer.update(dt);
    } else {
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
    }
    // 受击后仰
    if (this.flinchT > 0) this.flinchT -= dt;
    this.group.rotation.x = -Math.max(0, this.flinchT) * 1.5;

    this._sync();

    // LOD 切換 — 使用 perf 設定，若不可用則預設 100m
    if (this._lodMesh) {
      const cam = window.__game?.player?.pos;
      if (cam) {
        const dist = this.pos.distanceTo(cam);
        const lodDist = (typeof perf !== 'undefined' && perf.settings?.lodDistance) ? perf.settings.lodDistance : 100;
        const useLOD = dist > lodDist;
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

  updateBullets(dt, player, fx) {
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
      // 命中玩家
      if (!dead && player.alive) {
        const sx = d.pos.x - prev.x, sz = d.pos.z - prev.z;
        const L2 = sx * sx + sz * sz;
        let t = L2 > 1e-9 ? ((player.pos.x - prev.x) * sx + (player.pos.z - prev.z) * sz) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = prev.x + sx * t, cz = prev.z + sz * t;
        const cy = prev.y + (d.pos.y - prev.y) * t;
        const hd = Math.hypot(player.pos.x - cx, player.pos.z - cz);
        const relY = cy - player.pos.y;
        if (hd < 0.42 && relY > -0.1 && relY < 1.85) {
          fx.playerHit(d.dmg, d.from);
          dead = true;
        } else if (!d.whizzed && hd < 2.2 && relY > -0.2 && relY < 2.2) {
          d.whizzed = true;
          audio.whizz();
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
  spawnBoss(pos, { hp = 600, scale = 1.45, name = 'BOSS·军阀', rare = false } = {}) {
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
    // 重裝甲風：雙肩甲 / 胸甲 / 背甲 / 頭盔 + 紅色目鏡（CS 重裝兵感）
    const armorM = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.85, roughness: 0.35 });
    const mk = (geo, x, y, z) => { const m = new THREE.Mesh(geo, armorM); m.position.set(x, y, z); s.group.add(m); return m; };
    mk(new THREE.BoxGeometry(0.26, 0.16, 0.3), -0.36, 1.68, 0);    // 左肩甲
    mk(new THREE.BoxGeometry(0.26, 0.16, 0.3), 0.36, 1.68, 0);     // 右肩甲
    mk(new THREE.BoxGeometry(0.56, 0.42, 0.1), 0, 1.38, 0.19);     // 胸甲
    mk(new THREE.BoxGeometry(0.5, 0.3, 0.08), 0, 1.35, -0.2);      // 背甲
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.7), armorM);
    helm.position.set(0, 1.76, 0); s.group.add(helm);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 0.9 }));
    visor.position.set(0, 1.76, 0.15); s.group.add(visor);
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

  update(dt, targets, now, fx) {
    // main.js 在合作/BOT 局會傳「目標陣列」（玩家 + 遠端玩家 + BOT 殘影），單人局傳玩家本人
    const list = Array.isArray(targets) ? targets.filter(t => t && t.pos) : [targets];
    const primary = list[0];
    for (const s of this.soldiers) {
      // 每名敵人追最近的存活目標（alive 明確為 false 才排除）
      let tgt = primary, bd = Infinity;
      for (const t of list) {
        if (t.alive === false) continue;
        const d = s.pos.distanceTo(t.pos);
        if (d < bd) { bd = d; tgt = t; }
      }
      if (tgt) s.update(dt, tgt, now, fx);
    }
    if (primary) this.updateBullets(dt, primary, fx);
    // 敌方曳光
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt; t.obj.material.opacity = Math.max(0, t.life / 0.09);
      if (t.life <= 0) { this.scene.remove(t.obj); t.obj.geometry.dispose(); this.tracers.splice(i, 1); }
    }
  }
}
