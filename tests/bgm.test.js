/**
 * 背景音乐模块的回归：在没有浏览器的环境里必须安全降级，
 * 音量必须被夹在 0~1，关掉音乐后目标场景要保留（重新打开能接着播）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as bgm from '../src/ui/bgm.js';
import { Game, FIGHTERS } from '../src/core/game.js';

test('bgm 在没有浏览器（无 window.Audio）时安全降级，不抛错', () => {
  for (const fn of ['playBgm', 'stopBgm', 'unlockBgm', 'setBgmVolume', 'setBgmEnabled', 'onStatus', 'status']) {
    assert.equal(typeof bgm[fn], 'function', `${fn} 应导出`);
  }
  assert.doesNotThrow(() => bgm.playBgm('menu'));
  assert.doesNotThrow(() => bgm.unlockBgm());
  assert.equal(bgm.status().playing, false, '拿不到 Audio 就不播，但状态可读');
});

test('音量夹在 0~1，并能从 status 读回', () => {
  bgm.setBgmVolume(1.7); assert.equal(bgm.status().volume, 1);
  bgm.setBgmVolume(-0.4); assert.equal(bgm.status().volume, 0);
  bgm.setBgmVolume('0.3'); assert.equal(bgm.status().volume, 0.3, '字符串数字也能接受');
  bgm.setBgmVolume(NaN); assert.equal(bgm.status().volume, 0);
  bgm.setBgmVolume(0.5); assert.equal(bgm.status().volume, 0.5);
});

test('关闭音乐时保留目标场景，重新开启会按该场景恢复', () => {
  bgm.setBgmEnabled(true);
  bgm.playBgm('danger');
  assert.equal(bgm.status().scene, 'danger');
  bgm.setBgmEnabled(false);
  assert.equal(bgm.status().playing, false, '关闭后不播');
  assert.equal(bgm.status().scene, 'danger', '目标场景要保留');
  bgm.setBgmEnabled(true);
  assert.equal(bgm.status().scene, 'danger', '重新开启后仍记得该场景');
  bgm.stopBgm();
  assert.equal(bgm.status().scene, null, 'stopBgm 才清空场景');
});

test('状态回调会立刻收到一次当前状态（主界面靠它显示音乐是否正常）', () => {
  let received = null;
  bgm.onStatus(state => { received = state; });
  assert.ok(received && typeof received.volume === 'number', '订阅时应立即回调一次');
  assert.equal(typeof received.playing, 'boolean');
});

test('主界面音乐可在 自动 / Setting Off / Stand Proud / 关闭 之间切换', () => {
  assert.deepEqual(bgm.MODES, ['auto', 'setting-off', 'stand-proud', 'off']);
  assert.equal(bgm.setBgmTrack('stand-proud'), 'stand-proud');
  assert.equal(bgm.status().mode, 'stand-proud');
  assert.equal(bgm.menuModeLabel(), 'Stand Proud');
  assert.equal(bgm.setBgmTrack('off'), 'off');
  assert.equal(bgm.menuModeLabel(), '已关闭');
  // 非法值回落到自动，避免存档写坏导致音乐永远不响
  assert.equal(bgm.setBgmTrack('乱写的值'), 'auto');
  assert.equal(bgm.status().mode, 'auto');
  assert.equal(typeof bgm.menuModeLabel(), 'string');
});

test('Setting Off 明显比另外两首响，且所有曲目音量都在 0~1 内', () => {
  bgm.setBgmVolume(0.8);
  const levels = bgm.levels();
  const [settingOff, standProud, danger] = [levels['menu-1-setting-off.m4a'], levels['menu-2-stand-proud.m4a'], levels['danger-battle-start.m4a']];
  assert.ok(settingOff > standProud * 1.5, `Setting Off(${settingOff}) 应明显比 Stand Proud(${standProud}) 响`);
  assert.ok(settingOff > danger * 1.5, `Setting Off(${settingOff}) 应明显比危急曲(${danger}) 响`);
  for (const [name, value] of Object.entries(levels)) {
    assert.ok(value > 0 && value <= 1, `${name} 的音量 ${value} 应在 0~1 内`);
  }
  // 滑杆拉满时仍在安全范围内（<audio> 音量不能超过 1）
  bgm.setBgmVolume(1);
  for (const [name, value] of Object.entries(bgm.levels())) assert.ok(value <= 1, `${name} 在 100% 时不应超过 1`);
  bgm.setBgmVolume(0.8);
});

test('残血曲的音量调小了：比 Stand Proud 还轻，且 80% 滑杆下 ≤ 0.15', () => {
  bgm.setBgmVolume(0.8);
  const levels = bgm.levels();
  const standProud = levels['menu-2-stand-proud.m4a'], danger = levels['danger-battle-start.m4a'];
  assert.ok(danger < standProud, `残血曲(${danger}) 应比 Stand Proud(${standProud}) 轻`);
  assert.ok(danger <= 0.15, `残血曲在 80% 滑杆下应 ≤ 0.15，实际 ${danger}`);
  assert.ok(danger > 0, '调小不等于静音');
});

test('残血判定包含"正好一半"：20/40 也算残血（这是修的 bug）', () => {
  const g = new Game({ random: () => .5 });
  g.start('jotaro', 'dio');
  assert.equal(g.lowHealth(), false, '满血不算残血');

  g.s.hp.p1 = FIGHTERS.jotaro.hp / 2;                     // 正好一半
  assert.equal(g.lowHealth(), true, '★ 正好一半必须算残血（旧的 `< 0.5` 会漏掉，音乐就没了）');

  g.s.hp.p1 = FIGHTERS.jotaro.hp / 2 + 1;
  assert.equal(g.lowHealth(), false, '半血以上不算');

  g.s.hp.p1 = FIGHTERS.jotaro.hp;
  g.s.hp.p2 = FIGHTERS.dio.hp / 2;                        // 换对手残血
  assert.equal(g.lowHealth(), true, '任意一方残血都算');

  g.s.phase = 'result';
  assert.equal(g.lowHealth(), false, '结算阶段不该还判残血（要放回主界面音乐）');
});

test('危急曲每次重新掉到半血都会重新播放，不是只播一次', () => {
  const created = [];
  class FakeAudio {
    constructor(url) { this.url = url; this.volume = 0; this.loop = false; this.paused = true; this.listeners = {}; created.push(url); }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    set currentTime(_) {} get currentTime() { return 0; }
  }
  const hadWindow = 'window' in globalThis;
  const previous = globalThis.window;
  globalThis.window = { Audio: FakeAudio };
  try {
    bgm.stopBgm();
    bgm.setBgmEnabled(true);
    bgm.unlockBgm();
    const dangerPlays = () => created.filter(url => url.includes('danger')).length;

    bgm.playBgm('menu');                     // 满血
    assert.equal(dangerPlays(), 0);
    bgm.playBgm('danger');                   // 第一次掉半血
    assert.equal(dangerPlays(), 1, '第一次掉半血要响起危曲');
    bgm.playBgm('danger');                   // 同一残血状态重复刷新：不该重头播
    assert.equal(dangerPlays(), 1, '同一残血状态下重复刷新不应重播');
    bgm.playBgm('menu');                     // 治疗回到半血以上
    bgm.playBgm('danger');                   // 再次掉半血
    assert.equal(dangerPlays(), 2, '★ 再次掉到半血必须重新播放');
    bgm.playBgm('menu');
    bgm.playBgm('danger');
    assert.equal(dangerPlays(), 3, '★ 第三次掉半血也要重新播放');
  } finally {
    if (hadWindow) globalThis.window = previous; else delete globalThis.window;
    bgm.stopBgm();
  }
});
