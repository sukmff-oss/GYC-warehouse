// ============ 掉落物系统 ============
import * as THREE from 'three';
import { save, ITEMS } from './save.js';
import { WEAPONS, WEAPON_ORDER } from './weapon.js';

const RARITY_COLOR = {
  common: 0x9fb2c8,
  rare: 0x4aa8ff,
  epic: 0xc06aff,
};

// 装备类掉落（立即生效，不进背包）
const GEAR = {
  boostweapon: { icon: '⚡', name: '强化武器', desc: '当前武器伤害 +20%' },
  goldweapon:  { icon: '🌟', name: '黄金武器', desc: '当前武器伤害 +40%' },
  armor100:    { icon: '🛡', name: '重型护甲', desc: '护甲立即全满' },
  fullhp:      { icon: '💊', name: '纳米修复', desc: '生命立即全满' },
  fullsupply:  { icon: '📦', name: '全补给',   desc: '弹药与手雷补满' },
};

// 普通掉落的道具池（加权）
const COMMON_POOL = [
  ['medkit', 0.30],
  ['armorpack', 0.25],
  ['nadepack', 0.20],
  ['goldbag', 0.15],
  ['boostcore', 0.10],
];

function rollCommon() {
  let r = Math.random();
  for (const [id, w] of COMMON_POOL) {
    if ((r -= w) <= 0) return { rarity: 'common', type: 'item', itemId: id };
  }
  return { rarity: 'common', type: 'item', itemId: 'medkit' };
}

export class LootManager {
  constructor(scene) {
    this.scene = scene;
    this.items = [];   // { group, spec, baseY, phase }
    this.t = 0;
    this._geo = new THREE.OctahedronGeometry(0.26);
    this._pedGeo = new THREE.CylinderGeometry(0.34, 0.42, 0.08, 10);
  }

  drop(pos, spec = null) {
    const s = spec || rollCommon();
    const color = RARITY_COLOR[s.rarity] || RARITY_COLOR.common;
    const group = new THREE.Group();

    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.55,
      metalness: 0.6, roughness: 0.3,
    });
    const gem = new THREE.Mesh(this._geo, mat);
    gem.position.y = 0.75;
    gem.name = 'gem';

    const ped = new THREE.Mesh(this._pedGeo,
      new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.5, roughness: 0.6 }));
    ped.position.y = 0.04;

    // 光环
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.1;
    ring.name = 'ring';

    group.add(gem, ped, ring);
    group.position.copy(pos);
    group.position.y = 0;
    this.scene.add(group);
    this.items.push({ group, spec: s, phase: Math.random() * Math.PI * 2 });
    return s;
  }

  // 返回被拾取的 spec，无拾取返回 null
  update(dt, player) {
    this.t += dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      const g = it.group;
      const gem = g.getObjectByName('gem');
      gem.rotation.y += dt * 2.4;
      gem.position.y = 0.75 + Math.sin(this.t * 2.2 + it.phase) * 0.1;
      g.getObjectByName('ring').rotation.z += dt * 1.2;

      if (player.alive &&
          Math.hypot(player.pos.x - g.position.x, player.pos.z - g.position.z) < 1.7) {
        this.scene.remove(g);
        gem.material.dispose();
        this.items.splice(i, 1);
        return it.spec;
      }
    }
    return null;
  }

  clear() {
    for (const it of this.items) this.scene.remove(it.group);
    this.items.length = 0;
  }
}

// 拾取结算
export function applyLoot(spec, player, weapon, hud, audio) {
  if (spec.type === 'item') {
    const it = ITEMS[spec.itemId];
    if (save.addItem(spec.itemId, 1)) {
      hud.sysmsg(`拾取 ${it.icon} ${it.name} · 已放入背包（B 打开）`, 2200);
    } else {
      hud.sysmsg('背包已满 · 道具未能拾取', 1800);
    }
    audio.kill();
    return;
  }

  const g = GEAR[spec.type];
  switch (spec.type) {
    case 'boostweapon': {
      const st = weapon.state[weapon.activeId];
      st.boost = Math.max(st.boost || 1, 1.2);
      break;
    }
    case 'goldweapon':
      weapon.state[weapon.activeId].boost = 1.4;
      break;
    case 'armor100':
      player.armor = 100;
      break;
    case 'fullhp':
      player.hp = 100;
      break;
    case 'fullsupply':
      for (const id of WEAPON_ORDER) {
        weapon.state[id].ammo = WEAPONS[id].mag;
        weapon.state[id].reserve = WEAPONS[id].reserve;
      }
      weapon.grenades = Math.max(weapon.grenades, 3);
      break;
  }
  if (g) hud.sysmsg(`${g.icon} ${g.name} · ${g.desc}`, 2200);
  audio.kill();
}
