/**
 * 第七章「披着同伴的脸」的两处**演出**回归（2026-10-03 用户提的）：
 *   ① **boss 开大没动画**：黄色节制此前只在结算画面用过大招插画，战斗里一点演出都没有 →
 *      现在把她的「史莱姆防御」加进"会播插画"的技能名单（每次放都会播）。
 *   ② **觉醒标签的名字**：我原先起的"先看清楚"被退回（从开局就挂着、听起来像被动），
 *      改成与第一章同一个名字「星尘的怒火」，标签读作「星尘的怒火 · 半血后觉醒」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, STORY_CHAPTERS } from '../src/core/game.js';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('★ boss 放「史莱姆防御」时会播大招插画（skill 白名单里有 slime）', () => {
  const line = main.slice(main.indexOf('showCutin(event)') - 400, main.indexOf('showCutin(event)'));
  assert.match(line, /'slime'/, '★ 白名单里要有 slime，否则第七章的战斗里永远看不到她的插画');
  // 顺带守住原本就在名单里的那几个（别被后来的人改掉）
  for (const key of ['ora', 'time', 'splash', 'flame', 'blaze', 'blade', 'armor', 'vine', 'hamon', 'drag', 'sucker']) {
    assert.match(line, new RegExp(`'${key}'`), `白名单里应该还有 ${key}`);
  }
  // 插画素材真的存在（不然播出来是空白）
  assert.ok(fs.existsSync(new URL('../assets/out/cutins/temperance.webp', import.meta.url)), '黄色节制的大招插画素材要在');
});

test('★ 第七章的觉醒名改成「星尘的怒火」，标签读作「星尘的怒火 · 半血后觉醒」', () => {
  const chapter = STORY_CHAPTERS.find(c => c.id === 'chapter-7');
  assert.equal(chapter.swaps?.jotaro?.rage?.name, '星尘的怒火');
  const game = new Game({ random: () => 0.5 });
  game.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id });
  assert.equal(game.storyStatus('p1'), '星尘的怒火 · 半血后觉醒', '半血前显示的是这一句');
  game.s.hp.p1 = 1;
  assert.equal(game.checkStoryRage('p1'), true);
  assert.equal(game.storyStatus('p1'), '星尘的怒火 · 攻击 +3 · 每回合 +1 AP', '觉醒后换成加成文案');
});
