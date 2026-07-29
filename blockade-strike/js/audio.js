// ============ 音效系统（WebAudio 合成，无外部资源） ============

class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this._noiseBuf = null;
    this._lastVoice = 0;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      // 预生成噪声缓冲
      const len = this.ctx.sampleRate * 1.2;
      this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  get ok() { return !!this.ctx; }
  get t() { return this.ctx.currentTime; }

  _gain(v, t0) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(v, t0);
    g.connect(this.master);
    return g;
  }

  _noise(t0, dur, { vol = 0.5, freq = 1200, q = 0.8, type = 'lowpass', decay = null } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    const g = this._gain(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (decay || dur));
    src.connect(f); f.connect(g);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  _tone(t0, dur, { freq = 440, freqEnd = null, vol = 0.3, type = 'sine' } = {}) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    const g = this._gain(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // ---------- 枪械 ----------
  shot(dist = 0) {
    if (!this.ok) return;
    const att = 1 / (1 + dist * 0.06);       // 距离衰减
    const t0 = this.t;
    this._noise(t0, 0.14, { vol: 0.5 * att, freq: 900, type: 'lowpass', decay: 0.12 });
    this._tone(t0, 0.08, { freq: 160, freqEnd: 60, vol: 0.35 * att, type: 'triangle' });
  }

  sniperShot() {
    if (!this.ok) return;
    const t0 = this.t;
    this._noise(t0, 0.35, { vol: 0.7, freq: 700, decay: 0.3 });
    this._tone(t0, 0.22, { freq: 120, freqEnd: 38, vol: 0.5, type: 'triangle' });
    this._noise(t0 + 0.05, 0.4, { vol: 0.18, freq: 300, decay: 0.38 }); // 尾音
  }

  reload() {
    if (!this.ok) return;
    const t0 = this.t;
    this._tone(t0, 0.05, { freq: 900, freqEnd: 500, vol: 0.16, type: 'square' });
    this._tone(t0 + 0.16, 0.05, { freq: 700, freqEnd: 400, vol: 0.14, type: 'square' });
    this._tone(t0 + 0.38, 0.06, { freq: 1200, freqEnd: 800, vol: 0.18, type: 'square' });
  }

  ricochet() {
    if (!this.ok) return;
    const t0 = this.t;
    this._tone(t0, 0.22, { freq: 2800 + Math.random() * 800, freqEnd: 900, vol: 0.12, type: 'sine' });
  }

  whizz() {
    if (!this.ok) return;
    const t0 = this.t;
    this._noise(t0, 0.16, { vol: 0.16, freq: 3800, q: 6, type: 'bandpass', decay: 0.15 });
  }

  // ---------- 玩家 ----------
  step() {
    if (!this.ok) return;
    this._noise(this.t, 0.07, { vol: 0.1, freq: 300, decay: 0.06 });
  }

  hurt() {
    if (!this.ok) return;
    const t0 = this.t;
    this._tone(t0, 0.16, { freq: 220, freqEnd: 110, vol: 0.3, type: 'sawtooth' });
    this._noise(t0, 0.1, { vol: 0.14, freq: 500, decay: 0.09 });
  }

  // ---------- 爆炸 ----------
  boom(dist = 0) {
    if (!this.ok) return;
    const att = 1 / (1 + dist * 0.045);
    const t0 = this.t;
    this._noise(t0, 0.8, { vol: 0.9 * att, freq: 260, decay: 0.7 });
    this._tone(t0, 0.5, { freq: 90, freqEnd: 28, vol: 0.6 * att, type: 'sine' });
    this._noise(t0 + 0.02, 0.25, { vol: 0.4 * att, freq: 2000, decay: 0.2 });
  }

  // ---------- 反馈 ----------
  hit() {
    if (!this.ok) return;
    this._tone(this.t, 0.05, { freq: 1500, freqEnd: 1100, vol: 0.16, type: 'square' });
  }

  kill() {
    if (!this.ok) return;
    const t0 = this.t;
    this._tone(t0, 0.07, { freq: 880, vol: 0.18, type: 'sine' });
    this._tone(t0 + 0.07, 0.1, { freq: 1320, vol: 0.18, type: 'sine' });
  }

  plant() {
    if (!this.ok) return;
    const t0 = this.t;
    for (let i = 0; i < 3; i++)
      this._tone(t0 + i * 0.12, 0.06, { freq: 1050, vol: 0.16, type: 'square' });
  }

  beep(urgent = false) {
    if (!this.ok) return;
    this._tone(this.t, urgent ? 0.09 : 0.06, { freq: urgent ? 1600 : 1200, vol: 0.2, type: 'square' });
  }

  // ---------- 语音播报（语音合成 + 提示音兜底） ----------
  voice(name) {
    const lines = {
      firstblood: 'First blood',
      headshot: 'Headshot',
      double: 'Double kill',
      triple: 'Triple kill',
      rampage: 'Rampage',
      eliminated: 'Enemy eliminated',
      victory: 'Victory',
    };
    const text = lines[name] || name;
    const nowT = performance.now();
    if (nowT - this._lastVoice < 350) return;   // 防止连发重叠
    this._lastVoice = nowT;
    // 提示音层
    if (this.ok) {
      const t0 = this.t;
      this._tone(t0, 0.1, { freq: 660, vol: 0.14, type: 'sine' });
      this._tone(t0 + 0.09, 0.16, { freq: 990, vol: 0.14, type: 'sine' });
    }
    try {
      if (!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 1.05; u.pitch = 0.9; u.volume = 0.8;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) { /* 忽略语音失败 */ }
  }
}

export const audio = new AudioSys();
