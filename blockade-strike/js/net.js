// =============================================================
// net.js — P2P 多人連線（PeerJS，房主權威，最多 5 人合作打敵人）
// 房主：跑敵人 AI / 傷害 / 擊殺 / 金幣，10Hz 廣播快照
// 加入者：本地命中偵測後回報房主，渲染遠端玩家與敵人殘影
// =============================================================
import * as THREE from 'three';
import { Soldier } from './enemies.js';

const PREFIX = 'blkds-room-';
const MAX_CLIENTS = 4;   // 房主 + 4 = 5 人
const ZERO_V = new THREE.Vector3();

export class Net {
  constructor(scene) {
    this.scene = scene;
    this.peer = null;
    this.isHost = false;
    this.connected = false;
    this.code = '';
    this.mapId = 'town';
    this.env = 'sunset';
    this.conns = new Map();     // id -> {conn, name, state, avatar, stub}（房主用）
    this.remote = new Map();    // id -> {state, avatar, stub}（加入者看其他玩家，含房主）
    this.myId = 0; this.myName = 'P1';
    this.ghosts = [];           // 加入者的敵人殘影（Soldier，不跑 AI）
    this.vshots = [];           // 加入者的敵方子彈視覺
    this.vnades = [];           // 其他玩家的手雷視覺
    this.onEvent = () => {};    // main.js 接 UI / 遊戲事件
    this._ray = new THREE.Raycaster();
    this._nadeGeo = new THREE.SphereGeometry(0.09, 8, 8);
    this._nadeMat = new THREE.MeshStandardMaterial({ color: 0x3a4a32, roughness: 0.6, metalness: 0.3 });
  }

  // ---------- 建立 / 加入 ----------
  _mkCode() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += c[(Math.random() * c.length) | 0];
    return s;
  }

  host() {
    this.leave();
    this.isHost = true;
    this.code = this._mkCode();
    this.myId = 1; this.myName = 'P1';
    this.peer = new Peer(PREFIX + this.code);
    this.peer.on('open', () => {
      this.connected = true;
      this.onEvent('code', this.code);
      this.onEvent('status', `房號 ${this.code} · 等待玩家加入…`);
    });
    this.peer.on('error', e => this.onEvent('status', '連線錯誤：' + e.type));
    this.peer.on('connection', conn => this._accept(conn));
    return this.code;
  }

  // ---------- 自動配房（固定公共房，無需房號）----------
  // 優先搶當公共房主；已有人當房主則加入；都失敗則回調 'solo' 離線進行
  auto(cb) {
    this.leave();
    const room = 'LOBBY1';
    this.code = room;
    let settled = false;
    const done = role => { if (!settled) { settled = true; cb(role); } };
    setTimeout(() => done(this.connected ? (this.isHost ? 'host' : 'client') : 'solo'), 7000);
    this.isHost = true; this.myId = 1; this.myName = 'P1';
    this.onEvent('status', '🔗 尋找公共房間…');
    this.peer = new Peer(PREFIX + room);
    this.peer.on('open', () => {
      this.connected = true;
      this.onEvent('code', room);
      done('host');
    });
    this.peer.on('connection', c => this._accept(c));
    this.peer.on('error', e => {
      if (e.type === 'unavailable-id') this._joinPublic(room, done);
      else if (!this.connected) { this.onEvent('status', '連線錯誤：' + e.type); done('solo'); }
    });
  }

  _joinPublic(room, done) {
    this.isHost = false;
    try { this.peer.destroy(); } catch {}
    this.peer = new Peer();
    this.onEvent('status', '房間已存在 · 加入中…');
    this.peer.on('error', e => {
      if (e.type === 'peer-unavailable') {
        // 房主剛好離線 → 換我搶當房主
        try { this.peer.destroy(); } catch {}
        this.isHost = true; this.myId = 1; this.myName = 'P1';
        this.peer = new Peer(PREFIX + room);
        this.peer.on('open', () => { this.connected = true; this.onEvent('code', room); done('host'); });
        this.peer.on('connection', c => this._accept(c));
        this.peer.on('error', () => done(this.connected ? 'host' : 'solo'));
      } else done('solo');
    });
    this.peer.on('open', () => {
      const conn = this.peer.connect(PREFIX + room, { reliable: true });
      this.hostConn = conn;
      conn.on('open', () => { this.connected = true; done('client'); });
      conn.on('data', d => this._onDataAsClient(d));
      conn.on('close', () => this.onEvent('status', '與房主斷線'));
    });
  }

  join(code) {
    this.leave();
    this.isHost = false;
    this.code = code.trim().toUpperCase();
    this.peer = new Peer();
    this.onEvent('status', '連線中…');
    this.peer.on('error', e => {
      this.onEvent('status', e.type === 'peer-unavailable' ? '找不到房間，請確認房號' : '連線錯誤：' + e.type);
    });
    this.peer.on('open', () => {
      const conn = this.peer.connect(PREFIX + this.code, { reliable: true });
      conn.on('open', () => {
        this.hostConn = conn;
        this.connected = true;
        this.onEvent('status', '已連上，等待房主分配…');
      });
      conn.on('data', d => this._onDataAsClient(d));
      conn.on('close', () => this.onEvent('status', '與房主斷線'));
    });
  }

  _accept(conn) {
    if (this.conns.size >= MAX_CLIENTS) {
      conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); });
      return;
    }
    conn.on('open', () => {
      const id = this.conns.size + 2;   // P2 起
      const name = 'P' + id;
      const rec = { conn, name, state: null, avatar: null, stub: null };
      this.conns.set(id, rec);
      conn.send({ t: 'welcome', id, name, mapId: this.mapId, env: this.env });
      this.onEvent('status', `${name} 加入（${this.conns.size + 1}/5）`);
      this.onEvent('roster', this.conns.size + 1);
      this._broadcastRoster();
    });
    conn.on('data', d => this._onDataAsHost(conn, d));
    conn.on('close', () => {
      for (const [id, r] of this.conns) {
        if (r.conn === conn) {
          this._removeRemote(id);
          this.conns.delete(id);
          this._broadcast({ t: 'leave', id });
          this.onEvent('status', `${r.name} 離開（${this.conns.size + 1}/5）`);
          this.onEvent('roster', this.conns.size + 1);
          this._broadcastRoster();
          break;
        }
      }
    });
  }

  _broadcastRoster() {
    const players = [{ id: 1, name: 'P1' }, ...[...this.conns.entries()].map(([id, r]) => ({ id, name: r.name }))];
    this._broadcast({ t: 'roster', players });
    this.onEvent('rosterInfo', players);
  }

  leave() {
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} }
    this.peer = null; this.connected = false; this.isHost = false;
    for (const [id] of this.remote) this._removeRemote(id);
    this.remote.clear();
    this.conns.clear();
    this.hostConn = null;
    this.clearGhosts();
  }

  // ---------- 收發 ----------
  send(o) {   // 加入者 → 房主
    if (this.isHost) return;
    if (this.hostConn && this.hostConn.open) this.hostConn.send(o);
  }

  _broadcast(o, exceptId = -1) {   // 房主 → 所有人
    if (!this.isHost) return;
    for (const [id, r] of this.conns)
      if (id !== exceptId && r.conn.open) r.conn.send(o);
  }

  _onDataAsHost(conn, d) {
    const rec = [...this.conns.values()].find(r => r.conn === conn);
    if (!rec) return;
    if (d.t === 'state') {
      rec.state = d;
      this.onEvent('remoteState', rec);
    } else if (d.t === 'hit') {
      this.onEvent('clientHit', { id: d.id, dmg: d.dmg, part: d.part, w: d.w, from: rec });
    } else if (d.t === 'nade') {
      this.onEvent('clientNade', { o: d.o, dir: d.dir, from: rec });
      this._broadcast({ t: 'vnade', o: d.o, dir: d.dir }, this._idOf(rec));
    } else if (d.t === 'shotfx') {
      this._broadcast({ t: 'shotfx', o: d.o, dir: d.dir }, this._idOf(rec));
    } else if (d.t === 'cannonTake') {
      this.onEvent('cannonTake');
    } else if (d.t === 'gatlingTake') {
      this.onEvent('gatlingTake');
    } else if (d.t === 'boomfx') {   // 加入者的加農槍爆炸 → 本地播放 + 轉播其他人
      this.onEvent('boom', d);
      this._broadcast({ t: 'boom', p: d.p }, this._idOf(rec));
    }
  }

  _onDataAsClient(d) {
    switch (d.t) {
      case 'welcome':
        this.myId = d.id; this.myName = d.name; this.mapId = d.mapId;
        this.onEvent('welcome', d);
        break;
      case 'full': this.onEvent('status', '房間已滿（5 人）'); this.onEvent('full'); break;
      case 'roster': this.onEvent('rosterInfo', d.players); break;
      case 'map': this.mapId = d.mapId; this.env = d.env || this.env; this.onEvent('map', d); break;
      case 'start': this.onEvent('start'); break;
      case 'snap': this._applySnap(d); break;
      case 'kill': this.onEvent('kill', d); break;
      case 'gold': this.onEvent('gold', d.n); break;
      case 'dmg': if (d.to === undefined || d.to === this.myId) this.onEvent('dmg', d); break;
      case 'ebolt': this._spawnVBolt(d); break;
      case 'vnade': this._spawnVNade(d.o, d.dir); break;
      case 'boom': this.onEvent('boom', d); break;
      case 'leave': this._removeRemote(d.id); this.remote.delete(d.id); break;
      case 'msg': this.onEvent('msg', d.text); break;
      case 'cannonSpawn': this.onEvent('cannonSpawn', d); break;
      case 'cannonGone': this.onEvent('cannonGone'); break;
      case 'gatlingSpawn': this.onEvent('gatlingSpawn', d); break;
      case 'gatlingGone': this.onEvent('gatlingGone'); break;
    }
  }

  _idOf(rec) {
    for (const [id, r] of this.conns) if (r === rec) return id;
    return -1;
  }

  // ---------- 遠端玩家化身 ----------
  _mkAvatar(name) {
    const s = new Soldier(this.scene, name);
    s.noRespawn = true;
    s.state = 'remote';
    if (s._marker) s._marker.visible = false;   // 隊友不顯示敵人標記
    // 藍色臂章區分敵我
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.1, 0.36),
      new THREE.MeshStandardMaterial({ color: 0x2a6ad8, roughness: 0.7, emissive: 0x1a3a78, emissiveIntensity: 0.5 }));
    band.position.y = 1.5;
    s.group.add(band);
    return s;
  }

  _getAvatar(id, name) {
    let r = this.remote.get(id);
    if (!r) {
      r = { state: null, avatar: this._mkAvatar(name || 'P' + id), target: null };
      this.remote.set(id, r);
    }
    return r;
  }

  _removeRemote(id) {
    const r = this.remote.get(id);
    if (r && r.avatar) { this.scene.remove(r.avatar.group); this.scene.remove(r.avatar._lodMesh); }
    this.remote.delete(id);
  }

  // 房主：遠端玩家作為敵人 AI 的目標 stub
  targetStubs() {
    const out = [];
    for (const [, r] of this.conns) {
      if (!r.state) continue;
      if (!r.stub) {
        r.stub = { pos: new THREE.Vector3(), vel: ZERO_V, alive: true, isRemote: true, name: r.name, id: this._idOf(r) };
      }
      r.stub.pos.set(r.state.p[0], r.state.p[1], r.state.p[2]);
      r.stub.alive = r.state.hp > 0;
      out.push(r.stub);
    }
    return out;
  }

  // 每幀驅動化身動畫（雙方通用）
  updateAvatars(dt) {
    const drive = (r) => {
      const st = r.state;
      if (!st) return;
      const a = r.avatar;
      const lerp = Math.min(1, dt * 12);
      a.pos.x += (st.p[0] - a.pos.x) * lerp;
      a.pos.y += (st.p[1] - a.pos.y) * lerp;
      a.pos.z += (st.p[2] - a.pos.z) * lerp;
      // 角度插值（處理環繞）
      let dy = st.yaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw += dy * lerp;
      a.moving = !!st.mv;
      if (a.moving) {
        a.walkPh += dt * 9;
        a.legL.rotation.x = Math.sin(a.walkPh) * 0.55;
        a.legR.rotation.x = -Math.sin(a.walkPh) * 0.55;
      } else {
        a.legL.rotation.x *= 0.8; a.legR.rotation.x *= 0.8;
      }
      a.armL.rotation.x = -1.05; a.armR.rotation.x = -1.05;   // 持槍前指
      a.group.visible = st.hp > 0;
      a._sync();
    };
    for (const [, r] of this.remote) drive(r);
    if (this.isHost) for (const [, r] of this.conns) {
      if (!r.avatar && r.state) { r.avatar = this._mkAvatar(r.name); r.avatar.state = r.state; this.remote.set(this._idOf(r), r); }
    }
  }

  // ---------- 房主快照 ----------
  broadcastSnap(player, enemies, scoreB, dt, extraPlayers = []) {
    if (!this.isHost) return;
    this._snapT = (this._snapT || 0) + dt;
    if (this._snapT < 0.1) return;
    this._snapT = 0;
    const players = [[1, player.pos.x, player.pos.y, player.pos.z, player.yaw, player.pitch, player.hp, player.sprinting ? 1 : 0]];
    for (const [id, r] of this.conns) {
      if (!r.state) continue;
      players.push([id, r.state.p[0], r.state.p[1], r.state.p[2], r.state.yaw, r.state.pitch, r.state.hp, r.state.mv ? 1 : 0]);
    }
    for (const row of extraPlayers) players.push(row);   // BOT 隊友（id 90+）
    const es = [];
    enemies.soldiers.forEach((s, i) => {
      es.push([i, +s.pos.x.toFixed(2), +s.pos.y.toFixed(2), +s.pos.z.toFixed(2), +s.yaw.toFixed(2), s.hp, s.state === 'dead' ? 0 : 1, s.moving ? 1 : 0]);
    });
    this._broadcast({ t: 'snap', players, es, scoreB });
  }

  // 加入者：套用快照
  _applySnap(d) {
    for (const [id, x, y, z, yaw, pitch, hp, mv] of d.players) {
      if (id === this.myId) continue;
      const r = this._getAvatar(id, id >= 90 ? 'BOT' : 'P' + id);
      r.state = { p: [x, y, z], yaw, pitch, hp, mv: !!mv };
    }
    for (const [i, x, y, z, yaw, hp, alive, mv] of d.es) {
      let g = this.ghosts[i];
      if (!g) {
        g = new Soldier(this.scene, 'E' + (i + 1));
        g.noRespawn = true; g.netId = i;
        this.ghosts[i] = g;
      }
      g._netTarget = { x, y, z, yaw, hp, alive: !!alive, mv: !!mv };
    }
    this.onEvent('snapScore', d.scoreB);
  }

  // 加入者：驅動敵人殘影（在 main 迴圈呼叫）
  updateGhosts(dt) {
    for (const g of this.ghosts) {
      if (!g || !g._netTarget) continue;
      const T = g._netTarget;
      const lerp = Math.min(1, dt * 10);
      g.pos.x += (T.x - g.pos.x) * lerp;
      g.pos.z += (T.z - g.pos.z) * lerp;
      let dy = T.yaw - g.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      g.yaw += dy * lerp;
      g.hp = T.hp;
      if (!T.alive && g.state !== 'dead') { g.state = 'dead'; g.deadT = 0; g._fallDir = Math.random() < .5 ? 1 : -1; }
      if (g.state === 'dead') {
        g.deadT += dt;
        const t = Math.min(1, g.deadT / 0.35);
        g.group.rotation.z = t * Math.PI / 2 * g._fallDir;
        g.group.position.y = -t * 0.25;
        if (g.deadT > 2.2) g.group.visible = false;
        if (T.alive) {   // 房主端已重生
          g.state = 'patrol'; g.deadT = 0; g.group.visible = true;
          g.group.rotation.set(0, 0, 0); g.group.position.y = 0;
          g.pos.set(T.x, 0, T.z);
        }
      } else {
        g.moving = T.mv;
        if (g.moving) {
          g.walkPh += dt * 9;
          g.legL.rotation.x = Math.sin(g.walkPh) * 0.55;
          g.legR.rotation.x = -Math.sin(g.walkPh) * 0.55;
        } else { g.legL.rotation.x *= 0.8; g.legR.rotation.x *= 0.8; }
        g.armL.rotation.x = -1.05; g.armR.rotation.x = -1.05;
      }
      if (g.state !== 'dead') g._sync();
      else { g.group.position.x = g.pos.x; g.group.position.z = g.pos.z; }
      if (g._lodMesh) g._lodMesh.visible = false;   // 殘影不用 LOD
    }
  }

  // 加入者：本地命中偵測（對殘影）
  hitTestGhosts(origin, dir, maxDist) {
    const meshes = [];
    for (const g of this.ghosts) {
      if (!g || g.state === 'dead') continue;
      meshes.push(...g.hitMeshes);
    }
    if (!meshes.length) return null;
    this._ray.set(origin, dir);
    this._ray.far = maxDist;
    const hits = this._ray.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const h = hits[0];
    return { t: h.distance, soldier: h.object.userData.soldier, part: h.object.userData.part, point: h.point };
  }

  clearGhosts() {
    for (const g of this.ghosts) if (g) { this.scene.remove(g.group); this.scene.remove(g._lodMesh); }
    this.ghosts.length = 0;
  }

  // ---------- 加入者：敵方子彈視覺（無傷害，傷害由房主 dmg 事件送達）----------
  _spawnVBolt(d) {
    const head = new THREE.Sprite(new THREE.SpriteMaterial({
      color: new THREE.Color(2.4, 1.1, 0.4), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    head.scale.setScalar(0.1);
    head.position.set(d.o[0], d.o[1], d.o[2]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: d.boss ? 0xffd040 : 0xff8a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending
    }));
    this.scene.add(head, line);
    this.vshots.push({ head, line, vel: new THREE.Vector3(d.d[0], d.d[1], d.d[2]).multiplyScalar(d.speed), life: 1.4 });
  }

  updateVShots(dt) {
    for (let i = this.vshots.length - 1; i >= 0; i--) {
      const b = this.vshots[i];
      b.head.position.addScaledVector(b.vel, dt);
      const p = b.head.position;
      const arr = b.line.geometry.attributes.position.array;
      arr[0] = p.x - b.vel.x * 0.055; arr[1] = p.y - b.vel.y * 0.055; arr[2] = p.z - b.vel.z * 0.055;
      arr[3] = p.x; arr[4] = p.y; arr[5] = p.z;
      b.line.geometry.attributes.position.needsUpdate = true;
      b.life -= dt;
      if (b.life <= 0 || p.y <= 0.02) {
        this.scene.remove(b.head, b.line);
        b.line.geometry.dispose();
        this.vshots.splice(i, 1);
      }
    }
  }

  // ---------- 手雷視覺同步 ----------
  _spawnVNade(o, dir) {
    const mesh = new THREE.Mesh(this._nadeGeo, this._nadeMat);
    mesh.position.set(o[0], o[1], o[2]);
    this.scene.add(mesh);
    this.vnades.push({ mesh, vel: new THREE.Vector3(dir[0], dir[1], dir[2]).multiplyScalar(16).add(new THREE.Vector3(0, 3.5, 0)), fuse: 2.5 });
  }

  updateVNades(dt, onBoom) {
    for (let i = this.vnades.length - 1; i >= 0; i--) {
      const n = this.vnades[i];
      n.vel.y -= 13 * dt;
      n.mesh.position.addScaledVector(n.vel, dt);
      if (n.mesh.position.y < 0.09) {
        n.mesh.position.y = 0.09;
        n.vel.y = Math.abs(n.vel.y) * 0.42;
        n.vel.x *= 0.75; n.vel.z *= 0.75;
      }
      n.fuse -= dt;
      if (n.fuse <= 0) {
        onBoom && onBoom(n.mesh.position.clone());
        this.scene.remove(n.mesh);
        this.vnades.splice(i, 1);
      }
    }
  }

  // ---------- 每幀（雙方）----------
  update(dt, onBoom) {
    this.updateAvatars(dt);
    this.updateVShots(dt);
    this.updateVNades(dt, onBoom);
  }
}
