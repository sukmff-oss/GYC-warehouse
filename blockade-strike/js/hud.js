// ============ HUD（抬头显示） ============
import { minimapRects, minimapRoads } from './map.js';

const $ = id => document.getElementById(id);

function retrigger(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;   // 强制重排以重启动画
  el.classList.add(cls);
}

export class HUD {
  constructor() {
    this.map = null;
    this._sysT = null;
    this._dmgFlip = 0;
    this.mm = $('minimap').getContext('2d');
    this.cp = $('compass').getContext('2d');
  }

  show() { $('hud').classList.add('on'); }

  setMap(mapInfo) { this.map = mapInfo; }

  // ---------- 比分 / 计时 ----------
  setScore(b, r) {
    $('scoreB').textContent = b;
    $('scoreR').textContent = r;
  }

  setTimer(sec) {
    if (!isFinite(sec)) { $('timer').textContent = '∞'; return; }
    const s = Math.max(0, Math.ceil(sec));
    $('timer').textContent = `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---------- 生命 / 护甲 / 弹药 ----------
  setHP(hp, armor) {
    $('hpnum').innerHTML = `<small>HEALTH</small>${Math.max(0, Math.ceil(hp))}`;
    const fill = $('hpfill');
    fill.style.width = Math.max(0, hp) + '%';
    fill.classList.toggle('low', hp < 35);
    $('armorbar').style.display = armor > 0 ? 'block' : 'none';
    if (armor > 0) $('armorfill').style.width = Math.min(100, armor) + '%';
  }

  setAmmo(ammo, reserve, reloading) {
    const el = $('ammo');
    el.innerHTML = `${ammo}<small>/ ${reserve}</small>`;
    el.classList.toggle('reload', !!reloading);
  }

  setWeapon(name) { $('wpnname').textContent = name; }
  setGrenades(n) { $('nadenum').textContent = n; }
  gold(n) { $('goldnum').textContent = n; }

  // ---------- 命中 / 击杀 ----------
  hitmarker() { retrigger($('hitmark'), 'pop'); }

  killToast(pts) {
    $('killtoast').querySelector('.big').textContent = 'ENEMY ELIMINATED';
    $('killtoast').querySelector('.pts').textContent = '+' + pts;
    retrigger($('killtoast'), 'show');
  }

  celebrate(big, sub, tier = 0) {
    const el = $('streak');
    el.querySelector('.big').textContent = big;
    el.querySelector('.sub').textContent = sub;
    el.classList.remove('tier1', 'tier2');
    if (tier === 1) el.classList.add('tier1');
    else if (tier >= 2) el.classList.add('tier2');
    retrigger(el, 'show');
  }

  feed(killer, weapon, victim, good) {
    const box = $('killfeed');
    const div = document.createElement('div');
    div.className = 'feed';
    div.innerHTML = `<span class="${good ? 'b' : 'r'}">${killer}</span>` +
      `<span class="w">${weapon}</span>` +
      `<span class="${good ? 'r' : 'b'}">${victim}</span>`;
    box.prepend(div);
    while (box.children.length > 6) box.lastChild.remove();
    setTimeout(() => { div.remove(); }, 5200);
  }

  // ---------- 状态提示 ----------
  sysmsg(text, ms = 2000) {
    const el = $('sysmsg');
    if (this._sysT) { clearTimeout(this._sysT); this._sysT = null; }
    if (!text) { el.classList.remove('show'); return; }
    el.textContent = text;
    el.classList.add('show');
    this._sysT = setTimeout(() => el.classList.remove('show'), ms);
  }

  prompt(html) {
    const el = $('interact');
    if (!html) { el.style.display = 'none'; return; }
    el.innerHTML = html;
    el.style.display = 'block';
  }

  objective(html) {
    const el = $('objective');
    if (!html) { el.style.display = 'none'; return; }
    el.innerHTML = html;
    el.style.display = 'block';
  }

  protect(t) {
    const el = $('protect');
    if (t > 0) {
      el.textContent = `🛡 出生保護 · ${t.toFixed(1)}s`;
      el.style.display = 'block';
    } else el.style.display = 'none';
  }

  bossBar(name, hp, maxHp) {
    const el = $('bossbar');
    if (name == null) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    $('bossname').textContent = name;
    $('bossfill').style.width = Math.max(0, hp / maxHp * 100) + '%';
  }

  plantBar(frac) {
    const el = $('plantbar');
    if (frac == null) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    $('plantfill').style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  }

  damageFrom(angle) {
    const el = $('dmgdir' + (this._dmgFlip % 2));
    this._dmgFlip++;
    el.style.transform = `rotate(${angle}rad)`;
    retrigger(el, 'show');
  }

  // ---------- 小地图 ----------
  drawMinimap(player, soldiers, now) {
    if (!this.map) return;
    const ctx = this.mm, W = 168;
    const b = this.map.bounds;
    const rangeX = b.maxX - b.minX, rangeZ = b.maxZ - b.minZ;
    const s = W / Math.max(rangeX, rangeZ);
    const ox = (W - rangeX * s) / 2, oz = (W - rangeZ * s) / 2;
    const X = x => ox + (x - b.minX) * s;
    const Y = z => oz + (z - b.minZ) * s;   // 北（-z）在上

    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = '#20242c';
    ctx.fillRect(0, 0, W, W);

    // 道路 / 地面
    for (const r of minimapRoads) {
      ctx.fillStyle = r.color || '#3a4048';
      ctx.globalAlpha = 0.55;
      ctx.fillRect(X(r.x - r.w / 2), Y(r.z - r.d / 2), r.w * s, r.d * s);
    }
    ctx.globalAlpha = 1;

    // 建筑 / 掩体
    ctx.fillStyle = '#5a6472';
    for (const r of minimapRects)
      ctx.fillRect(X(r.x - r.w / 2), Y(r.z - r.d / 2), Math.max(1.5, r.w * s), Math.max(1.5, r.d * s));

    // 爆破点
    if (this.map.bombSite) {
      const bs = this.map.bombSite;
      const pulse = 3 + Math.sin(now * 4) * 1.2;
      ctx.strokeStyle = '#ff5a3a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(X(bs.x), Y(bs.z), (bs.r * s) + pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ff5a3a';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('B', X(bs.x), Y(bs.z) + 3);
    }

    // 敌人
    for (const sd of soldiers) {
      if (sd.state === 'dead') continue;
      ctx.fillStyle = sd.isBoss ? '#ffd700' : '#ff5a4a';
      ctx.beginPath();
      ctx.arc(X(sd.pos.x), Y(sd.pos.z), sd.isBoss ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 玩家（白色箭头，指向朝向）
    ctx.save();
    ctx.translate(X(player.pos.x), Y(player.pos.z));
    ctx.rotate(-player.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -5.5); ctx.lineTo(3.6, 4.2); ctx.lineTo(0, 2.2); ctx.lineTo(-3.6, 4.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ---------- 罗盘 ----------
  drawCompass(player) {
    const ctx = this.cp, W = 460, H = 26;
    const heading = ((-player.yaw * 180 / Math.PI) % 360 + 360) % 360;  // 北 = 0
    const pxPerDeg = W / 100;   // 视野 100°
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,14,20,.45)';
    ctx.fillRect(0, 0, W, H);

    const marks = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];
    ctx.textAlign = 'center';
    for (let a = 0; a < 360; a += 15) {
      let d = a - heading;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      const x = W / 2 + d * pxPerDeg;
      if (x < -20 || x > W + 20) continue;
      const m = marks.find(mk => mk[0] === a);
      if (m) {
        ctx.fillStyle = m[1] === 'N' ? '#ff6a5d' : '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(m[1], x, 17);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,.4)';
        ctx.fillRect(x - 0.5, H - 8, 1, a % 45 === 0 ? 8 : 4);
      }
    }
    // 中线
    ctx.fillStyle = '#ffb04a';
    ctx.fillRect(W / 2 - 1, 0, 2, 7);
  }
}
