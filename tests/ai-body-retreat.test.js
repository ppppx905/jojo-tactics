/**
 * ★★ 2026-10-07 用户要求（本次改版）：**电脑的"本体"站位**——
 *   用户原话："**尽量只让替身暴露在对方攻击范围内，本体尽量后撤，远距离替身（攻击范围 ≥ 3）
 *   则在此基础上向后拉扯着打**"（远距离替身那半条的回归在 `tests/kite-ai.test.js`）。
 *
 * 为什么本体该退（不是手感，是账）：本体与替身**共用一条命**，但**替身有 `standDefBonus` 防御加成**——
 *   同一个敌人打替身要扣掉更多防御。所以"只让对手够得着替身"是实打实的减伤。
 *
 * 这一份按验收标准 ①–⑤ 逐条钉住 `src/core/ai.js` 的 `BODY` 那一支：
 *   ① **被够着就脱身**：本体站在敌方射程里时，会走到"敌方够不着、且不破坏连携距离"的落点；
 *   ② **不主动走进敌方射程**：交火中，本体的落点不会被敌人够着（宁可不走）；
 *   ③ **不许把替身丢下**：退得太远（会让替身这一回合打不着人）要重罚——否则本体"退到死、再走回来"白花行动点；
 *   ④ **防僵死闸门**：替身还打不到人时，本体照旧"跟着压上"（否则被远程敌人压着时整队永远进不了场）；
 *   ⑤ **单单位角色不受影响**（没有替身棋子就谈不上"只让替身暴露"）＋ 多种子收敛冒烟。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS } from '../src/core/game.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { hexDist } from '../src/core/hex.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const aiSource = fs.readFileSync(new URL('../src/core/ai.js', import.meta.url), 'utf8');
const put = (u, row, col) => { Object.assign(u, { row, col }); return u; };

/** 摆一个局面：p1 交给 AI，p2 只留 `foe` 一枚在场的棋子，其余丢到棋盘另一头占位。 */
function setup(a = 'jotaro', b = 'polnareff', spots = [], { turn = 'p1' } = {}) {
  const game = new Game({ random: seeded(13) });
  assert.equal(game.start(a, b, 'ai'), true, `${a}/${b} 要能开局`);
  game.s.terrain = {};                       // 草丛／邻石会把"够不够得着"搅浑，统一清掉
  for (const [id, row, col] of spots) put(game.unit(id), row, col);
  game.s.turn = turn;
  return game;
}
/** 把这一回合剩下的行动点全部交给 AI 走完，返回走过的计划（用来观察"连串决策"而不只是第一手）。 */
function playTurn(game, guard = 8) {
  const plans = [];
  while (game.s.phase === 'battle' && game.s.turn === 'p1' && plans.length < guard) {
    const plan = chooseAI(game);
    if (!plan || !plan.type) break;
    if (plan.type === 'end') break;
    plans.push(plan);
    if (!playAIAction(game, plan)) break;
  }
  return plans;
}
const bodyOf = g => g.unit('p1-user');
const standOf = g => g.unit('p1-stand');
const foeOf = g => g.unit('p2-stand');
const dist = (g, a, b) => hexDist(g.tile(a), g.tile(b));
/**
 * ⚠️ 摆位一律**按引擎的六角距离现找格子**，不许手算行列坐标：
 *   本工程的棋盘是错列布局（同级相邻两列才差 1 格），手算"列差 3 ＝ 3 格"会直接算错，
 *   测试的前提断言就会假红。`hexDist` 读的是棋子／格子对象上的 `q`/`r`，所以只喂引擎对象。
 */
const ring = (game, from, d) => game.tiles.filter(t => hexDist(t, from) === d);
/** 把 p2 的另一枚棋子丢到棋盘另一头占位（免得它占掉我们要用的格子）。 */
function parkFoeMate(game) {
  const foe = foeOf(game), mate = game.unit('p2-user');
  if (!mate) return;
  const far = game.tiles.filter(t => hexDist(t, game.tile(foe)) >= 10)[0];
  if (far) put(mate, far.row, far.col);
}

// ===================== ① 被够着就脱身 =====================

test('① 本体被敌人够着时，会退到"敌方够不着、且没破坏连携距离"的落点', () => {
  /**
   * 承太郎（连携距离 2）对波鲁纳雷夫（银色战车射程 2）：
   *   · 本体 (6,5) 与敌方替身 (6,7) 距离 2 ＝ **正被够着**（敌方射程 2）；
   *   · 我方替身 (6,4) 摆在敌人身后侧，**够不着谁**（距离 3 > 射程 2）——这样本体的走位不会被
   *     "替身抢行动点"盖掉，单独看清本体这一支。
   */
  const game = setup('jotaro', 'polnareff', [
    ['p1-user', 6, 5], ['p1-stand', 6, 4], ['p2-stand', 6, 7], ['p2-user', 0, 0],
  ]);
  const body = bodyOf(game), foe = foeOf(game);
  assert.equal(dist(game, body, foe), 2, '（前提）本体站在敌方射程里');
  assert.ok(dist(game, standOf(game), foe) > foe.range, '（前提）我方替身够不着敌人（免得抢走这一手的注意力）');
  const plan = chooseAI(game);
  assert.equal(plan.type, 'move', `★ 本体该脱身（拿到的是 ${plan.type}）`);
  assert.equal(plan.unit, body, '★ 撤的是本体，不是替身');
  assert.ok(dist(game, plan.target, foe) > foe.range,
    `★ 退到敌方射程之外（${dist(game, plan.target, foe)} > ${foe.range}）`);
  assert.ok(hexDist(plan.target, game.tile(standOf(game))) <= game.distLimit('p1'),
    '★ 连携距离不许被退坏');
  // 真的走得成，而且走完仍然安全
  assert.equal(playAIAction(game, plan), true, '★ 这一手要真的走得成');
  assert.ok(dist(game, body, foe) > foe.range, '★ 走完确实站在敌方射程之外');
});

test('① 已经交火时：先让替身出手，再用剩下的行动点把本体拉出射程（行动点花在刀刃上）', () => {
  // 本体 (6,5) 与敌替身距离 1（被贴身）、替身 (6,7) 与敌替身距离 2（正好在射程里）＝双方已经打起来了。
  const game = setup('jotaro', 'polnareff', [
    ['p1-user', 6, 5], ['p1-stand', 6, 7], ['p2-stand', 6, 4], ['p2-user', 0, 0],
  ]);
  const foe = foeOf(game);
  assert.ok(dist(game, bodyOf(game), foe) <= foe.range, '（前提）本体被够着');
  const plans = playTurn(game);
  assert.ok(plans.some(p => p.type === 'attack' && p.unit === standOf(game)), '★ 替身照常出手（该打就打）');
  assert.ok(plans.some(p => p.type === 'move' && p.unit === bodyOf(game)), '★ 本体也被挪了位置（剩下的行动点用来脱身）');
  assert.ok(dist(game, bodyOf(game), foe) > foe.range,
    `★ 这一回合结束时本体已经在敌方射程之外（${dist(game, bodyOf(game), foe)} > ${foe.range}）`);
  assert.ok(dist(game, bodyOf(game), standOf(game)) <= game.distLimit('p1'), '★ 连携距离照旧没被退坏');
});

// ===================== ② 不主动走进敌方射程 =====================

test('② 交火中本体**不主动走进敌方射程**：整回合里它的落点一次都不落在敌人手里', () => {
  // 摆位：本体与替身都站在"敌方射程 + 1"那一圈（本体安全、替身一步就能开火 → 这一支是开着的），
  //       两枚相隔在连携上限以内。
  const game = setup('jotaro', 'polnareff');
  parkFoeMate(game);
  const foe = foeOf(game), body = bodyOf(game), stand = standOf(game);
  const F = game.tile(foe), tether = game.distLimit('p1');
  const outside = ring(game, F, (foe.range || 0) + 1);
  const bodySpot = outside.find(t => t !== F);
  const standSpot = outside.find(t => t !== bodySpot && hexDist(t, bodySpot) <= tether);
  assert.ok(bodySpot && standSpot, '（前提）棋盘上找得到这一圈落点');
  put(body, bodySpot.row, bodySpot.col);
  put(stand, standSpot.row, standSpot.col);
  assert.ok(dist(game, body, foe) > foe.range, '（前提）本体本来就在敌方射程之外');
  assert.ok(dist(game, stand, foe) > foe.range, '（前提）替身也还没进敌方射程（这一步正要上前开火）');
  for (const plan of playTurn(game)) {
    if (plan.unit !== body || !plan.target) continue;
    assert.ok(dist(game, plan.target, foe) > foe.range,
      `★ 本体不该主动踏进敌方射程（那一格距敌 ${dist(game, plan.target, foe)} ≤ ${foe.range}）`);
  }
  assert.ok(dist(game, body, foe) > foe.range, '★ 整回合走完，本体仍然在敌方射程之外');
});

// ===================== ③ 不许把替身丢下 =====================

test('③ 本体不会为了自保退到"替身这一回合已经打不着人"的距离之外', () => {
  /**
   * 闸门③ 的由来（调参时真实观察到）：只按"躲伤害＋越远越好"打分时，本体能一口气退到 5 格外，
   * 于是替身被连携锁在原地、这一回合彻底打不着人，**下一手本体又得走回来**——白花两个行动点。
   * 所以"退"的上限是**替身还够得着的距离**（`替身射程 + 连携上限`，从本体落脚处算）。
   */
  const game = setup('jotaro', 'polnareff', [
    ['p1-user', 6, 5], ['p1-stand', 6, 4], ['p2-stand', 6, 7], ['p2-user', 0, 0],
  ]);
  const foe = foeOf(game), stand = standOf(game);
  const limit = (stand.range || 0) + game.distLimit('p1');
  for (const plan of playTurn(game)) {
    if (plan.unit !== bodyOf(game) || !plan.target) continue;
    assert.ok(dist(game, plan.target, foe) <= limit,
      `★ 本体退过头了：${dist(game, plan.target, foe)} 格 > 替身够得着的上限 ${limit} 格`);
  }
});

// ===================== ④ 防僵死闸门 =====================

test('④ 替身还打不到人时，本体照旧"跟着压上"（闸门①：否则整队永远进不了场）', () => {
  /**
   * 敌人远在棋盘另一头：替身这一回合、下一回合都够不着（`standCanFight` 为假），
   * 所以本支整支不生效，本体必须照旧往前走——不然本体一味后撤会把替身用连携锁住，
   * 整队再也进不了场（第五章"整艘船"那类关卡与本条同源）。
   */
  const game = setup('jotaro', 'polnareff', [
    ['p1-user', 6, 3], ['p1-stand', 6, 5], ['p2-stand', 6, 14], ['p2-user', 6, 12],
  ]);
  const body = bodyOf(game), foe = foeOf(game);
  const before = dist(game, body, foe);
  const plans = playTurn(game);
  const bodyMoves = plans.filter(p => p.unit === body && p.target);
  assert.ok(bodyMoves.length, '★ 本体不该发呆（要跟着压上）');
  assert.ok(dist(game, body, foe) < before,
    `★ 结果是"往前压"而不是"往后撤"（${before} → ${dist(game, body, foe)}）`);
});

test('④ 本体与替身都动起来：整回合不会出现"谁也不动"（收敛的底线）', () => {
  const game = setup('jotaro', 'polnareff', [
    ['p1-user', 6, 4], ['p1-stand', 6, 6], ['p2-stand', 6, 13], ['p2-user', 6, 14],
  ]);
  const plans = playTurn(game);
  assert.ok(plans.length >= 2, `★ 这一回合该有几手棋（实际 ${plans.length} 手）`);
  assert.ok(plans.some(p => p.unit === bodyOf(game)), '★ 本体参与了推进');
  assert.ok(plans.some(p => p.unit === standOf(game)), '★ 替身也参与了推进');
});

// ===================== ⑤ 单单位角色不受影响 =====================

test('⑤ 单单位角色（没有替身棋子）**碰不到这一支**：规则只认"有没有替身"，不认角色名', () => {
  // ① 数据：单单位角色就是 `stand: null`（判据在数据里，ai.js 不按角色名硬编码）
  for (const key of ['joseph', 'emperor', 'forever', 'temperance']) {
    assert.equal(FIGHTERS[key].stand, null, `${key} 是单单位角色`);
  }
  // ② 静态：本体这一支要求"这个角色确实有替身棋子"，而且判据取的是棋子对象
  assert.match(aiSource, /const bodyUser = user && stand && user\.flees !== true \? user : null/,
    '★ 判据＝"本体存在 且 替身棋子存在"，单单位角色自然被排除');
  assert.match(aiSource, /if \(bodyMode && u === bodyUser\)/, '★ 这一支只作用于本体那一枚');
  // ③ 行为：乔瑟夫（单单位、射程 3）被贴身时走的仍是它自己那套（拉扯），分数的量级就是那套的
  //    （`KITE.base` ＝ 60 起步；本体那一支最高也就 20 出头，两者量级分得开）
  const solo = new Game({ random: seeded(13) });
  assert.equal(solo.start('joseph', 'polnareff', 'ai'), true);
  solo.s.terrain = {};
  put(solo.unit('p1-user'), 5, 5);
  put(solo.unit('p2-stand'), 5, 7);
  put(solo.unit('p2-user'), 0, 0);
  solo.s.turn = 'p1';
  // ⚠️ 单单位角色在引擎里**没有** `p1-stand` 这枚棋子（`Game.unit()` 读不到时返回 null）。
  assert.ok(!solo.unit('p1-stand'), '（前提）乔瑟夫没有替身棋子');
  assert.equal(solo.distLimit('p1'), 0, '（前提）单单位角色也没有连携距离');
  const plan = chooseAI(solo);
  assert.equal(plan.type, 'move', `★ 他仍然会拉扯（拿到 ${plan.type}）`);
  assert.ok(plan.score >= 60, `★ 拿的是"拉扯"那一档的分（${plan.score}），不是本体那一档（≤ 25 上下）`);
});

// ===================== ⑤ 收敛冒烟：多种子不许因为"本体后撤"把对局拖死 =====================

test('⑤ 收敛冒烟：几组配对多种子跑完、能分出胜负、步数正常', () => {
  const pairs = [
    ['jotaro', 'polnareff'], ['kakyoin', 'avdol'], ['iggy', 'dio'],
    ['fake_captain', 'joseph'], ['gray_fly', 'kakyoin'], ['polnareff', 'ebony'],
  ];
  let worst = 0, worstTag = '';
  for (const seed of [13, 777, 20261003]) {
    for (const [a, b] of pairs) {
      const game = new Game({ random: seeded(seed) });
      game.start(a, b, 'ai');
      let steps = 0;
      while (game.s.phase === 'battle' && steps < 400) {
        const plan = chooseAI(game);
        if (!plan || !playAIAction(game, plan)) game.endTurn();
        steps++;
      }
      assert.equal(game.s.phase, 'result', `★ ${a}/${b} seed ${seed}：走了 ${steps} 步还没打完（上限 400）`);
      assert.ok(['p1', 'p2'].includes(game.s.winner), `${a}/${b} seed ${seed}：要分出胜负`);
      if (steps > worst) { worst = steps; worstTag = `${a}/${b} seed ${seed}`; }
    }
  }
  assert.ok(worst < 200, `★ 最慢的一局也不该贴近上限（${worstTag} ${worst} 步）`);
  console.log(`  ⑤ 收敛冒烟：18 局全部分出胜负，最慢 ${worstTag} ${worst} 步`);
});
