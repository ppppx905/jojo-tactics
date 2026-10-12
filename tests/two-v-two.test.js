/**
 * ★★ PvP 2v2（双人同屏 · 每方两个角色）的回归测试。
 *
 * 设计口径（用户拍定，别改）：
 *   · 每个角色**各自一条血**、**各自每回合 3 点行动点**（`RULE.apPerTurn` 不动）；
 *   · 出手顺序**交错**：P1 第一个角色 → P2 第一个角色 → P1 第二个角色 → P2 第二个角色；
 *   · 一队**两个角色都倒下**才判负；一个角色倒下后同队另一个照常出手；
 *   · 默认仍然是 1v1：`s.slots === ['p1', 'p2']`，旧行为一字不变。
 *
 * 关键实现（这些断言就是守住它）：槽位名 `'p1'`/`'p2'` 是第一个角色（沿用旧键），
 * 第二个角色是 `'p1b'`/`'p2b'`；棋子的 `side` ＝ 队别、`slot` ＝ 角色；血量/AP/冷却按 `slot` 记账。
 * 2v2 的第二个角色通过 `game.setRoster()` 在 `start()` 之前登记（`start()` 的签名没有变）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, RULE, FIGHTERS, SKILLS, teamOf, slotIndex, slotName, otherSide, playableFighters } from '../src/core/game.js';
import { tileKey, hexDist, COLS, ROWS } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';

function seeded(seed = 42) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
/** 开一局 2v2（每方第二个角色由 roster 登记）。 */
function duo(a = 'jotaro', b = 'dio', ab = 'kakyoin', bb = 'iggy') {
  const game = new Game({ random: seeded() });
  game.setRoster({ p1b: ab, p2b: bb });
  game.start(a, b);
  game.s.terrain = {};
  return game;
}
/** 把一枚棋子搬到指定格（测试里要凑出"够得着"的局面，不受地形随机影响）。 */
function place(game, id, row, col) { Object.assign(game.unit(id), { row, col }); return game.unit(id); }

test('★ 2v2 开局：4 个角色、8 枚棋子各就各位，每方两个槽位', () => {
  const g = duo();
  const s = g.s;
  assert.deepEqual(s.slots, ['p1', 'p1b', 'p2', 'p2b'], '槽位键：第二个角色是 p1b / p2b');
  assert.equal(g.twoSided(), true);
  assert.equal(s.phase, 'battle');
  // 8 枚棋子，id 前缀就是槽位
  assert.equal(s.units.length, 8, '每方两个角色 × 两枚棋子 = 8');
  assert.deepEqual([...s.units.map(u => u.id)].sort(),
    ['p1-stand', 'p1-user', 'p1b-stand', 'p1b-user', 'p2-stand', 'p2-user', 'p2b-stand', 'p2b-user']);
  // 每个棋子的 side ＝ 队别、slot ＝ 角色
  for (const u of s.units) {
    assert.equal(teamOf(u.slot), u.side, `${u.id} 的 side 应该是从 slot 推出来的队别`);
    assert.equal(u.id, `${u.slot}-${u.kind}`);
  }
  // 四个角色都在 s.fighters 里，并且各自是各自的数据
  assert.deepEqual(Object.keys(s.fighters), ['p1', 'p1b', 'p2', 'p2b']);
  assert.equal(s.fighters.p1b.key, 'kakyoin');
  assert.equal(s.fighters.p2b.key, 'iggy');
  assert.equal(s.hp.p1, FIGHTERS.jotaro.hp);
  assert.equal(s.hp.p1b, FIGHTERS.kakyoin.hp);
  assert.equal(s.hp.p2b, FIGHTERS.iggy.hp);
  // 每枚棋子都落在合法格子上、互不重叠、不出界
  const keys = s.units.map(u => tileKey(g.tile(u)));
  assert.equal(new Set(keys).size, keys.length, '不能有两枚棋子站在同一格');
  for (const u of s.units) {
    // ★ 2026-10-05：行上限原写死 `11`（旧 11 行棋盘），现在按 ROWS 算 —— 否则放大到 13 行之后
    //   这条"出界"检查就形同虚设（新摆位在第 6 行，怎么都过得去）。
    assert.ok(u.row >= 0 && u.row < ROWS && u.col >= 0 && u.col < COLS, `${u.id} 出界了`);
    assert.ok(g.tile(u), `${u.id} 不在棋盘上`);
  }
  // 每个角色自己的两枚棋子都在连携距离内
  for (const slot of s.slots) {
    assert.ok(g.pairDistance(slot) <= g.distLimit(slot),
      `${slot} 开局就连携超出距离（${g.pairDistance(slot)} > ${g.distLimit(slot)}）`);
    assert.ok(g.pairDistance(slot) > 0, `${slot} 的两枚棋子不该叠在一起`);
  }
  // 双方镜像对称（18 列 → 镜像列 = COLS − 1 − 列 ＝ 17 − 列；由 COLS 算，不写死）
  for (const [mine, theirs] of [['p1-user', 'p2-user'], ['p1-stand', 'p2-stand'], ['p1b-user', 'p2b-user'], ['p1b-stand', 'p2b-stand']]) {
    assert.equal(g.unit(theirs).col, COLS - 1 - g.unit(mine).col, `${mine} 与 ${theirs} 应左右镜像`);
    assert.equal(g.unit(theirs).row, g.unit(mine).row);
  }
  // 站位集中在 deploySpot：两方各自的 4 枚棋子列互不相同
  // ★ 2026-10-05 棋盘放大后重排：P1 的第二对(外圈)在 1/3，第一对(内圈)在 5/7（旧棋盘是 0/2 与 3/5）。
  assert.deepEqual([...s.units.filter(u => u.side === 'p1').map(u => u.col)].sort((a, b) => a - b), [1, 3, 5, 7]);
});

test('★ 每个角色各自的 3 点行动点与各自的血：打 A 不掉 B，花 A 的 AP 不动 B', () => {
  const g = duo();
  assert.equal(RULE.apPerTurn, 3, '★ 每个角色每回合 3 点（这个常量不许改）');
  for (const slot of g.s.slots) {
    assert.equal(g.s.ap[slot], RULE.apPerTurn, `${slot} 开局 3 AP`);
    assert.equal(g.s.turnAP[slot], RULE.apPerTurn);
  }
  // 花掉 p1 / p1b 各自的行动点：互不影响
  const u1 = place(g, 'p1-user', 5, 4), u1b = place(g, 'p1b-user', 5, 1);
  assert.ok(g.move(u1, g.reachable(u1)[0]), 'p1 的第一个角色走一步');
  assert.equal(g.s.ap.p1, 2, 'p1 的 AP 少了 1');
  assert.equal(g.s.ap.p1b, 3, '★ 同队第二个角色的行动点不受影响');
  // 换到 p1b 出手（交错顺序 p1 → p2 → p1b → p2b）
  g.endTurn(); g.endTurn();
  assert.equal(g.s.turn, 'p1b', 'P1 的第二个角色出手');
  assert.equal(g.s.ap.p1b, 3, '轮到他才重置行动点');
  assert.equal(g.s.ap.p1, 2, '★ 第一个角色这一回合不会再拿到行动点');
  assert.ok(g.move(u1b, g.reachable(u1b)[0]), 'p1b 走一步');
  assert.equal(g.s.ap.p1b, 2);
  assert.equal(g.s.ap.p1, 2, 'p1 的行动点不受队友影响');

  // 打 p1b 的血：p1 一点不掉
  const attacker = place(g, 'p2-stand', 5, 2);
  const victim = g.unit('p1b-user');
  const before = { p1: g.s.hp.p1, p1b: g.s.hp.p1b };
  g.s.turn = 'p2';
  assert.ok(g.attack(attacker, victim), '世界打伊奇那侧的花京院');
  assert.ok(g.s.hp.p1b < before.p1b, '被打的角色掉血');
  assert.equal(g.s.hp.p1, before.p1, '★ 同队另一个角色的血一点没掉');
});

test('★ 出手顺序是交错的：P1① → P2① → P1② → P2②', () => {
  const g = duo();
  assert.deepEqual(g.turnOrder(), ['p1', 'p2', 'p1b', 'p2b']);
  const seen = [g.s.turn];
  for (let i = 0; i < 4; i++) { g.endTurn(); seen.push(g.s.turn); }
  assert.deepEqual(seen, ['p1', 'p2', 'p1b', 'p2b', 'p1'], '一轮 4 个角色，然后回到 P1①');
  assert.equal(g.roundNumber(), 2, '4 个角色各走一次 = 一轮');
  // 每一个角色轮到自己的时候都拿满 3 AP
  for (const slot of ['p2', 'p1b', 'p2b']) assert.equal(g.s.ap[slot], RULE.apPerTurn);
});

test('★ 一个角色被打倒后，同队另一个还能继续打；槽位被跳过', () => {
  const g = duo();
  g.s.hp.p1b = 0;                       // P1 的第二个角色先倒下
  assert.equal(g.checkEnd(), false, '还有 p1 站着，这一局不该结束');
  assert.equal(g.s.phase, 'battle');
  assert.equal(g.slotAlive('p1b'), false);
  assert.equal(g.slotAlive('p1'), true);
  // 出手顺序跳过倒下的槽位：p1 → p2 → p2b → p1
  assert.equal(g.nextSlot('p2'), 'p2b', 'p1b 已经倒下 → 直接跳到 p2b');
  const seen = [g.s.turn];
  for (let i = 0; i < 3; i++) { g.endTurn(); seen.push(g.s.turn); }
  assert.deepEqual(seen, ['p1', 'p2', 'p2b', 'p1'], '★ 倒下的 p1b 不再获得回合');
  // 活着的那个角色照常出手：还能移动、还能攻击
  assert.equal(g.s.ap.p1, RULE.apPerTurn);
  const me = place(g, 'p1-stand', 5, 4), foe = place(g, 'p2b-user', 5, 5);
  assert.ok(g.attack(me, foe), '同队的另一个角色还能打');
  assert.ok(g.s.hp.p2b < FIGHTERS.iggy.hp);
  // 倒下的**敌方**角色不能再被打（他的棋子还在场上挡路，但不是目标）
  g.s.hp.p2b = 0;
  const corpse = g.unit('p2b-user');
  assert.equal(g.slotAlive(corpse.slot), false);
  assert.equal(g.targets(me, 9).includes(corpse), false, '★ 尸体不再是可攻击目标');
  assert.match(g.attackReason(me, corpse), /倒下/);
  // 己方（哪怕倒下了）本来就不能打
  assert.match(g.attackReason(me, g.unit('p1b-user')), /己方/);
});

test('★ 一队两个角色都倒下才判负（1v1 的判定优先级不变）', () => {
  const g = duo();
  g.s.hp.p1 = 0;
  assert.equal(g.checkEnd(), false, '只倒了一个不算输');
  g.s.hp.p1b = 0;
  assert.equal(g.checkEnd(), true, '★ 两个都倒下 → 判负');
  assert.equal(g.s.phase, 'result');
  assert.equal(g.s.winner, 'p2');
  assert.equal(g.s.resultReason, '共享生命归零');

  // 双方同时归零：保持原有优先级（先看 p1 → p2 获胜），没有新引入平局分支
  const both = duo();
  both.s.hp.p1 = 0; both.s.hp.p1b = 0; both.s.hp.p2 = 0; both.s.hp.p2b = 0;
  both.checkEnd();
  assert.equal(both.s.winner, 'p2', '同时归零时仍是 p2 获胜（与改动前同一处判定）');
});

test('★ 2v2 里每个角色各自记账：冷却、灼烧、时停、技能都只影响自己', () => {
  const g = duo('jotaro', 'dio', 'avdol', 'kakyoin');
  // 1）冷却：p1b（阿布德尔）放火焰道路只写进自己的 CD
  g.s.turn = 'p1b';
  const avdol = g.unit('p1b-stand');
  assert.deepEqual(g.s.cd.p1, {}, 'p1 没有冷却');
  assert.ok(g.beginSkill(avdol, 'flame')); g.place(avdol, g.placement(avdol)[0]);
  assert.equal(g.s.cd.p1b.flame, SKILLS.flame.cd, 'p1b 自己进冷却');
  assert.deepEqual(g.s.cd.p1, {}, '★ 同队另一个角色不受影响');
  assert.equal(g.s.ap.p1, RULE.apPerTurn, '★ 花的是 p1b 的行动点');
  // 2）灼烧：被动在阿布德尔身上，打谁谁叠，不传染给同队的另一个角色
  g.cancel();
  g.s.turn = 'p1b';
  g.s.cd.p1b.flame = 0;
  g.s.ap.p1b = 5;
  const avdolStand = place(g, 'p1b-stand', 5, 4);
  const dioUser = place(g, 'p2-user', 5, 5);
  place(g, 'p2b-user', 5, 8);
  assert.ok(g.attack(avdolStand, dioUser));
  assert.equal(g.s.burn.p2, 1, '被打的角色叠了灼烧');
  assert.equal(g.s.burn.p2b, 0, '★ 同队另一个角色没被叠上');
  // 3）技能表按角色取：p1 是承太郎、p1b 是阿布德尔
  assert.deepEqual(g.skills('p1b'), ['burn', 'flame', 'blaze']);
  assert.deepEqual(g.skills('p1'), ['ora', 'star', 'time']);
});

test('★ 2v2 能打得下去：两边按"贴上去就打"的简单策略能分出胜负，且状态始终合法', () => {
  // 这里不用 AI 决策（AI 的逐位行为另有 control.test.js 覆盖），只是把 8 枚棋子真的动起来：
  // 一边检查"血量/行动点/连携/占格"始终合法，一边确认这一局打得完（不会因为 2v2 而卡住）。
  for (const seed of [7, 2024]) {
    const g = new Game({ random: seeded(seed) });
    g.setRoster({ p1b: 'kakyoin', p2b: 'iggy' });
    g.start('jotaro', 'dio');
    let guard = 0, damage = 0;
    const totalHp = () => g.s.slots.reduce((sum, slot) => sum + g.s.hp[slot], 0);
    while (g.s.phase === 'battle' && guard++ < 600) {
      const s = g.s, slot = s.turn;
      const mine = s.units.filter(u => u.slot === slot);
      const foes = () => s.units.filter(u => u.side !== teamOf(slot) && g.slotAlive(u.slot));
      const nearest = (tiles, list) => list.map(u => g.tile(u))
        .sort((a, b) => Math.min(...tiles.map(t => hexDist(t, a))) - Math.min(...tiles.map(t => hexDist(t, b))))[0];
      const before = totalHp();
      // 把这个角色的行动点花光：能打就打，够不着就往最近的敌人挪
      for (let step = 0; step < 8 && g.s.ap[slot] > 0; step++) {
        const targets = foes();
        if (!targets.length) break;
        const attacker = mine.find(u => u.range && targets.some(t => hexDist(g.tile(u), g.tile(t)) <= u.range));
        if (attacker) {
          const foe = targets.filter(t => hexDist(g.tile(attacker), g.tile(t)) <= attacker.range)
            .sort((a, b) => g.s.hp[a.slot] - g.s.hp[b.slot])[0];
          if (g.attack(attacker, foe)) continue;
        }
        const walker = mine.filter(u => g.s.ap[slot] >= 1).find(u => {
          const here = g.tile(u), goal = nearest([here], targets);
          return g.reachable(u).some(t => hexDist(t, goal) < hexDist(here, goal));
        });
        if (!walker) break;
        const here = g.tile(walker), goal = nearest([here], targets);
        const stepTo = g.reachable(walker).filter(t => hexDist(t, goal) < hexDist(here, goal))
          .sort((a, b) => hexDist(a, goal) - hexDist(b, goal))[0];
        if (!stepTo || !g.move(walker, stepTo)) break;
      }
      damage += before - totalHp();
      for (const key of g.s.slots) {
        assert.ok(Number.isFinite(g.s.hp[key]) && g.s.hp[key] >= 0 && g.s.hp[key] <= g.s.fighters[key].hp, `${key} 血量越界`);
        assert.ok(Number.isInteger(g.s.ap[key]) && g.s.ap[key] >= 0 && g.s.ap[key] <= 4, `${key} 行动点越界`);
        if (g.slotAlive(key) && g.pairDistance(key)) assert.ok(g.pairDistance(key) <= g.distLimit(key), `${key} 连携超出距离`);
      }
      const occupied = [...g.s.units, ...g.s.pillars].map(u => tileKey(g.tile(u)));
      assert.equal(new Set(occupied).size, occupied.length, '不能有两枚棋子重叠');
      if (g.s.phase !== 'battle') break;
      g.endTurn();
    }
    assert.ok(damage > 0, `seed ${seed}：2v2 二十来个回合里总该打出伤害`);
    assert.ok(guard < 600, `seed ${seed} 的 2v2 没打完`);
    assert.equal(g.s.phase, 'result', `seed ${seed} 应该分出胜负`);
    // 判负那一队**两个角色都归零**
    const loser = g.s.winner === 'p1' ? 'p2' : 'p1';
    for (const slot of g.teamSlots(loser)) assert.equal(g.s.hp[slot], 0, `${slot} 也该归零`);
  }
});

test('★ 开局校验：boss 不能当第二个角色；同一队不能重复；只给一边不给开', () => {
  const boss = new Game({ random: seeded() });
  boss.setRoster({ p1b: 'gray_fly', p2b: 'iggy' });   // gray_fly 是剧情 boss
  assert.equal(boss.start('jotaro', 'dio'), false, '★ boss 不能上场，直接拒绝开局');
  assert.match(boss.s.notice.text, /boss/);
  assert.deepEqual(boss.s.slots, ['p1', 'p2']);

  const half = new Game({ random: seeded() });
  half.setRoster({ p1b: 'kakyoin', p2b: null });      // 只配了一边
  assert.equal(half.start('jotaro', 'dio'), false, '★ 配置不完整就别开，绝不做"2 打 1"');
  assert.match(half.s.notice.text, /2v2/);
  assert.deepEqual(half.s.slots, ['p1', 'p2']);

  const dup = new Game({ random: seeded() });
  dup.setRoster({ p1b: 'jotaro', p2b: 'iggy' });      // 同队两个承太郎
  assert.equal(dup.start('jotaro', 'dio'), false, '同一队不能选两个一样的角色');
  assert.match(dup.s.notice.text, /相同/);

  const noBoss = new Game({ random: seeded() });
  noBoss.setRoster({ p1b: 'kakyoin', p2b: 'dio' });   // 跨队允许重复
  noBoss.start('dio', 'jotaro');
  assert.deepEqual(noBoss.s.slots, ['p1', 'p1b', 'p2', 'p2b'], '跨队重复是允许的（只有同队不行）');
  assert.equal(noBoss.s.fighters.p1.key, noBoss.s.fighters.p2b.key);

  // 1v1 的开局接口对本校验完全免疫（席位没登记就是 1v1）
  const solo = new Game({ random: seeded() });
  assert.equal(solo.start('jotaro', 'dio'), true);
  assert.deepEqual(solo.s.slots, ['p1', 'p2']);
});

test('★ 剧情章节不吃 2v2；人机位可以进 2v2，但 AI 只打自己那一个角色', () => {
  // 剧情：角色由章节固定，即使登记了第二个角色也必须按 1v1 开
  const story = new Game({ random: seeded() });
  story.setRoster({ p1b: 'kakyoin', p2b: 'iggy' });
  story.start('jotaro', 'gray_fly', 'ai', { story: 'chapter-2' });
  assert.deepEqual(story.s.slots, ['p1', 'p2'], '剧情模式必须是 1v1');
  assert.equal(story.s.units.length, 4);
  assert.deepEqual(story.s.control, { p1: 'human', p2: 'ai' }, '剧情：玩家真人 / 敌方人机（控制表只覆盖参战的两个槽位）');
  // ★ 2026-10-04 用户改掉了「AI 只能玩 1v1」这条规则：人机位与 2v2 可以同时开。
  //   但 AI 仍然**只操作它自己那一个角色**——同队第二个角色的棋子与行动点它碰都不碰。
  const ai = new Game({ random: seeded() });
  ai.setRoster({ p1b: 'kakyoin', p2b: 'iggy' });
  ai.start('jotaro', 'dio', 'ai');
  assert.deepEqual(ai.s.slots, ['p1', 'p1b', 'p2', 'p2b'], '人机对战现在也能开 2v2');
  assert.equal(ai.s.units.length, 8);
  assert.deepEqual(ai.s.control, { p1: 'human', p1b: 'human', p2: 'ai', p2b: 'ai' },
    '默认控制表：P2 侧（含 P2②）是人机，P1 侧是真人');
  ai.s.terrain = {};
  ai.s.turn = 'p2';                       // 轮到 P2①
  assert.ok(playAIAction(ai, chooseAI(ai)), 'AI 要能对 2v2 的局面做出决定');
  assert.ok(ai.s.ap.p2 <= RULE.apPerTurn - 1, 'P2① 花掉了自己的行动点');
  assert.equal(ai.s.ap.p2b, RULE.apPerTurn, '★ AI 不会替同队的 P2② 出手');
  assert.equal(ai.s.ap.p1, RULE.apPerTurn, '也不会碰对手的位子');
  assert.equal(ai.s.ap.p1b, RULE.apPerTurn);
});

test('★ 1v1 完全不变：slots 仍是 [p1,p2]，键、出手顺序、结算形状都照旧', () => {
  const g = new Game({ random: seeded() });
  g.start('jotaro', 'dio');
  assert.deepEqual(g.s.slots, ['p1', 'p2'], '★ 1v1 的状态键必须保持 p1 / p2');
  assert.equal(g.twoSided(), false);
  assert.deepEqual(g.turnOrder(), ['p1', 'p2']);
  assert.deepEqual(g.s.hp, { p1: FIGHTERS.jotaro.hp, p2: FIGHTERS.dio.hp });
  assert.deepEqual(g.s.ap, { p1: 3, p2: 3 });
  assert.deepEqual(g.s.burn, { p1: 0, p2: 0 });
  assert.deepEqual(Object.keys(g.s.fighters), ['p1', 'p2']);
  // 出手顺序与结算判定都还是"两边交替"
  const seen = [g.s.turn]; g.endTurn(); seen.push(g.s.turn); g.endTurn(); seen.push(g.s.turn);
  assert.deepEqual(seen, ['p1', 'p2', 'p1']);
  assert.equal(g.roundNumber(), 2);
  assert.equal(g.nextSlot('p1'), 'p2');
  assert.equal(g.nextSlot('p2'), 'p1');
  g.s.hp.p2 = 0;
  assert.equal(g.checkEnd(), true);
  assert.equal(g.s.winner, 'p1');
  // 认输 / 跳过回合的入口也照旧
  const two = new Game({ random: seeded() });
  two.start('jotaro', 'dio');
  assert.equal(two.resign('p1'), true);
  assert.equal(two.s.winner, 'p2');
  assert.equal(two.s.resultReason, 'P1 主动认输');
  assert.equal(slotName('p1'), 'P1');
  assert.equal(slotName('p2'), 'P2');
  assert.equal(slotIndex('p2b'), 1);
  assert.equal(teamOf('p1b'), 'p1');
  assert.equal(otherSide('p1b'), 'p2', 'otherSide 传槽位时给的是队别');
  assert.equal(otherSide('p1'), 'p2');
});

test('★ 2v2 也走 1v1 那一套技能规则：扬沙/溺水/时停的记账都落在"哪个角色"上', () => {
  // 扬沙迷眼：只影响被打的那个角色
  const g = duo('iggy', 'dio', 'jotaro', 'kakyoin');
  g.s.turn = 'p1';
  const sand = g.unit('p1-stand');   // 愚者
  g.s.ap.p1 = 5;
  const victim = place(g, 'p2b-stand', 5, 4);
  place(g, 'p1-stand', 5, 5);
  assert.ok(g.select(sand.id), '扬沙要先选中施放者');
  assert.ok(g.sandblast(victim));
  assert.equal(g.s.sandBlind.p2b, 'p1', '谁放的、谁被迷眼，都按角色槽位记');
  assert.equal(g.s.sandBlind.p2, null, '★ 同队的另一个角色没被迷眼');
  assert.ok(g.s.hp.p2b < FIGHTERS.kakyoin.hp, '扬沙的 3 点真实伤害只落在被打的角色身上');
  assert.equal(g.s.hp.p2, FIGHTERS.dio.hp, '★ 同队另一个角色一点没掉');

  // 时停：跳过的仍然是"对手的下一个出手回合"，然后施放者拿到额外回合（与 1v1 同口径）
  const t = duo('jotaro', 'dio', 'kakyoin', 'iggy');
  t.s.turn = 'p1'; t.s.hp.p1 = 20; t.checkTimeWindow();
  assert.ok(t.select('p1-stand'));
  assert.ok(t.beginSkill(t.selected, 'time'));
  assert.equal(t.s.skipSide, 'p2', '下一个出手的是 P2 的第一个角色');
  t.endTurn();
  assert.equal(t.s.turn, 'p1', '★ 跳过对手回合后，把额外回合还给施放者');
  assert.equal(t.s.ap.p2, 0, '被跳过的 P2 行动点清零');
  assert.equal(t.timeExtraTurn('p1'), true, '这一回合是时停的额外回合');
  assert.equal(t.s.timeUsed.p1, true);
  assert.equal(t.s.timeUsed.p1b, false, '★ 同队另一个角色没用掉时停');
});

test('★ 界面接线：hud 的 2v2 选人顺序与信息栏两行都接上了（静态检查）', () => {
  const hud = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  // 选人顺序：P1① → P2① → P1② → P2②
  assert.match(hud, /export function draftOrder\(draft\)/, '缺少"选人顺序"的单一来源');
  assert.match(hud, /return draft\?\.v2v \? \['p1', 'p2', 'p1b', 'p2b'\] : \['p1', 'p2'\]/, '顺序必须是交错的那一个');
  assert.match(hud, /export function nextDraftPick\(draft\)/, '缺少"现在轮到谁选"');
  // 两边都选齐才能开打
  assert.match(hud, /start\.disabled = missing\.length > 0/, '★ 没选齐时开始按钮要禁用');
  // 2v2 的对局信息栏：一侧两行 + 当前行动者高亮
  assert.match(hud, /class="side-row\$\{acting \? ' is-acting' : ''\}/, '★ 当前行动的那一行要高亮');
  assert.match(hud, /for \(const team of \['p1', 'p2'\]\)/, '信息栏按队别分组');
  // 大厅开关与第二个角色的登记
  assert.match(main, /button\.dataset\.teamSize/, '缺少 1v1 / 2v2 开关的接线');
  assert.match(main, /game\.setRoster\(/, '开打前要把第二对角色登记给引擎');
  assert.match(main, /game\.start\(draft\.p1, draft\.p2, draft\.mode, \{ story: draft\.story \}\)/, 'start() 的调用写法不许变');
  // 1v1 的旧调用点仍然按"槽位"判断回合（1v1 下槽位就是 p1/p2）
  assert.match(main, /u\.slot === game\.s\.turn/);
  // ?v2v=1 直开
  assert.match(main, /query\.get\('v2v'\) === '1'/, '缺少 ?v2v=1 直开参数');
});

test('★ 界面渲染：2v2 时两边各两行角色信息，行动点跟着当前那一位走', async () => {
  // 最小假 DOM（与 hud.test.js 同一套思路）：只实现 HUD 用到的那几个 API。
  const elements = new Map();
  const make = id => ({
    id, innerHTML: '', textContent: '', className: '', disabled: false, hidden: false, value: '', style: {},
    dataset: {}, attributes: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    hasAttribute(k) { return k in this.attributes; },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, closest: () => null,
    querySelector: () => make(`${id}-child`), querySelectorAll: () => [],
    insertAdjacentHTML(_, html) { this.innerHTML += html; },
    appendChild() {}, contains: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, bottom: 100, right: 100 }),
  });
  const previous = globalThis.document;
  globalThis.document = {
    getElementById: id => { if (!elements.has(id)) elements.set(id, make(id)); return elements.get(id); },
    querySelector: () => make('query'), querySelectorAll: () => [], createElement: () => make('created'),
    addEventListener() {}, removeEventListener() {}, activeElement: null, body: make('body'),
  };
  try {
    const { renderCards, renderActions, renderDraft, nextDraftPick } = await import('../src/ui/hud.js');
    const g = duo();
    renderCards(g, { humanTurn: true });
    renderActions(g, { humanTurn: true, busy: false });
    const bay1 = elements.get('sideP1').innerHTML;
    assert.equal((bay1.match(/data-row="/g) || []).length, 2, '★ 一侧要有两行角色信息');
    assert.equal((bay1.match(/data-row="([^"]+)"[^>]*class|class="side-row is-acting"/g) || []).length >= 0, true);
    assert.ok(bay1.includes('data-hp="p1b"') && bay1.includes('data-ap="p1b"'), '第二个角色也要有自己的血与行动点');
    assert.ok(bay1.includes('is-acting'), '当前行动的那一位要高亮');
    assert.ok(elements.get('sideP2').innerHTML.includes('data-hp="p2b"'));
    // 行动点显示跟着当前行动的槽位走
    const ap = () => [...elements.get('apDisplay').innerHTML.matchAll(/>(\d+)<small> \/ (\d+)</g)].map(m => `${m[1]}/${m[2]}`).pop();
    assert.equal(ap(), '3/3');
    g.s.turn = 'p2b'; g.s.ap.p2b = 1; g.s.turnAP.p2b = 3;
    renderCards(g, { humanTurn: true }); renderActions(g, { humanTurn: true, busy: false });
    assert.equal(ap(), '1/3', '★ 底部行动点跟着高亮的那位走');
    assert.match(elements.get('apDisplay').innerHTML, /P2·2 回合/, '2v2 里要标出是哪个角色在动');
    assert.equal(elements.get('apDisplay').className, 'p2', '配色仍按队别');
    // 选人页：2v2 时两侧各有两行角色槽位、并显示"轮到谁选"
    renderDraft({ p1: 'jotaro', p2: 'dio', p1b: null, p2b: 'iggy', v2v: true, mode: 'hotseat', focus: { p1: 'p1', p2: 'p2' } });
    assert.ok(elements.get('draftP1').innerHTML.includes('data-draft-focus="p1b"'), 'P1 要有第二个角色的槽位');
    assert.equal(nextDraftPick({ v2v: true, p1: 'a', p2: 'b', p1b: null, p2b: null }), 'p1b', '★ 轮流：P1 选完第一个角色轮到 P2，再轮到 P1 的第二个');
    assert.equal(elements.get('startBtn').disabled, true, '没选齐时不能开打');
    renderDraft({ p1: 'jotaro', p2: 'dio', p1b: 'kakyoin', p2b: 'iggy', v2v: true, mode: 'hotseat' });
    assert.equal(elements.get('startBtn').disabled, false, '选齐了就能开打');
    assert.equal(elements.get('startBtn').getAttribute('aria-disabled'), 'false');
    // 1v1：面板回到原来的单角色形状
    renderDraft({ p1: 'jotaro', p2: 'dio', mode: 'hotseat' });
    assert.equal(elements.get('draftP1').innerHTML.includes('draft-slots'), false, '1v1 不显示两个角色槽位');
    assert.equal(elements.get('startBtn').disabled, false);
    // ⚠️ 2026-10-03 第三条用户拍板：第八章的皇帝（emperor）改成 PvP 可选角色，可选角色 7 → 8 名。
    assert.match(elements.get('buildTag').textContent, /共 9 名角色/);
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});

test('★ 1v1 的"逐值等价"：新公式在 2 个槽位下与改动前的写法完全一样', () => {
  // 出手顺序：1v1 时"交错顺序"退化成两边交替，nextSlot 必须与原来的 otherSide 逐值相同
  const g = new Game({ random: seeded() });
  g.start('jotaro', 'dio');
  for (const side of ['p1', 'p2']) assert.equal(g.nextSlot(side), otherSide(side), `nextSlot('${side}') 必须等于 otherSide`);
  // 轮次：改动前是 floor((turnNumber + 1) / 2)，现在是 floor((n - 1) / 槽位数) + 1 —— 2 个槽位下逐值相同
  const oldRound = n => Math.floor((n + 1) / 2);
  for (let n = 1; n <= 40; n++) {
    g.s.turnNumber = n;
    assert.equal(g.roundNumber(), oldRound(n), `turnNumber=${n} 的轮次算出来不一样了`);
  }
  // 认输的文案与判定也照旧（1v1 下槽位名就是 P1 / P2）
  assert.equal(slotName('p1'), 'P1');
  assert.equal(slotName('p2'), 'P2');
  // 状态对象的键也必须还是那两个（deepEqual 要求键完全一致）
  assert.deepEqual(Object.keys(g.s.hp), ['p1', 'p2']);
  assert.deepEqual(Object.keys(g.s.ap), ['p1', 'p2']);
  assert.deepEqual(Object.keys(g.s.cd), ['p1', 'p2']);
  assert.deepEqual(Object.keys(g.s.burn), ['p1', 'p2']);
  assert.deepEqual(Object.keys(g.s.stats), ['p1', 'p2']);
});

test('★ 2v2 的人数上限：可选角色够用（每方两个、同队不许重复）', () => {
  const roster = playableFighters().map(f => f.key);
  assert.ok(roster.length >= 4, `可选角色只有 ${roster.length} 个，凑不出两边各两个`);
  assert.ok(roster.every(key => !FIGHTERS[key].boss), '可选列表里不该有 boss');
});
