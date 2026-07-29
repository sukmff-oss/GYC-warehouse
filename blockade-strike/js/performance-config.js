// =============================================================
// performance-config.js — 畫質設定與效能優化系統
// for 街區突擊 / BLOCKADE STRIKE
// =============================================================

/**
 * 自動偵測裝置效能等級
 * 根據 GPU、螢幕解析度、記憶體等決定預設畫質
 */
function detectPerformanceLevel() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  
  if (!gl) return 'low';
  
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : '';
  
  // 高階 GPU 關鍵字
  const highEnd = /RTX|GTX 1[6789]|GTX 2[0789]|RX 6[789]|RX 7|Apple M[23]|Apple M1 Pro|Apple M1 Max|Apple M1 Ultra/i;
  // 中階 GPU
  const midEnd = /GTX 9|GTX 10|RX 5|Intel Iris|Apple M1(?! )|Mali-G7|Mali-G8|Adreno 6[56789]|Adreno 7/i;
  
  const pixelCount = window.innerWidth * window.innerHeight;
  const isHighRes = pixelCount > 2560 * 1440;
  const isMobile = /Android|iPhone|iPad|iPod/.test(navigator.userAgent);
  
  if (highEnd.test(renderer) && !isHighRes) return 'high';
  if (midEnd.test(renderer) || (highEnd.test(renderer) && isHighRes)) return 'medium';
  if (isMobile) return 'low';
  return 'medium';
}

/**
 * 畫質設定配置
 */
export const QUALITY_PRESETS = {
  low: {
    label: '流暢',
    shadows: false,              // 關閉陰影
    shadowMapSize: 1024,
    pixelRatio: Math.min(window.devicePixelRatio, 1.0),
    antialias: false,
    bloom: false,                // 關閉泛光
    motionBlur: false,           // 關閉動態模糊
    filmGrain: false,            // 關閉膠片顆粒
    skyQuality: 'simple',        // 簡單天空
    minimapHz: 5,                // 小地图 5Hz
    enemyCount: 8,               // 减少敌人数量
    lodDistance: 30,             // LOD 切换距离
    textureQuality: 'low',
    postFX: false,               // 关闭后处理管线
  },
  medium: {
    label: '均衡',
    shadows: true,
    shadowMapSize: 1024,
    pixelRatio: Math.min(window.devicePixelRatio, 1.5),
    antialias: true,
    bloom: true,
    motionBlur: true,
    filmGrain: true,
    skyQuality: 'full',
    minimapHz: 10,
    enemyCount: 10,
    lodDistance: 50,
    textureQuality: 'medium',
    postFX: true,
  },
  high: {
    label: '極致',
    shadows: true,
    shadowMapSize: 2048,
    pixelRatio: Math.min(window.devicePixelRatio, 2.0),
    antialias: true,
    bloom: true,
    motionBlur: true,
    filmGrain: true,
    skyQuality: 'full',
    minimapHz: 15,
    enemyCount: 12,
    lodDistance: 80,
    textureQuality: 'high',
    postFX: true,
  },
};

class PerformanceConfig {
  constructor() {
    this.level = localStorage.getItem('blockade_quality') || detectPerformanceLevel();
    this.settings = { ...QUALITY_PRESETS[this.level] };
    this._minimapTimer = 0;
    this._minimapInterval = 1 / this.settings.minimapHz;
  }

  get(key) {
    return this.settings[key];
  }

  setLevel(level) {
    if (!QUALITY_PRESETS[level]) return false;
    this.level = level;
    this.settings = { ...QUALITY_PRESETS[level] };
    this._minimapInterval = 1 / this.settings.minimapHz;
    localStorage.setItem('blockade_quality', level);
    return true;
  }

  // 小地图是否需要更新（基于降频）
  shouldUpdateMinimap(dt) {
    this._minimapTimer += dt;
    if (this._minimapTimer >= this._minimapInterval) {
      this._minimapTimer = 0;
      return true;
    }
    return false;
  }

  // 根据距离判断是否应该使用 LOD
  shouldUseLOD(distance) {
    return distance > this.settings.lodDistance;
  }
}

export const perf = new PerformanceConfig();

/**
 * 創建畫質設定 UI
 */
export function createQualityUI() {
  const existing = document.getElementById('quality-panel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'quality-panel';
  panel.innerHTML = `
    <style>
      #quality-panel {
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(10,14,22,0.95); border: 1px solid rgba(255,255,255,0.15);
        border-radius: 10px; padding: 24px 28px; z-index: 9999;
        color: #e8ecf2; font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
        min-width: 280px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      }
      #quality-panel h3 { margin: 0 0 16px; font-size: 17px; color: #ffd27a; letter-spacing: 2px; text-align: center; }
      .q-row { display: flex; align-items: center; justify-content: space-between; margin: 10px 0; font-size: 13px; }
      .q-row span { opacity: 0.85; }
      .q-row b { color: #5db2ff; font-weight: 600; }
      .q-btns { display: flex; gap: 8px; margin-top: 16px; }
      .q-btn {
        flex: 1; padding: 10px; border: 1px solid rgba(255,255,255,0.2);
        background: rgba(255,255,255,0.06); color: #fff; border-radius: 6px;
        cursor: pointer; font-size: 13px; transition: all 0.2s;
      }
      .q-btn:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.35); }
      .q-btn.active { background: rgba(93,178,255,0.25); border-color: #5db2ff; color: #5db2ff; }
      .q-close { margin-top: 14px; width: 100%; padding: 10px; border: 1px solid rgba(255,255,255,0.15);
        background: rgba(255,255,255,0.05); color: #aaa; border-radius: 6px;
        cursor: pointer; font-size: 12px; }
      .q-close:hover { background: rgba(255,255,255,0.1); color: #fff; }
      .q-hint { font-size: 11px; color: #888; margin-top: 10px; text-align: center; }
    </style>
    <h3>⚙️ 畫質設定</h3>
    <div class="q-row"><span>當前等級</span><b id="q-current">${perf.settings.label}</b></div>
    <div class="q-row"><span>陰影</span><b>${perf.settings.shadows ? '開' : '關'}</b></div>
    <div class="q-row"><span>泛光 (Bloom)</span><b>${perf.settings.bloom ? '開' : '關'}</b></div>
    <div class="q-row"><span>動態模糊</span><b>${perf.settings.motionBlur ? '開' : '關'}</b></div>
    <div class="q-row"><span>解析度縮放</span><b>${perf.settings.pixelRatio.toFixed(1)}×</b></div>
    <div class="q-row"><span>敵人數量</span><b>${perf.settings.enemyCount}</b></div>
    <div class="q-btns">
      <button class="q-btn ${perf.level === 'low' ? 'active' : ''}" data-level="low">流暢</button>
      <button class="q-btn ${perf.level === 'medium' ? 'active' : ''}" data-level="medium">均衡</button>
      <button class="q-btn ${perf.level === 'high' ? 'active' : ''}" data-level="high">極致</button>
    </div>
    <div class="q-hint">修改後需重新整理頁面生效</div>
    <button class="q-close">關閉</button>
  `;

  panel.querySelectorAll('.q-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const level = btn.dataset.level;
      perf.setLevel(level);
      // 更新按鈕狀態
      panel.querySelectorAll('.q-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('q-current').textContent = perf.settings.label;
    });
  });

  panel.querySelector('.q-close').addEventListener('click', () => panel.remove());

  document.body.appendChild(panel);
}

// 綁定快捷鍵 Ctrl+Q 或 ~ 打開畫質面板
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey && e.code === 'KeyQ') || e.code === 'Backquote') {
    e.preventDefault();
    createQualityUI();
  }
});
