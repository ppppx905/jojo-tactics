/**
 * ★★ 2026-10-03 用户要求②③：**吊死者的替身防御加成 1 → 2**、**J·凯尔（本体）倾向逃跑**。
 *
 * ② `FIGHTERS.geil.standDefBonus` 从 1 改成 2（**只动他一个**）；
 * ③ `FIGHTERS.geil.user.flees: true`（**数据旗标，只挂本体**）——AI 操作它时倾向拉开距离、
 *    不主动贴身；只有"撤不掉"或"这一下能换到明显收益"时才正常出手。
 *
 * ⚠️ 这一份把用户那句"**不能因此卡死或让对局打不完**"钉在两条线上：
 *    · 行为线：被贴身就撤 / 够不着就正常推进 / 能一击收掉就照常出手（三条兜底各有用例）；
 *    · 收敛线：`geil` 对**全部 14 个角色**、以及 `geil` 对 `geil`（两个逃跑单位互相瞪）多种子跑完，
 *      再加第八章阶段 1 / 阶段 2 的多种子自动收尾。
 * ⚠️ 既有回归一字未改：`tests/game.test.js` 那条"任意两角色对战必须收敛"（全部 196 组配对 × 2 种子）
 *    与 `tests/hanged-man.test.js` 里阶段 2 的 AI 收尾/落点断言都照旧在跑。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, STORY_CHAPTERS } from '../src/core/game.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { hexDist } from '../src/core/hex.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const aiSource = fs.readFileSync(new URL('../src/core/ai.js', import.meta.url), 'utf8');
const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
const battles = chapter8.scenes.filter(scene => scene.kind === 'battle');
const phase1 = battles.find(scene => scene.lineup?.enemy === 'emperor');
const phase2 = battles.find(scene => scene.lineup?.enemy === 'geil');
const place = (u, tile) => { Object.assign(u, { row: tile.row, col: tile.col }); return u; };
/** 按行列直接摆一枚棋子（摆位用；与上面的 `place` 是同一件事的两种写法）。 */
const put = (u, row, col) => { Object.assign(u, { row, col }); return u; };

/** 按某一幕的阵容开一局（＝ main.js 里 startStoryMatch + startMatch 那一套的等价写法）。 */
function openScene(scene, seed = 13) {
  const game = new Game({ random: seeded(seed) });
  game.setRoster({ p1b: scene.lineup.ally || null, story: true, scene });
  game.start(scene.lineup.player, scene.lineup.enemy, 'ai', { story: chapter8.id });
  return game;
}
/** 一局里按"哪一方 + 哪个棋子"取棋子。 */
const unit = (game, slot, kind) => game.s.units.find(u => u.slot === slot && u.kind === kind);

// ===================== ② 替身防御加成 1 → 2 =====================

test('② 吊死者的替身防御加成 1 → 2，且**别的角色一个数都没动**', () => {
  assert.equal(FIGHTERS.geil.standDefBonus, 2, '★ 用户 2026-10-03 拍板：1 → 2');
  // "别的角色一个数都没动"：拿 tools/rules-fingerprint.json 的基线逐值比一遍
  // （那份基线正好只收录非 boss 的 12 名角色，没收录 geil / emperor）
  const baseline = JSON.parse(fs.readFileSync(new URL('../tools/rules-fingerprint.json', import.meta.url)));
  assert.equal(baseline.FIGHTERS.geil, undefined, '（基线里本来就没有 geil 这一项，所以这一改不碰指纹测试）');
  for (const [key, values] of Object.entries(baseline.FIGHTERS)) {
    assert.equal(FIGHTERS[key].standDefBonus, values.standDefBonus, `${key}.standDefBonus 不该被这次改动波及`);
  }
  // 真的作用在防御口径上：打**本体**只是基础 2；打**吊死者**要多啃那 2 点
  const game = openScene(phase2);
  game.s.terrain = {};                                  // 干净棋盘：地形加成不掺进来
  const ghost = unit(game, 'p2', 'stand'), owner = unit(game, 'p2', 'user');
  const foe = unit(game, 'p1', 'stand');
  assert.equal(game.standBonus('p2'), 2, '★ 这一方的替身防御加成就是 2');
  assert.equal(game.defense(owner).total, FIGHTERS.geil.def, '本体照旧只有基础防御');
  assert.equal(game.defense(ghost).total, FIGHTERS.geil.def + 2, '★ 吊死者＝基础 2 + 替身 2 = 4');
  assert.equal(game.preview(foe, owner).damage - game.preview(foe, ghost).damage, 2,
    '★ 同一击打在替身上要多扣 2 点（1 → 2 就体现在这里）');
});

// ===================== ③ 逃跑旗标只挂本体 =====================

test('③ `flees` 旗标只挂在 J·凯尔**本体**上（数据字段，引擎数值一点不受影响）', () => {
  const flagged = Object.values(FIGHTERS)
    .flatMap(f => [f.user, f.stand].filter(Boolean))
    .filter(u => u.flees !== undefined);
  assert.equal(flagged.length, 1, '★ 全项目只有**一个**单位带这个旗标');
  assert.equal(flagged[0], FIGHTERS.geil.user, '★ 就是 J·凯尔的本体（吊死者身上没有）');
  assert.equal(FIGHTERS.geil.user.flees, true);
  assert.equal(FIGHTERS.geil.stand.flees, undefined, '★ 替身那枚不许有（倾向只给本体）');
  for (const key of Object.keys(FIGHTERS)) {
    if (key === 'geil') continue;
    for (const kind of ['user', 'stand']) {
      if (FIGHTERS[key][kind]) assert.equal(FIGHTERS[key][kind].flees, undefined, `${key}.${kind} 不该有这个旗标`);
    }
  }
  // 真开一局：棋子对象是 `{ ...f.user }` 铺出来的，所以本体那枚真的带上了、替身那枚没有
  const game = openScene(phase2);
  assert.equal(unit(game, 'p2', 'user').flees, true);
  assert.equal(unit(game, 'p2', 'stand').flees, undefined);
  // 它是**给 AI 看的**：删掉它，攻击 / 防御 / 预览这些引擎口径逐值相同
  const owner = unit(game, 'p2', 'user'), foe = unit(game, 'p1', 'stand');
  const snapshot = () => ({ attack: game.unitAttack(owner), def: game.defense(owner).total, pv: game.preview(owner, foe) });
  const withFlag = snapshot();
  delete owner.flees;
  assert.deepEqual(snapshot(), withFlag, '★ 旗标不参与任何数值结算');
  // AI 侧只认旗标（不按角色名硬编码）
  assert.match(aiSource, /const fleeUnit = mine\.find\(u => u\.kind === 'user' && u\.flees === true\)/,
    '★ AI 读的是"本体 + 旗标"这一条判据');
});

// ===================== ③ 主动拉开距离（真实局面，多种子） =====================

/**
 * 摆一个"**本体被贴身、吊死者够不着**"的局面（坐标由真实的反光点布局算出来，不写死坐标）：
 *   · 吊死者站在某个反光点上（镜面行走：落点只有反光点与空岩石格）；
 *   · 本体紧贴波鲁纳雷夫的替身（距离 1）——**正被敌方射程罩着**，这才是该撤的时刻；
 *   · 本体离吊死者 ≤ 4（联携距离 4，超了它一步都走不了）；
 *   · 敌方其余棋子丢到 5 格外，让吊死者既打不着人、也没有"更近的落点"可走。
 * 每一组摆位都在下面逐条验过前提，验过了才用——所以这一条断言不受其它棋子的决策干扰。
 */
function fleeSetup(seed = 13) {
  const game = openScene(phase2, seed);
  const ghost = unit(game, 'p2', 'stand'), owner = unit(game, 'p2', 'user');
  const foeStand = unit(game, 'p1', 'stand');
  const rest = game.s.units.filter(u => u.slot !== 'p2' && u !== foeStand);
  for (const raw of game.s.mirrors) {
    const mirror = game.at(raw.row, raw.col);
    if (game.pillarAt(mirror) || game.isRock(mirror)) continue;
    for (const spot of game.tiles) {
      if (spot === mirror || hexDist(spot, mirror) > 4) continue;
      for (const beside of game.near(spot)) {
        if (beside === mirror || hexDist(beside, mirror) < 4) continue;
        const away = game.tiles.filter(t => t !== spot && t !== beside && t !== mirror
          && hexDist(t, mirror) >= 5 && hexDist(t, beside) >= 4);
        if (away.length < 3) continue;
        place(ghost, mirror); place(owner, spot); place(foeStand, beside);
        rest.forEach((u, i) => place(u, away[i % away.length]));
        game.s.turn = 'p2';
        if (hexDist(game.tile(owner), game.tile(foeStand)) > foeStand.range) continue;   // 本体确实被够得着
        if (!game.reachable(owner).length) continue;                                     // 本体确实走得动
        if (game.targets(ghost, ghost.range).length) continue;                           // 吊死者打不着任何人
        const ghostDist = hexDist(game.tile(ghost), game.tile(foeStand));
        if (game.reachable(ghost).some(t => hexDist(t, game.tile(foeStand)) < ghostDist)) continue;
        return { game, ghost, owner, foeStand };
      }
    }
  }
  throw new Error('没摆出"本体被贴身、吊死者够不着"的局面（反光点布局变了？）');
}

test('③ 被贴身时**主动往外撤**：AI 选择的是"往远离敌方走"，不是贴身打（多种子）', () => {
  for (const seed of [13, 7, 2024, 4242, 99991]) {
    const { game, ghost, owner, foeStand } = fleeSetup(seed);
    assert.equal(hexDist(game.tile(owner), game.tile(foeStand)), 1, `seed ${seed}（前提）本体正贴着对面`);
    assert.equal(game.targets(ghost, ghost.range).length, 0, `seed ${seed}（前提）吊死者够不着任何人`);
    const before = hexDist(game.tile(owner), game.tile(foeStand));
    const plan = chooseAI(game);
    assert.equal(plan.type, 'move', `★ seed ${seed}：该撤的时候要撤（拿到的是 ${plan.type}）`);
    assert.equal(plan.unit, owner, `★ seed ${seed}：撤的是**本体**，不是吊死者`);
    const after = hexDist(plan.target, game.tile(foeStand));
    assert.ok(after > before, `★ seed ${seed}：这一步是**拉开距离**（${before} → ${after}）`);
    assert.ok(after > foeStand.range, `★ seed ${seed}：撤完要站到敌方射程之外（${after} > ${foeStand.range}）`);
    assert.equal(playAIAction(game, plan), true, `★ seed ${seed}：这一手要真的走得成`);
    assert.equal(hexDist(game.tile(owner), game.tile(foeStand)), after, '（走完站位与计划一致）');
  }
});

// ===================== ③ 三条兜底 =====================

/**
 * 只留**本体**的一局（把替身那枚棋子从棋盘上拿掉）。
 * ⚠️ 这不是"造一个引擎到不了的状态"：**单单位角色**（乔瑟夫 / 皇帝 / 黄色节制 / 力量）本来就是
 *    `mine` 里只有一个本体，`chooseAI` 必须处理它（既有的 `stand || user` 那些写法就是为它留的）。
 *    把 geil 的替身拿掉，就是让"带 flees 旗标的本体"走那条既有路径——这样断言不会被吊死者那一手盖住。
 */
function soloOwner(seed = 13) {
  const game = new Game({ random: seeded(seed) });
  game.start('geil', 'polnareff', 'ai');
  game.s.terrain = {};                                     // 干净棋盘：地形加成不掺进这一条
  game.s.units = game.s.units.filter(u => !(u.slot === 'p1' && u.kind === 'stand'));
  game.s.turn = 'p1';
  return { game, owner: unit(game, 'p1', 'user'), foe: unit(game, 'p2', 'stand') };
}

test('③ 兜底一：被够得着就撤；**够不着时不白撤**，照常推进（不因此卡死）', () => {
  // ① 正贴着（对方替身射程 2，距离 1 ≤ 2）→ 撤
  const close = soloOwner();
  put(close.owner, 5, 5); put(close.foe, 5, 6);
  const retreat = chooseAI(close.game);
  assert.equal(retreat.type, 'move');
  assert.equal(retreat.unit, close.owner);
  assert.ok(hexDist(retreat.target, close.game.tile(close.foe)) > 1, '★ 被贴身就往远处撤');

  // ② 站得够远（距离 5 > 射程 2）→ **不撤**，照常往前推
  //    ⚠️ 这一条就是"无处可退 / 没人在追时照常行动"的兜底：没有它，两个逃跑单位会互相瞪到天荒地老
  const far = soloOwner();
  put(far.owner, 5, 5); put(far.foe, 5, 10);
  assert.equal(hexDist(far.game.tile(far.owner), far.game.tile(far.foe)), 5, '（前提）站得够远');
  const approach = chooseAI(far.game);
  assert.equal(approach.type, 'move');
  assert.equal(approach.unit, far.owner);
  const gap = hexDist(approach.target, far.game.tile(far.foe));
  assert.ok(gap < 5, `★ 够不着的时候它照常推进（5 → ${gap}），不是原地发呆`);
});

test('③ 兜底二：**这一下能换到明显收益**（一击收掉对手）时照常出手', () => {
  const { game, owner, foe } = soloOwner();
  put(owner, 5, 5); put(foe, 5, 6);
  game.s.hp.p2 = 2;                                        // 本体这一击（6 攻 − 4 防 = 2）正好把对面打空
  assert.equal(game.preview(owner, foe).wins, true, '（前提）这一下真的能收掉');
  const plan = chooseAI(game);
  assert.equal(plan.type, 'attack', '★ 能一击定胜负时不该还在往外跑');
  assert.equal(plan.unit, owner);
  assert.equal(plan.target, foe);
});

test('③ 对照：把旗标拿掉，同一个人同一个局面就**不再往外撤**（旗标确实是这一行为的开关）', () => {
  const { game, owner, foe } = soloOwner();
  put(owner, 5, 5); put(foe, 5, 6);
  assert.equal(chooseAI(game).type, 'move', '（前提）带旗标时它撤');
  const again = soloOwner();
  put(again.owner, 5, 5); put(again.foe, 5, 6);
  delete again.owner.flees;
  const plan = chooseAI(again.game);
  assert.equal(plan.type, 'attack', '★ 没有旗标时贴上去就打（所以"往外撤"确实是旗标带来的）');
  assert.equal(plan.unit, again.owner);
});

// ===================== ⑤ 对局仍能收敛 =====================

test('⑤ 带逃跑倾向之后对局照样收敛：geil 对**全部角色**（含 geil 对 geil）多种子全部打完', () => {
  const seeds = [13, 777, 4242, 9421, 20261003];
  const keys = Object.keys(FIGHTERS);
  for (const seed of seeds) for (const key of keys) for (const [a, b] of [[key, 'geil'], ['geil', key]]) {
    const game = new Game({ random: seeded(seed) });
    game.start(a, b, 'ai');
    let steps = 0;
    while (game.s.phase === 'battle' && steps < 500) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
      steps++;
      assert.ok(Number.isFinite(game.s.hp.p1) && Number.isFinite(game.s.hp.p2), `${a}/${b} 血量要始终是有限数`);
    }
    assert.equal(game.s.phase, 'result', `★ ${a}/${b}（seed ${seed}）走了 ${steps} 步还没打完——逃跑倾向卡住了对局`);
    assert.ok(['p1', 'p2'].includes(game.s.winner), `${a}/${b}（seed ${seed}）要分出胜负`);
  }
});

// ===================== ⑥ 第八章两场都能自动收尾 =====================

test('⑥ 第八章阶段 1 / 阶段 2 的 AI 都能自动收尾（12 个种子，别死循环）', () => {
  const seeds = [13, 555, 777, 2024, 4242, 7919, 9421, 31415, 99991, 123456, 20261003, 2];
  for (const [name, scene] of [['阶段 1', phase1], ['阶段 2', phase2]]) {
    for (const seed of seeds) {
      const game = openScene(scene, seed);
      let guard = 0;
      while (game.s.phase === 'battle' && guard < 900) {
        const plan = chooseAI(game);
        if (!plan || !playAIAction(game, plan)) game.endTurn();
        guard++;
      }
      const tag = `${name} seed ${seed}`;
      assert.ok(guard < 900, `★ ${tag}：这局没打完（走了 ${guard} 步，说明卡住了）`);
      assert.equal(game.s.phase, 'result', `${tag}：要收场`);
      assert.ok(['p1', 'p2'].includes(game.s.winner), `${tag}：胜负落在某一队上`);
      // 机制旗标不许"串场"（和 tests/chapter8-phases.test.js 同一个口径）
      if (scene === phase1) assert.deepEqual(game.s.mirrors, [], `${tag}：阶段 1 不该有反光点`);
      else {
        assert.equal(game.s.shotAim, null, `${tag}：阶段 2 不该有冷枪弹道`);
        assert.equal(game.storyLossDone(), false, `${tag}：必败剧情战只属于阶段 1`);
        if (game.s.winner === 'p1') assert.ok(game.s.hp.p2 <= 0, `${tag}：打倒 J·凯尔才算赢`);
      }
    }
  }
});
