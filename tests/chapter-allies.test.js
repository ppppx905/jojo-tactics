/**
 * 第八章「皇帝与吊死者」的地基（2026-10-03 第①步）：
 * **剧情章节可以自己写死两个角色位**——玩家侧多一个电脑控制的友军、敌方两个角色位。
 *
 * ⚠️ 第八章本身还没进 `STORY_CHAPTERS`（机制、数值、文本是后面几步的事），
 *    所以这里用一份**临时章节**验证引擎的能力，测完立刻从 `STORY_CHAPTERS` 里摘掉，不污染别的测试。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, STORY_CHAPTERS, FIGHTERS, teamOf } from '../src/core/game.js';

function seeded(seed = 42) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** 临时塞一个章节进去跑用例，finally 里摘掉（顺序与内容都不留下来）。 */
function withTempChapter(fields, run) {
  const chapter = { id: 'chapter-test-allies', label: '测试章', eyebrow: 'TEST', title: '测试章', ...fields };
  STORY_CHAPTERS.push(chapter);
  try { return run(chapter); }
  finally {
    const at = STORY_CHAPTERS.indexOf(chapter);
    if (at >= 0) STORY_CHAPTERS.splice(at, 1);
  }
}

test('★ 章节写死两个角色位：玩家侧友军（电脑）+ 敌方两个角色位，都能开局', () => {
  withTempChapter({ player: 'jotaro', enemy: 'dio', ally: 'kakyoin', enemy2: 'temperance' }, chapter => {
    const game = new Game({ random: seeded() });
    game.setRoster({ p1b: chapter.ally, p2b: chapter.enemy2, story: true });
    assert.equal(game.start('jotaro', 'dio', 'ai', { story: chapter.id }), true, '章节席位应当能开局');
    assert.deepEqual(game.s.slots, ['p1', 'p1b', 'p2', 'p2b'], '四个槽位');
    // 控制表交给引擎的剧情默认值：玩家侧第一个位子真人，**其余（含友军与两个敌人）全部人机**
    assert.deepEqual(game.s.control, { p1: 'human', p1b: 'ai', p2: 'ai', p2b: 'ai' });
    assert.equal(game.isAI('p1b'), true, '电脑友军归电脑管');
    assert.equal(game.teamHasHuman('p1'), true, '玩家这一队有真人 → 可以认输');
    assert.equal(game.teamHasHuman('p2'), false, '敌方全是电脑');
    // 每个角色各自的棋子上场（kakyoin/dio/jotaro 都是本体+替身，temperance 是单单位）
    assert.equal(game.s.units.filter(u => u.slot === 'p1').length, 2);
    assert.equal(game.s.units.filter(u => u.slot === 'p1b').length, 2);
    assert.equal(game.s.units.filter(u => u.slot === 'p2').length, 2);
    assert.equal(game.s.units.filter(u => u.slot === 'p2b').length, 1, '单单位角色只上场一枚');
    // 每个角色各自一条血
    assert.equal(game.s.hp.p1, FIGHTERS.jotaro.hp);
    assert.equal(game.s.hp.p1b, FIGHTERS.kakyoin.hp);
    assert.equal(game.s.hp.p2b, FIGHTERS.temperance.hp);
    // 出手顺序：交错
    assert.deepEqual(game.turnOrder(), ['p1', 'p2', 'p1b', 'p2b']);
    // 剧情标记照旧挂着
    assert.equal(game.s.story?.id, chapter.id);
  });
});

test('★ 章节席位允许用剧情 boss 当第二个角色；自由对局仍然不许', () => {
  withTempChapter({ player: 'jotaro', enemy: 'dio', ally: 'kakyoin', enemy2: 'temperance' }, chapter => {
    const game = new Game({ random: seeded() });
    game.setRoster({ p1b: chapter.ally, p2b: chapter.enemy2, story: true });
    assert.equal(game.slotsFor().length, 4, '章节写死 boss 也照收');
    assert.equal(game.start('jotaro', 'dio', 'ai', { story: chapter.id }), true);
    assert.equal(game.s.fighters.p2b.key, 'temperance', '敌方第二个位子就是那个 boss');
  });
  // 自由对局（玩家自己选人）里，boss 依旧不许当第二个角色
  const free = new Game({ random: seeded() });
  free.setRoster({ p1b: 'kakyoin', p2b: 'temperance' });
  assert.equal(free.start('jotaro', 'dio', 'hotseat'), false, '自由对局里 boss 当第二个角色要被拒');
  assert.match(free.s.notice?.text || '', /可选角色/);
});

test('★ 没声明友军的章节照旧 1v1（老七章一个字不变）', () => {
  const chapter = STORY_CHAPTERS.find(c => c.id === 'chapter-6');
  assert.ok(chapter, '第六章还在');
  const game = new Game({ random: seeded() });
  game.setRoster({ p1b: null, p2b: null, story: true });
  assert.equal(game.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id }), true);
  assert.deepEqual(game.s.slots, ['p1', 'p2']);
  assert.deepEqual(game.s.control, { p1: 'human', p2: 'ai' }, '玩家真人 / 敌方人机，与改动前一致');
});

test('剧情模式忽略"非章节写死"的席位表（老章节不会被自由对局的席位污染）', () => {
  const chapter = STORY_CHAPTERS.find(c => c.id === 'chapter-6');
  const game = new Game({ random: seeded() });
  game.setRoster({ p1b: 'kakyoin', p2b: 'avdol' });   // 注意：没有 story: true
  assert.equal(game.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id }), true);
  assert.deepEqual(game.s.slots, ['p1', 'p2'], '★ 老章节必须仍然是 1v1');
});

test('★ 章节席位里出现不存在的角色时会被拒绝（不留下半个战场）', () => {
  withTempChapter({ player: 'jotaro', enemy: 'dio', ally: 'kakyoin', enemy2: 'not_a_fighter' }, chapter => {
    const game = new Game({ random: seeded() });
    game.setRoster({ p1b: chapter.ally, p2b: chapter.enemy2, story: true });
    assert.equal(game.start('jotaro', 'dio', 'ai', { story: chapter.id }), false);
    assert.match(game.s.notice?.text || '', /不存在/);
  });
});

test('★ 临时章节用完就摘掉：STORY_CHAPTERS 里不会留下测试数据', () => {
  const before = STORY_CHAPTERS.length;
  withTempChapter({ player: 'jotaro', enemy: 'dio', ally: 'kakyoin', enemy2: 'temperance' }, chapter => {
    assert.equal(STORY_CHAPTERS.length, before + 1);
    assert.equal(teamOf('p1b'), 'p1', '（顺带确认工具函数可用）');
    assert.ok(chapter.id);
  });
  assert.equal(STORY_CHAPTERS.length, before, '★ 测完必须摘掉');
  assert.equal(STORY_CHAPTERS.some(c => c.id === 'chapter-test-allies'), false);
});
