/**
 * ★★ 2026-10-04 用户要求③（任务三）：远程角色的**「拉扯」**——`kite: true` 数据旗标。
 *
 * 目标行为（用户原话）：AI 操作霍尔·霍斯 / 乔瑟夫 / 花京院时**尽量站在敌人够不着的地方出手**——
 * 能打就打，但优先选择"**在（或接近）自己最大射程、同时位于敌人威胁范围之外**"的落点；
 * 敌人逼近时**往后撤**再打。三个人都是远程型（霍尔＝本体射程 5 的单单位、乔瑟夫＝本体射程 3 的单单位、
 * 花京院＝替身「绿色法皇」射程 3）。
 *
 * 这一份按验收标准 ③④⑤ 逐条钉死：
 *   ③ **旗标只挂在霍尔 / 乔瑟夫 / 花京院（本体与绿色法皇）这四个单位上**，别的角色一个都没有；
 *      AI 侧**只认字段、不按角色名硬编码**；它是纯 AI 旗标，引擎数值一点不受影响；
 *   ④ 行为：被逼近时**先撤到"敌方够不着、自己还打得着"的射程边缘**，撤完照样输出；
 *      **撤不掉就照常行动**（闸门②：不存在"我打得着、他打不着"的距离时，决策与不带旗标时**完全一样**）；
 *   ⑤ 收敛性：多种子跑完（含这三个角色两两对局、他们 × 全部角色、全部配对抽样、剧情章节），
 *      无卡死、能分出胜负，并打印局数与步数。
 *
 * ⚠️ `flees`（J·凯尔本体那条既有的逃跑行为）不在这一份里：它有自己的回归 `tests/geil-flee.test.js`，
 *    一个字都没改；`kite` 走的是另一支（闸门不同、评分不同），两者互不干扰。
 *
 * ★★ 2026-10-07 用户改版（本条推翻了下面 ③④ 里"只认旗标"的旧口径，理由见用户原话）：
 *   用户要求"**远距离替身（攻击范围 ≥ 3）则向后拉扯着打**"，所以判据扩成
 *   **"`kite` 旗标 ∪ 替身射程 ≥ 3"**（`KITE.minRange`）——新覆盖**阿布德尔的「魔术师之红」（射程 3）**，
 *   它以前被逼近时是"站在原地对射"，现在也会撤到射程边缘。
 *   · **旗标一个没动**（仍只有那四个单位），下面 ③ 的旗标清单照旧；
 *   · **花京院的那枚"本体"改由 `BODY` 那一支接管**（用户同一次要求的"本体尽量后撤、只让替身暴露"，
 *     回归在 `tests/ai-body-retreat.test.js`），所以下面那条本体用例的**注释改了、断言没放宽**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, STORY_CHAPTERS } from '../src/core/game.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { hexDist } from '../src/core/hex.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const aiSource = fs.readFileSync(new URL('../src/core/ai.js', import.meta.url), 'utf8');
const put = (u, row, col) => { Object.assign(u, { row, col }); return u; };

/** 挂了 `kite` 旗标的三个角色（本体/替身那一层见下面的期望表）。 */
const KITE_KEYS = ['emperor', 'joseph', 'kakyoin'];
/** 用户点名的**四个单位**：霍尔本体、乔瑟夫本体、花京院本体 ＋ 绿色法皇。 */
const KITE_UNITS = () => [
  { key: 'emperor', kind: 'user', name: '霍尔·霍斯' },
  { key: 'joseph', kind: 'user', name: '乔瑟夫' },
  { key: 'kakyoin', kind: 'user', name: '花京院' },
  { key: 'kakyoin', kind: 'stand', name: '绿色法皇' },
];
const allUnits = () => Object.entries(FIGHTERS)
  .flatMap(([key, f]) => ['user', 'stand'].map(kind => ({ key, kind, unit: f[kind] })).filter(e => e.unit));

// ===================== ③ 旗标只挂在这四个单位上 =====================

test('③ `kite` 旗标只挂在霍尔 / 乔瑟夫 / 花京院（本体与绿色法皇）这四个单位上', () => {
  const flagged = allUnits().filter(e => e.unit.kite !== undefined);
  assert.equal(flagged.length, 4, `★ 全项目只有四个单位带这个旗标（实际 ${flagged.length}：${flagged.map(e => `${e.key}.${e.kind}`)}）`);
  // 与用户点名的那四个**逐个对照**（顺序不参与比较：FIGHTERS 的键序不是这条要守的东西）
  assert.deepEqual(flagged.map(e => `${e.key}.${e.kind}`).sort(),
    KITE_UNITS().map(e => `${e.key}.${e.kind}`).sort(), '★ 就是用户点名的那四个（别的角色一个都没有）');
  for (const e of flagged) assert.equal(e.unit.kite, true, `${e.key}.${e.kind} 是 true`);
  // 逐角色遍历：没有旗标的角色**一个字段都不许有**（`undefined`，不是 false）
  for (const e of allUnits()) {
    if (KITE_KEYS.includes(e.key)) continue;
    assert.equal(e.unit.kite, undefined, `${e.key}.${e.kind} 不该有这个旗标`);
  }
  // 花京院两枚都挂、别的角色两枚都不挂 —— 逐个点名核对，免得上面那张表写错
  assert.equal(FIGHTERS.kakyoin.user.kite, true);
  assert.equal(FIGHTERS.kakyoin.stand.kite, true);
  for (const key of ['jotaro', 'dio', 'avdol', 'polnareff', 'iggy', 'geil', 'gray_fly', 'forever',
    'fake_captain', 'ebony', 'temperance']) {
    for (const kind of ['user', 'stand']) {
      if (FIGHTERS[key][kind]) assert.equal(FIGHTERS[key][kind].kite, undefined, `${key}.${kind} 不该有 kite`);
    }
  }
});

test('③ AI 侧只认字段、**不按角色名硬编码**（静态检查 ＋ 真开一局看棋子对象）', () => {
  // ① 静态：判据必须是"棋子上的 kite 字段"
  //    ★ 2026-10-07 起这条判据扩成"**旗标 ∪ 替身射程 ≥ 3**"（用户要求"远距离替身也拉扯"）——
  //      原来那句只认旗标，所以阿布德尔（射程 3、无旗标）不在其列；现在按规则自动纳入。
  assert.match(aiSource, /const kites = u => u\.kite === true \|\| \(u\.kind === 'stand' && \(u\.range \|\| 0\) >= KITE\.minRange\)/,
    '★ 判据应为"旗标 ∪ 替身射程 ≥ KITE.minRange"');
  assert.match(aiSource, /if \(!kites\(u\)\) continue;/, '★ 旗标判据写在走位评分那一段');
  assert.match(aiSource, /KITE\.minRange/, '★ 门槛值来自数据常量，不许把 3 写死在判据里');
  assert.match(aiSource, /u\.kite/, '★ ai.js 真的读了这个字段');
  // 代码里不许出现角色键（注释里提到人名不算——所以查的是"带引号的角色键"这种硬编码写法）。
  // ⚠️ `emperor` 不在这一串里：它在本工程里同时是**技能名**（`SKILLS.emperor`、`skillSetFor` 里的
  //    `['aim','emperor']`），ai.js 里出现 `'emperor'` 是在说技能、不是角色。这里查的是别的角色键。
  assert.equal(/(['"])(jotaro|dio|avdol|polnareff|joseph|kakyoin|iggy|gray_fly|fake_captain|forever|ebony|geil|hol_horse)\1/.test(aiSource),
    false, '★ ai.js 里不许出现按角色名硬编码的写法（引号里的角色键）');
  // ② 真开一局：棋子对象是 `{ ...f.user }` 铺出来的，所以旗标跟着对应的那一枚
  const game = new Game({ random: seeded(13) });
  game.start('kakyoin', 'polnareff', 'ai');
  assert.equal(game.unit('p1-user').kite, true, '花京院本体那枚带上了');
  assert.equal(game.unit('p1-stand').kite, true, '绿色法皇那枚也带上了');
  assert.equal(game.unit('p2-stand').kite, undefined, '对面的替身没有');
  const solo = new Game({ random: seeded(13) });
  solo.start('emperor', 'joseph', 'ai');
  assert.equal(solo.unit('p1-user').kite, true, '霍尔本体那枚带上了');
  assert.equal(solo.unit('p2-user').kite, true, '乔瑟夫本体那枚也带上了（两边都有旗标，各算各的）');
});

test('③ 它是**纯 AI 旗标**：删掉它，攻击 / 防御 / 预览 / 移动力逐值相同', () => {
  const game = new Game({ random: seeded(13) });
  game.start('joseph', 'polnareff', 'ai');
  const me = game.unit('p1-user'), foe = game.unit('p2-stand');
  const snapshot = () => ({
    attack: game.unitAttack(me), def: game.defense(me).total, range: me.range,
    move: game.moveRange(me), reach: game.reachable(me).length, pv: game.preview(me, foe),
  });
  const withFlag = snapshot();
  delete me.kite;
  assert.deepEqual(snapshot(), withFlag, '★ 旗标不参与任何数值结算（与 flees 同一条口径）');
});

// ===================== ④ 行为：撤到"敌方够不着、自己还打得着"的射程边缘 =====================

/**
 * 摆一个"**远程角色被近战替身逼近到 2 格**"的局面（三个角色各一份）：
 *   · p1 ＝被测角色交给 AI，p2 ＝波鲁纳雷夫（银色战车射程 2；本体不能普攻）；
 *   · 地形清空（草丛／邻石会把"够不够得着"搅浑）；
 *   · p2 的本体丢到棋盘另一头（它打不了人，只用来占位）；
 *   · 被测的**射手**（单单位角色＝本体，花京院＝绿色法皇）站在 (5,5)，对面替身站 (5,7) ＝距离 2。
 */
function kiteSetup(key = 'emperor') {
  const game = new Game({ random: seeded(13) });
  assert.equal(game.start(key, 'polnareff', 'ai'), true, `${key} 能开局`);
  game.s.terrain = {};
  const shooter = game.s.units.find(u => u.slot === 'p1' && u.kind === (FIGHTERS[key].stand ? 'stand' : 'user'));
  const mate = game.s.units.find(u => u.slot === 'p1' && u !== shooter);
  const foeStand = game.s.units.find(u => u.slot === 'p2' && u.kind === 'stand');
  const foeUser = game.s.units.find(u => u.slot === 'p2' && u.kind === 'user');
  put(shooter, 5, 5);
  if (mate) put(mate, 5, 3);                               // 花京院的本体（连携距离 3 以内）
  put(foeStand, 5, 7);
  put(foeUser, 0, 0);
  game.s.turn = 'p1';
  return { game, shooter, mate, foeStand, foeUser };
}

test('④ 被逼近时**先撤到"敌方够不着、自己还打得着"的射程边缘**（霍尔 / 乔瑟夫 / 花京院三份）', () => {
  for (const key of KITE_KEYS) {
    const { game, shooter, foeStand } = kiteSetup(key);
    const range = shooter.range || 0;
    // 前提：确实被够得着（口径＝敌方射程），而且自己本来就打得着
    assert.equal(hexDist(game.tile(shooter), game.tile(foeStand)), 2, `${key}（前提）站到了 2 格外`);
    assert.ok(2 <= foeStand.range, `${key}（前提）对面够得着它（对面射程 ${foeStand.range}）`);
    assert.ok(2 <= range, `${key}（前提）它自己也打得着（自己射程 ${range}）`);
    const plan = chooseAI(game);
    assert.equal(plan.type, 'move', `★ ${key}：被逼近时该往后撤（拿到的是 ${plan.type}）`);
    assert.equal(plan.unit, shooter, `★ ${key}：撤的是那个射手`);
    const after = hexDist(plan.target, game.tile(foeStand));
    assert.ok(after > foeStand.range, `★ ${key}：撤完要站到**敌方射程之外**（${after} > ${foeStand.range}）`);
    assert.ok(after <= range, `★ ${key}：同时还在**自己的射程里**（${after} ≤ ${range}）——撤完能开火，不是白撤`);
    assert.equal(playAIAction(game, plan), true, `★ ${key}：这一手要真的走得成`);
    assert.equal(hexDist(game.tile(shooter), game.tile(foeStand)), after, `（${key}：走完站位与计划一致）`);
  }
});

test('④ 撤完照常输出：接下来的行动都发生在**敌方射程之外**，而且伤害真的落了地', () => {
  for (const key of KITE_KEYS) {
    const { game, shooter, foeStand } = kiteSetup(key);
    const hp0 = game.s.hp.p2;
    playAIAction(game, chooseAI(game));                    // ① 先撤（上一条已经钉过）
    // ② 本回合剩下的行动点：不许发呆（'end'），而且出手时必须在敌方射程之外
    const actions = [];
    let guard = 0;
    while (game.s.phase === 'battle' && game.s.turn === 'p1' && guard++ < 6) {
      const plan = chooseAI(game);
      const threatened = hexDist(game.tile(shooter), game.tile(foeStand)) <= foeStand.range;
      if (plan.type === 'attack') {
        assert.equal(threatened, false, `★ ${key}：开火时站在**敌人够不着的地方**（距离 ${hexDist(game.tile(shooter), game.tile(foeStand))} > 射程 ${foeStand.range}）`);
      }
      actions.push(plan.skill || plan.type);
      if (!playAIAction(game, plan)) break;
    }
    assert.ok(actions.some(a => a !== 'end'), `★ ${key}：撤完还要照常出手（这一回合的动作：${actions.join(' → ')}）`);
    // ③ 再往下走几步：伤害一定要落到对面身上（霍尔那 10 点是"一回合之后"才结算的，所以多走几步）
    for (let i = 0; i < 8 && game.s.phase === 'battle'; i++) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
    }
    assert.ok(game.s.hp.p2 < hp0, `★ ${key}：拉扯归拉扯，输出照样打出去了（对面 ${hp0} → ${game.s.hp.p2}）`);
  }
});

test('④ 花京院的本体（打不了人）被逼近时**只负责撤到敌人够不着的地方**（射程 0 那一支）', () => {
  // ⚠️ 2026-10-07 起，这一枚**本体**的走位由 `BODY` 那一支负责（用户要求"本体尽量后撤、
  //    只让替身暴露"），不再走 `KITE` 的"射程 0"分支——**断言一个字没放宽**：
  //    它仍然必须撤到敌方射程之外、并且不许把连携距离退坏。完整的本体规则回归见
  //    `tests/ai-body-retreat.test.js`。
  const game = new Game({ random: seeded(13) });
  game.start('kakyoin', 'polnareff', 'ai');
  game.s.terrain = {};
  const body = game.unit('p1-user'), stand = game.unit('p1-stand');
  const foeStand = game.unit('p2-stand'), foeUser = game.unit('p2-user');
  // 本体站在敌方替身的射程里（距离 2 ≤ 2）；绿色法皇摆在连携距离以内、但已经在敌方射程之外
  put(body, 5, 5); put(stand, 5, 2);
  put(foeStand, 5, 7); put(foeUser, 0, 0);
  game.s.turn = 'p1';
  assert.equal(hexDist(game.tile(body), game.tile(foeStand)), 2, '（前提）本体被够得着');
  assert.ok(hexDist(game.tile(stand), game.tile(foeStand)) > foeStand.range, '（前提）绿色法皇已经站在敌方射程之外');
  const plan = chooseAI(game);
  assert.equal(plan.type, 'move', '★ 本体该往后撤');
  assert.equal(plan.unit, body, '★ 撤的是本体（它没有普攻，只负责别站进敌人的射程）');
  const after = hexDist(plan.target, game.tile(foeStand));
  assert.ok(after > foeStand.range, `★ 撤到敌方射程之外（${after} > ${foeStand.range}）`);
  assert.ok(hexDist(plan.target, game.tile(stand)) <= 3, '（连携距离不许被撤坏）');
});

test('④ 闸门②：**撤不掉就照常行动**——带旗标与不带旗标的决策完全一样（不会互相瞪到天荒地老）', () => {
  /**
   * 乔瑟夫（射程 3）对乔瑟夫（射程 3）：**不存在**"我打得着、他打不着"的距离
   * （打得着就必然被够得着），所以闸门② 挡住这一趟撤退，走位评分原样落到既有算法上。
   * ⚠️ 这一条就是防死循环的关键：两个这样的单位若都无条件后撤，就会在半路互相瞪着一格来回蹭、
   *    一颗血都不掉（`flees` 那条踩过的同一个坑）。
   */
  const build = () => {
    const game = new Game({ random: seeded(13) });
    game.start('joseph', 'joseph', 'ai');
    game.s.terrain = {};
    const me = game.unit('p1-user'), foe = game.unit('p2-user');
    put(me, 5, 5); put(foe, 5, 8);                          // 距离 3 ＝ 双方的射程
    game.s.turn = 'p1';
    return { game, me, foe };
  };
  const flagged = build();
  const plain = build();
  assert.equal(hexDist(flagged.game.tile(flagged.me), flagged.game.tile(flagged.foe)), 3, '（前提）站在 3 格外');
  assert.equal(flagged.foe.range, 3, '（前提）对手射程也是 3 —— 没有"我打得着、他打不着"的距离');
  assert.equal(flagged.me.range, 3);
  // 带旗标时：它不走"越退越远"那一支，而是照常进攻
  const withFlag = chooseAI(flagged.game);
  assert.notEqual(withFlag.type, 'move', `★ 撤不掉时不该为了撤而后退（拿到 ${withFlag.type}）`);
  // 对照：把旗标拿掉，同一个局面下**决策完全一样**（＝这一趟撤退确实被闸门挡住了）
  delete plain.me.kite;
  const withoutFlag = chooseAI(plain.game);
  assert.equal(withoutFlag.type, withFlag.type, '★ 带旗标与不带旗标的决策类型一致');
  assert.equal(withoutFlag.skill, withFlag.skill, '★ 技能也一致');
  // ⚠️ 两局是**两个不同的 Game 实例**，棋子对象不是同一个引用——所以比的是身份字段，不是对象本身
  assert.equal(withoutFlag.unit?.name, withFlag.unit?.name, '★ 出手的单位一致');
  assert.equal(withoutFlag.target?.name, withFlag.target?.name, '★ 打的目标一致');
  assert.equal(withoutFlag.score, withFlag.score, '★ 连评分都逐值相同（走的确实是同一支算法）');
  // 而且照常打得出伤害（不是站着发呆）
  const hp0 = flagged.game.s.hp.p2;
  let guard = 0;
  while (flagged.game.s.phase === 'battle' && flagged.game.s.turn === 'p1' && guard++ < 6) {
    const plan = chooseAI(flagged.game);
    if (!playAIAction(flagged.game, plan)) break;
  }
  assert.ok(flagged.game.s.hp.p2 < hp0, `★ 照常输出（对面 ${hp0} → ${flagged.game.s.hp.p2}）`);
});

test('④ 对照：同一个局面把旗标拿掉，就**不再往外撤**（旗标确实是这一行为的开关）', () => {
  const { game } = kiteSetup('emperor');
  assert.equal(chooseAI(game).type, 'move', '（前提）带旗标时它先撤');
  const again = kiteSetup('emperor');
  delete again.game.unit('p1-user').kite;
  const plan = chooseAI(again.game);
  assert.notEqual(plan.type, 'move', `★ 没有旗标时它不会往外撤（拿到的是 ${plan.type}）`);
});

test('④ **远距离替身（射程 ≥ 3）按规则一律拉扯**；射程 2 的替身照旧压上去打（2026-10-07 用户改版）', () => {
  /**
   * ★★ 这条用例**推翻了它自己 2026-10-04 的旧断言**（旧断言写的是"同样是远程的阿布德尔不拉扯，
   *   只有插上旗标才会"）。用户 2026-10-07 的要求是"**远距离替身（攻击范围 ≥ 3）则向后拉扯着打**"，
   *   也就是把"凡射程 ≥ 3 的替身都拉扯"变成**规则**、不再逐个插旗标——阿布德尔（魔术师之红，射程 3）
   *   正是这条规则新覆盖到的角色。所以这里改的是**设计**，不是把断言放宽。
   *
   * 同一局面下换一个**射程 2** 的替身（伊奇 & 愚者）做对照：它照旧原地开火/出手，不后撤——
   * 证明"不是凡远程就一概后退"，门槛确实卡在射程 3。
   */
  const build = key => {
    const game = new Game({ random: seeded(13) });
    game.start(key, 'polnareff', 'ai');
    game.s.terrain = {};
    const stand = game.unit('p1-stand'), mate = game.unit('p1-user');
    const foeStand = game.unit('p2-stand'), foeUser = game.unit('p2-user');
    put(stand, 5, 5); put(mate, 5, 4);                      // 连携距离以内（阿布德尔 2 / 伊奇 3）
    put(foeStand, 5, 7); put(foeUser, 0, 0);
    game.s.turn = 'p1';
    return { game, stand, mate, foeStand };
  };
  // ① 阿布德尔：射程 3、没有旗标 → 被逼近到 2 格时**撤到自己的射程边缘**（3 格，出了敌方射程）
  const far = build('avdol');
  assert.equal(hexDist(far.game.tile(far.stand), far.game.tile(far.foeStand)), 2, '（前提）被逼近到 2 格');
  assert.equal(far.stand.range, 3, '（前提）它是射程 3 的远程替身');
  assert.equal(far.stand.kite, undefined, '★ 它仍然没有 kite 旗标（走的是"射程 ≥ 3"这条规则）');
  const retreat = chooseAI(far.game);
  assert.equal(retreat.type, 'move', `★ 射程 ≥ 3 的替身被逼近时该往后撤（拿到 ${retreat.type}）`);
  assert.equal(retreat.unit, far.stand, '★ 撤的是这枚替身');
  const after = hexDist(retreat.target, far.game.tile(far.foeStand));
  assert.equal(after, 3, `★ 撤到自己的最大射程那一条线上（3 格）`);
  assert.ok(after > far.foeStand.range, '★ 而且已经出了敌方射程（3 > 2）');
  // ② 伊奇：射程 2 → 不后撤，照旧在原地出手
  const near = build('iggy');
  assert.equal(near.stand.range, 2, '（前提）愚者是射程 2 的近战替身');
  const press = chooseAI(near.game);
  assert.notEqual(press.type, 'move', `★ 射程 2 的替身不后撤（拿到 ${press.type}）——门槛卡在 3`);
});

// ===================== ⑤ 收敛性：多种子不许卡死 =====================

/** 把一局交给 AI 打完，返回步数与结果。 */
function playOut(a, b, seed, limit = 600) {
  const game = new Game({ random: seeded(seed) });
  game.start(a, b, 'ai');
  let steps = 0;
  while (game.s.phase === 'battle' && steps < limit) {
    const plan = chooseAI(game);
    if (!plan || !playAIAction(game, plan)) game.endTurn();
    steps++;
  }
  return { steps, done: game.s.phase === 'result', winner: game.s.winner, hp: { ...game.s.hp }, limit };
}

const SEEDS = [13, 777, 4242, 9421, 20261003, 7919];
const KEYS = Object.keys(FIGHTERS);
const stats = { matches: 0, maxSteps: 0, maxTag: '' };

function check(tag, r) {
  stats.matches++;
  if (r.steps > stats.maxSteps) { stats.maxSteps = r.steps; stats.maxTag = tag; }
  assert.ok(r.done, `★ ${tag}：走了 ${r.steps} 步还没打完（上限 ${r.limit} 步）——拉扯把对局拖死了`);
  assert.ok(['p1', 'p2'].includes(r.winner), `${tag}：要分出胜负（winner=${r.winner}）`);
  assert.ok(Number.isFinite(r.hp.p1) && Number.isFinite(r.hp.p2), `${tag}：血量要始终是有限数`);
}

test('⑤ 三个角色**两两对局**（含自己打自己）多种子全部打完、能分出胜负', () => {
  let local = 0, worst = 0, worstTag = '';
  for (const seed of SEEDS) for (const a of KITE_KEYS) for (const b of KITE_KEYS) {
    const r = playOut(a, b, seed);
    check(`⑤a ${a}/${b} seed ${seed}`, r);
    local++;
    if (r.steps > worst) { worst = r.steps; worstTag = `${a}/${b} seed ${seed}`; }
  }
  console.log(`  ⑤a 三个远程角色两两对局：${local} 局全部分出胜负，最慢 ${worstTag} ${worst} 步`);
});

test('⑤ 他们 × **全部 16 个角色**（两个方向）多种子全部打完', () => {
  let local = 0, worst = 0, worstTag = '';
  for (const seed of [13, 777, 9421]) {
    for (const key of KITE_KEYS) for (const foe of KEYS) for (const [a, b] of [[key, foe], [foe, key]]) {
      const r = playOut(a, b, seed);
      check(`⑤b ${a}/${b} seed ${seed}`, r);
      local++;
      if (r.steps > worst) { worst = r.steps; worstTag = `${a}/${b} seed ${seed}`; }
    }
  }
  console.log(`  ⑤b 远程角色 × 全部 16 角色（双向）：${local} 局全部分出胜负，最慢 ${worstTag} ${worst} 步`);
});

test('⑤ **全部配对抽样**（16 个角色各挑 4 个对手，双向轮换）也照样收敛', () => {
  let local = 0, worst = 0, worstTag = '';
  for (const seed of [13, 4242]) {
    for (let i = 0; i < KEYS.length; i++) for (const step of [1, 3, 5, 7]) {
      const a = KEYS[i], b = KEYS[(i + step) % KEYS.length];
      const [x, y] = step % 4 === 1 ? [a, b] : [b, a];      // 两个方向都轮到
      const r = playOut(x, y, seed);
      check(`⑤c ${x}/${y} seed ${seed}`, r);
      local++;
      if (r.steps > worst) { worst = r.steps; worstTag = `${x}/${y} seed ${seed}`; }
    }
  }
  console.log(`  ⑤c 全部配对抽样：${local} 局全部分出胜负，最慢 ${worstTag} ${worst} 步`);
});

test('⑤ 剧情章节（含第八章阶段 2 里电脑操作的花京院）AI 全量对局也全都收得了尾', () => {
  let local = 0, worst = 0, worstTag = '';
  for (const chapter of STORY_CHAPTERS) {
    for (const seed of [13, 20261003]) {
      const battles = (chapter.scenes || []).filter(scene => scene.kind === 'battle' && !scene.lineup);
      for (let i = 0; i < battles.length; i++) {
        const r = playOut(chapter.player, chapter.enemy, seed);
        check(`⑤d ${chapter.id} seed ${seed}`, r);
        local++;
        if (r.steps > worst) { worst = r.steps; worstTag = `${chapter.id} seed ${seed}`; }
      }
    }
  }
  // 第八章阶段 2：玩家侧带着**电脑控制的花京院**（kite 单位真的在剧情里上场）
  const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
  const phase2 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.ally === 'kakyoin');
  assert.ok(phase2, '（前提）第八章阶段 2 的电脑友军是花京院');
  for (const seed of [13, 7919, 20261003]) {
    const game = new Game({ random: seeded(seed) });
    game.setRoster({ p1b: phase2.lineup.ally, story: true, scene: phase2 });
    game.start(phase2.lineup.player, phase2.lineup.enemy, 'ai', { story: chapter8.id });
    let steps = 0;
    while (game.s.phase === 'battle' && steps < 900) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
      steps++;
    }
    check(`⑤d 第八章阶段 2 seed ${seed}`, { steps, done: game.s.phase === 'result', winner: game.s.winner,
      hp: { ...game.s.hp }, limit: 900 });
    local++;
    if (steps > worst) { worst = steps; worstTag = `第八章阶段 2 seed ${seed}`; }
  }
  console.log(`  ⑤d 剧情章节全 AI 对局：${local} 局全部分出胜负，最慢 ${worstTag} ${worst} 步`);
});

test('⑤ 汇总：这一份一共跑了多少局、最慢多少步（验收时看这一条）', () => {
  assert.ok(stats.matches >= 300, `★ 覆盖量要够（实际 ${stats.matches} 局）`);
  assert.ok(stats.maxSteps < 400, `★ 最慢的一局也不能贴近上限（${stats.maxTag} ${stats.maxSteps} 步 / 上限 600）`);
  console.log(`  ⑤ 汇总：共 ${stats.matches} 局，最慢 ${stats.maxTag} ${stats.maxSteps} 步（上限 600），全部收敛且分出胜负`);
});
