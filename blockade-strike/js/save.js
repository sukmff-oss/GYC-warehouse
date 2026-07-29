// ============ 存档系统（localStorage 持久化） ============

const KEY = 'blockade-strike-save-v1';

export const PACK_CAP = 24;
export const WH_CAP = 60;

// 道具图鉴（背包/仓库中可存放的物品）
export const ITEMS = {
  medkit:    { icon: '💊', name: '医疗包',   desc: '恢复 50 点生命',        color: '#7affa0' },
  armorpack: { icon: '🛡', name: '护甲包',   desc: '恢复 50 点护甲',        color: '#6ab0ff' },
  nadepack:  { icon: '💣', name: '手雷包',   desc: '手雷 +2',               color: '#ffb04a' },
  boostcore: { icon: '⚡', name: '强化核心', desc: '当前武器伤害提升至 +20%', color: '#ffe06a' },
  goldcore:  { icon: '🌟', name: '黄金核心', desc: '当前武器伤害提升至 +40%', color: '#ffd700' },
  goldbag:   { icon: '💰', name: '金币袋',   desc: '立即获得 100 金币',      color: '#ffd27a' },
};

function defaults() {
  return {
    gold: 0,
    pack: {},   // { itemId: count } 背包
    wh: {},     // { itemId: count } 仓库
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
      if (d.pack && typeof d.pack === 'object') this.pack = d.pack;
      if (d.wh && typeof d.wh === 'object') this.wh = d.wh;
      if (d.stats && typeof d.stats === 'object')
        Object.assign(this.stats, d.stats);
    } catch (e) { /* 损坏的存档从头开始 */ }
  },

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        gold: this.gold, pack: this.pack, wh: this.wh, stats: this.stats,
      }));
    } catch (e) { /* 存储不可用时静默 */ }
  },

  addGold(n) {
    this.gold = Math.max(0, this.gold + n);
    this.save();
  },

  totalOf(obj) {
    let n = 0;
    for (const k in obj) n += obj[k];
    return n;
  },

  addItem(id, n = 1) {
    if (!ITEMS[id]) return false;
    if (this.totalOf(this.pack) + n > PACK_CAP) return false;  // 背包已满
    this.pack[id] = (this.pack[id] || 0) + n;
    this.save();
    return true;
  },

  removeItem(id, n = 1) {
    if ((this.pack[id] || 0) < n) return false;
    this.pack[id] -= n;
    if (this.pack[id] <= 0) delete this.pack[id];
    this.save();
    return true;
  },

  toWarehouse(id) {
    if (!this.pack[id]) return false;
    if (this.totalOf(this.wh) + 1 > WH_CAP) return false;
    this.pack[id]--;
    if (this.pack[id] <= 0) delete this.pack[id];
    this.wh[id] = (this.wh[id] || 0) + 1;
    this.save();
    return true;
  },

  toPack(id) {
    if (!this.wh[id]) return false;
    if (this.totalOf(this.pack) + 1 > PACK_CAP) return false;
    this.wh[id]--;
    if (this.wh[id] <= 0) delete this.wh[id];
    this.pack[id] = (this.pack[id] || 0) + 1;
    this.save();
    return true;
  },
};

save.load();
