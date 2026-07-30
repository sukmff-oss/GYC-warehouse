// =============================================================
// post.js — 優化版後處理管線
// 根據畫質設定動態調整效果強度
// =============================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { perf } from './performance-config.js';

// 電影級調色：暈影 + 膠片顆粒 + 輕色差 + 暖色高光
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    vigStrength: { value: 0.36 },
    grainStrength: { value: 0.032 },
    aberration: { value: 0.0006 },
    saturation: { value: 1.08 },
    lift: { value: 0.012 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float time, vigStrength, grainStrength, aberration, saturation, lift;
    varying vec2 vUv;
    // 無 sin 雜訊（sin-hash 在大座標下精度崩壞會產生條紋）
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * aberration * (0.2 + r2 * 2.2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(lum), col, saturation);
      col += vec3(lift, lift * 0.7, lift * 0.3);
      float vig = 1.0 - vigStrength * smoothstep(0.12, 0.72, r2);
      col *= vig;
      col += (hash(uv * vec2(1920.0, 1080.0) + mod(time, 128.0) * 61.7) - 0.5) * grainStrength;
      gl_FragColor = vec4(col, 1.0);
    }
  `
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.settings = perf.settings;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    
    // 如果畫質設定關閉後處理，直接走原生渲染
    if (!this.settings.postFX) {
      this.composer = null;
      return;
    }

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // Bloom — 根據畫質調整解析度
    if (this.settings.bloom) {
      const bloomRes = this.settings.textureQuality === 'low' ? 4 : 2;
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(innerWidth / bloomRes, innerHeight / bloomRes),
        0.3, 0.35, 1.0
      );
      this.composer.addPass(this.bloom);
    }

    // Motion Blur — 可選
    if (this.settings.motionBlur) {
      this.motion = new AfterimagePass(0.3);
      this.composer.addPass(this.motion);
    }

    // Film 調色 — 可選顆粒
    if (this.settings.filmGrain) {
      this.film = new ShaderPass(FilmShader);
      this.composer.addPass(this.film);
    } else {
      // 簡化版：只有暈影和飽和度，無顆粒
      this.film = new ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
          vigStrength: { value: 0.3 },
          saturation: { value: 1.05 },
        },
        vertexShader: FilmShader.vertexShader,
        fragmentShader: /* glsl */`
          uniform sampler2D tDiffuse;
          uniform float vigStrength, saturation;
          varying vec2 vUv;
          void main() {
            vec3 col = texture2D(tDiffuse, vUv).rgb;
            float lum = dot(col, vec3(0.299, 0.587, 0.114));
            col = mix(vec3(lum), col, saturation);
            vec2 d = vUv - 0.5;
            float vig = 1.0 - vigStrength * smoothstep(0.12, 0.72, dot(d, d));
            gl_FragColor = vec4(col * vig, 1.0);
          }
        `
      });
      this.composer.addPass(this.film);
    }

    this.composer.addPass(new OutputPass());
  }

  setSize(w, h) {
    if (this.composer) this.composer.setSize(w, h);
  }

  render(dt, speed = 0, now = 0) {
    if (!this.composer) {
      // 無後處理模式：直接渲染
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.settings.motionBlur && this.motion) {
      const target = 0.28 + Math.min(1, speed / 9) * 0.5;
      this.motion.uniforms.damp.value += (target - this.motion.uniforms.damp.value) * Math.min(1, dt * 6);
    }
    if (this.film) {
      this.film.uniforms.time.value = now;
    }
    this.composer.render();
  }
}
