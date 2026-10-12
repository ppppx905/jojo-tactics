/**
 * 背景音乐：主界面（选人与结算）循环播放播放列表；战斗中任一方残血时切换成危急曲。
 *
 * 音乐文件放在 assets/out/audio/ 下，并**随发布包一起分发**——2026-09-12 起改为包含音乐
 * （用户要求；此前是刻意排除的，见《开发交接文档》§4「发布包」一节）。
 * 文件不存在、格式浏览器不支持、或用户还没交互过（浏览器禁止自动播放）时，
 * 全部静默降级：不报错、不阻塞，游戏照常运行，主界面会给出可读的提示。
 *
 * 每首曲子带独立 gain：<audio> 的音量上限是 1.0，想突出某一首就压低别的，
 * 或者整体抬 BGM_SCALE——两者都在这里集中调，改一处即可。
 */

const TRACKS = [
  { id: 'setting-off', label: 'Setting Off', url: 'assets/out/audio/menu-1-setting-off.m4a', gain: 1 },
  { id: 'stand-proud', label: 'Stand Proud', url: 'assets/out/audio/menu-2-stand-proud.m4a', gain: 0.34 },
];
// 残血曲（Danger）：用户 2026-09-15 要求「音量调小」——它会在残血期间**循环播放**，
// 原来 gain 0.4（默认滑杆下约 25%）偏吵，现在减半到 0.2（约 12.5%），比 Stand Proud 还轻。
const DANGER = [{ url: 'assets/out/audio/danger-battle-start.m4a', gain: 0.2 }];

/** 主界面音乐模式：自动轮流 / 固定某一首 / 关闭主界面音乐（战斗危急曲仍保留）。 */
export const MODES = ['auto', 'setting-off', 'stand-proud', 'off'];
const MODE_LABELS = { auto: '自动轮流', 'setting-off': 'Setting Off', 'stand-proud': 'Stand Proud', off: '已关闭' };

// 音乐整体档位。<audio> 音量上限是 1，所以 Setting Off 靠「整体抬高 + 压低其它两首」来突出。
// 默认 80% 滑杆下的实际音量：Setting Off ≈ 0.62、Stand Proud ≈ 0.21、危急曲 ≈ 0.125。
const BGM_SCALE = 0.78;

let volume = 0.8;
let enabled = true;
let scene = null;          // 'menu' | 'danger' | null
let node = null;           // 当前 <audio>
let current = null;        // 当前曲目（带动自己的 gain）
let failed = new Set();    // 播不出来的文件，之后不再重试
let ready = false;         // 用户交互过、允许播放
let fadeTimer = null;
let mode = 'auto';
let onState = null;

const clamp = v => Math.max(0, Math.min(1, Number.isFinite(Number(v)) ? Number(v) : 0));
const canPlay = () => typeof window !== 'undefined' && typeof window.Audio === 'function';

/** 某首曲子在当前滑杆下的实际音量（0~1）。 */
export const levelOf = entry => clamp(volume) * BGM_SCALE * clamp(entry?.gain ?? 1);

/** 各曲目当前的实际音量（以文件名为键），便于主界面显示与测试核对。 */
export function levels() {
  return Object.fromEntries([...TRACKS, ...DANGER].map(t => [t.url.split('/').pop(), Number(levelOf(t).toFixed(3))]));
}

/** 当前模式下的主界面播放列表；'off' 返回空列表表示不播。 */
function menuList() {
  if (mode === 'off') return [];
  return TRACKS.filter(track => mode === 'auto' || track.id === mode);
}

export function menuModeLabel() { return MODE_LABELS[mode] || MODE_LABELS.auto; }

/** 切换主界面音乐；正在播主界面音乐会立刻换成新选择。 */
export function setBgmTrack(next) {
  const wanted = MODES.includes(next) ? next : 'auto';
  if (wanted === mode) return mode;
  mode = wanted;
  if (scene === 'menu') {
    scene = null;               // 强制按新列表重取
    playBgm('menu');
  }
  notify();
  return mode;
}

function pick(list) { return list.find(entry => !failed.has(entry.url)) || null; }

function fadeTo(target, ms = 500) {
  if (!node) return;
  clearInterval(fadeTimer);
  const from = node.volume, steps = Math.max(1, Math.round(ms / 40));
  let step = 0;
  fadeTimer = setInterval(() => {
    step++;
    if (!node) { clearInterval(fadeTimer); return; }
    node.volume = clamp(from + (target - from) * (step / steps));
    if (step >= steps) {
      clearInterval(fadeTimer);
      if (target === 0) { node.pause(); node.src = ''; node = null; current = null; }
    }
  }, 40);
}

function start(entry, list) {
  const audio = new window.Audio(entry.url);
  audio.preload = 'auto';
  audio.loop = list.length === 1;        // 单曲（危急曲或锁定单曲）直接循环，多曲播完自动下一首
  audio.volume = 0;
  audio.addEventListener('ended', () => { if (scene) start(pick(list) || entry, list); });
  audio.addEventListener('error', () => {
    failed.add(entry.url);
    notify();
    if (node === audio) {
      node = null; current = null;
      const next = pick(list);
      if (next) start(next, list); else notify();
    }
  });
  node = audio;
  current = entry;
  const playing = audio.play();
  if (playing && typeof playing.catch === 'function') playing.catch(() => { if (node === audio) { node = null; current = null; } notify(); });
  fadeTo(levelOf(entry), 600);
  notify();
}

function notify() { if (typeof onState === 'function') onState(status()); }

/** 当前状态，供主界面显示"音乐是否正常"。 */
export function status() {
  return { scene, mode, volume, scale: BGM_SCALE, levels: levels(), enabled, ready,
    playing: !!node && !node.paused, unavailable: failed.size > 0 };
}

export function onStatus(fn) { onState = fn; notify(); }

export function setBgmVolume(value) {
  volume = clamp(value);
  if (node && current) node.volume = levelOf(current);
  notify();
}

export function setBgmEnabled(on) {
  enabled = !!on;
  if (!enabled) halt();                    // 只停声音，保留「目标场景」，重新开启能接着播
  else if (scene && !node) playBgm(scene);
  notify();
}

/** 只停声音，不动「目标场景」——这样用户交互解锁后还能自动接上。 */
function halt() {
  clearInterval(fadeTimer);
  if (node) {
    const old = node;
    node = null;
    current = null;
    try { old.volume = 0; old.pause(); } catch { /* 已经没了 */ }
  }
  notify();
}

/** 切换场景：'menu' 主界面播放列表，'danger' 残血曲，null 停止。 */
export function playBgm(next) {
  if (next === scene && node) return;
  scene = next;
  halt();
  if (!enabled || !ready || !canPlay() || !next) { notify(); return; }
  const list = next === 'menu' ? menuList() : DANGER;
  if (!list.length) { notify(); return; }   // 主界面音乐选「已关闭」
  const entry = pick(list);
  if (entry) start(entry, list); else notify();
}

export function stopBgm() {
  scene = null;
  halt();
}

/** 首次用户交互后调用：浏览器只允许在交互后自动播放。 */
export function unlockBgm() {
  ready = true;
  if (scene && !node) playBgm(scene); else notify();
}
