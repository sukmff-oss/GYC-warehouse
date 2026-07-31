import * as THREE from 'three';
import { plasterTex, brickTex, asphaltTex, sandTex, concreteTex, woodTex, containerTex, fabricTex, carPaintTex, leafTex, barkTex, signTex, rustTex, texMat } from './textures.js';

// ---------- 共享材质 ----------
const MAT = {};
function mat(color, rough = 0.95, metal = 0) {
  const key = color + '_' + rough + '_' + metal;
  if (!MAT[key]) MAT[key] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  return MAT[key];
}

export const colliders = [];    // {min,max}
export const minimapRects = []; // 建筑/大型掩体
export const minimapRoads = []; // 道路/地面色块 {x,z,w,d,color}
export const enemySpawns = [];
export const patrolPoints = [];

let scene, group;
const rand = (a, b) => a + Math.random() * (b - a);
let NIGHT = false;   // 夜晚模式：星空月亮、暖窗燈光
let SUNSET = false;  // 夕陽模式：低空暖陽、橙紅天色
export function isNight() { return NIGHT; }

// 依目前時段（夜晚 / 夕陽 / 白天）套用天空與霧色
function applySkyEnv({ night, sunset, day, dayEl = 38, haze = 1 }) {
  const hex = c => '#' + c.toString(16).padStart(6, '0');
  if (NIGHT) {
    scene.fog = new THREE.Fog(night, 55, 215);
    buildSky(hex(night), 12, 0.5);
  } else if (SUNSET) {
    scene.fog = new THREE.Fog(sunset, 45, 200);
    buildSky(hex(sunset), 5, 2.4);       // 太陽貼近地平線 + 重霾 → 橙紅夕照
  } else {
    scene.fog = new THREE.Fog(day, 60, 230);
    buildSky(hex(day), dayEl, haze);
  }
}

// ---------- 基础盒子（加入当前地图组）----------
function box(w, h, d, color, x, y, z, opts = {}) {
  let material;
  if (opts.emis) {
    // 自發光材質（夜晚暖窗 / 燈具）
    material = new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0,
      emissive: opts.emis, emissiveIntensity: opts.emisI ?? 1
    });
  } else if (opts.tex) {
    // 按盒子尺寸平铺，保持贴图密度一致
    const t = opts.tex.clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.max(w, d) / 5), Math.max(1, h / 5));
    material = texMat(color, t, { rough: opts.rough, metal: opts.metal, alpha: opts.alpha, alphaTest: opts.alphaTest, side: opts.side, bump: opts.bump });
  } else {
    material = mat(color, opts.rough ?? 0.95, opts.metal ?? 0);
  }
  // 使用 Mesh 合併（當非旋轉且非透明時）
  if (!opts.ry && !opts.rz && !opts.rx && opts.solid !== false && !opts.alpha && !opts.noBatch) {
    batchBox(w, h, d, material, x, y, z, opts);
  } else {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    if (opts.ry) m.rotation.y = opts.ry;
    if (opts.rz) m.rotation.z = opts.rz;
    if (opts.rx) m.rotation.x = opts.rx;
    m.castShadow = opts.cast !== false;
    m.receiveShadow = true;
    group.add(m);
  }
  if (opts.solid !== false && !opts.ry && !opts.rz && !opts.rx) {
    colliders.push({
      min: new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      max: new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2)
    });
  }
  return null; // batch 模式下不返回單個 mesh
}

function road(x, z, w, d, color = 0x8a8478, y = 0.02) {
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), texMat(color, asphaltTex(), { rough: 0.98 }));
  p.rotation.x = -Math.PI / 2; p.position.set(x, y, z);
  p.receiveShadow = true; group.add(p);
  minimapRoads.push({ x, z, w, d, color: '#' + color.toString(16).padStart(6, '0') });
}

// ---------- 天空 ----------
import { Sky } from 'three/addons/objects/Sky.js';
import { batchBegin, batchBox, batchEnd } from './lod-mesh.js';

// 微动画注册表：main 每帧调用 mapAnims.forEach(fn => fn(t))
export const mapAnims = [];

function buildSky(horizon = '#e8e2d0', sunElevation = 38, haze = 1) {
  // ===== 夜晚天空：深色背景 + 星空 + 月亮 =====
  if (NIGHT) {
    scene.background = new THREE.Color(horizon);
    scene.fog = new THREE.Fog(horizon, 55, 215);
    // 星空
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(320 * 3);
    for (let i = 0; i < 320; i++) {
      const a = rand(0, Math.PI * 2), el = rand(0.08, 1.4), r = 700;
      starPos[i * 3] = Math.cos(a) * Math.cos(el) * r;
      starPos[i * 3 + 1] = Math.sin(el) * r;
      starPos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xcdd8f0, size: 1.6, sizeAttenuation: false, fog: false,
      transparent: true, opacity: 0.85, depthWrite: false
    }));
    group.add(stars);
    // 月亮（微亮柔光，不刺眼）
    const mc = document.createElement('canvas'); mc.width = mc.height = 128;
    const mx = mc.getContext('2d');
    const mg = mx.createRadialGradient(64, 64, 8, 64, 64, 64);
    mg.addColorStop(0, 'rgba(214,226,244,.85)'); mg.addColorStop(0.25, 'rgba(190,206,234,.6)');
    mg.addColorStop(0.45, 'rgba(140,165,210,.18)'); mg.addColorStop(1, 'rgba(120,150,200,0)');
    mx.fillStyle = mg; mx.fillRect(0, 0, 128, 128);
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(mc), transparent: true, opacity: 0.8, fog: false, depthWrite: false
    }));
    moon.scale.set(150, 150, 1);
    moon.position.set(-320, 380, -520);
    group.add(moon);
    // 稀疏暗雲
    const cc = document.createElement('canvas'); cc.width = cc.height = 128;
    const cx = cc.getContext('2d');
    for (let i = 0; i < 10; i++) {
      const px = rand(20, 108), py = rand(45, 85), r = rand(14, 30);
      const rg = cx.createRadialGradient(px, py, 0, px, py, r);
      rg.addColorStop(0, 'rgba(110,128,162,.55)'); rg.addColorStop(1, 'rgba(110,128,162,0)');
      cx.fillStyle = rg; cx.beginPath(); cx.arc(px, py, r, 0, 7); cx.fill();
    }
    const ctex = new THREE.CanvasTexture(cc);
    const clouds = [];
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, transparent: true, opacity: rand(.3, .5), fog: false, depthWrite: false }));
      const s = rand(120, 240);
      sp.scale.set(s, s * 0.38, 1);
      const a = rand(0, Math.PI * 2), r = rand(220, 520);
      sp.position.set(Math.cos(a) * r, rand(110, 220), Math.sin(a) * r);
      sp.userData.drift = rand(0.4, 1.1);
      group.add(sp);
      clouds.push(sp);
    }
    mapAnims.push((t) => {
      for (const cl of clouds) {
        cl.position.x += cl.userData.drift * 0.016;
        if (cl.position.x > 560) cl.position.x = -560;
      }
    });
    return;
  }
  // ===== 夕陽天空：大氣漸層 + 晚霞雲（夕陽光暈已移除，避免刺眼） =====
  if (SUNSET) {
    const simple = typeof perf !== 'undefined' && perf.settings.skyQuality === 'simple';
    if (simple) {
      scene.background = new THREE.Color(horizon);
      scene.fog = new THREE.Fog(horizon, 45, 200);
    } else {
      // 大氣散射（低太陽 + 重霾 → 橙紅漸層天）
      const sky = new Sky();
      sky.scale.setScalar(3000);
      group.add(sky);
      const u = sky.material.uniforms;
      u.turbidity.value = 8;
      u.rayleigh.value = 3;
      u.mieCoefficient.value = 0.005;
      u.mieDirectionalG.value = 0.8;
      const sunDir = new THREE.Vector3().setFromSphericalCoords(1,
        THREE.MathUtils.degToRad(90 - sunElevation), THREE.MathUtils.degToRad(135));
      u.sunPosition.value.copy(sunDir);
    }
    // 晚霞雲（暖橙 + 暗紫兩層，緩慢飄動）
    const mkCloudTex = (r, g, b, a) => {
      const cc = document.createElement('canvas'); cc.width = cc.height = 128;
      const cx = cc.getContext('2d');
      for (let i = 0; i < 9; i++) {
        const px = rand(20, 108), py = rand(45, 85), rr = rand(14, 30);
        const rg = cx.createRadialGradient(px, py, 0, px, py, rr);
        rg.addColorStop(0, `rgba(${r},${g},${b},${a})`); rg.addColorStop(1, `rgba(${r},${g},${b},0)`);
        cx.fillStyle = rg; cx.beginPath(); cx.arc(px, py, rr, 0, 7); cx.fill();
      }
      return new THREE.CanvasTexture(cc);
    };
    const warmTex = mkCloudTex(255, 168, 105, 0.55);
    const duskTex = mkCloudTex(96, 56, 82, 0.45);
    const clouds = [];
    for (let i = 0; i < 12; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: i % 3 === 2 ? duskTex : warmTex, transparent: true,
        opacity: rand(.35, .65), fog: false, depthWrite: false
      }));
      const s = rand(130, 280);
      sp.scale.set(s, s * 0.32, 1);
      const a = rand(0, Math.PI * 2), r = rand(230, 540);
      sp.position.set(Math.cos(a) * r, rand(60, 190), Math.sin(a) * r);
      sp.userData.drift = rand(0.5, 1.3);
      group.add(sp);
      clouds.push(sp);
    }
    mapAnims.push(() => {
      for (const cl of clouds) {
        cl.position.x += cl.userData.drift * 0.016;
        if (cl.position.x > 580) cl.position.x = -580;
      }
    });
    return;
  }
  if (typeof perf !== 'undefined' && perf.settings.skyQuality === 'simple') {
    scene.background = new THREE.Color(horizon);
    scene.fog = new THREE.Fog(horizon, 60, 220);
    return;
  }
  // 大气散射天空
  const sky = new Sky();
  sky.scale.setScalar(3000);
  group.add(sky);
  const u = sky.material.uniforms;
  u.turbidity.value = 3 + haze * 2;
  u.rayleigh.value = 2.4;
  u.mieCoefficient.value = 0.0012 + haze * 0.0015;
  u.mieDirectionalG.value = 0.72;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1,
    THREE.MathUtils.degToRad(90 - sunElevation), THREE.MathUtils.degToRad(135));
  u.sunPosition.value.copy(sunDir);

  // 柔和云层（保留少量，叠在大气上）
  const cc = document.createElement('canvas'); cc.width = cc.height = 128;
  const cx = cc.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const px = rand(20, 108), py = rand(45, 85), r = rand(12, 30);
    const rg = cx.createRadialGradient(px, py, 0, px, py, r);
    rg.addColorStop(0, 'rgba(255,255,255,.7)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = rg; cx.beginPath(); cx.arc(px, py, r, 0, 7); cx.fill();
  }
  const ctex = new THREE.CanvasTexture(cc);
  const clouds = [];
  for (let i = 0; i < 12; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, transparent: true, opacity: rand(.35, .7), fog: false, depthWrite: false }));
    const s = rand(90, 200);
    sp.scale.set(s, s * 0.38, 1);
    const a = rand(0, Math.PI * 2), r = rand(200, 520);
    sp.position.set(Math.cos(a) * r, rand(90, 200), Math.sin(a) * r);
    sp.userData.drift = rand(0.6, 1.6);
    group.add(sp);
    clouds.push(sp);
  }
  mapAnims.push((t) => {  // 云缓慢漂移
    for (const cl of clouds) {
      cl.position.x += cl.userData.drift * 0.016;
      if (cl.position.x > 560) cl.position.x = -560;
    }
  });

  // 空气浮尘（近景微粒，氛围感）
  const dustTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,250,235,.5)'); g.addColorStop(1, 'rgba(255,250,235,0)');
    c.fillStyle = g; c.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(cv);
  })();
  const dusts = [];
  for (let i = 0; i < 26; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, opacity: rand(.12, .3), depthWrite: false }));
    sp.scale.set(0.06, 0.06, 1);
    sp.position.set(rand(-30, 30), rand(0.3, 5), rand(-30, 30));
    sp.userData = { ph: rand(0, 7), r: rand(0.5, 2.2), sp: rand(0.2, 0.7), cx: sp.position.x, cz: sp.position.z };
    group.add(sp);
    dusts.push(sp);
  }
  mapAnims.push((t) => {
    for (const d of dusts) {
      d.position.x = d.userData.cx + Math.sin(t * d.userData.sp + d.userData.ph) * d.userData.r;
      d.position.z = d.userData.cz + Math.cos(t * d.userData.sp * 0.8 + d.userData.ph) * d.userData.r;
      d.position.y += Math.sin(t * 0.4 + d.userData.ph) * 0.0012;
    }
  });
}

// ---------- 通用道具 ----------
const wallCols = [0xd8c9a8, 0xcbb894, 0xe0d3b5, 0xc4a982, 0xd0bf9f, 0xbfa77e];
const awnCols = [0x3f6d4e, 0x8a4a3a, 0x3a5a7a, 0x9a7a3a, 0x6a4a6a, 0xb06a3a];

const signNames = ['五金商店', '咖啡館', '大藥房', '便民超市', '老茶館', '書店', '麵包房', '雜貨鋪'];
const signBgs = ['#3a4a5c', '#6a3a2a', '#2a5a42', '#7a5a20', '#4a3a62'];

function building(x, z, w, d, floors, face, fixedH) {
  const isBrick = Math.random() < 0.3;
  const col = isBrick ? 0xb08a74 : wallCols[(Math.random() * wallCols.length) | 0];
  const h = fixedH || (floors * 3.4 + rand(0, 1.2));
  box(w, h, d, col, x, h / 2, z, { tex: isBrick ? brickTex() : plasterTex(), bump: isBrick ? 1.4 : 0.5 });
  minimapRects.push({ x, z, w, d });
  // 屋顶女儿墙 + 压顶
  box(w + 0.3, 0.5, d + 0.3, col, x, h + 0.25, z, { solid: false });
  box(w + 0.4, 0.12, d + 0.4, 0x9a8f7c, x, h + 0.53, z, { solid: false, cast: false });
  box(w - 0.6, 0.45, d - 0.6, 0x000000, x, h + 0.22, z, { solid: false, cast: false });

  const fx = x + face * (w / 2);
  // 层间线脚（水平挑檐条）
  for (let f = 1; f < floors; f++)
    box(0.22, 0.2, d + 0.15, 0xcfc4ae, fx + face * 0.08, f * 3.4, z, { solid: false, cast: false });
  // 顶部檐口线脚
  box(0.3, 0.26, d + 0.3, 0xd8cdb6, fx + face * 0.1, h - 0.13, z, { solid: false, cast: false });

  // 首层店门（取中间窗位，替换为门 + 招牌）
  const nWin0 = Math.max(1, Math.round(d / 4));
  const doorSlot = (Math.random() * nWin0) | 0;
  const doorZ = z - d / 2 + (doorSlot + 0.5) * (d / nWin0);
  // 门洞暗槽 + 门框 + 双开门 + 门前台阶
  box(0.14, 2.3, 1.7, 0x1c1a16, fx + face * 0.06, 1.15, doorZ, { solid: false, cast: false });
  box(0.1, 2.15, 0.72, 0x5a4632, fx + face * 0.11, 1.1, doorZ - 0.4, { solid: false, cast: false, tex: woodTex() });
  box(0.1, 2.15, 0.72, 0x5a4632, fx + face * 0.11, 1.1, doorZ + 0.4, { solid: false, cast: false, tex: woodTex() });
  box(0.2, 0.16, 1.9, 0x8a8274, fx + face * 0.2, 0.08, doorZ, { solid: false, cast: false, tex: concreteTex() });
  box(0.34, 0.14, 2.2, 0x9a9284, fx + face * 0.3, 0.02, doorZ, { solid: false, cast: false, tex: concreteTex() });
  // 招牌
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.85),
    texMat(0xffffff, signTex(signNames[(Math.random() * signNames.length) | 0], signBgs[(Math.random() * signBgs.length) | 0]), { rough: 0.85 }));
  sign.position.set(fx + face * 0.16, 3.05, doorZ);
  sign.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
  sign.castShadow = false; group.add(sign);
  // 招牌底托板
  box(0.1, 1.0, 3.6, 0x3a352c, fx + face * 0.08, 3.05, doorZ, { solid: false, cast: false });

  for (let f = 0; f < floors; f++) {
    const wy = 1.9 + f * 3.4;
    const nWin = nWin0;
    for (let i = 0; i < nWin; i++) {
      if (f === 0 && i === doorSlot) continue; // 门位
      const wz = z - d / 2 + (i + 0.5) * (d / nWin);
      // 窗套：边框 + 玻璃 + 窗台板 + 窗眉
      box(0.1, 1.55, 1.45, 0x8a7a5c, fx + face * 0.05, wy, wz, { solid: false, cast: false });
      if ((NIGHT || SUNSET) && Math.random() < (NIGHT ? 0.55 : 0.35))
        // 夜晚 / 傍晚亮燈暖窗
        box(0.12, 1.4, 1.3, 0xffd9a0, fx + face * 0.09, wy, wz, { solid: false, cast: false, emis: 0xffb05a, emisI: NIGHT ? 1.15 : 0.8 });
      else
        box(0.12, 1.4, 1.3, 0x2a3038, fx + face * 0.09, wy, wz, { solid: false, cast: false });
      box(0.26, 0.1, 1.7, 0xd0c6b0, fx + face * 0.1, wy - 0.82, wz, { solid: false, cast: false });
      box(0.2, 0.1, 1.6, 0xc4b89e, fx + face * 0.08, wy + 0.83, wz, { solid: false, cast: false });
      // 玻璃高光条
      box(0.13, 0.5, 0.25, 0x9ab8c8, fx + face * 0.1, wy + 0.3, wz - 0.35, { solid: false, cast: false });
      // 部分窗户装百叶（两侧挡板）
      if (Math.random() < 0.3) {
        const sc = awnCols[(Math.random() * awnCols.length) | 0];
        box(0.08, 1.5, 0.34, sc, fx + face * 0.12, wy, wz - 0.95, { solid: false, cast: false });
        box(0.08, 1.5, 0.34, sc, fx + face * 0.12, wy, wz + 0.95, { solid: false, cast: false });
      }
      if (f === 0 && Math.random() < 0.5) {
        const ac = awnCols[(Math.random() * awnCols.length) | 0];
        box(2.2, 0.12, 1.9, ac, fx + face * 1.05, wy + 1.25, wz, { solid: false, rz: -face * 0.42, tex: fabricTex() });
        box(0.08, 1.0, 0.08, 0x5a4a3a, fx + face * 1.9, wy + 0.6, wz - 0.8, { solid: false });
        box(0.08, 1.0, 0.08, 0x5a4a3a, fx + face * 1.9, wy + 0.6, wz + 0.8, { solid: false });
      } else if (f > 0 && Math.random() < 0.35) {
        box(1.5, 0.14, 2.4, col, fx + face * 0.75, wy - 0.85, wz, { solid: false });
        box(1.5, 0.5, 0.08, 0x6a5a44, fx + face * 0.75, wy - 0.55, wz - 1.16, { solid: false });
        box(1.5, 0.5, 0.08, 0x6a5a44, fx + face * 0.75, wy - 0.55, wz + 1.16, { solid: false });
        box(0.08, 0.5, 2.4, 0x6a5a44, fx + face * 1.45, wy - 0.55, wz, { solid: false });
      }
    }
    if (Math.random() < 0.6)
      box(0.55, 0.55, 0.8, 0xb8bcc0, fx + face * 0.35, wy + rand(0.6, 1.2), z + rand(-d / 3, d / 3), { solid: false });
  }

  // 雨水管（立面一侧，底部弯头）
  const pipeZ = z - d / 2 + 0.4;
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, h, 8), mat(0x8a8a86, 0.6, 0.6));
  pipe.position.set(fx + face * 0.14, h / 2, pipeZ); pipe.castShadow = true; group.add(pipe);
  const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), mat(0x8a8a86, 0.6, 0.6));
  elbow.position.set(fx + face * 0.32, 0.25, pipeZ); elbow.rotation.z = face * 0.8; group.add(elbow);

  // 屋顶水箱（带支架，可作掩体）
  if (Math.random() < 0.55) {
    const tx = x - face * w * 0.22, tz = z + rand(-d * 0.25, d * 0.25);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 1.7, 14), texMat(0x7a8494, rustTex(), { rough: 0.7, metal: 0.4 }));
    tank.position.set(tx, h + 1.75, tz); tank.castShadow = true; group.add(tank);
    for (const [lx, lz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]])
      box(0.12, 0.9, 0.12, 0x4a4a48, tx + lx, h + 0.45, tz + lz, { solid: false });
    box(2.2, 0.12, 2.2, 0x5a5a56, tx, h + 0.95, tz, { solid: false, cast: false });
    colliders.push({ min: new THREE.Vector3(tx - 1, h + 0.9, tz - 1), max: new THREE.Vector3(tx + 1, h + 2.6, tz + 1) });
  }
  // 卫星锅
  if (Math.random() < 0.45) {
    const dx = x + rand(-w * 0.3, w * 0.3), dz = z + rand(-d * 0.3, d * 0.3);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), mat(0x6a6a66, 0.6, 0.6));
    pole.position.set(dx, h + 0.95, dz); group.add(pole);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 3), mat(0xc8c8c0, 0.5, 0.5));
    dish.position.set(dx, h + 1.5, dz); dish.rotation.x = Math.PI * 0.72; dish.castShadow = true; group.add(dish);
  }
  return h;
}

// 楼梯：从 (x,z) 沿 dir(0=+z,1=-z,2=+x,3=-x) 上升到 height
function stairs(x, z, dir, height, width = 2, color = 0xb5a888) {
  const stepH = 0.38, stepD = 0.62;
  const n = Math.ceil(height / stepH);
  for (let i = 0; i < n; i++) {
    const h = (i + 1) * stepH;
    const off = (i + 0.5) * stepD;
    let sx = x, sz = z, w = width, d = stepD;
    if (dir === 0) sz = z + off;
    else if (dir === 1) sz = z - off;
    else if (dir === 2) { sx = x + off; w = stepD; d = width; }
    else { sx = x - off; w = stepD; d = width; }
    box(w, h, d, color, sx, h / 2, sz);
  }
  return n * stepD;
}

function marketStall(x, z, ry = 0) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  const woodM = texMat(0x9a7a52, woodTex());
  const mk = (w, h, d, col, px, py, pz, o = {}) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o.wood ? woodM : mat(col));
    m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true;
    if (o.rz) m.rotation.z = o.rz;
    g.add(m);
  };
  mk(3.2, 0.12, 1.6, 0x7a5c3c, 0, 0.95, 0, { wood: true });
  mk(0.14, 0.95, 0.14, 0x5a4630, -1.4, 0.48, -0.6); mk(0.14, 0.95, 0.14, 0x5a4630, 1.4, 0.48, -0.6);
  mk(0.14, 0.95, 0.14, 0x5a4630, -1.4, 0.48, 0.6); mk(0.14, 0.95, 0.14, 0x5a4630, 1.4, 0.48, 0.6);
  mk(3.6, 0.1, 2.2, awnCols[(Math.random() * awnCols.length) | 0], 0, 2.35, 0, { rz: 0.06 });
  mk(0.1, 1.5, 0.1, 0x5a4630, -1.6, 1.6, -0.9); mk(0.1, 1.5, 0.1, 0x5a4630, 1.6, 1.6, 0.9);
  const goods = [0xd98a2a, 0xc94a3a, 0x8ab54a, 0xe0c060];
  for (let i = 0; i < 6; i++)
    mk(rand(0.3, 0.5), rand(0.2, 0.4), rand(0.3, 0.5), goods[i % 4], rand(-1.2, 1.2), 1.15, rand(-0.5, 0.5));
  group.add(g);
  colliders.push({ min: new THREE.Vector3(x - 1.8, 0, z - 1.8), max: new THREE.Vector3(x + 1.8, 1.1, z + 1.8) });
}

function car(x, z, ry, col) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  const paint = texMat(col, carPaintTex(), { rough: 0.35, metal: 0.7 });
  const mk = (w, h, d, c, px, py, pz, usePaint = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), usePaint ? paint : mat(c, 0.6, 0.3));
    m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; g.add(m);
  };
  mk(4.4, 0.85, 1.9, col, 0, 0.75, 0);
  mk(2.4, 0.75, 1.75, col, -0.2, 1.5, 0);
  mk(2.2, 0.55, 1.8, 0x222a33, -0.2, 1.55, 0, false);
  // 前后保险杠
  mk(0.28, 0.22, 1.94, 0x2a2a2a, -2.28, 0.42, 0, false);
  mk(0.28, 0.22, 1.94, 0x2a2a2a, 2.28, 0.42, 0, false);
  // 进气格栅
  mk(0.08, 0.28, 1.1, 0x14161a, -2.22, 0.72, 0, false);
  // 大灯 / 尾灯
  mk(0.08, 0.18, 0.38, 0xf5ecc8, -2.2, 0.92, -0.6, false);
  mk(0.08, 0.18, 0.38, 0xf5ecc8, -2.2, 0.92, 0.6, false);
  mk(0.08, 0.16, 0.4, 0xa02820, 2.2, 0.9, -0.6, false);
  mk(0.08, 0.16, 0.4, 0xa02820, 2.2, 0.9, 0.6, false);
  // 后视镜
  mk(0.12, 0.1, 0.22, 0x222222, -1.15, 1.5, -1.0, false);
  mk(0.12, 0.1, 0.22, 0x222222, -1.15, 1.5, 1.0, false);
  // 排气管
  mk(0.22, 0.1, 0.1, 0x555a5e, 2.32, 0.28, 0.55, false);
  const wg = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  [[-1.5, -0.95], [1.5, -0.95], [-1.5, 0.95], [1.5, 0.95]].forEach(([px, pz]) => {
    const w = new THREE.Mesh(wg, mat(0x1a1a1a, 0.9));
    w.rotation.x = Math.PI / 2; w.position.set(px, 0.38, pz); w.castShadow = true; g.add(w);
  });
  group.add(g);
  // 分段碰撞：引擎盖/后备箱 0.85m 可跳上，车顶 1.55m 需二段跳
  const along = Math.abs(Math.cos(ry)) > 0.5;
  const L = along ? 'x' : 'z', W = along ? 'z' : 'x';
  const mkCol = (a, b, h, halfW) => {
    const min = new THREE.Vector3(), max = new THREE.Vector3();
    min[L] = a; max[L] = b; min[W] = -halfW; max[W] = halfW;
    min.y = 0; max.y = h;
    const off = new THREE.Vector3(x, 0, z);
    colliders.push({ min: min.add(off), max: max.add(off) });
  };
  mkCol(-2.25, -1.05, 0.85, 0.95);   // 前舱
  mkCol(-1.05, 1.0, 1.55, 0.9);      // 座舱顶
  mkCol(1.0, 2.25, 0.85, 0.95);      // 后备箱
}

function container(x, z, ry, col, stacked = false) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  const steel = c => texMat(c, containerTex(), { rough: 0.6, metal: 0.5 });
  const mk = (w, h, d, c, px, py, pz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), steel(c));
    m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; g.add(m);
  };
  mk(6, 2.6, 2.4, col, 0, 1.3, 0);
  mk(6.06, 0.18, 2.46, 0x2a2a2a, 0, 2.62, 0);
  if (stacked) mk(6, 2.6, 2.4, awnCols[(Math.random() * awnCols.length) | 0], 0, 3.95, 0);
  group.add(g);
  const cw = Math.abs(Math.cos(ry)) > 0.5 ? [6.2, 2.6] : [2.6, 6.2];
  const top = stacked ? 5.3 : 2.7;
  colliders.push({ min: new THREE.Vector3(x - cw[0] / 2, 0, z - cw[1] / 2), max: new THREE.Vector3(x + cw[0] / 2, top, z + cw[1] / 2) });
  minimapRects.push({ x, z, w: cw[0], d: cw[1] });
}

function sandbags(x, z, w, ry = 0) {
  const rows = Math.round(w / 0.9);
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < 3 - (i % 2); j++)
      box(0.85, 0.32, 0.5, 0xb8a678, x + (i - rows / 2 + 0.5) * 0.9 + (i % 2) * 0.2, 0.18 + j * 0.3, z, { solid: false, ry, tex: fabricTex() });
  colliders.push({ min: new THREE.Vector3(x - w / 2, 0, z - 0.4), max: new THREE.Vector3(x + w / 2, 1.0, z + 0.4) });
}

function barrier(x, z, ry = 0) {
  box(2.6, 0.9, 0.5, 0xcac4b8, x, 0.45, z, { ry, solid: false, tex: concreteTex() });
  box(2.6, 0.25, 0.7, 0xcac4b8, x, 0.12, z, { ry, solid: false, tex: concreteTex() });
  const along = Math.abs(Math.cos(ry)) > 0.5;
  colliders.push({ min: new THREE.Vector3(x - (along ? 1.3 : 0.4), 0, z - (along ? 0.4 : 1.3)), max: new THREE.Vector3(x + (along ? 1.3 : 0.4), 0.95, z + (along ? 0.4 : 1.3)) });
}

function crate(x, z, s = 1) {
  box(s, s, s, 0x9a7a52, x, s / 2, z, { tex: woodTex() });
  box(s + 0.06, s * 0.18, s + 0.06, 0x6a5236, x, s / 2, z, { solid: false, cast: false });
}

function tire(x, z) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12), mat(0x222222));
  t.position.set(x, 0.16, z); t.castShadow = t.receiveShadow = true; group.add(t);
  const h = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.32, 12), mat(0x9a9484));
  h.position.set(x, 0.16, z); group.add(h);
}

function palm(x, z) {
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 5.4, 7), texMat(0x9a7a56, barkTex()));
  trunk.position.set(x, 2.7, z); trunk.rotation.z = rand(-0.08, 0.08); trunk.castShadow = true; group.add(trunk);
  const leafMat = texMat(0xffffff, leafTex(), { alphaTest: 0.4, side: THREE.DoubleSide, rough: 0.9 });
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), leafMat);
    leaf.position.set(x, 5.5, z); leaf.rotation.y = i * Math.PI / 3;
    leaf.translateX(1.3); leaf.rotation.z = -0.55; leaf.castShadow = true; group.add(leaf);
  }
  colliders.push({ min: new THREE.Vector3(x - 0.3, 0, z - 0.3), max: new THREE.Vector3(x + 0.3, 5, z + 0.3) });
}

function bush(x, z) {
  const leafMat = texMat(0xffffff, leafTex(), { alphaTest: 0.4, side: THREE.DoubleSide, rough: 0.9 });
  for (let i = 0; i < 5; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(rand(0.9, 1.4), rand(0.7, 1.1)), leafMat);
    p.position.set(x + rand(-0.5, 0.5), rand(0.3, 0.7), z + rand(-0.5, 0.5));
    p.rotation.y = rand(0, Math.PI); p.rotation.x = rand(-0.4, 0.2);
    p.castShadow = true; group.add(p);
  }
}

function wire(x1, y1, z1, x2, y2, z2, cloth = false) {
  const p1 = new THREE.Vector3(x1, y1, z1), p2 = new THREE.Vector3(x2, y2, z2);
  const mid = p1.clone().lerp(p2, 0.5); mid.y -= p1.distanceTo(p2) * 0.06;
  const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.025, 4), mat(0x2a2a2a));
  m.castShadow = false; group.add(m);
  if (cloth) {
    const cols = [0xc95a4a, 0xe0d0a0, 0x6a8ab5, 0xd8d8d0];
    for (let i = 0; i < 3; i++) {
      const p = curve.getPoint(0.25 + i * 0.22);
      box(0.7, rand(0.7, 1.1), 0.05, cols[i % 4], p.x, p.y - 0.5, p.z, { solid: false });
    }
  }
}

// 飘动旗帜（顶点波形动画）
function flag(x, y, z, color = 0xc23a2a, w = 1.6, h = 1.0, vertical = false) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, vertical ? h + 2.4 : y, 6), mat(0x5a5e62, 0.5, 0.7));
  if (!vertical) { pole.position.set(x, y / 2, z); }
  else { pole.position.set(x, y + h / 2 + 0.6, z); }
  pole.castShadow = true; group.add(pole);
  const geo = new THREE.PlaneGeometry(w, h, 8, 4);
  const base = geo.attributes.position.array.slice();
  const fm = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
    map: fabricTex(), emissive: color, emissiveIntensity: 0.06
  }));
  if (!vertical) { fm.position.set(x + w / 2 + 0.05, y - h / 2 - 0.15, z); }
  else { fm.position.set(x + 0.03, y + h / 2 + 1.2, z); fm.rotation.y = Math.PI / 2; }
  fm.castShadow = true; group.add(fm);
  mapAnims.push((t) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3], by = base[i * 3 + 1];
      const edge = vertical ? (h / 2 - by) / h : (bx + w / 2) / w; // 自由边权重
      pos.setZ(i, Math.sin(bx * 3 + by * 2 + t * 5.5) * 0.1 * edge + Math.sin(t * 2.2 + bx) * 0.05 * edge);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  });
}

// 油桶（锈铁皮 + 加强箍）
function barrel(x, z, col = 0x9a5a30) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.95, 14), texMat(col, rustTex(), { rough: 0.7, metal: 0.35 }));
  body.position.y = 0.48; body.castShadow = body.receiveShadow = true; g.add(body);
  for (const hy of [0.25, 0.48, 0.71]) {
    const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.345, 0.345, 0.05, 14), mat(0x4a4038, 0.6, 0.5));
    hoop.position.y = hy; g.add(hoop);
  }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 14), mat(0x6a5a48, 0.55, 0.5));
  lid.position.y = 0.97; g.add(lid);
  group.add(g);
  colliders.push({ min: new THREE.Vector3(x - 0.35, 0, z - 0.35), max: new THREE.Vector3(x + 0.35, 1.0, z + 0.35) });
}

// 路灯（灯杆 + 悬臂 + 灯头）
function streetlight(x, z, ry = 0) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  const metal = mat(0x3f4448, 0.5, 0.7);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 6.2, 8), metal);
  pole.position.y = 3.1; pole.castShadow = true; g.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.09, 0.09), metal);
  arm.position.set(0.85, 6.05, 0); g.add(arm);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.28), metal);
  head.position.set(1.75, 6.0, 0); head.castShadow = true; g.add(head);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xf8f2dc, emissive: 0xfff2c0, emissiveIntensity: NIGHT ? 2.2 : SUNSET ? 1.3 : 0.6 }));
  lamp.position.set(1.75, 5.92, 0); g.add(lamp);
  group.add(g);
  colliders.push({ min: new THREE.Vector3(x - 0.2, 0, z - 0.2), max: new THREE.Vector3(x + 0.2, 6, z + 0.2) });
}

function rubble(x, z, n = 5) {
  for (let i = 0; i < n; i++)
    box(rand(0.3, 0.9), rand(0.15, 0.5), rand(0.3, 0.9), [0xa89878, 0x8a8274, 0xb0a488][i % 3],
      x + rand(-1.5, 1.5), 0.1, z + rand(-1.5, 1.5), { solid: false, cast: false });
}

// ================= 地图一：小镇街道 =================
function buildTown() {
  applySkyEnv({ night: 0x0d1420, sunset: 0x4a2a33, day: 0xbccfda });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), texMat(0xc9b894, (() => { const t = sandTex().clone(); t.needsUpdate = true; t.repeat.set(70, 70); return t; })(), { rough: 0.98 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);
  road(0, 0, 15, 180, 0x8a8478);
  road(0, -38, 120, 9, 0x948d7e);
  road(0, 30, 120, 9, 0x948d7e);

  // 主街建筑（首栋固定高度，保证楼梯-平台-屋顶严丝合缝）
  const roofH = building(-16, -68, 14, 20, 2, 1, 7.6);
  building(-15, -48, 12, 14, 1, 1);
  building(-17, -26, 16, 18, 3, 1);
  building(-15, -6, 12, 16, 2, 1);
  building(-16, 14, 14, 18, 2, 1);
  building(-15, 44, 12, 22, 2, 1);
  building(-16, 70, 14, 20, 3, 1);
  building(16, -72, 14, 22, 2, -1);
  building(15, -46, 12, 16, 2, -1);
  building(17, -22, 16, 16, 2, -1);
  building(15, 2, 12, 20, 3, -1);
  building(16, 26, 14, 14, 1, -1);
  building(15, 52, 12, 18, 2, -1);
  building(16, 74, 14, 18, 2, -1);
  building(-30, -44, 12, 12, 2, 1);
  building(30, -32, 12, 12, 2, -1);
  building(-30, 36, 12, 12, 2, 1);
  building(32, 24, 14, 12, 2, -1);

  // ===== 屋顶狙击平台 + 室外楼梯（复杂地形）=====
  const platH = roofH;
  // 楼梯从 (-7.2, -56) 向北爬升，顶端 z≈-68.4 与 (-16,-68) 楼顶相接
  stairs(-7.2, -56, 1, platH, 2.2);
  // 梯顶衔接平台（始于楼梯末端之后，避免挡路）
  box(4.6, 0.35, 4.6, 0xb5a888, -8, platH - 0.17, -70.3);
  // 平台外沿护栏（视觉）
  box(0.15, 1.0, 4.6, 0x8a7a5c, -5.8, platH + 0.5, -70.3, { solid: false });
  box(4.6, 1.0, 0.15, 0x8a7a5c, -8, platH + 0.5, -72.55, { solid: false });

  // 边界
  const wallCol = 0xbfae8c;
  box(3, 4.5, 190, wallCol, -30, 2.25, 0, { tex: plasterTex() });
  box(3, 4.5, 190, wallCol, 30, 2.25, 0, { tex: plasterTex() });
  box(63, 4.5, 3, wallCol, 0, 2.25, -92, { tex: plasterTex() });
  box(63, 4.5, 3, wallCol, 0, 2.25, 92, { tex: plasterTex() });

  // 市集 / 掩体
  marketStall(-4, -10, 0.15); marketStall(4.5, -4, -0.2);
  marketStall(-3.5, 6, 0.4); marketStall(4, 14, -0.1);
  car(4.5, -34, 0.12, 0x7a8a99); car(-5, -52, -0.06, 0xb56a3a);
  car(5, 36, Math.PI + 0.1, 0x8a8f96); car(-4.5, 56, Math.PI - 0.15, 0x6a7a5a);
  car(-24, -38, Math.PI / 2 + 0.1, 0x9a4a4a); car(24, 30, Math.PI / 2 - 0.08, 0x5a6a8a);
  sandbags(0, -24, 4); sandbags(-2, 22, 3.5); sandbags(3, -60, 4);
  sandbags(-3, 44, 3); sandbags(18, -38, 3); sandbags(-18, 30, 3);
  barrier(-3, -42); barrier(3, 20); barrier(-4, -2); barrier(2, 62);
  barrier(-14, -38, Math.PI / 2); barrier(14, 30, Math.PI / 2);
  crate(-6.5, -20, 1.1); crate(-6.2, -18.6, 0.8); crate(6.5, 8, 1.2);
  crate(6.2, 9.6, 0.7); crate(-6.5, 40, 1); crate(6.5, -50, 1.1);
  crate(20, -34, 1); crate(-22, 32, 1);
  tire(6.8, -28); tire(-6.8, 18); tire(6.9, 50); tire(-6.9, -46);
  box(1.6, 1.1, 1, 0x4a6a4f, 6.9, 0.55, -58);
  box(1.6, 1.1, 1, 0x4a6a4f, 7, 0.55, 44);
  palm(-6.9, -31); palm(6.5, -16); palm(-6.5, 26); palm(6.5, 66);
  bush(-7.5, -44); bush(7.2, 2); bush(-7.4, 48); bush(7.3, -62);
  bush(-3, -34.5); bush(6.8, 24);
  wire(-9, 6.5, -40, 9, 6.2, -38); wire(-9, 7, -12, 9, 6.6, -10, true);
  wire(-9, 6.2, 16, 9, 6.8, 18, true); wire(-9, 6.8, 48, 9, 6.4, 46);
  wire(-16, 5.5, -44, -16, 5.5, 36);
  // 楼顶旗帜
  flag(-12.5, 9.5, -42, 0xc23a2a); flag(12.5, 8.5, 22, 0x2a5ac2); flag(-19, 10.5, 58, 0xc23a2a);
  // 沿街路灯（交替两侧，灯头朝路心）
  for (const lz of [-70, -30, 10, 50]) streetlight(-8.6, lz, 0);
  for (const lz of [-50, -10, 30, 70]) streetlight(8.6, lz, Math.PI);
  // 油桶堆
  barrel(5.8, -38, 0x9a5a30); barrel(6.5, -37.2, 0x3a5a7a); barrel(6.1, -38.8, 0x6a7a4a);
  barrel(-6.2, 12, 0x9a5a30); barrel(-5.5, 12.7, 0x7a4a6a);
  barrel(24.5, -35.5, 0x3a5a7a); barrel(-24.5, 33.5, 0x9a5a30);
  for (let i = 0; i < 40; i++) rubble(rand(-7, 7), rand(-85, 85), 1);

  enemySpawns.push(
    new THREE.Vector3(0, 0, -80), new THREE.Vector3(-24, 0, -34),
    new THREE.Vector3(24, 0, 30), new THREE.Vector3(0, 0, -60),
    new THREE.Vector3(-5, 0, -70), new THREE.Vector3(5, 0, 70),
    new THREE.Vector3(-24, 0, 26), new THREE.Vector3(24, 0, -42),
    new THREE.Vector3(0, 0, -45), new THREE.Vector3(-20, 0, -52)
  );
  patrolPoints.push(
    new THREE.Vector3(0, 0, -40), new THREE.Vector3(-5, 0, -10),
    new THREE.Vector3(5, 0, 10), new THREE.Vector3(0, 0, 40),
    new THREE.Vector3(-20, 0, -38), new THREE.Vector3(25, 0, 30),
    new THREE.Vector3(4, 0, -60), new THREE.Vector3(-4, 0, 60),
    new THREE.Vector3(0, 0, 0)
  );
  return {
    playerSpawn: new THREE.Vector3(0, 0, 78),
    bounds: { minX: -28.5, maxX: 28.5, minZ: -90, maxZ: 90 },
    extent: 95,
    night: true,                            // 夜晚光照（main.js 依此調暗環境）
    bombSite: { x: 0, z: -82, r: 4 },      // 北端敌方阵营
    portalPos: new THREE.Vector3(0, 0, -30)
  };
}

// ================= 地图二：沙漠废墟 =================
function buildRuins() {
  applySkyEnv({ night: 0x0e141f, sunset: 0x5c3527, day: 0xe2d2ac, dayEl: 42 });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), texMat(0xd6c098, (() => { const t = sandTex().clone(); t.needsUpdate = true; t.repeat.set(70, 70); return t; })(), { rough: 0.98 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);
  road(0, 0, 130, 12, 0xb0a180);
  road(0, 0, 12, 130, 0xb0a180);

  // ===== 中央双层废墟 =====
  const cCol = 0xbcb2a0;
  // 一层残墙
  box(14, 3.4, 0.6, cCol, 0, 1.7, -7, { tex: concreteTex() });
  box(0.6, 3.4, 9, cCol, -7, 1.7, -2.5, { tex: concreteTex() });
  box(0.6, 2.2, 6, cCol, 7, 1.1, -4, { tex: concreteTex() });
  box(6, 2.6, 0.6, cCol, -4, 1.3, 3, { tex: concreteTex() });
  // 二层楼板
  box(14, 0.4, 9, cCol, 0, 3.6, -2.5, { tex: concreteTex() });
  box(0.6, 2.8, 9, cCol, -7, 5.0, -2.5, { tex: concreteTex() });
  box(5, 2.2, 0.6, cCol, -4, 4.7, -7, { tex: concreteTex() });
  box(0.5, 0.9, 9, cCol, 6.8, 4.2, -2.5, { solid: false }); // 二层矮护沿
  minimapRects.push({ x: 0, z: -2.5, w: 14, d: 9 });
  // 上二层楼梯（南侧进入）
  stairs(4.5, 10.5, 1, 3.8, 2.4);
  box(3.4, 0.35, 3, cCol, 4.5, 3.62, 4.2);
  // 废墟散件
  rubble(-3, 0, 8); rubble(3, -5, 6); rubble(-5, -6, 5);

  // ===== 四周残垣断壁 =====
  const ruins = [
    [-26, -24, 10, 2.6, 0.5], [-30, 8, 0.5, 2.2, 12], [24, -18, 0.5, 3, 10],
    [28, 14, 12, 2.4, 0.5], [-14, 26, 8, 2, 0.5], [12, -30, 0.5, 2.4, 8],
    [-8, -34, 9, 2.8, 0.5], [20, 30, 0.5, 2, 9], [-36, -8, 0.5, 2.6, 9], [36, -2, 0.5, 2.6, 9]
  ];
  for (const [x, z, w, h, d] of ruins) {
    box(w, h, d, cCol, x, h / 2, z);
    box(w + 0.1, 0.25, d + 0.1, 0x8a8274, x, h + 0.1, z, { solid: false, cast: false });
    minimapRects.push({ x, z, w: Math.max(w, 1), d: Math.max(d, 1) });
  }

  // ===== 高台脚手架（东南）=====
  box(6, 0.35, 6, 0x9a8468, 24, 4.0, -2);
  for (const [px, pz] of [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]])
    box(0.3, 4.0, 0.3, 0x7a6248, 24 + px, 2, -2 + pz);
  stairs(24, 7.8, 1, 4.18, 2.2, 0x9a8468);
  box(6, 0.9, 0.12, 0x7a6248, 24, 4.6, 1, { solid: false });
  minimapRects.push({ x: 24, z: -2, w: 6, d: 6 });

  // 集装箱与管道
  container(-18, -14, 0.3, 0x8a4a3a);
  container(16, 18, -0.2, 0x3a5a7a);
  container(-14, 18, Math.PI / 2 + 0.1, 0x6a7a4a, true);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 9, 12, 1, true), mat(0x9a8a6a, 0.7, 0.5));
  pipe.rotation.z = Math.PI / 2; pipe.position.set(-24, 0.8, 22); pipe.castShadow = pipe.receiveShadow = true;
  group.add(pipe);
  colliders.push({ min: new THREE.Vector3(-28.5, 0, 21.2), max: new THREE.Vector3(-19.5, 1.6, 22.8) });

  // 掩体
  sandbags(0, -16, 4); sandbags(-10, 8, 3.5); sandbags(12, -8, 3); sandbags(-20, 26, 3);
  barrier(-6, 14); barrier(10, 6, Math.PI / 2); barrier(-18, -26); barrier(26, 8, Math.PI / 2);
  crate(-9, -12, 1.1); crate(8, 14, 1); crate(30, -10, 1.2); crate(-32, 16, 1);
  car(-10, -22, 0.4, 0x9a8a7a); car(14, 26, Math.PI - 0.3, 0x6a6a72);
  barrel(10, -14, 0x9a5a30); barrel(10.8, -13.3, 0x5a6a72); barrel(-22, 4, 0x6a7a4a);
  barrel(30, 16, 0x9a5a30); barrel(-34, -20, 0x7a4a6a);
  palm(-30, -18); palm(30, 22); palm(-16, 32); palm(34, -24);
  bush(-8, -10); bush(10, 12); bush(-26, 18); bush(26, -20); bush(4, 20);
  for (let i = 0; i < 50; i++) rubble(rand(-40, 40), rand(-40, 40), 1);

  // 边界（残破土墙）
  box(110, 3.6, 3, 0xbfae8c, 0, 1.8, -46, { tex: concreteTex(), bump: 0.8 });
  box(110, 3.6, 3, 0xbfae8c, 0, 1.8, 46, { tex: concreteTex(), bump: 0.8 });
  box(3, 3.6, 95, 0xbfae8c, -48, 1.8, 0, { tex: concreteTex(), bump: 0.8 });
  box(3, 3.6, 95, 0xbfae8c, 48, 1.8, 0, { tex: concreteTex(), bump: 0.8 });

  enemySpawns.push(
    new THREE.Vector3(-38, 0, -36), new THREE.Vector3(38, 0, -36),
    new THREE.Vector3(-38, 0, 36), new THREE.Vector3(38, 0, 36),
    new THREE.Vector3(0, 0, -38), new THREE.Vector3(-30, 0, 0),
    new THREE.Vector3(30, 0, 10), new THREE.Vector3(0, 0, 24),
    new THREE.Vector3(-20, 0, -30), new THREE.Vector3(20, 0, -28)
  );
  patrolPoints.push(
    new THREE.Vector3(0, 0, -2), new THREE.Vector3(-16, 0, 10),
    new THREE.Vector3(16, 0, -10), new THREE.Vector3(-24, 0, -20),
    new THREE.Vector3(24, 0, 20), new THREE.Vector3(0, 0, 30),
    new THREE.Vector3(-30, 0, 26), new THREE.Vector3(30, 0, -26)
  );
  return {
    playerSpawn: new THREE.Vector3(0, 0, 38),
    bounds: { minX: -45, maxX: 45, minZ: -43, maxZ: 43 },
    extent: 50,
    night: true,                            // 夜晚光照
    bombSite: { x: -30, z: -30, r: 4 },    // 西北角残垣深处
    portalPos: new THREE.Vector3(0, 0, 18)
  };
}

// ================= 地图三：货运码头 =================
function buildDocks() {
  applySkyEnv({ night: 0x0c1219, sunset: 0x472e35, day: 0xc4d2da });

  // 地面混凝土
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), texMat(0x9aa0a2, (() => { const t = concreteTex().clone(); t.needsUpdate = true; t.repeat.set(55, 55); return t; })(), { rough: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);
  road(0, 0, 100, 14, 0x84898c);
  road(-20, 0, 12, 90, 0x84898c);
  road(20, 0, 12, 90, 0x84898c);

  // 东侧海面（从码头边缘 x=54 起，不覆盖场区）
  const water = new THREE.Mesh(new THREE.PlaneGeometry(220, 320),
    new THREE.MeshStandardMaterial({ color: 0x2a6a8a, roughness: 0.3, metalness: 0.4 }));
  water.rotation.x = -Math.PI / 2; water.position.set(164, 0.05, 0); group.add(water);
  // 码头边缘
  box(4, 1.2, 130, 0x7a7f82, 52, 0.6, 0);

  // ===== 集装箱堆场（巷道）=====
  const cc = [0x8a4a3a, 0x3a5a7a, 0x6a7a4a, 0xb08a3a, 0x5a6a72, 0x7a4a6a];
  const layout = [
    [-34, -30, 0, 1], [-20, -30, 0, 0], [-34, -18, 0, 0], [-6, -30, 0, 1],
    [8, -30, 0, 0], [22, -30, 0, 1], [36, -30, 0, 0],
    [-34, 6, 0, 0], [-34, 18, 0, 1], [-20, 18, 0, 0], [-6, 18, 0, 0],
    [8, 18, 0, 1], [22, 18, 0, 0], [36, 18, 0, 1], [36, 6, 0, 0],
    [-6, -8, 0, 0], [8, -8, 0, 0], [-13, -2, Math.PI / 2, 1], [15, -2, Math.PI / 2, 0],
    [36, -14, 0, 0], [-20, -6, 0, 0]
  ];
  layout.forEach(([x, z, ry, st], i) => container(x, z, ry, cc[i % cc.length], !!st));

  // 箱梯：爬到 (-6,-30) 双层箱顶（高 5.3）
  stairs(-6, -20.2, 1, 5.3, 1.6, 0x8a8f96);
  // 爬到 (-13,-2) 双层箱顶
  stairs(-3.2, -2, 3, 5.3, 1.6, 0x8a8f96);

  // ===== 开放式仓库（北侧）=====
  const whCol = 0xb0a890;
  box(30, 6, 1, whCol, 0, 3, -44, { tex: concreteTex(), bump: 0.8 });
  box(1, 6, 14, whCol, -15, 3, -37, { tex: concreteTex(), bump: 0.8 });
  box(1, 6, 14, whCol, 15, 3, -37, { tex: concreteTex(), bump: 0.8 });
  box(30, 0.5, 16, 0x8a8578, 0, 6.2, -37, { tex: concreteTex() });
  minimapRects.push({ x: 0, z: -40, w: 30, d: 10 });
  crate(-8, -40, 1.3); crate(-6.4, -40, 1); crate(8, -38, 1.2);
  sandbags(0, -34, 4);

  // ===== 门式起重机（装饰）=====
  for (const zx of [-16, 12]) {
    box(1, 12, 1, 0xc98a2a, -42, 6, zx);
    box(1, 12, 1, 0xc98a2a, -42 + 26, 6, zx);
    box(30, 1.2, 1.2, 0xc98a2a, -29, 12.4, zx, { solid: false });
  }

  // 散件
  sandbags(-14, 28, 3.5); sandbags(14, -20, 3); sandbags(0, 8, 3);
  barrier(-26, -14); barrier(26, 28, Math.PI / 2); barrier(0, 28); barrier(-26, 28, Math.PI / 2);
  crate(28, -18, 1.1); crate(-28, 2, 1); crate(2, -18, 0.9); crate(44, 10, 1.2);
  car(-38, 26, Math.PI / 2 + 0.2, 0x5a6a7a); car(40, -8, 0.1, 0x8a8a92);
  tire(-24, 10); tire(24, -14); tire(4, 24);
  // 码头路灯与油桶堆
  for (const lz of [-40, -8, 26]) streetlight(48, lz, Math.PI);
  streetlight(-48, -20, 0); streetlight(-48, 14, 0);
  barrel(-38, -22, 0x9a5a30); barrel(-37.2, -21.2, 0x3a5a7a); barrel(-38.6, -20.8, 0x6a7a4a);
  barrel(42, 16, 0x9a5a30); barrel(42.8, 16.8, 0x7a4a6a); barrel(4, -34, 0x3a5a7a);

  // 边界
  box(3, 4, 130, 0x8a8f96, -52, 2, 0, { tex: concreteTex(), bump: 0.8 });
  box(108, 4, 3, 0x8a8f96, 0, 2, -52, { tex: concreteTex(), bump: 0.8 });
  box(108, 4, 3, 0x8a8f96, 0, 2, 34, { tex: concreteTex(), bump: 0.8 });
  box(3, 4, 90, 0x8a8f96, 52, 2, -8, { tex: concreteTex(), bump: 0.8 });

  enemySpawns.push(
    new THREE.Vector3(-40, 0, -40), new THREE.Vector3(40, 0, -40),
    new THREE.Vector3(-40, 0, 24), new THREE.Vector3(40, 0, 24),
    new THREE.Vector3(0, 0, -44), new THREE.Vector3(-28, 0, 0),
    new THREE.Vector3(28, 0, 8), new THREE.Vector3(0, 0, -16),
    new THREE.Vector3(-44, 0, -10), new THREE.Vector3(44, 0, -24)
  );
  patrolPoints.push(
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(-28, 0, -14),
    new THREE.Vector3(28, 0, -14), new THREE.Vector3(-28, 0, 14),
    new THREE.Vector3(28, 0, 14), new THREE.Vector3(0, 0, 26),
    new THREE.Vector3(0, 0, -36), new THREE.Vector3(14, 0, 4)
  );
  return {
    playerSpawn: new THREE.Vector3(0, 0, 28),
    bounds: { minX: -49, maxX: 49, minZ: -49, maxZ: 31 },
    extent: 55,
    night: true,                            // 夜晚光照
    bombSite: { x: 0, z: -40, r: 4.5 },    // 仓库内
    portalPos: new THREE.Vector3(20, 0, 0)
  };
}

// ================= 地图四：奇遇 · 黄金遗迹 =================
function buildAdventure() {
  scene.fog = new THREE.Fog(0xe8d8a8, 55, 220);
  buildSky('#f0e0b0', 50, 1.1);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), texMat(0xd8c090, (() => { const t = sandTex().clone(); t.needsUpdate = true; t.repeat.set(50, 50); return t; })(), { rough: 0.95 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);
  road(0, 0, 10, 76, 0xb8a070);
  road(0, 0, 76, 10, 0xb8a070);

  const gold = c => texMat(c, containerTex(), { rough: 0.35, metal: 0.85 });
  const stone = 0xc8b088;

  // ===== 中央三层黄金金字塔 =====
  box(18, 2, 18, stone, 0, 1, -14, { tex: concreteTex(), bump: 0.8 });
  box(12, 2, 12, stone, 0, 3, -14, { tex: concreteTex(), bump: 0.8 });
  box(6, 2, 6, 0xd8b040, 0, 5, -14, { tex: containerTex(), metal: 0.8, rough: 0.4 });
  // 塔顶黄金祭坛
  box(2, 1, 2, 0xffd700, 0, 6.5, -14, { metal: 0.9, rough: 0.25 });
  minimapRects.push({ x: 0, z: -14, w: 18, d: 18 });
  // 南侧登台阶梯
  stairs(0, -3.2, 1, 2.0, 3, stone);
  box(3, 0.3, 2.2, stone, 0, 2.1, -8.2);

  // ===== 四角金柱 =====
  for (const [px, pz] of [[-14, -28], [14, -28], [-14, 0], [14, 0]]) {
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 7, 10), gold(0xd8b040));
    pil.position.set(px, 3.5, pz); pil.castShadow = true; group.add(pil);
    box(2.2, 0.5, 2.2, 0xffd700, px, 7.2, pz, { solid: false, metal: 0.9, rough: 0.25 });
    colliders.push({ min: new THREE.Vector3(px - 0.9, 0, pz - 0.9), max: new THREE.Vector3(px + 0.9, 7, pz + 0.9) });
    minimapRects.push({ x: px, z: pz, w: 1.8, d: 1.8 });
  }

  // 金色幡旗（竖幅）
  flag(-8, 4, -6, 0xd8a828, 0.9, 2.2, true); flag(8, 4, -6, 0xd8a828, 0.9, 2.2, true);
  flag(-8, 4, -22, 0xc23a2a, 0.9, 2.2, true); flag(8, 4, -22, 0xc23a2a, 0.9, 2.2, true);
  // ===== 宝藏基座（掉落点位）=====
  const lootSpots = [];
  const pedPos = [
    [-10, 8], [-5, 8], [5, 8], [10, 8],
    [-10, -24], [-5, -24], [5, -24], [10, -24],
    [-18, -8], [18, -8]
  ];
  for (const [px, pz] of pedPos) {
    box(0.9, 1.0, 0.9, 0xc8a850, px, 0.5, pz, { metal: 0.7, rough: 0.4 });
    box(1.1, 0.12, 1.1, 0xffd700, px, 1.06, pz, { solid: false, metal: 0.9, rough: 0.25 });
    lootSpots.push(new THREE.Vector3(px, 0, pz + 1.2));
  }

  // ===== 掩体与装饰 =====
  crate(-8, 16, 1.1); crate(8, 16, 1); crate(-16, 4, 0.9); crate(16, 4, 1.1);
  barrel(-12, 12, 0xd8a828); barrel(12, 12, 0xd8a828); barrel(-20, -16, 0x9a5a30); barrel(20, -16, 0x9a5a30);
  sandbags(0, 14, 4); sandbags(-6, -6, 3); sandbags(6, -6, 3);
  palm(-24, 8); palm(24, 8); palm(-24, -30); palm(24, -30);
  bush(-14, 18); bush(14, 18); bush(-22, -6); bush(22, -6);
  for (let i = 0; i < 24; i++) rubble(rand(-30, 30), rand(-32, 24), 1);

  // ===== 边界（金边石墙）=====
  box(80, 3.6, 3, 0xbfae8c, 0, 1.8, -40, { tex: concreteTex(), bump: 0.8 });
  box(80, 3.6, 3, 0xbfae8c, 0, 1.8, 40, { tex: concreteTex(), bump: 0.8 });
  box(3, 3.6, 80, 0xbfae8c, -40, 1.8, 0, { tex: concreteTex(), bump: 0.8 });
  box(3, 3.6, 80, 0xbfae8c, 40, 1.8, 0, { tex: concreteTex(), bump: 0.8 });
  box(80, 0.4, 3.4, 0xd8b040, 0, 3.8, -40, { solid: false, cast: false, metal: 0.8, rough: 0.35 });
  box(80, 0.4, 3.4, 0xd8b040, 0, 3.8, 40, { solid: false, cast: false, metal: 0.8, rough: 0.35 });
  box(3.4, 0.4, 80, 0xd8b040, -40, 3.8, 0, { solid: false, cast: false, metal: 0.8, rough: 0.35 });
  box(3.4, 0.4, 80, 0xd8b040, 40, 3.8, 0, { solid: false, cast: false, metal: 0.8, rough: 0.35 });

  enemySpawns.push(
    new THREE.Vector3(-18, 0, -20), new THREE.Vector3(18, 0, -20),
    new THREE.Vector3(-18, 0, 12), new THREE.Vector3(18, 0, 12),
    new THREE.Vector3(0, 0, -30), new THREE.Vector3(-28, 0, -8),
    new THREE.Vector3(28, 0, -8), new THREE.Vector3(0, 0, 16)
  );
  patrolPoints.push(
    new THREE.Vector3(0, 0, 8), new THREE.Vector3(-14, 0, -14),
    new THREE.Vector3(14, 0, -14), new THREE.Vector3(0, 0, -28),
    new THREE.Vector3(-20, 0, 0), new THREE.Vector3(20, 0, 0)
  );
  return {
    playerSpawn: new THREE.Vector3(0, 0, 32),
    bounds: { minX: -38, maxX: 38, minZ: -38, maxZ: 38 },
    extent: 44,
    bombSite: null,
    portalPos: new THREE.Vector3(0, 0, 4),   // 返程传送门
    lootSpots,
    bossPos: new THREE.Vector3(0, 0, -14)    // 稀有 BOSS 在金字塔前
  };
}

// ---------- 入口 ----------
// ---------- 台北 101（加大 200% 城市街道 + 載具自由開車）----------
function buildTaipei() {
  applySkyEnv({ night: 0x0d1420, sunset: 0x4a2a33, day: 0xbccfda });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), texMat(0x8f9396, (() => { const t = asphaltTex().clone(); t.needsUpdate = true; t.repeat.set(140, 140); return t; })(), { rough: 0.97 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; group.add(ground);

  // ===== 道路網（市區加大：5 條南北大道 × 5 條東西幹道，自由開車）=====
  for (const rx of [-80, -40, 40, 80]) road(rx, 27, 10, 306, 0x4a4e54);   // 南北向（z -120~174）
  road(0, 0, 12, 360, 0x4a4e54);                                          // 中央大道直通 101（z -180~180）
  for (const rz of [-120, -60, 0, 60, 120]) road(0, rz, 240, 10, 0x565a60);   // 東西向
  // 101 前廣場人行道
  box(46, 0.08, 30, 0xb8b2a4, 0, 0.04, -141, { solid: false, tex: concreteTex() });

  // ===== 台北 101（竹節式塔身 + 裙樓 + 尖頂）=====
  const TX = 0, TZ = -168;
  box(34, 12, 26, 0x9aa2ac, TX, 6, TZ, { tex: concreteTex(), bump: 0.6 });   // 裙樓
  minimapRects.push({ x: TX, z: TZ, w: 34, d: 26 });
  box(34.2, 2.2, 26.2, 0x6a92a8, TX, 3.2, TZ, { solid: false, emis: 0x2a4a5a, emisI: 0.3 });   // 玻璃帷幕帶
  let tw = 17, ty = 12;
  for (let i = 0; i < 8; i++) {   // 八節竹節塔身（下寬上窄、節節外挑）
    const segH = 7.5;
    box(tw, segH, tw, 0x5f8a76, TX, ty + segH / 2, TZ, { solid: i < 2, emis: 0x1a3a2a, emisI: 0.25 });
    box(tw + 1.4, 1.0, tw + 1.4, 0xc8b890, TX, ty + segH - 0.3, TZ, { solid: false });          // 斗拱外挑
    box(tw + 1.5, 0.35, tw + 1.5, 0xffd9a0, TX, ty + segH + 0.15, TZ, { solid: false, emis: 0xffb05a, emisI: 1.0 });  // 節頂燈帶
    ty += segH; tw *= 0.92;
  }
  box(tw * 0.6, 5, tw * 0.6, 0x9aa4ac, TX, ty + 2.5, TZ, { solid: false });   // 尖頂
  box(0.5, 12, 0.5, 0xc23a2a, TX, ty + 11, TZ, { solid: false, emis: 0xc23a2a, emisI: 0.8 });   // 天線

  // ===== 街廓（6×4 街區，每格 2 棟；少量空地停車場）=====
  const xBands = [[-118, -86], [-74, -46], [-34, -6], [6, 34], [46, 74], [86, 118]];
  const zBands = [[-114, -66], [-54, -6], [6, 54], [66, 114]];
  for (const [x0, x1] of xBands) {
    for (const [z0, z1] of zBands) {
      if (Math.random() < 0.15) {   // 空地：停車場 / 工事
        crate(x0 + 8, z0 + 10, 1.1); crate(x1 - 8, z1 - 10, 1);
        barrier((x0 + x1) / 2, (z0 + z1) / 2, Math.PI / 2);
        sandbags(x0 + 6, z1 - 8, 3.5);
        continue;
      }
      const w = x1 - x0, d = z1 - z0, cz = (z0 + z1) / 2;
      const bw = (w - 8) / 2;
      building(x0 + 2 + bw / 2, cz, bw, d - 10, 3 + (Math.random() * 7 | 0), -1);   // 門面朝西側道路
      building(x1 - 2 - bw / 2, cz, bw, d - 10, 3 + (Math.random() * 7 | 0), 1);    // 門面朝東側道路
    }
  }
  // 南側街廓（z 126~174，較矮建築群）
  for (const [x0, x1] of xBands) {
    if (Math.random() < 0.2) { palm((x0 + x1) / 2 - 6, 150); palm((x0 + x1) / 2 + 6, 158); continue; }
    building((x0 + x1) / 2, 150, (x1 - x0) - 12, 36, 2 + (Math.random() * 3 | 0), x0 < 0 ? 1 : -1);
  }

  // 邊界
  box(3, 4.5, 368, 0x8a8f96, -122, 2.25, 0, { tex: concreteTex(), bump: 0.8 });
  box(3, 4.5, 368, 0x8a8f96, 122, 2.25, 0, { tex: concreteTex(), bump: 0.8 });
  box(248, 4.5, 3, 0x8a8f96, 0, 2.25, -182, { tex: concreteTex(), bump: 0.8 });
  box(248, 4.5, 3, 0x8a8f96, 0, 2.25, 182, { tex: concreteTex(), bump: 0.8 });

  // 街道家具：路口路燈 + 中央大道行道樹
  for (const rx of [-80, -40, 0, 40, 80])
    for (const rz of [-120, -60, 0, 60, 120])
      streetlight(rx + 7, rz + 7, Math.PI / 4);
  for (const lz of [-100, -60, -20, 20, 60, 100, 140]) { palm(-9, lz); palm(9, lz + 12); }
  sandbags(0, -128, 4); sandbags(-16, -8, 3.5); sandbags(16, 12, 4);
  barrier(-8, -30); barrier(8, -14); barrier(-8, 46); barrier(8, 88);
  crate(-10, -52, 1.1); crate(10.5, -54, 1); crate(-14, 8, 1); crate(14, -2, 1.2);
  crate(-24, 66, 1); crate(24, -68, 1);

  enemySpawns.push(
    new THREE.Vector3(0, 0, -120), new THREE.Vector3(-40, 0, -60),
    new THREE.Vector3(40, 0, -60), new THREE.Vector3(-80, 0, 0),
    new THREE.Vector3(80, 0, 0), new THREE.Vector3(0, 0, 30),
    new THREE.Vector3(-40, 0, 120), new THREE.Vector3(40, 0, 120),
    new THREE.Vector3(-80, 0, -120), new THREE.Vector3(80, 0, -120),
    new THREE.Vector3(0, 0, 160), new THREE.Vector3(-80, 0, 90),
    new THREE.Vector3(80, 0, 90), new THREE.Vector3(0, 0, -150)
  );
  patrolPoints.push(
    new THREE.Vector3(0, 0, -60), new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-40, 0, 0), new THREE.Vector3(40, 0, 0),
    new THREE.Vector3(0, 0, 60), new THREE.Vector3(-80, 0, -60),
    new THREE.Vector3(80, 0, 60), new THREE.Vector3(0, 0, -120),
    new THREE.Vector3(-40, 0, 120), new THREE.Vector3(40, 0, -120),
    new THREE.Vector3(0, 0, 120), new THREE.Vector3(-80, 0, 120)
  );
  return {
    playerSpawn: new THREE.Vector3(0, 0, 172),
    bounds: { minX: -120, maxX: 120, minZ: -180, maxZ: 180 },
    extent: 200,
    night: true,
    bombSite: { x: 0, z: -138, r: 6 },          // 101 廣場
    portalPos: new THREE.Vector3(12, 0, 24)
  };
}

const BUILDERS = { town: buildTown, ruins: buildRuins, docks: buildDocks, taipei: buildTaipei, adventure: buildAdventure };

export function buildMap(sc, mapId = 'town', env = 'night') {
  scene = sc;
  // 清理旧地图
  if (group) {
    scene.remove(group);
    group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  }
  colliders.length = 0; minimapRects.length = 0; minimapRoads.length = 0;
  enemySpawns.length = 0; patrolPoints.length = 0; mapAnims.length = 0;

  group = new THREE.Group();
  scene.add(group);
  NIGHT = (env === 'night');      // 時段：day 白天 | sunset 夕陽 | night 夜晚
  SUNSET = (env === 'sunset');
  batchBegin(group);            // 开始收集同材质盒子（否则建筑墙体不会渲染 → 墙壁"透明"）
  const builder = BUILDERS[mapId] || buildTown;
  const info = builder();
  batchEnd();                   // 合并并真正加入场景
  info.env = env;               // main.js 依此套用光照
  return info;
}
