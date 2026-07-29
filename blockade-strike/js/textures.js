// ============ 程序化贴图（Canvas 生成，无外部资源） ============
import * as THREE from 'three';

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// 明暗噪点（贴图以近白为基调，让材质颜色正常叠乘）
function speckle(ctx, s, n, amp = 0.12, dark = true) {
  for (let i = 0; i < n; i++) {
    const d = dark && Math.random() < 0.6;
    ctx.fillStyle = d
      ? `rgba(0,0,0,${Math.random() * amp})`
      : `rgba(255,255,255,${Math.random() * amp})`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function blotch(ctx, s, n, color, rMin, rMax, alpha) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = color.replace('A', (Math.random() * alpha).toFixed(3));
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, rMin + Math.random() * (rMax - rMin), 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------- 墙面 / 地面 ----------
let _plaster, _brick, _asphalt, _sand, _concrete, _wood, _container, _fabric,
    _carPaint, _leaf, _bark, _rust, _gunMetal, _gunWood;

export function plasterTex() {
  return _plaster ??= canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#ded8cc'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 2200, 0.10);
    blotch(ctx, s, 10, 'rgba(120,110,95,A)', 14, 44, 0.10);
    // 细微裂纹
    ctx.strokeStyle = 'rgba(90,85,75,.18)'; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      let x = Math.random() * s, y = Math.random() * s;
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += (Math.random() - .5) * 40; y += Math.random() * 24; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });
}

export function brickTex() {
  return _brick ??= canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#c9c2b6'; ctx.fillRect(0, 0, s, s);   // 灰缝
    const bw = 42, bh = 18;
    for (let y = 0, row = 0; y < s; y += bh + 4, row++) {
      for (let x = -bw; x < s + bw; x += bw + 4) {
        const ox = row % 2 ? x + bw / 2 : x;
        const v = 0.82 + Math.random() * 0.18;
        ctx.fillStyle = `rgb(${215 * v | 0},${205 * v | 0},${192 * v | 0})`;
        ctx.fillRect(ox, y, bw, bh);
      }
    }
    speckle(ctx, s, 1600, 0.10);
  });
}

export function asphaltTex() {
  return _asphalt ??= canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#b9b9bc'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 4200, 0.22);
    blotch(ctx, s, 8, 'rgba(60,60,64,A)', 10, 30, 0.14);
  });
}

export function sandTex() {
  return _sand ??= canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#e6dbc4'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 3800, 0.10);
    // 风纹
    ctx.strokeStyle = 'rgba(150,135,105,.16)'; ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      const y = Math.random() * s;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * .3, y + 12, s * .6, y - 12, s, y + 6);
      ctx.stroke();
    }
  });
}

export function concreteTex() {
  return _concrete ??= canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#cfcfcb'; ctx.fillRect(0, 0, s, s);
    speckle(ctx, s, 2600, 0.12);
    blotch(ctx, s, 12, 'rgba(95,95,90,A)', 8, 34, 0.10);
  });
}

export function woodTex() {
  return _wood ??= canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#d9c2a0'; ctx.fillRect(0, 0, s, s);
    // 木板
    for (let y = 0; y < s; y += 36) {
      ctx.fillStyle = `rgba(120,90,55,${0.10 + Math.random() * 0.12})`;
      ctx.fillRect(0, y, s, 34);
      ctx.fillStyle = 'rgba(80,58,32,.5)';
      ctx.fillRect(0, y + 34, s, 2);
      // 木纹
      ctx.strokeStyle = 'rgba(110,82,48,.25)'; ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const gy = y + 6 + Math.random() * 26;
        ctx.moveTo(0, gy);
        ctx.bezierCurveTo(s * .3, gy + 3, s * .6, gy - 3, s, gy + 2);
        ctx.stroke();
      }
    }
  });
}

export function containerTex() {
  return _container ??= canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#d8d8da'; ctx.fillRect(0, 0, s, s);
    // 瓦楞竖纹
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = 'rgba(0,0,0,.16)'; ctx.fillRect(x, 0, 3, s);
      ctx.fillStyle = 'rgba(255,255,255,.20)'; ctx.fillRect(x + 8, 0, 3, s);
    }
    speckle(ctx, s, 900, 0.10);
    blotch(ctx, s, 6, 'rgba(140,80,40,A)', 6, 20, 0.16);   // 锈迹
  });
}

export function fabricTex() {
  return _fabric ??= canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#e2e2e2'; ctx.fillRect(0, 0, s, s);
    // 织纹
    for (let y = 0; y < s; y += 3) {
      ctx.fillStyle = `rgba(0,0,0,${y % 6 ? 0.05 : 0.10})`;
      ctx.fillRect(0, y, s, 1);
    }
    for (let x = 0; x < s; x += 3) {
      ctx.fillStyle = `rgba(0,0,0,${x % 6 ? 0.04 : 0.08})`;
      ctx.fillRect(x, 0, 1, s);
    }
  });
}

export function carPaintTex() {
  return _carPaint ??= canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#e8e8ea'; ctx.fillRect(0, 0, s, s);
    // 金属漆闪点
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1);
    }
    speckle(ctx, s, 300, 0.06);
  });
}

export function leafTex() {
  return _leaf ??= canvasTex(128, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    // 叶团（透明背景，配合 alphaTest）
    for (let i = 0; i < 46; i++) {
      const g = 120 + Math.random() * 100;
      ctx.fillStyle = `rgba(${g * 0.55 | 0},${g | 0},${g * 0.45 | 0},.95)`;
      ctx.save();
      ctx.translate(Math.random() * s, Math.random() * s);
      ctx.rotate(Math.random() * Math.PI * 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, 5 + Math.random() * 9, 3 + Math.random() * 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });
}

export function barkTex() {
  return _bark ??= canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#cbb79c'; ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 6) {
      ctx.fillStyle = `rgba(90,68,45,${0.18 + Math.random() * 0.25})`;
      ctx.fillRect(x + Math.random() * 3, 0, 2 + Math.random() * 3, s);
    }
    speckle(ctx, s, 500, 0.12);
  });
}

export function rustTex() {
  return _rust ??= canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#c8c4bc'; ctx.fillRect(0, 0, s, s);
    blotch(ctx, s, 16, 'rgba(150,80,35,A)', 5, 22, 0.4);
    blotch(ctx, s, 10, 'rgba(90,50,25,A)', 3, 12, 0.35);
    speckle(ctx, s, 700, 0.12);
  });
}

// ---------- 招牌（带文字） ----------
const _signs = new Map();
export function signTex(text, bg = '#2a4a7a') {
  const key = text + '|' + bg;
  if (_signs.has(key)) return _signs.get(key);
  const t = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, s - 16, s - 16);
    speckle(ctx, s, 400, 0.08);
    ctx.fillStyle = '#f5f0e4';
    ctx.font = 'bold 64px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 6;
    ctx.fillText(text, s / 2, s / 2 + 4);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  _signs.set(key, t);
  return t;
}

// ---------- 枪械 ----------
export function gunMetalTex() {
  return _gunMetal ??= canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#d4d6da'; ctx.fillRect(0, 0, s, s);
    // 拉丝
    for (let y = 0; y < s; y += 2) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
      ctx.fillRect(0, y, s, 1);
    }
    speckle(ctx, s, 400, 0.06);
  });
}

export function gunWoodTex() {
  return _gunWood ??= canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#dcae78'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(100,62,28,.35)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      const y = Math.random() * s;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * .3, y + 6, s * .6, y - 6, s, y + 4);
      ctx.stroke();
    }
    speckle(ctx, s, 300, 0.08);
  });
}

// ---------- 材质工厂 ----------
export function texMat(color, tex = null, opts = {}) {
  const m = new THREE.MeshStandardMaterial({
    color,
    map: tex || null,
    roughness: opts.rough ?? 0.9,
    metalness: opts.metal ?? 0,
  });
  if (opts.alpha !== undefined) { m.transparent = true; m.opacity = opts.alpha; }
  if (opts.alphaTest) { m.alphaTest = opts.alphaTest; m.transparent = true; }
  if (opts.side !== undefined) m.side = opts.side;
  if (opts.bump && tex) { m.bumpMap = tex; m.bumpScale = opts.bump * 0.02; }
  return m;
}
