/**
 * 剧情模式里「承太郎的技能表」这条规矩的回归测试。
 *
 * 由来（2026-10-03 用户报的 bug）：**第七章里承太郎能直接用时停**。
 * 查下来不是被改坏的，而是第七章当初漏写了 `swaps`——第一到第六章每章都写了
 * 「这一战他还没有时停（原作里那要到最后对 DIO 才觉醒）」，第七章只写了 scenes 与 temperance 旗标，
 * 于是承太郎带着 `ora/star/time` 三个技能上了场。
 *
 * 这个文件用「**遍历所有章节**」的写法把规矩钉死：以后再加新章节，只要主角是承太郎，
 * 就必须自己声明技能表与半血觉醒，漏一个就红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, FIGHTERS, STORY_CHAPTERS } from '../src/core/game.js';

test('★ 剧情里的承太郎一律没有时停，而且都有半血觉醒（逐章遍历，防再漏）', () => {
  const chapters = STORY_CHAPTERS.filter(chapter => chapter.player === 'jotaro');
  assert.ok(chapters.length >= 5, `主角是承太郎的章节应该有一批（现在 ${chapters.length} 章：第 1、3、4、5、7 章）`);
  for (const chapter of chapters) {
    const game = new Game({ random: () => 0.5 });
    assert.equal(game.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id }), true, `${chapter.id} 能开局`);
    const skills = game.skills('p1');
    assert.equal(skills.includes('time'), false, `★ ${chapter.id}：承太郎不该有时停`);
    assert.deepEqual(skills, ['ora', 'star'], `${chapter.id}：技能表应与一至六章同一口径（欧拉欧拉 + 白金之星）`);
    assert.ok(chapter.swaps?.jotaro?.rage, `${chapter.id}：要写明半血觉醒`);
  }
});

test('★ 第七章的两处补齐：技能表去掉时停 + 半血觉醒（+3 攻击 / +1 AP）', () => {
  const chapter = STORY_CHAPTERS.find(c => c.id === 'chapter-7');
  assert.ok(chapter, '第七章还在');
  assert.deepEqual(chapter.swaps?.jotaro?.skills, ['ora', 'star'], '★ 第七章必须写明技能表（本次 bug 的根因就是没写）');
  assert.equal(chapter.swaps?.jotaro?.rage?.atk, 3, '半血觉醒：攻击力 +3');
  assert.equal(chapter.swaps?.jotaro?.rage?.ap, 1, '半血觉醒：每个己方回合 +1 行动点');
  // ⚠️ 这里**不再**要求「本关规则」里写一句"这一战他没有时停"：
  //    2026-10-03 用户退回了那句——技能栏上本来就只显示「欧拉欧拉 / 白金之星」，
  //    「本关规则」只该写"这一关和普通对局不一样的地方"，不要把角色自身的技能说明抄一遍。
});

test('★ 半血觉醒真的会生效：掉到一半以下后攻击力 +3、每回合 +1 AP', () => {
  const chapter = STORY_CHAPTERS.find(c => c.id === 'chapter-7');
  const rage = chapter.swaps.jotaro.rage;
  const game = new Game({ random: () => 0.5 });
  game.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id });
  const unit = game.unit('p1-stand');
  const target = game.unit('p2-user');
  const before = game.preview(unit, target)?.attack;
  assert.equal(game.storyAP('p1'), 0, '没觉醒时没有额外行动点');
  game.s.hp.p1 = Math.floor(FIGHTERS[chapter.player].hp * rage.hpRatio);   // 压到半血线上
  assert.equal(game.checkStoryRage('p1'), true, '半血触发觉醒（判定入口就是它）');
  assert.equal(game.storyRage('p1'), true, '觉醒状态已记下');
  const after = game.preview(unit, target)?.attack;
  assert.equal(after, before + rage.atk, '★ 攻击力 +3 要吃进伤害预览');
  assert.equal(game.storyAP('p1'), rage.ap, '★ 每个己方回合 +1 行动点');
  assert.equal(game.checkStoryRage('p1'), false, '觉醒只触发一次');
});
