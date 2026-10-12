/**
 * 程序化音效（Web Audio，零素材、零下载）。
 *
 * 设计原则：全部用振荡器 + 噪声实时合成。
 * 其中「时停」是本作机制收益最大的一条：时钟停摆音 → 全场静音 → 破钟重击。
 * 这一段静默比任何音效都值钱，因为玩家会立刻意识到"我的回合没了"。
 *
 * 浏览器要求首次用户交互后才能启动 AudioContext，故有 unlock()。
 */

let ctx = null;
let master = null;
let limiter = null;
let muted = false;
let unlocked = false;
const BASE_GAIN = 0.92;   // 100% 音量时的总线增益（音效再调大过一档）
let volume = 1;           // 0~1，主界面音量滑杆写入

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = BASE_GAIN * volume;
  // 音效整体调大后，多个音叠加时峰值会顶到 0dB 以上；用一条温和的限制器压峰，
  // 保证"更响"而不是"更破"。阈值只压峰值段，正常音量下几乎听不出变化。
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter).connect(ctx.destination);
  return ctx;
}

/** 首次交互调用：解锁音频。 */
export function unlockAudio() {
  const c = ensure();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  unlocked = true;
}

/** 主界面音量滑杆：0~1，同时作用于全部音效。 */
export function setVolume(value) {
  volume = Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 1));
  if (master) master.gain.value = muted ? 0 : BASE_GAIN * volume;
  return volume;
}

export function getVolume() { return volume; }

export function isMuted() { return muted; }

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : BASE_GAIN * volume;
  return muted;
}

/* ------------------------------------------------------------ 基元 */

function env(node, t0, attack, decay, peak = 1, sustain = 0) {
  const g = node.gain;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  if (sustain > 0) {
    g.setValueAtTime(Math.max(0.0002, peak), t0 + attack + sustain);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + sustain + decay);
  } else {
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }
}

function tone({ type = "square", f0 = 440, f1 = null, dur = 0.09, gain = 0.3, delay = 0, attack = 0.004, detune = 0 } = {}) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  if (f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  if (detune) osc.detune.value = detune;
  env(g, t0, attack, dur, gain);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + attack + 0.05);
}

let noiseBuf = null;
function noise(dur = 0.2, gain = 0.3, delay = 0, filter = null, q = 1) {
  if (!ctx || muted) return;
  if (!noiseBuf) {
    const n = Math.floor(ctx.sampleRate * 0.6);
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x7fffffff) * 2 - 1;
    }
  }
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const g = ctx.createGain();
  let node = src;
  if (filter) {
    const bq = ctx.createBiquadFilter();
    bq.type = filter;
    bq.frequency.setValueAtTime(filter === "lowpass" ? 1400 : 2600, t0);
    bq.Q.value = q;
    node.connect(bq);
    node = bq;
  }
  env(g, t0, 0.002, dur, gain, dur * 0.35);
  node.connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.12);
}

/* ------------------------------------------------------------ 事件音 */

/** UI 点击：清脆短促。 */
export function sfxClick() {
  if (!ensure()) return;
  tone({ type: "triangle", f0: 980, f1: 620, dur: 0.05, gain: 0.18 });
}

/** 移动：低频踏步 + 轻微摩擦。 */
export function sfxMove() {
  if (!ensure()) return;
  tone({ type: "sine", f0: 200, f1: 120, dur: 0.09, gain: 0.22 });
  noise(0.06, 0.10, 0, "lowpass", 1);
}

/** 命中：噪声冲击 + 低频下坠，要有"打实了"的感觉。 */
export function sfxHit(power = 1) {
  if (!ensure()) return;
  noise(0.14, 0.34 * power, 0, "lowpass", 0.8);
  tone({ type: "square", f0: 260 * power, f1: 55, dur: 0.13, gain: 0.26 * power });
}

/** 技能释放：上行扫频。 */
export function sfxSkill() {
  if (!ensure()) return;
  tone({ type: "sawtooth", f0: 320, f1: 1100, dur: 0.16, gain: 0.16 });
  tone({ type: "triangle", f0: 640, f1: 1500, dur: 0.13, gain: 0.11, delay: 0.02 });
}

/** 大招：厚重冲击 + 碎音。 */
export function sfxUltimate() {
  if (!ensure()) return;
  tone({ type: "sawtooth", f0: 90, f1: 40, dur: 0.5, gain: 0.34 });
  noise(0.42, 0.30, 0, "lowpass", 0.7);
  for (let i = 0; i < 8; i++) {
    tone({ type: "square", f0: 700 + i * 190, f1: 300, dur: 0.05, gain: 0.10, delay: 0.05 + i * 0.035 });
  }
}

/** 回合切换：两音提示，上行=你的回合，下行=对手回合。 */
export function sfxTurn(mine) {
  if (!ensure()) return;
  const a = mine ? 620 : 520;
  const b = mine ? 930 : 350;
  tone({ type: "triangle", f0: a, dur: 0.09, gain: 0.20 });
  tone({ type: "triangle", f0: b, dur: 0.14, gain: 0.20, delay: 0.09 });
}

/**
 * 时停：时钟停摆 → 静音 → 破钟。
 * 静默段是设计的核心，不要用任何音效填充。
 */
export function sfxTimeStop() {
  if (!ensure()) return;
  // 1) 时钟滴答突然被拉慢
  for (let i = 0; i < 6; i++) {
    const stretch = 1 + i * 0.55;
    noise(0.02, 0.20, i * 0.1 * stretch, "bandpass", 6);
  }
  // 2) 下行滑音"沉入静止"
  tone({ type: "sine", f0: 1400, f1: 60, dur: 1.0, gain: 0.24, delay: 0.6 });
  tone({ type: "sawtooth", f0: 700, f1: 30, dur: 1.1, gain: 0.14, delay: 0.62, detune: 12 });
  // 3) 静默后破钟重击
  const at = 1.75;
  tone({ type: "square", f0: 130, f1: 45, dur: 0.4, gain: 0.34, delay: at });
  noise(0.34, 0.30, at, "bandpass", 1.4);
  tone({ type: "triangle", f0: 1760, f1: 900, dur: 0.5, gain: 0.12, delay: at + 0.02 });
}

/** 胜负：胜利上行，失败下行。 */
export function sfxResult(win) {
  if (!ensure()) return;
  const notes = win ? [523, 659, 784, 1047] : [523, 466, 392, 294];
  notes.forEach((f, i) =>
    tone({ type: "triangle", f0: f, dur: 0.30, gain: 0.22, delay: i * 0.13 })
  );
}

/** 治疗：柔和上行。 */
export function sfxHeal() {
  if (!ensure()) return;
  [660, 880, 1180].forEach((f, i) =>
    tone({ type: "sine", f0: f, f1: f * 1.05, dur: 0.22, gain: 0.18, delay: i * 0.07 })
  );
}

/** 踩到危险地形。 */
export function sfxHazard() {
  if (!ensure()) return;
  tone({ type: "sawtooth", f0: 180, f1: 70, dur: 0.24, gain: 0.24 });
  noise(0.2, 0.16, 0, "lowpass", 1);
}

/* ------------------------------------------------------------ 角色技能专属音 */
/* 全部现场合成，不依赖任何音频文件，也不会引入有版权的素材。 */

/** 欧拉欧拉：起手重击（沿用大招音）→ 连打 → 收尾重拳。 */
export function sfxOra() {
  if (!ensure()) return;
  sfxUltimate();
  const step = 0.042;
  for (let i = 0; i < 14; i++) {
    const at = 0.3 + i * step;
    noise(0.05, 0.13, at, "bandpass", 1.2);
    tone({ type: "square", f0: 300 + (i % 3) * 45, f1: 90, dur: 0.05, gain: 0.13, delay: at });
  }
  const end = 0.3 + 14 * step + 0.05;
  tone({ type: "sawtooth", f0: 150, f1: 45, dur: 0.3, gain: 0.3, delay: end });
  noise(0.24, 0.28, end, "lowpass", 0.8);
}

/** 流星指刺：极短高频突刺 + 金属余音。 */
export function sfxStar() {
  if (!ensure()) return;
  tone({ type: "triangle", f0: 2600, f1: 3400, dur: 0.05, gain: 0.16 });
  noise(0.05, 0.18, 0, "bandpass", 9);
  tone({ type: "sine", f0: 3300, dur: 0.34, gain: 0.07, delay: 0.01 });
}

/** 吸血：低频下坠吸取 + 两次吞咽。 */
export function sfxDrain() {
  if (!ensure()) return;
  tone({ type: "sawtooth", f0: 260, f1: 70, dur: 0.45, gain: 0.2 });
  noise(0.4, 0.14, 0, "lowpass", 0.9);
  [0.26, 0.46].forEach((at, i) => tone({ type: "sine", f0: 200 - i * 40, f1: 90, dur: 0.16, gain: 0.2, delay: at }));
}

/** 绿宝石：晶体清脆琶音。 */
export function sfxEmerald() {
  if (!ensure()) return;
  [1760, 2349, 2794, 3520].forEach((f, i) => tone({ type: "sine", f0: f, dur: 0.3, gain: 0.11, delay: i * 0.035 }));
  noise(0.2, 0.1, 0, "bandpass", 10);
}

/** 绿宝石水花：晶体爆发 + 冲击余波。 */
export function sfxSplash() {
  if (!ensure()) return;
  tone({ type: "sawtooth", f0: 700, f1: 120, dur: 0.3, gain: 0.22 });
  noise(0.5, 0.26, 0.02, "bandpass", 3);
  [1760, 2093, 2637, 3136, 3951].forEach((f, i) =>
    tone({ type: "sine", f0: f, dur: 0.42, gain: 0.12, delay: 0.03 + i * 0.05 }));
  tone({ type: "square", f0: 200, f1: 60, dur: 0.26, gain: 0.26, delay: 0.16 });
}

/** 火焰道路：火舌窜起 + 噼啪燃烧。 */
export function sfxFlame() {
  if (!ensure()) return;
  tone({ type: "sawtooth", f0: 120, f1: 520, dur: 0.5, gain: 0.18 });
  noise(0.6, 0.22, 0, "lowpass", 0.8);
  for (let i = 0; i < 7; i++) noise(0.03, 0.1, 0.08 + i * 0.07, "bandpass", 5 + i);
}

/** 涅槃：低音钟 + 上行圣咏，用于清火与回复。 */
export function sfxNirvana() {
  if (!ensure()) return;
  tone({ type: "sine", f0: 110, f1: 82, dur: 1.2, gain: 0.28 });
  noise(0.9, 0.1, 0, "lowpass", 0.7);
  [660, 880, 1174, 1568].forEach((f, i) =>
    tone({ type: "triangle", f0: f, dur: 0.5, gain: 0.13, delay: 0.1 + i * 0.11 }));
}

/** 发射剑刃：出鞘金属声 + 剑风 + 长余音。 */
export function sfxBlade() {
  if (!ensure()) return;
  noise(0.07, 0.24, 0, "bandpass", 12);
  tone({ type: "triangle", f0: 2200, f1: 3200, dur: 0.06, gain: 0.14 });
  tone({ type: "sawtooth", f0: 1600, f1: 180, dur: 0.4, gain: 0.16, delay: 0.05 });
  tone({ type: "sine", f0: 2800, dur: 0.5, gain: 0.07, delay: 0.06 });
}

/** 装甲／卸甲：甲片扣合（升调）或脱落（降调）。 */
export function sfxArmor(wearing = false) {
  if (!ensure()) return;
  const steps = wearing ? [220, 300, 420] : [420, 300, 205];
  steps.forEach((f, i) => {
    const at = i * 0.11;
    noise(0.07, 0.22, at, "bandpass", 4);
    tone({ type: "square", f0: f, f1: f * 0.6, dur: 0.1, gain: 0.18, delay: at });
    tone({ type: "sine", f0: f * 6, dur: 0.22, gain: 0.05, delay: at });
  });
}

/** 危险预感：低音脉动，残血回合开始时用。 */
export function sfxMenacing() {
  if (!ensure()) return;
  for (let i = 0; i < 5; i++) {
    const at = i * 0.28;
    tone({ type: "sine", f0: 62 + i * 3, f1: 48, dur: 0.24, gain: 0.22, delay: at });
    tone({ type: "triangle", f0: 124, f1: 96, dur: 0.2, gain: 0.08, delay: at + 0.02 });
  }
  noise(1.3, 0.07, 0, "lowpass", 0.7);
}

/** 时间恢复：上行回升 + 钟表重新走动。 */
export function sfxTimeResume() {
  if (!ensure()) return;
  tone({ type: "sine", f0: 70, f1: 1300, dur: 0.7, gain: 0.2 });
  for (let i = 0; i < 8; i++) noise(0.02, 0.16, 0.5 + i * (0.09 - i * 0.005), "bandpass", 7);
  tone({ type: "triangle", f0: 900, f1: 1500, dur: 0.4, gain: 0.12, delay: 1.1 });
}

/** 藤蔓缠绕：破空一鞭 + 缠住后的簌簌声。 */
export function sfxVine() {
  if (!ensure()) return;
  noise(0.12, 0.2, 0, "bandpass", 2);
  tone({ type: "triangle", f0: 900, f1: 240, dur: 0.16, gain: 0.14 });
  for (let i = 0; i < 5; i++) noise(0.04, 0.09, 0.12 + i * 0.05, "bandpass", 6);
}

/** 波纹疾走：明亮的上行波 + 金色余韵。 */
export function sfxHamon() {
  if (!ensure()) return;
  tone({ type: "sine", f0: 420, f1: 1600, dur: 0.34, gain: 0.2 });
  tone({ type: "triangle", f0: 840, f1: 2400, dur: 0.3, gain: 0.12, delay: 0.04 });
  noise(0.24, 0.14, 0.02, "bandpass", 5);
  [1568, 2093, 3136].forEach((f, i) => tone({ type: "sine", f0: f, dur: 0.4, gain: 0.08, delay: 0.12 + i * 0.06 }));
}

/** 预判成功：两声轻巧的「我就知道」。 */
export function sfxPredict() {
  if (!ensure()) return;
  tone({ type: "triangle", f0: 1046, dur: 0.09, gain: 0.18 });
  tone({ type: "triangle", f0: 1568, dur: 0.16, gain: 0.16, delay: 0.09 });
}
