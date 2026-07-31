// ============ 存档系统（localStorage 持久化） ============

const KEY = 'blockade-strike-save-v1';

// 道具图鉴（戰鬥中拾取後立即生效）
export const ITEMS = {
  medkit:    { icon: '💊', name: '醫療包',   desc: '恢復 50 點生命',        color: '#7affa0' },
  armorpack: { icon: '🛡', name: '護甲包',   desc: '恢復 50 點護甲',        color: '#6ab0ff' },
  nadepack:  { icon: '💣', name: '手雷包',   desc: '手雷 +2',               color: '#ffb04a' },
  boostcore: { icon: '⚡', name: '強化核心', desc: '當前武器傷害提升至 +20%', color: '#ffe06a' },
  goldcore:  { icon: '🌟', name: '黃金核心', desc: '當前武器傷害提升至 +40%', color: '#ffd700' },
  goldbag:   { icon: '💰', name: '金幣袋',   desc: '立即獲得 100 金幣',      color: '#ffd27a' },
};

function defaults() {
  return {
    gold: 0,
    stats: { kills: 0, boss: 0, missions: 0, adventures: 0 },
  };
}

export const save = {
  ...defaults(),

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.gold === 'number') this.gold = d.gold;
      if (d.stats && typeof d.stats === 'object')
        Object.assign(this.stats, d.stats);
    } catch (e) { /* 损坏的存档从头开始 */ }
  },

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        gold: this.gold, stats: this.stats,
      }));
    } catch (e) { /* 存储不可用时静默 */ }
  },

  addGold(n) {
    this.gold = Math.max(0, this.gold + n);
    this.save();
  },
};

save.load();
