import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildMap, colliders, mapAnims } from './map.js';
import { Player } from './player.js';
import { Weapon, WEAPON_ORDER, WEAPONS } from './weapon.js';
import { EnemyManager } from './enemies.js';
import { HUD } from './hud.js';
import { audio } from './audio.js';
import { LootManager, applyLoot } from './loot.js';
import { save, ITEMS } from './save.js';
import { PostFX } from './post.js';
import { perf, createQualityUI } from './performance-config.js';
import { ObjectPool } from './lod-mesh.js';
import { Net } from './net.js';
import { BotManager } from './bots.js';

const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (IS_TOUCH) document.body.classList.add('touch');

// ---------- 渲染基础 ----------
const renderer = new THREE.WebGLRenderer({ antialias: perf.settings.antialias });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(perf.settings.pixelRatio);
renderer.shadowMap.enabled = perf.settings.shadows;
renderer.shadowMap.type = perf.settings.shadows ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
renderer.domElement.classList.add('game');
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 800);
scene.add(camera);
const post = new PostFX(renderer, scene, camera);

const sun = new THREE.DirectionalLight(0xfff2dc, 2.9);
sun.position.set(60, 90, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(perf.settings.shadowMapSize, perf.settings.shadowMapSize);
sun.shadow.camera.left = -75; sun.shadow.camera.right = 75;
sun.shadow.camera.top = 75; sun.shadow.camera.bottom = -75;
sun.shadow.camera.far = 350;
sun.shadow.bias = -0.0008;
scene.add(sun);
const hemi = new THREE.HemisphereLight(0xbdd8f0, 0x8a7a5c, 0.62);
scene.add(hemi);

// 依地圖時段套用光照（白天 / 夕陽 / 夜晚）
function applyMapEnv(info) {
  const env = info.env || (info.night ? 'night' : 'day');
  let envI;
  if (env === 'night') {
    sun.intensity = 0.55;
    sun.color.set(0x9ab8e8);                    // 冷色月光
    sun.position.set(-40, 70, -50);
    hemi.intensity = 0.26;
    hemi.color.set(0x7a94c8);
    hemi.groundColor.set(0x141a26);
    renderer.toneMappingExposure = 0.92;
    envI = 0.12;
  } else if (env === 'sunset') {
    sun.intensity = 1.7;
    sun.color.set(0xff9a50);                    // 低角度暖橙夕陽
    sun.position.set(-85, 20, -55);
    hemi.intensity = 0.42;
    hemi.color.set(0xe09a62);
    hemi.groundColor.set(0x38221c);
    renderer.toneMappingExposure = 0.95;
    envI = 0.3;
  } else {
    sun.intensity = 2.9;
    sun.color.set(0xfff2dc);
    sun.position.set(60, 90, 30);
    hemi.intensity = 0.62;
    hemi.color.set(0xbdd8f0);
    hemi.groundColor.set(0x8a7a5c);
    renderer.toneMappingExposure = 0.98;
    envI = 1;
  }
  // IBL 環境反射強度（夜晚/夕陽壓暗，避免畫面灰亮）
  scene.traverse(o => {
    if (o.isMesh && o.material && 'envMapIntensity' in o.material)
      o.material.envMapIntensity = envI;
  });
}

// 真实光照：IBL 环境反射
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

// ---------- 游戏对象 ----------
let mapInfo = buildMap(scene, 'town', 'night');
const player = new Player(camera, renderer.domElement);
player.setBounds(mapInfo.bounds);
const weapon = new Weapon(camera, scene);
const enemies = new EnemyManager(scene, perf.settings.enemyCount);
const loot = new LootManager(scene);
const hud = new HUD();
hud.setMap(mapInfo);
applyMapEnv(mapInfo);   // 初始地圖（小鎮夜晚）光照
const net = new Net(scene);   // P2P 連線（預設單機，不連線）
const bots = new BotManager(scene);   // BOT 隊友（房主開房自動加入）

// ---------- 游戏状态 ----------
const G = {
  state: 'menu',
  mapId: 'town',
  env: 'night',            // day 白天 | sunset 夕陽 | night 夜晚
  mode: 'free',            // free 自由局 | timed 限时局（3 分钟）
  scoreB: 0, scoreR: 0,
  kills: 0, deaths: 0, shots: 0, hits: 0,
  time: 600, respawnT: 0,
  firing: false, adsHeld: false,
  shake: 0,
  streak: 0, lastKillT: -10, firstBlood: false,
  coop: false,             // 多人連線模式
  missions: 0,             // 爆破完成次数
  bomb: { state: 'carry', plantT: 0, boomT: 0, beepT: 0, mesh: null }, // carry|planting|planted
  boss: null,              // 当前 BOSS 士兵
  portal: { active: false, target: null },  // target: 'adventure' | 'exit'
  inAdventure: false, adventureT: 0, advGold: 0, advItems: 0,
};
let now = 0;
const $ = id => document.getElementById(id);

// ---------- 手雷 ----------
const nadePool = new ObjectPool(
  () => {
    const geo = new THREE.SphereGeometry(0.09, 8, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a4a32, roughness: 0.6, metalness: 0.3 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  },
  (mesh) => { mesh.position.set(0, -100, 0); mesh.visible = false; },
  8
);
const boomLight = new THREE.PointLight(0xff8830, 0, 30);
scene.add(boomLight);
const nades = [];

weapon.onThrow = () => {
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  if (G.coop && !net.isHost) {
    // 加入者：手雷由房主端生成（才有傷害），本地只發請求
    net.send({ t: 'nade', o: [camera.position.x, camera.position.y, camera.position.z], dir: [dir.x, dir.y, dir.z] });
    audio.step();
    return;
  }
  const mesh = nadePool.acquire();
  mesh.visible = true;
  mesh.position.copy(camera.position).addScaledVector(dir, 0.6).y -= 0.15;
  const vel = dir.clone().multiplyScalar(16);
  vel.y += 3.5;
  vel.addScaledVector(player.vel, 0.4);
  nades.push({ mesh, vel, fuse: 2.5 });
  audio.step();
  if (G.coop && net.isHost)
    net._broadcast({ t: 'vnade', o: [camera.position.x, camera.position.y, camera.position.z], dir: [dir.x, dir.y, dir.z] });
};

// 純視覺爆炸（連線同步用，不造成傷害）
function explodeVisual(pos) {
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: weapon.impactTex, color: 0xffb060, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  flash.position.copy(pos).y += 0.4;
  flash.scale.set(2, 2, 1);
  scene.add(flash);
  const parts = [{ obj: flash, vel: new THREE.Vector3(), life: 0.25, particle: true, grow: 26 }];
  for (let i = 0; i < 14; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: weapon.impactTex, transparent: true, depthWrite: false,
      color: i < 7 ? 0xff9040 : 0x555048
    }));
    sp.position.copy(pos).y += 0.3;
    sp.scale.set(rand(0.3, 0.7), rand(0.3, 0.7), 1);
    const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.6), rand(-1, 1)).multiplyScalar(rand(3, 9));
    scene.add(sp);
    parts.push({ obj: sp, vel: v, life: rand(0.4, 0.9), particle: true });
  }
  weapon.shells.push(...parts);
  const dPlayer = pos.distanceTo(player.pos);
  audio.boom(dPlayer);
  G.shake = Math.max(G.shake, Math.max(0, 1 - dPlayer / 21));
}

function explode(pos, weaponName = 'M67', radius = 7, dmgBase = 100) {
  // 特效
  boomLight.position.copy(pos).y += 0.5;
  boomLight.intensity = 300;
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: weapon.impactTex, color: 0xffb060, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  flash.position.copy(pos).y += 0.4;
  flash.scale.set(2, 2, 1);
  scene.add(flash);
  const parts = [{ obj: flash, vel: new THREE.Vector3(), life: 0.25, particle: true, grow: 26 }];
  for (let i = 0; i < 18; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: weapon.impactTex, transparent: true, depthWrite: false,
      color: i < 8 ? 0xff9040 : 0x555048
    }));
    sp.position.copy(pos).y += 0.3;
    sp.scale.set(rand(0.3, 0.7), rand(0.3, 0.7), 1);
    const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.6), rand(-1, 1)).multiplyScalar(rand(3, 9));
    scene.add(sp);
    parts.push({ obj: sp, vel: v, life: rand(0.4, 0.9), particle: true });
  }
  weapon.shells.push(...parts);
  if (G.coop && net.isHost) net._broadcast({ t: 'boom', p: [pos.x, pos.y, pos.z] });

  const dPlayer = pos.distanceTo(player.pos);
  audio.boom(dPlayer);
  G.shake = Math.max(G.shake, Math.max(0, 1 - dPlayer / (radius * 3)));

  // 伤害敌人
  for (const s of enemies.soldiers) {
    if (s.state === 'dead') continue;
    const d = pos.distanceTo(s.pos.clone().setY(s.pos.y + 1));
    if (d > radius) continue;
    const dmg = d < 3 ? dmgBase : dmgBase - (d - 3) / (radius - 3) * dmgBase * 0.8;
    const killed = s.damage(dmg, 'body', now);
    if (killed) onKill(s, weaponName);
  }
  // 自伤
  if (dPlayer < radius && player.alive) {
    const dmg = (dPlayer < 2.5 ? dmgBase * 0.9 : dmgBase * 0.9 - (dPlayer - 2.5) / (radius - 2.5) * dmgBase * 0.7);
    const dx = pos.x - player.pos.x, dz = pos.z - player.pos.z;
    hud.damageFrom(Math.atan2(dx, -dz) - (-player.yaw));
    if (player.damage(dmg, pos, now)) onPlayerDeath();
  }
}

function updateNades(dt) {
  for (let i = nades.length - 1; i >= 0; i--) {
    const n = nades[i];
    n.vel.y -= 13 * dt;
    n.mesh.position.addScaledVector(n.vel, dt);
    const p = n.mesh.position;
    // 地面反弹
    if (p.y < 0.09) {
      p.y = 0.09;
      n.vel.y = Math.abs(n.vel.y) * 0.42;
      n.vel.x *= 0.75; n.vel.z *= 0.75;
      if (n.vel.length() < 0.6) n.vel.set(0, 0, 0);
    }
    // 墙体反弹
    for (const c of colliders) {
      const r = 0.09;
      if (p.x + r < c.min.x || p.x - r > c.max.x) continue;
      if (p.z + r < c.min.z || p.z - r > c.max.z) continue;
      if (p.y + r < c.min.y || p.y - r > c.max.y) continue;
      const dx1 = (c.max.x + r) - p.x, dx2 = p.x - (c.min.x - r);
      const dz1 = (c.max.z + r) - p.z, dz2 = p.z - (c.min.z - r);
      const dy1 = (c.max.y + r) - p.y;
      const m = Math.min(dx1, dx2, dz1, dz2, dy1);
      if (m === dx1) { p.x = c.max.x + r; n.vel.x = Math.abs(n.vel.x) * 0.45; }
      else if (m === dx2) { p.x = c.min.x - r; n.vel.x = -Math.abs(n.vel.x) * 0.45; }
      else if (m === dz1) { p.z = c.max.z + r; n.vel.z = Math.abs(n.vel.z) * 0.45; }
      else if (m === dz2) { p.z = c.min.z - r; n.vel.z = -Math.abs(n.vel.z) * 0.45; }
      else { p.y = c.max.y + r; n.vel.y = Math.abs(n.vel.y) * 0.42; n.vel.x *= 0.75; n.vel.z *= 0.75; }
      break;
    }
    n.mesh.rotation.x += dt * 8;
    n.fuse -= dt;
    if (n.fuse <= 0) {
      scene.remove(n.mesh);
      nades.splice(i, 1);
      explode(p.clone());
    }
  }
  boomLight.intensity *= Math.pow(0.00001, dt);
}

function rand(a, b) { return a + Math.random() * (b - a); }

// ---------- 金币 ----------
function addGold(n) {
  save.addGold(n);
  hud.gold(save.gold);
  if (G.inAdventure) G.advGold += n;
}

// ---------- 击杀庆祝 ----------
function onKill(soldier, weaponName, isHeadshot = false, killerName = 'YOU') {
  const mine = killerName === 'YOU';
  G.kills++; G.scoreB++;
  save.stats.kills++; save.save();
  hud.setScore(G.scoreB, G.scoreR);
  if (mine) {
    if (now - G.lastKillT < 4) G.streak++; else G.streak = 1;
    G.lastKillT = now;
  }
  // 連線：廣播擊殺與團隊金幣
  if (G.coop && net.isHost) {
    net._broadcast({ t: 'kill', k: mine ? 'P1' : killerName, w: weaponName, v: soldier.name, head: isHeadshot });
    net._broadcast({ t: 'gold', n: 10 });
  }

  // ===== BOSS 击杀 =====
  if (soldier.isBoss) {
    const rare = soldier.maxHp >= 1000;
    addGold(rare ? 1000 : 200);
    save.stats.boss++; save.save();
    hud.bossBar(null);
    hud.celebrate(rare ? 'GUARDIAN DOWN' : 'BOSS DOWN', rare ? '遠古守衛已擊殺 · 金幣 +1000' : '敵方 BOSS 已擊殺 · 金幣 +200', 2);
    audio.voice('rampage');
    // 大量掉落
    const drops = rare ? 5 : 3;
    const rarePool = ['boostweapon', 'armor100', 'fullhp'];
    const epicPool = ['goldweapon', 'fullsupply'];
    const itemPool = ['boostcore', 'goldcore', 'goldbag', 'medkit', 'armorpack', 'nadepack'];
    for (let i = 0; i < drops; i++) {
      const p = soldier.pos.clone();
      p.x += rand(-1.5, 1.5); p.z += rand(-1.5, 1.5);
      if (rare) {
        // 稀有 BOSS：道具 + 史诗混合
        if (Math.random() < 0.5) loot.drop(p, { rarity: Math.random() < 0.5 ? 'epic' : 'rare', type: 'item', itemId: itemPool[(Math.random() * itemPool.length) | 0] });
        else loot.drop(p, { rarity: 'epic', type: epicPool[(Math.random() * epicPool.length) | 0] });
      } else {
        loot.drop(p, Math.random() < 0.4
          ? { rarity: 'epic', type: epicPool[(Math.random() * epicPool.length) | 0] }
          : { rarity: 'rare', type: rarePool[(Math.random() * rarePool.length) | 0] });
      }
    }
    if (rare) {
      activatePortal('exit');   // 返程传送门
      hud.sysmsg(IS_TOUCH ? '返程傳送門已開啟 · 靠近點互動鍵離開奇遇' : '返程傳送門已開啟 · 靠近按 P 離開奇遇', 4000);
    } else {
      activatePortal('adventure'); // 奇遇传送门
      hud.sysmsg(IS_TOUCH ? '🌀 奇遇傳送門已開啟 · 靠近點互動鍵進入黃金遺跡' : '🌀 奇遇傳送門已開啟 · 靠近按 P 進入黃金遺跡', 4500);
    }
    G.boss = null;
    return;
  }

  addGold(10);
  if (!G.coop) loot.drop(soldier.pos.clone());   // 連線模式關閉拾取（避免不同步）

  if (!mine) {   // 隊友擊殺：只上播報
    audio.kill();
    hud.feed(killerName, weaponName, soldier.name, true);
    return;
  }
  if (!G.firstBlood) {
    G.firstBlood = true;
    hud.celebrate('FIRST BLOOD', '首殺 · 先聲奪人', 0);
    audio.voice('firstblood');
  } else if (isHeadshot) {
    hud.killToast(150);
    hud.celebrate('HEADSHOT', '爆頭', 0);
    audio.voice('headshot');
  } else if (G.streak === 2) {
    hud.celebrate('DOUBLE KILL', '雙殺', 1);
    audio.voice('double');
  } else if (G.streak === 3) {
    hud.celebrate('TRIPLE KILL', '三連殺', 1);
    audio.voice('triple');
  } else if (G.streak >= 4) {
    hud.celebrate('RAMPAGE', `${G.streak} 連殺 · 超神`, 2);
    audio.voice('rampage');
  } else {
    hud.killToast(100);
    audio.voice('eliminated');
  }
  audio.kill();
  hud.feed('YOU', weaponName, soldier.name, true);
}

// ---------- RPG 火箭弹 ----------
const rockets = [];
const rocketGeo = new THREE.ConeGeometry(0.07, 0.3, 8);
const rocketMat = new THREE.MeshStandardMaterial({ color: 0x4a5240, metalness: 0.5, roughness: 0.5 });

function spawnRocket(origin, dir) {
  const m = new THREE.Mesh(rocketGeo, rocketMat);
  m.position.copy(origin).addScaledVector(dir, 0.8);
  m.lookAt(m.position.clone().add(dir));
  m.rotateX(Math.PI / 2);
  scene.add(m);
  rockets.push({ mesh: m, vel: dir.clone().multiplyScalar(28), smokeT: 0 });
  audio.sniperShot();
}

function updateRockets(dt) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.mesh.position.addScaledVector(r.vel, dt);
    const p = r.mesh.position;
    // 尾烟
    r.smokeT -= dt;
    if (r.smokeT <= 0) {
      r.smokeT = 0.03;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: weapon.impactTex, color: 0xcccccc, transparent: true, opacity: 0.5, depthWrite: false
      }));
      sp.position.copy(p); sp.scale.set(0.3, 0.3, 1);
      scene.add(sp);
      weapon.shells.push({ obj: sp, vel: new THREE.Vector3(0, 0.5, 0), life: 0.5, particle: true });
    }
    let hit = p.y <= 0.05;
    // 撞墙
    if (!hit) {
      for (const c of colliders) {
        if (p.x > c.min.x && p.x < c.max.x && p.y > c.min.y && p.y < c.max.y && p.z > c.min.z && p.z < c.max.z) { hit = true; break; }
      }
    }
    // 直接命中敌人
    if (!hit) {
      for (const s of enemies.soldiers) {
        if (s.state === 'dead') continue;
        if (p.distanceTo(s.pos.clone().setY(s.pos.y + 1)) < 1.1) { hit = true; break; }
      }
    }
    if (hit || p.length() > 300) {
      scene.remove(r.mesh);
      rockets.splice(i, 1);
      explode(p.clone(), 'RPG-7');
    }
  }
}

// ---------- 敌人回调 ----------
const fx = {
  enemyTracer() {},   // 旧即时曳光已弃用（实体弹道替代）
  enemyBullet(from, dir, speed, dmg, boss) {
    enemies.fireBullet(from, dir, speed, dmg, boss);
    if (G.coop && net.isHost)
      net._broadcast({ t: 'ebolt', o: [from.x, from.y, from.z], d: [dir.x, dir.y, dir.z], speed, boss });
  },
  enemyImpact(pos) { weapon._impact(pos, null, false); },
  playerHit(dmg, fromPos, tgt) {
    // 連線：子彈命中的是遠端玩家 → 轉交給對方客户端處理
    if (tgt && tgt.isRemote) {
      net._broadcast({ t: 'dmg', dmg, from: [fromPos.x, fromPos.y, fromPos.z], to: tgt.id });
      return;
    }
    // BOT 隊友中彈：房主本地結算
    if (tgt && tgt.isBot) {
      if (bots.damage(tgt, dmg)) hud.sysmsg(`💀 ${tgt.name} 陣亡 · 6 秒後重生`, 2200);
      return;
    }
    applyIncomingDamage(dmg, fromPos);
  }
};

// 本地玩家受到敵方子彈傷害（單機 & 連線雙方共用）
function applyIncomingDamage(dmg, fromPos) {
  if (G.state !== 'play') return;
  if (player.protectT > 0) { // 出生保护：敌方攻击无效
    hud.sysmsg('🛡 保護期內 · 敵方攻擊無效', 800);
    return;
  }
  const dx = fromPos.x - player.pos.x, dz = fromPos.z - player.pos.z;
  hud.damageFrom(Math.atan2(dx, -dz) - (-player.yaw));
  if (player.damage(dmg, fromPos, now)) onPlayerDeath();
}

function onPlayerDeath() {
  G.state = 'dead';
  G.deaths++;
  G.scoreR++;
  G.streak = 0;
  hud.setScore(G.scoreB, G.scoreR);
  hud.feed('ENEMY', 'AK-47', 'YOU', false);
  hud.sysmsg('你已陣亡 · 3 秒後重新部署', 3000);
  $('vignette').style.opacity = '1';
  G.respawnT = 3;
}

// ---------- 传送门（奇遇入口 / 返程）----------
const portalG = new THREE.Group();
{
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.12, 10, 32),
    new THREE.MeshStandardMaterial({ color: 0x8a4aff, emissive: 0x6a2aff, emissiveIntensity: 1.2, metalness: 0.6, roughness: 0.3 }));
  ring.position.y = 2.0; ring.name = 'ring';
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.25, 32),
    new THREE.MeshBasicMaterial({ color: 0x4a2a9a, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  disc.position.y = 2.0; disc.name = 'disc';
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 8, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x9a5aff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 4; beam.name = 'beam';
  portalG.add(ring, disc, beam);
  portalG.visible = false;
  scene.add(portalG);
}

function activatePortal(target) {
  G.portal.active = true;
  G.portal.target = target;
  portalG.position.copy(mapInfo.portalPos);
  portalG.visible = true;
}

function deactivatePortal() {
  G.portal.active = false;
  portalG.visible = false;
}

function updatePortal(dt) {
  if (!G.portal.active) return;
  const ring = portalG.getObjectByName('ring');
  const disc = portalG.getObjectByName('disc');
  ring.rotation.z += dt * 1.6;
  disc.rotation.z -= dt * 0.8;
  const s = 1 + Math.sin(now * 3) * 0.06;
  ring.scale.setScalar(s);
}

// ---------- 爆破任务 ----------
const bombG = new THREE.Group();   // 爆破点标记
{
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.1, 7, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 3.5;
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.4, 32),
    new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.name = 'ring';
  bombG.add(beam, ring);
  bombG.visible = false;
  scene.add(bombG);
}
const c4Mesh = new THREE.Group();  // 已安装的 C4
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.5, metalness: 0.4 }));
  body.position.y = 0.12;
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  led.position.set(0.12, 0.23, 0); led.name = 'led';
  c4Mesh.add(body, led);
  c4Mesh.visible = false;
  scene.add(c4Mesh);
}

function setupBomb() {
  if (G.coop) { bombG.visible = false; c4Mesh.visible = false; return; }   // 連線模式關閉爆破任務
  if (mapInfo.bombSite && !G.inAdventure) {
    bombG.position.set(mapInfo.bombSite.x, 0, mapInfo.bombSite.z);
    bombG.visible = G.bomb.state === 'carry';
  } else bombG.visible = false;
  c4Mesh.visible = false;
}

function updateBomb(dt) {
  if (G.coop) { hud.plantBar(null); return; }   // 連線模式關閉爆破任務
  const b = G.bomb;
  const site = mapInfo.bombSite;
  if (!site || G.inAdventure) { hud.plantBar(null); return; }
  const dSite = Math.hypot(player.pos.x - site.x, player.pos.z - site.z);

  if (b.state === 'carry') {
    bombG.visible = true;
    bombG.getObjectByName('ring').rotation.z += dt * 0.8;
    if (dSite < site.r && player.alive && G.state === 'play')
      hud.prompt(IS_TOUCH ? '點按 <b>互動</b> 安裝 C4 炸彈' : '按 <b>E</b> 安裝 C4 炸彈');
  } else if (b.state === 'planting') {
    if (dSite > site.r + 1.5 || !player.alive) { // 离开/阵亡中断
      b.state = 'carry';
      hud.plantBar(null);
      hud.sysmsg('安裝已中斷', 1400);
    } else {
      b.plantT -= dt;
      hud.plantBar(1 - b.plantT / 3);
      if (b.plantT <= 0) {
        b.state = 'planted'; b.boomT = 20; b.beepT = 0;
        hud.plantBar(null);
        bombG.visible = false;
        c4Mesh.position.set(site.x, 0, site.z);
        c4Mesh.visible = true;
        audio.plant();
        hud.sysmsg('💣 炸彈已安裝 · 20 秒後引爆', 2600);
        hud.celebrate('BOMB PLANTED', '炸彈已安裝', 1);
      }
    }
  } else if (b.state === 'planted') {
    b.boomT -= dt;
    // 蜂鸣逐渐急促
    b.beepT -= dt;
    if (b.beepT <= 0) {
      b.beepT = Math.max(0.14, b.boomT / 20 * 1.1);
      audio.beep(b.boomT < 5);
      const led = c4Mesh.getObjectByName('led');
      led.material.color.set(led.material.color.getHex() === 0xff2020 ? 0x440000 : 0xff2020);
    }
    if (b.boomT <= 0) {
      c4Mesh.visible = false;
      b.state = 'carry';
      explode(new THREE.Vector3(site.x, 0.3, site.z), 'C4 炸藥', 12, 320);
      G.missions++;
      save.stats.missions++; save.save();
      G.scoreB += 10;
      hud.setScore(G.scoreB, G.scoreR);
      addGold(300);
      hud.celebrate('MISSION COMPLETE', '爆破任務完成 · 金幣 +300', 2);
      audio.voice('victory');
      hud.sysmsg('爆破任務完成！任務已刷新，可再次執行', 3500);
      setupBomb();
    }
  }
}

// ---------- 奇遇地图 ----------
function enterAdventure() {
  deactivatePortal();
  G.inAdventure = true;
  G.adventureT = 120;
  G.advGold = 0; G.advItems = 0;
  G.bomb.state = 'carry'; bombG.visible = false; c4Mesh.visible = false;
  mapInfo = buildMap(scene, 'adventure', 'day');   // 黃金遺跡固定白天
  player.setBounds(mapInfo.bounds);
  player.spawn(mapInfo.playerSpawn);
  enemies.reset(6, mapInfo.bounds, mapInfo.playerSpawn);
  enemies.setBounds(mapInfo.bounds, mapInfo.playerSpawn);
  enemies.clearBullets();
  enemies.spawnAll(player.pos);
  // 稀有 BOSS
  G.boss = enemies.spawnBoss(mapInfo.bossPos, { hp: 1500, scale: 1.7, name: '遠古守衛', rare: true });
  // 基座宝藏（稀有/史诗道具与装备）
  const itemPool = ['boostcore', 'goldcore', 'goldbag', 'medkit', 'armorpack', 'nadepack'];
  for (const spot of mapInfo.lootSpots) {
    const roll = Math.random();
    if (roll < 0.55) loot.drop(spot, { rarity: 'rare', type: 'item', itemId: itemPool[(Math.random() * itemPool.length) | 0] });
    else if (roll < 0.8) loot.drop(spot, { rarity: 'rare', type: 'boostweapon' });
    else loot.drop(spot, { rarity: 'epic', type: Math.random() < 0.6 ? 'goldweapon' : 'fullsupply' });
  }
  hud.setMap(mapInfo);
  applyMapEnv(mapInfo);   // 地圖光照（在所有新物件建立後統一套用）
  hud.celebrate('GOLDEN RUINS', '奇遇 · 黃金遺跡 · 限時 120 秒', 2);
  hud.sysmsg('拾取稀有裝備，擊殺遠古守衛可獲得大量金幣！', 4000);
}

function exitAdventure() {
  save.stats.adventures++; save.save();
  deactivatePortal();
  G.inAdventure = false;
  G.boss = null;
  enemies.removeBosses();
  endRound(true);
}

function resetWeapons() {
  for (const id of WEAPON_ORDER) {
    weapon.state[id].ammo = WEAPONS[id].mag;
    weapon.state[id].reserve = WEAPONS[id].reserve;
    weapon.state[id].boost = 1;
  }
  weapon.grenades = 2; weapon.reloading = 0;
}

function respawnPlayer() {
  player.spawn(mapInfo.playerSpawn);
  resetWeapons();
  G.state = 'play';
  hud.sysmsg('重新部署完成', 1200);
}

// ---------- 输入（键鼠）----------
document.addEventListener('mousedown', e => {
  if (G.state !== 'play' || IS_TOUCH) return;
  if (document.pointerLockElement !== renderer.domElement) return;
  if (e.button === 0) G.firing = true;
  if (e.button === 2) G.adsHeld = true;
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) G.firing = false;
  if (e.button === 2) G.adsHeld = false;
});
document.addEventListener('contextmenu', e => e.preventDefault());
function doInteract() { // E / 触屏互动键：安装炸弹或进出传送门
  if (G.state !== 'play' || !player.alive) return;
  const site = mapInfo.bombSite;
  if (G.portal.active && player.pos.distanceTo(portalG.position) < 6) {
    if (G.portal.target === 'adventure') enterAdventure();
    else exitAdventure();
    return;
  }
  if (!G.inAdventure && site && G.bomb.state === 'carry'
    && Math.hypot(player.pos.x - site.x, player.pos.z - site.z) < site.r) {
    G.bomb.state = 'planting';
    G.bomb.plantT = 3;
    hud.sysmsg('安裝炸彈中……保持站位', 2000);
  }
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyB') { togglePack(); return; }
  if (G.state === 'menu' || G.state === 'end') return;
  if (e.code === 'Escape' && G.state === 'play') { quitToMenu(); return; }
  if (G.state !== 'play') return;
  if (e.code === 'KeyR') weapon.startReload();
  if (e.code === 'KeyG') weapon.throwGrenade();
  if (e.code === 'KeyE' || e.code === 'KeyP') doInteract();
  if (e.code === 'KeyZ') { // 狙击变倍
    const zn = weapon.cycleZoom();
    if (zn) { $('scopezoom').textContent = zn + ' · Z 变倍'; audio.hit(); }
  }
  // 数字键 1~0 切换 10 种武器
  const m = e.code.match(/^Digit(\d)$/);
  if (m) {
    const idx = (parseInt(m[1]) + 9) % 10;   // 1→0 ... 0→9
    weapon.switchWeapon(WEAPON_ORDER[idx]);
  }
});

function quitToMenu() {
  G.state = 'menu';
  G.firing = false; G.adsHeld = false;
  G.inAdventure = false; G.boss = null;
  enemies.removeBosses();
  deactivatePortal();
  hud.plantBar(null); hud.prompt(null); hud.protect(0); hud.bossBar(null); hud.objective(null);
  net.leave(); bots.clear(); G.coop = false;   // 退出公共房，釋放位置
  if (!IS_TOUCH) document.exitPointerLock?.();
  if (IS_TOUCH) $('touchui').classList.remove('ingame');
  save.save();
  $('endScreen').classList.add('hidden');
  $('startScreen').classList.remove('hidden');
  refreshStartbar();
  updateRoster();
}
document.addEventListener('pointerlockchange', () => {
  if (IS_TOUCH) return;
  if (document.pointerLockElement !== renderer.domElement) {
    G.firing = false; G.adsHeld = false;
    if (G.state === 'play') hud.sysmsg('已暫停 · 點擊畫面繼續', 60000);
  } else hud.sysmsg('', 1);
});
renderer.domElement.addEventListener('click', () => {
  if (IS_TOUCH) return;
  if ((G.state === 'play' || G.state === 'dead') && document.pointerLockElement !== renderer.domElement)
    renderer.domElement.requestPointerLock();
});

// ---------- 触屏控制 ----------
if (IS_TOUCH) {
  const joy = $('joy'), knob = $('joyknob');
  let joyId = null, joyCx = 0, joyCy = 0;
  joy.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    joyId = t.identifier;
    const r = joy.getBoundingClientRect();
    joyCx = r.left + r.width / 2; joyCy = r.top + r.height / 2;
    e.preventDefault();
  }, { passive: false });
  joy.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      let dx = (t.clientX - joyCx) / 45, dy = (t.clientY - joyCy) / 45;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      player.touchMove.f = -dy; player.touchMove.s = dx;
      player.touchSprint = len > 0.92;
      knob.style.transform = `translate(calc(-50% + ${dx * 38}px), calc(-50% + ${dy * 38}px))`;
    }
    e.preventDefault();
  }, { passive: false });
  const joyEnd = e => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      joyId = null;
      player.touchMove.f = 0; player.touchMove.s = 0; player.touchSprint = false;
      knob.style.transform = 'translate(-50%,-50%)';
    }
  };
  joy.addEventListener('touchend', joyEnd);
  joy.addEventListener('touchcancel', joyEnd);

  // 视角滑动
  const lz = $('lookzone');
  let lookId = null, lx = 0, ly = 0;
  lz.addEventListener('touchstart', e => {
    const t = e.changedTouches[0];
    lookId = t.identifier; lx = t.clientX; ly = t.clientY;
    e.preventDefault();
  }, { passive: false });
  lz.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      player.look(t.clientX - lx, t.clientY - ly);
      lx = t.clientX; ly = t.clientY;
    }
    e.preventDefault();
  }, { passive: false });
  const lookEnd = e => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; };
  lz.addEventListener('touchend', lookEnd);
  lz.addEventListener('touchcancel', lookEnd);

  // 按钮
  const bind = (id, down, up) => {
    const el = $(id);
    el.addEventListener('touchstart', e => { down(el); e.preventDefault(); }, { passive: false });
    if (up) {
      el.addEventListener('touchend', () => up(el));
      el.addEventListener('touchcancel', () => up(el));
    }
  };
  bind('btnFire', () => { G.firing = true; }, () => { G.firing = false; });
  bind('btnAds', el => { G.adsHeld = !G.adsHeld; el.classList.toggle('on', G.adsHeld); });
  bind('btnJump', () => { player.keys['Space'] = true; }, () => { player.keys['Space'] = false; });
  bind('btnReload', () => weapon.startReload());
  bind('btnNade', () => weapon.throwGrenade());
  bind('btnSwap', () => weapon.cycle());
  bind('btnAct', () => doInteract());
  bind('btnPack2', () => togglePack());
  bind('btnQuit', () => quitToMenu());

  // 阻止 iOS 双指缩放手势 / 双击缩放干扰游戏
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
}

// ---------- 地图选择 ----------
document.querySelectorAll('.mapcard').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.mapcard').forEach(c => c.classList.remove('sel'));
    card.classList.add('sel');
    G.mapId = card.dataset.map;
    if (G.coop && net.isHost && net.connected) {   // 房主換圖同步給加入者
      net.mapId = G.mapId;
      net._broadcast({ t: 'map', mapId: G.mapId, env: G.env });
    }
  });
});
// 時段選擇（白天 / 夕陽 / 夜晚）
document.querySelectorAll('.envcard').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.envcard').forEach(c => c.classList.remove('sel'));
    card.classList.add('sel');
    G.env = card.dataset.env;
    if (G.coop && net.isHost && net.connected) {   // 房主換時段同步給加入者
      net.env = G.env;
      net._broadcast({ t: 'map', mapId: G.mapId, env: G.env });
    }
  });
});

// ---------- 模式选择（自由局 / 限时局）----------
document.querySelectorAll('.modecard').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.modecard').forEach(c => c.classList.remove('sel'));
    card.classList.add('sel');
    G.mode = card.dataset.mode;
  });
});

// ---------- 开始界面金币 / 统计 ----------
function refreshStartbar() {
  $('startgold').textContent = '💰 ' + save.gold;
  const st = save.stats;
  $('startstats').textContent = `生涯：擊殺 ${st.kills} · BOSS ${st.boss} · 爆破任務 ${st.missions} · 奇遇 ${st.adventures}`;
}
refreshStartbar();
hud.gold(save.gold);

// ---------- 背包 / 仓库面板 ----------
function itemCard(id, n, actions) {
  const it = ITEMS[id];
  const div = document.createElement('div');
  div.className = 'itemcard';
  div.innerHTML = `<div class="ic" style="color:${it.color}">${it.icon}</div>
    <div class="nm">${it.name}</div><div class="ds">${it.desc}</div><div class="ct">× ${n}</div>`;
  for (const [label, fn] of actions) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', fn);
    div.appendChild(b);
  }
  return div;
}

function renderPack() {
  const grid = $('packGrid');
  grid.innerHTML = '';
  const ids = Object.keys(save.pack);
  $('packSub').textContent = `存放拾取的裝備道具 · 可在戰鬥中使用（${save.totalOf(save.pack)}/${24}）`;
  if (!ids.length) { grid.innerHTML = '<div class="empty">背包空空如也 · 去戰鬥中拾取裝備吧</div>'; return; }
  for (const id of ids) {
    grid.appendChild(itemCard(id, save.pack[id], [
      ['使用', () => useItem(id)],
      ['存入倉庫', () => { save.toWarehouse(id); renderPack(); }]
    ]));
  }
}

function renderWh() {
  const grid = $('whGrid');
  grid.innerHTML = '';
  const ids = Object.keys(save.wh);
  $('whSub').textContent = `長期存儲 · 跨對局保留（${save.totalOf(save.wh)}/${60}）`;
  if (!ids.length) { grid.innerHTML = '<div class="empty">倉庫空空如也 · 背包中的道具可存入</div>'; return; }
  for (const id of ids) {
    grid.appendChild(itemCard(id, save.wh[id], [
      ['取出到背包', () => { save.toPack(id); renderWh(); }]
    ]));
  }
}

function togglePack() {
  const p = $('packPanel');
  const opening = !p.classList.contains('on');
  p.classList.toggle('on', opening);
  if (opening) {
    renderPack();
    if (G.state === 'play' && !IS_TOUCH) document.exitPointerLock?.();
  }
}

$('btnPack').addEventListener('click', togglePack);
$('btnWh').addEventListener('click', () => { renderWh(); $('whPanel').classList.add('on'); });
document.querySelectorAll('.panelclose').forEach(b =>
  b.addEventListener('click', () => $(b.dataset.close).classList.remove('on')));

// ---------- 道具使用 ----------
function useItem(id) {
  if (!save.removeItem(id, 1)) return;
  if (id === 'medkit') player.hp = Math.min(100, player.hp + 50);
  else if (id === 'armorpack') player.armor = Math.min(100, player.armor + 50);
  else if (id === 'nadepack') weapon.grenades = Math.min(6, weapon.grenades + 2);
  else if (id === 'boostcore') {
    const st = weapon.state[weapon.activeId];
    st.boost = Math.max(st.boost, 1.2);
  } else if (id === 'goldcore') {
    weapon.state[weapon.activeId].boost = 1.4;
  } else if (id === 'goldbag') { save.addGold(100); hud.gold(save.gold); }
  audio.kill();
  hud.sysmsg(`已使用 ${ITEMS[id].icon} ${ITEMS[id].name}`, 1600);
  renderPack();
}

// ---------- 多人連線 UI ----------
function updateRoster() {
  const n = net.isHost ? net.conns.size + 1 + bots.count : (net.rosterCount || (net.connected ? 2 : 1));
  $('coopinfo').textContent = G.coop ? `👥 ${Math.min(n, 5)}/5 · 公共房` : '';
  $('coopinfo').style.display = (G.coop && G.state !== 'menu') ? 'block' : 'none';
}

net.onEvent = (type, data) => {
  switch (type) {
    case 'code':
      $('coopStatus').textContent = '✅ 已建立公共房 · 自動補滿 BOT 隊友';
      break;
    case 'status':
      $('coopStatus').textContent = data;
      break;
    case 'roster':
      if (net.isHost) bots.setCount(Math.max(0, 5 - data), player.pos);   // 玩家進房自動踢走一位 BOT
      updateRoster();
      $('coopStatus').textContent = `公共房 · 目前 ${data}/5 位玩家`;
      break;
    case 'rosterInfo':
      net.rosterCount = data.length;
      updateRoster();
      $('coopStatus').textContent = `✅ 已加入公共房 · ${data.length}/5 位玩家`;
      break;
    case 'welcome':
      net.rosterCount = 2;
      G.mapId = data.mapId;
      if (data.env) G.env = data.env;
      document.querySelectorAll('.mapcard').forEach(c => c.classList.toggle('sel', c.dataset.map === data.mapId));
      document.querySelectorAll('.envcard').forEach(c => c.classList.toggle('sel', c.dataset.env === G.env));
      if (G.state === 'menu' || G.state === 'end') startGame();   // 加入公共房後直接進場
      break;
    case 'full':   // 公共房已滿 5 位玩家 → 本局離線進行
      G.coop = false;
      net.leave();
      bots.setCount(4, player.pos);
      if (G.state === 'menu' || G.state === 'end') startGame();
      hud.sysmsg('公共房間已滿 · 本局單機進行', 3000);
      break;
    case 'map':
      G.mapId = data.mapId;
      if (data.env) G.env = data.env;
      document.querySelectorAll('.mapcard').forEach(c => c.classList.toggle('sel', c.dataset.map === G.mapId));
      document.querySelectorAll('.envcard').forEach(c => c.classList.toggle('sel', c.dataset.env === G.env));
      break;
    case 'start':
      if (G.state === 'menu' || G.state === 'end') startGame();
      break;
    case 'snapScore':
      if (!net.isHost) { G.scoreB = data; hud.setScore(G.scoreB, G.scoreR); }
      break;
    case 'kill':
      hud.feed(data.k, data.w, data.v, true);
      if (data.k === net.myName) { hud.killToast(data.head ? 150 : 100); audio.kill(); }
      break;
    case 'gold':
      addGold(data);
      break;
    case 'dmg':
      applyIncomingDamage(data.dmg, new THREE.Vector3(data.from[0], data.from[1], data.from[2]));
      break;
    case 'boom':
      explodeVisual(new THREE.Vector3(data.p[0], data.p[1], data.p[2]));
      break;
    case 'msg':
      hud.sysmsg(data, 2500);
      break;
    case 'clientHit': {   // 房主：加入者回報命中
      if (G.state !== 'play') break;
      const s = enemies.soldiers[data.id];
      if (s && s.state !== 'dead') {
        const killed = s.damage(data.dmg, data.part, now);
        if (killed) onKill(s, data.w, data.part === 'head', data.from.name);
      }
      break;
    }
    case 'clientNade': {   // 房主：代加入者生成真手雷
      const dir = new THREE.Vector3(data.dir[0], data.dir[1], data.dir[2]);
      const mesh = nadePool.acquire();
      mesh.visible = true;
      mesh.position.set(data.o[0], data.o[1], data.o[2]).addScaledVector(dir, 0.6);
      const vel = dir.clone().multiplyScalar(16);
      vel.y += 3.5;
      nades.push({ mesh, vel, fuse: 2.5 });
      audio.step();
      break;
    }
  }
};

// ---------- 自動配房（進遊戲自動集中安排到公共房）----------
function autoMatch() {
  net.auto(role => {
    if (role === 'host') {
      G.coop = true;
      bots.setCount(4, player.pos);   // 1 人 + 4 BOT = 滿編 5，玩家進房自動踢 BOT
      startGame();
    } else if (role === 'client') {
      G.coop = true;
      bots.clear();
      $('coopStatus').textContent = '已加入公共房 · 同步戰場中…';
      // 收到 welcome 後自動 startGame（見 net.onEvent）
    } else {
      G.coop = false;                 // 連線伺服器不可用 → 離線配 BOT 隊友
      bots.setCount(4, player.pos);
      startGame();
      hud.sysmsg('⚠️ 無法連上配房伺服器 · 本局離線進行', 3200);
    }
  });
}

// ---------- 开始 / 重开 ----------
function startGame() {
  audio.init(); audio.resume();
  mapInfo = buildMap(scene, G.mapId, G.env);
  player.setBounds(mapInfo.bounds);
  enemies.setBounds(mapInfo.bounds, mapInfo.playerSpawn);
  if (bots.count) { bots.setBounds(mapInfo.bounds); bots.reset(mapInfo.playerSpawn); }   // BOT 隊友重新部署
  hud.setMap(mapInfo);
  G.state = 'play';
  G.scoreB = 0; G.scoreR = 0; G.kills = 0; G.deaths = 0; G.shots = 0; G.hits = 0;
  G.time = G.mode === 'timed' ? 180 : Infinity;   // 限时局 3 分钟
  G.shake = 0; G.missions = 0;
  G.inAdventure = false; G.boss = null;
  G.bomb.state = 'carry'; G.bomb.plantT = 0;
  deactivatePortal();
  hud.setScore(0, 0);
  hud.gold(save.gold);
  player.spawn(mapInfo.playerSpawn);
  resetWeapons();
  G.streak = 0; G.lastKillT = -10; G.firstBlood = false;
  enemies.removeBosses();
  if (G.coop && !net.isHost) {
    // 連線加入者：不跑本地敵人 AI，改用房主同步的殘影
    enemies.reset(0, mapInfo.bounds, mapInfo.playerSpawn);
    enemies.clearBullets();
    net.clearGhosts();
  } else {
    enemies.reset(12, mapInfo.bounds, mapInfo.playerSpawn);
    enemies.clearBullets();
    enemies.spawnAll(player.pos);
  }
  // 敌方 BOSS 驻守爆破点附近（連線模式關閉 BOSS/傳送門）
  if (mapInfo.bombSite && !G.coop) {
    G.boss = enemies.spawnBoss(new THREE.Vector3(mapInfo.bombSite.x + 4, 0, mapInfo.bombSite.z + 4), {});
  }
  setupBomb();
  applyMapEnv(mapInfo);   // 地圖光照（敵人/BOSS 建立後統一套用）
  if (G.coop && net.isHost) net._broadcast({ t: 'start' });   // 通知加入者開局
  updateRoster();
  for (const n of nades) scene.remove(n.mesh);
  nades.length = 0;
  $('startScreen').classList.add('hidden');
  $('endScreen').classList.add('hidden');
  hud.show();
  if (IS_TOUCH) $('touchui').classList.add('ingame');
  else renderer.domElement.requestPointerLock();
}
$('playBtn').addEventListener('click', () => {
  if (net.connected) startGame();   // 已在公共房（重開一局）
  else autoMatch();                 // 進遊戲自動配房
});
$('againBtn').addEventListener('click', () => {
  $('endScreen').classList.add('hidden');
  $('startScreen').classList.remove('hidden');
  G.state = 'menu';
});

function endRound(fromAdventure = false) {
  G.state = 'end';
  G.firing = false; G.adsHeld = false;
  hud.plantBar(null); hud.prompt(null); hud.protect(0); hud.bossBar(null); hud.objective(null);
  if (!IS_TOUCH) document.exitPointerLock?.();
  if (IS_TOUCH) $('touchui').classList.remove('ingame');
  if (fromAdventure) {
    $('endTitle').textContent = '奇 遇 結 束';
    $('endTitle').style.color = '#ffd27a';
    $('endScore').innerHTML = `<span class="b">+${G.advGold}</span> 💰`;
    $('endStats').textContent = `黃金遺跡收穫：金幣 ${G.advGold} · 道具裝備 ${G.advItems} 件`;
  } else {
    const win = G.scoreB >= G.scoreR;
    $('endTitle').textContent = G.scoreB === G.scoreR ? '平局' : (win ? '勝 利' : '戰 敗');
    $('endTitle').style.color = win ? '#ffd27a' : '#ff6a5d';
    $('endScore').innerHTML = `<span class="b">${G.scoreB}</span> &nbsp;:&nbsp; <span class="r">${G.scoreR}</span>`;
    const acc = G.shots ? Math.round(G.hits / G.shots * 100) : 0;
    $('endStats').textContent = `擊殺 ${G.kills} · 陣亡 ${G.deaths} · 命中率 ${acc}% · 爆破任務 ${G.missions} 次`;
    if (G.scoreB > G.scoreR) audio.voice('victory');
  }
  $('endGold').textContent = `💰 當前金幣 ${save.gold}（已自動存檔）`;
  save.save();
  $('endScreen').classList.remove('hidden');
  refreshStartbar();
}

// ---------- 主循环 ----------
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  now += dt;

  if (G.state === 'play' || G.state === 'dead') {
    if (G.state === 'play' && !G.inAdventure) {
      G.time -= dt;
      if (G.time <= 0) endRound();
    }
    if (G.inAdventure && G.state === 'play') {
      G.adventureT -= dt;
      if (G.adventureT <= 0) exitAdventure();
    }
    if (G.state === 'dead') {
      G.respawnT -= dt;
      if (G.respawnT <= 0) respawnPlayer();
    }
    if (G.state === 'play' && player.alive && now - player.lastDamageT > 5 && player.hp < 100)
      player.hp = Math.min(100, player.hp + 16 * dt);

    player.update(dt, weapon.ads > 0.5);
    weapon.update(dt, player, G.adsHeld);
    updateNades(dt);
    updateRockets(dt);
    for (const fn of mapAnims) fn(now);   // 地图微动画（旗帜/浮尘/云）

    // 掉落拾取
    const got = loot.update(dt, player);
    if (got) {
      applyLoot(got, player, weapon, hud, audio);
      if (G.inAdventure) G.advItems++;
    }

    // 任务系统
    updateBomb(dt);
    updatePortal(dt);
    // 传送门交互提示
    if (G.portal.active && player.alive && player.pos.distanceTo(portalG.position) < 6) {
      hud.prompt(G.portal.target === 'adventure'
        ? (IS_TOUCH ? '點按 <b>互動</b> 進入奇遇地圖 · 黃金遺跡' : '按 <b>P</b> 進入奇遇地圖 · 黃金遺跡')
        : (IS_TOUCH ? '點按 <b>互動</b> 離開奇遇地圖（結算收穫）' : '按 <b>P</b> 離開奇遇地圖（結算收穫）'));
    } else if (!(mapInfo.bombSite && !G.inAdventure && G.bomb.state === 'carry'
      && Math.hypot(player.pos.x - mapInfo.bombSite.x, player.pos.z - mapInfo.bombSite.z) < mapInfo.bombSite.r)) {
      hud.prompt(null);
    }
    // BOSS 血条
    if (G.boss && G.boss.state !== 'dead') hud.bossBar(G.boss.name, G.boss.hp, G.boss.maxHp);
    else hud.bossBar(null);

    // 相机震动
    if (G.shake > 0.005) {
      camera.rotation.x += (Math.random() - 0.5) * 0.05 * G.shake;
      camera.rotation.z += (Math.random() - 0.5) * 0.04 * G.shake;
      G.shake *= Math.pow(0.001, dt);
    }

    // 开火
    if (G.firing && G.state === 'play') {
      if (weapon.ammo <= 0 && weapon.reloading <= 0) weapon.startReload();
      const ht = (G.coop && !net.isHost)
        ? (o, d, m) => net.hitTestGhosts(o, d, m)          // 加入者：打同步殘影
        : (o, d, m) => enemies.hitTest(o, d, m);
      const res = weapon.tryFire(now, player, ht);
      if (res !== null) {
        G.shots++;
        if (!weapon.cfg.auto) G.firing = false;   // 非全自动一枪一按
        if (res.rocket) {
          spawnRocket(res.origin, res.dir);
        } else if (res.hits && res.hits.length) {
          G.hits++;
          hud.hitmarker(); audio.hit();
          // 按目标聚合伤害（霰弹多弹丸叠加）
          const agg = new Map();
          for (const h of res.hits) {
            const a = agg.get(h.soldier) || { dmg: 0, head: false };
            a.dmg += res.dmg * (h.dmgMult || 1);   // M82 穿透第二目标衰减
            if (h.part === 'head') a.head = true;
            agg.set(h.soldier, a);
          }
          for (const [s, a] of agg) {
            if (G.coop && !net.isHost) {
              // 加入者：命中回報房主，由房主結算傷害/擊殺
              net.send({ t: 'hit', id: s.netId, dmg: a.dmg, part: a.head ? 'head' : 'body', w: weapon.cfg.name });
            } else {
              const killed = s.damage(a.dmg, a.head ? 'head' : 'body', now);
              if (killed) onKill(s, weapon.cfg.name, a.head);
            }
          }
        }
      }
    }

    // 敵人 AI / 連線同步
    if (G.coop && !net.isHost) {
      net.updateGhosts(dt);
    } else {
      const targets = (G.coop || bots.count) ? [player, ...net.targetStubs(), ...bots.targetStubs()] : player;
      enemies.update(dt, targets, now, fx);
      if (bots.count) bots.update(dt, {   // BOT 隊友 AI（職業分化：狙擊/醫療/衝鋒）
        player, enemies, now,
        onKill: (e, b) => onKill(e, b.role.weapon, false, b.name),
        tracer: (from, to, hit, color) => bots.tracer(from, to, hit, color),
        heal: (tgt, amt, medicName) => {
          if (tgt === 'player') {
            player.hp = Math.min(100, player.hp + amt);
            hud.sysmsg(`💚 ${medicName} 為你治療 +${amt}`, 1200);
          } else tgt.hp = Math.min(100, tgt.hp + amt);
        }
      });
    }
    if (G.coop) {
      net.update(dt, pos => explodeVisual(pos));   // 遠端玩家化身 / 視覺子彈 / 手雷
      if (net.isHost) {
        net.broadcastSnap(player, enemies, G.scoreB, dt, bots.snapRows());
      } else {
        net._stateT = (net._stateT || 0) + dt;
        if (net._stateT > 0.08) {
          net._stateT = 0;
          net.send({
            t: 'state',
            p: [player.pos.x, player.pos.y, player.pos.z],
            yaw: player.yaw, pitch: player.pitch,
            hp: player.alive ? player.hp : 0,
            mv: Math.hypot(player.vel.x, player.vel.z) > 0.5 ? 1 : 0
          });
        }
      }
    }

    // HUD
    if (perf.shouldUpdateMinimap(dt))
      hud.drawMinimap(player, (G.coop && !net.isHost) ? net.ghosts.filter(Boolean) : enemies.soldiers, now);
    hud.drawCompass(player);
    if (G.inAdventure) hud.setTimer(G.adventureT);
    else if (G.mode === 'timed') hud.setTimer(G.time);
    else $('timer').textContent = '∞';
    hud.protect(player.alive ? player.protectT : 0);
    // 任务指引
    if (G.inAdventure) {
      hud.objective(`🌀 奇遇 · 黃金遺跡<br>拾取稀有裝備，擊殺遠古守衛<br>剩餘 ${Math.ceil(G.adventureT)}s`);
    } else if (G.coop) {
      hud.objective(`👥 合作模式 · 你是 ${net.isHost ? 'P1（房主）' : net.myName}<br>合力殲滅敵軍 · 金幣團隊共享`);
    } else if (mapInfo.bombSite && !G.coop) {
      const b = G.bomb, site = mapInfo.bombSite;
      if (b.state === 'planted') hud.objective(`💣 炸彈已安裝<br>引爆倒計時 <b>${Math.ceil(b.boomT)}s</b>`);
      else {
        const d = Math.hypot(player.pos.x - site.x, player.pos.z - site.z);
        hud.objective(`🎯 任務：前往敵方陣營安裝 C4<br>距離爆破點 ${Math.round(d)}m · ${IS_TOUCH ? '點互動鍵' : '按 E'} 安裝`);
      }
    } else hud.objective(null);
    hud.setHP(player.hp, player.armor);
    hud.setAmmo(weapon.ammo, weapon.reserve, weapon.reloading > 0);
    hud.setWeapon(weapon.displayName);
    hud.setGrenades(weapon.grenades);
    const scoped = weapon.cfg.sight === 'scope' && weapon.ads > 0.6;
    $('scope').classList.toggle('on', scoped);
    $('crosshair').classList.toggle('ads', weapon.ads > 0.6);
    $('reddot').classList.toggle('on', weapon.ads > 0.6 && weapon.cfg.sight === 'reddot');
  }

  // 后期渲染（含自适应动态模糊）
  const hSpeed = Math.hypot(player.vel.x, player.vel.z);
  post.render(dt, G.state === 'play' ? hSpeed : 0, now);
}
loop();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
});

// 调试句柄
window.__game = { G, player, weapon, enemies, hud, nades, explode, loot, startGame, save, useItem, doInteract, enterAdventure, exitAdventure, activatePortal, portalG, quitToMenu, endRound, fx, updateBomb, applyLoot, audio, post };
