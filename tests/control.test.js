/**
 * ★★ 逐位「真人 / 人机」控制的回归测试（2026-10-04 用户拍定的设计）。
 *
 * 设计口径：
 *   · 「人机对战」不再是一个单独的模式：**每个角色位各自**决定是真人还是人机，
 *     所以 `s.control = { p1: 'human' | 'ai', … }` 是**唯一口径**（只有参战的槽位有键）；
 *   · 默认（大厅那一套）：P1① / P1② 真人，P2① / P2② 人机；
 *   · 四个位子可以全是人机（挂着看两边自己打完）；
 *   · 认输只对**真人位**开放；
 *   · 1v1 下不登记控制表时与改动前逐值等价（`mode === 'ai'` ＝ P2 侧人机）。
 *
 * 下面 5 组用例正好覆盖交付要求里的 5 条。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, RULE, teamOf } from '../src/core/game.js';
import { hexDist, tileKey } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';

function seeded(seed = 42) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** 开一局 1v1（可选控制表）。地形清空，免得随机地形影响"够不够得着"的判断。 */
function solo(a = 'jotaro', b = 'dio', { control = null, mode = 'hotseat' } = {}) {
  const game = new Game({ random: seeded() });
  if (control) game.setRoster({ control });
  game.start(a, b, mode);
  game.s.terrain = {};
  return game;
}
/** 开一局 2v2（四个位子，控制表按槽位给）。 */
function duo(control, chars = { p1: 'jotaro', p2: 'dio', p1b: 'kakyoin', p2b: 'iggy' }) {
  const game = new Game({ random: seeded() });
  game.setRoster({ p1b: chars.p1b, p2b: chars.p2b, control });
  game.start(chars.p1, chars.p2);
  game.s.terrain = {};
  return game;
}
const foesOf = (game, slot) => game.s.units.filter(u => u.side !== teamOf(slot) && game.slotAlive(u.slot));

/**
 * 测试里的"玩家"：代替真人点按钮——这一个位子能打就打、够不着就往最近的敌人挪，然后结束回合。
 * （只操作 `s.turn` 那一个位子的棋子，和真人只能动自己那一位是同一口径。）
 */
function humanPlay(game) {
  const s = game.s, slot = s.turn;
  const mine = s.units.filter(u => u.slot === slot);
  const nearest = (from, list) => list.map(u => game.tile(u))
    .sort((a, b) => hexDist(from, a) - hexDist(from, b))[0];
  for (let step = 0; step < 8 && s.ap[slot] > 0 && s.phase === 'battle'; step++) {
    const targets = foesOf(game, slot);
    if (!targets.length) break;
    const attacker = mine.find(u => u.range && targets.some(t => hexDist(game.tile(u), game.tile(t)) <= u.range));
    if (attacker) {
      const foe = targets.filter(t => hexDist(game.tile(attacker), game.tile(t)) <= attacker.range)
        .sort((a, b) => s.hp[a.slot] - s.hp[b.slot])[0];
      if (game.attack(attacker, foe)) continue;
    }
    const walker = mine.find(u => {
      const here = game.tile(u), goal = nearest(here, targets);
      return game.reachable(u).some(t => hexDist(t, goal) < hexDist(here, goal));
    });
    if (!walker) break;
    const here = game.tile(walker), goal = nearest(here, targets);
    const stepTo = game.reachable(walker).filter(t => hexDist(t, goal) < hexDist(here, goal))
      .sort((a, b) => hexDist(a, goal) - hexDist(b, goal))[0];
    if (!stepTo || !game.move(walker, stepTo)) break;
  }
  if (game.s.phase === 'battle') game.endTurn();
}
/**
 * ★ 只驱动**人机位**（＝ main.js 里 scheduleAI 在测试里的等价物）：
 * 轮到真人位就立刻停下、把回合交回给"玩家"，返回这一趟**按顺序**替哪几个位子做了决定
 * （同一个位子连续做好几个决定只记一次，用来断言"哪几个位子被自动操作了"）。
 */
function driveAI(game, maxSteps = 2000) {
  const acted = [];
  let guard = 0;
  while (game.s.phase === 'battle' && game.isAI(game.s.turn) && guard++ < maxSteps) {
    if (acted.at(-1) !== game.s.turn) acted.push(game.s.turn);
    const plan = chooseAI(game);
    if (!plan || !playAIAction(game, plan)) game.endTurn();
  }
  assert.ok(guard < maxSteps, '人机位自己打不出结果（可能卡在某个回合里）');
  return acted;
}
/** 每个位子的血量 / 行动点始终合法（2v2 时也要逐位检查）。 */
function assertStateValid(game, label = '') {
  for (const slot of game.s.slots) {
    assert.ok(Number.isFinite(game.s.hp[slot]) && game.s.hp[slot] >= 0 && game.s.hp[slot] <= game.fighter(slot).hp,
      `${label} ${slot} 血量越界：${game.s.hp[slot]}`);
    assert.ok(Number.isInteger(game.s.ap[slot]) && game.s.ap[slot] >= 0 && game.s.ap[slot] <= 4,
      `${label} ${slot} 行动点越界：${game.s.ap[slot]}`);
  }
}

/** 最小假 DOM（与 hud.test.js 同一套思路）：只实现 HUD 用到的那几个 API。 */
function fakeDom() {
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
  const document = {
    getElementById: id => { if (!elements.has(id)) elements.set(id, make(id)); return elements.get(id); },
    querySelector: () => make('query'), querySelectorAll: () => [], createElement: () => make('created'),
    addEventListener() {}, removeEventListener() {}, activeElement: null, body: make('body'),
  };
  return { document, get: id => document.getElementById(id) };
}
async function withDom(run) {
  const previous = globalThis.document;
  const dom = fakeDom();
  globalThis.document = dom.document;
  try { return await run(dom); } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
}

// ===================== ① 1v1：P1 真人 / P2 人机，照旧能打完 =====================
test('★ ① 1v1：P1 真人、P2 人机能从开局打到分出胜负，AI 只在 P2 出手', () => {
  const game = solo('jotaro', 'dio', { control: { p1: 'human', p2: 'ai' } });
  assert.deepEqual(game.s.control, { p1: 'human', p2: 'ai' }, '按位登记的控制表原样进对局');
  assert.equal(game.s.mode, 'ai', '兼容字段：这一局有人机位');
  assert.equal(game.hasAI(), true);
  assert.equal(game.allAI(), false);
  assert.equal(game.isAI('p1'), false);
  assert.equal(game.isAI('p2'), true);

  const acted = [];
  let guard = 0;
  while (game.s.phase === 'battle' && guard++ < 1500) {
    if (game.isAI(game.s.turn)) acted.push(game.s.turn);
    if (game.isAI(game.s.turn)) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
    } else humanPlay(game);
    assertStateValid(game, '1v1');
  }
  assert.ok(guard < 1500, '这一局没打完');
  assert.equal(game.s.phase, 'result', '人机位能自己把这一局打完');
  assert.ok(['p1', 'p2'].includes(game.s.winner));
  assert.ok(acted.length > 0, 'AI 确实行动过');
  assert.deepEqual([...new Set(acted)], ['p2'], '★ AI 只操作 P2 那一个位子');
});

// ===================== ② 2v2 混合位子：AI 自动，真人等待输入 =====================
test('★ ② 2v2 混合位子（P1①真人 / P1②人机 / P2①人机 / P2②真人）：轮到人机位自动打完，真人位停下等人', () => {
  const control = { p1: 'human', p1b: 'ai', p2: 'ai', p2b: 'human' };
  const game = duo(control);
  assert.equal(game.twoSided(), true);
  assert.deepEqual(game.s.slots, ['p1', 'p1b', 'p2', 'p2b']);
  assert.deepEqual(game.s.control, control, '四个位子各有自己的控制值');
  assert.deepEqual(Object.keys(game.s.control), game.s.slots, '控制表的键＝参战槽位，不多不少');
  assert.deepEqual(['p1', 'p1b', 'p2', 'p2b'].map(slot => game.isAI(slot)), [false, true, true, false]);
  assert.equal(game.allAI(), false);
  assert.equal(game.s.mode, 'ai');

  // 开局是真人位（P1①）：AI 一步都不能动
  assert.equal(game.s.turn, 'p1');
  assert.deepEqual(driveAI(game), [], '★ 轮到真人位时人机位不会抢先行动');
  // 真人位（P2②）自己的棋子站哪儿、有多少行动点，都记下来——AI 不该替它做任何事
  const humanTiles = () => game.s.units.filter(u => u.slot === 'p2b').map(u => tileKey(game.tile(u))).sort();
  const humanTilesAtStart = humanTiles();

  // 真人位操作完，交给人机位：P2① → P1② 两个位子自己走完，然后停在 P2②（真人）
  humanPlay(game);
  assert.equal(game.s.turn, 'p2', '交棒给 P2①（人机）');
  const acted = driveAI(game);
  assert.deepEqual(acted, ['p2', 'p1b'], '★ 人机位按交错顺序自动行动：P2① → P1②');
  assert.equal(game.s.turn, 'p2b', '★ 然后停在 P2②（真人）等输入，不会替玩家出手');
  assert.equal(game.s.ap.p2b, RULE.apPerTurn, '真人位一点行动点都没被自动花掉');
  assert.deepEqual(humanTiles(), humanTilesAtStart, '★ 真人位的棋子一步都没被 AI 挪动');
  assert.equal(game.s.stats.p2b.moves + game.s.stats.p2b.skills, 0, '真人位没有任何"自动行动"的记录');
  assert.equal(game.s.turnNumber, 4, '四个位子各轮过一次');
  assert.ok(game.s.stats.p2.moves + game.s.stats.p1b.moves >= 1, '两个 AI 位真的动过棋子');
  assertStateValid(game, '混合');

  // 真人位打完这一轮，回合回到 P1①（真人）——轮转是交错且完整的
  humanPlay(game);
  assert.equal(game.s.turn, 'p1');
  assert.equal(game.s.ap.p1, RULE.apPerTurn, '回到真人位时行动点已重置');
});

// ===================== ③ 四个位子全是人机：挂着看两边自己打完 =====================
test('★ ③ 2v2 四个位子全人机：不需要任何输入就能自动打完（观战）', () => {
  for (const seed of [7, 2024]) {
    const game = new Game({ random: seeded(seed) });
    game.setRoster({
      p1b: 'kakyoin', p2b: 'iggy',
      control: { p1: 'ai', p1b: 'ai', p2: 'ai', p2b: 'ai' },
    });
    game.start('jotaro', 'dio');
    game.s.terrain = {};
    assert.equal(game.allAI(), true, '四个位子全是人机');
    assert.deepEqual([...new Set(game.s.slots.map(slot => game.controlOf(slot)))], ['ai']);
    // 纯 AI 驱动：一个真人输入都没有（不调 humanPlay）
    let guard = 0;
    while (game.s.phase === 'battle' && guard++ < 2000) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
      if (guard % 5 === 0) assertStateValid(game, `全人机 seed ${seed}`);
    }
    assert.ok(guard < 2000, `seed ${seed}：全人机对局没打完`);
    assert.equal(game.s.phase, 'result', `seed ${seed}：四个 AI 应该能自己分出胜负`);
    assert.ok(game.s.winner === 'p1' || game.s.winner === 'p2');
    // 判负那一队**两个角色都归零**（2v2 的判负口径没被控制表影响）
    const loser = game.s.winner === 'p1' ? 'p2' : 'p1';
    for (const slot of game.teamSlots(loser)) assert.equal(game.s.hp[slot], 0, `${slot} 也该归零`);
    // 两边都真的动过手，不是"一边站着不动"打出来的结果
    for (const team of ['p1', 'p2']) {
      const stats = game.teamSlots(team).reduce((sum, slot) => sum + game.s.stats[slot].moves + game.s.stats[slot].skills, 0);
      assert.ok(stats > 0, `${team} 侧是人机，应该自己动过`);
    }
  }
});

// ===================== ④ 认输按"本队有没有真人"算 =====================
test('★ ④ 认输按钮：本队只要有一位真人就能用（2026-10-03 用户把规则从"按当前位子"改成"按队"）', async () => {
  await withDom(async dom => {
    const { renderActions } = await import('../src/ui/hud.js');
    const mixed = duo({ p1: 'human', p1b: 'ai', p2: 'ai', p2b: 'human' });
    // 轮到真人位：可取用
    assert.equal(mixed.s.turn, 'p1');
    renderActions(mixed, { humanTurn: !mixed.isAI(mixed.s.turn), busy: false });
    assert.equal(dom.get('resignBtn').disabled, false, '本队有真人 → 可以认输');
    // ★ 轮到**队友**是电脑的位子（P1②）：仍然可以替本队认输
    mixed.s.turn = 'p1b';
    assert.equal(mixed.teamHasHuman('p1b'), true, 'P1 队里有真人（P1①）');
    renderActions(mixed, { humanTurn: !mixed.isAI(mixed.s.turn), busy: false });
    assert.equal(dom.get('resignBtn').disabled, false, '★ 队友是电脑时也能替本队认输');
    assert.equal(dom.get('btnEnd').disabled, true, '但「结束回合」仍然不该让玩家替电脑点');
    // 对手那一队（P2① 是电脑、P2② 是真人）也同理
    mixed.s.turn = 'p2';
    assert.equal(mixed.teamHasHuman('p2'), true, 'P2 队里有真人（P2②）');
    renderActions(mixed, { humanTurn: false, busy: false });
    assert.equal(dom.get('resignBtn').disabled, false, '对手队里也有真人 → 那颗按钮同样可用');
    // 四个位子全是人机＝观战：认输永远不可用
    const watch = duo({ p1: 'ai', p1b: 'ai', p2: 'ai', p2b: 'ai' });
    for (const slot of watch.s.slots) {
      watch.s.turn = slot;
      assert.equal(watch.teamHasHuman(slot), false, `全人机时 ${slot} 那一队没有真人`);
      renderActions(watch, { humanTurn: false, busy: false });
      assert.equal(dom.get('resignBtn').disabled, true, `全人机观战里 ${slot} 的回合不给认输`);
      assert.match(dom.get('modeLabel').textContent, /观战/, '全人机时顶部标出这是观战');
    }
  });

  // 接线（静态）：认输按钮按"本队有没有真人"开关；处理函数只挡"本队全是电脑"；认输的仍是当前位子
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const hud = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  assert.match(hud, /game\.teamHasHuman/, 'HUD 要按"本队有没有真人"开关认输按钮');
  const handler = main.slice(main.indexOf("$('resignBtn').onclick"), main.indexOf("$('cfCancel').onclick"));
  assert.match(handler, /canResign/, '★ 处理函数用的是"本队有没有真人"这个判断');
  assert.match(handler, /const side = game\.s\.turn;/, '★ 认输的是当前行动的位子');
  assert.equal(handler.includes("'p1'"), false, '不能再用"AI 局就固定 P1 认输"的老写法');
  assert.match(main, /game\.teamHasHuman/, '打开菜单时按"本队有没有真人"刷新认输按钮');
});

// ===================== ⑤ 1v1 下的形状与旧行为等价 =====================
test('★ ⑤ 1v1：控制表形状正确，且不登记控制表时与旧行为（整方判断）逐值等价', () => {
  // 1）默认（不登记控制表）的本地对局：两边都是真人，与旧 hotseat 完全一致
  const hotseat = new Game({ random: seeded() });
  hotseat.start('jotaro', 'dio');
  assert.deepEqual(hotseat.s.control, { p1: 'human', p2: 'human' });
  assert.deepEqual(Object.keys(hotseat.s.control), hotseat.s.slots, '控制表只有参战的两个槽位');
  assert.equal(hotseat.s.mode, 'hotseat', '没有 AI 位 → mode 仍是 hotseat（旧字段照旧）');
  assert.equal(hotseat.hasAI(), false);
  for (const slot of ['p1', 'p2']) assert.equal(hotseat.isAI(slot), false);

  // 2）旧写法 `start(a, b, 'ai')`：等价于"P2 侧人机 / P1 侧真人"
  const vsAI = new Game({ random: seeded() });
  vsAI.start('jotaro', 'dio', 'ai');
  assert.deepEqual(vsAI.s.control, { p1: 'human', p2: 'ai' }, 'mode === "ai" 的兼容默认值');
  assert.equal(vsAI.s.mode, 'ai');
  // 旧的 humanTurn() 是 `!(mode === 'ai' && turn === 'p2')`：新口径逐值等价
  const oldHumanTurn = (mode, turn) => !(mode === 'ai' && turn === 'p2');
  for (const mode of ['hotseat', 'ai']) {
    const g = new Game({ random: seeded() });
    g.start('jotaro', 'dio', mode);
    for (const slot of ['p1', 'p2']) {
      assert.equal(!g.isAI(slot), oldHumanTurn(mode, slot), `mode=${mode} slot=${slot}：该不该等玩家输入必须与旧写法一致`);
    }
  }

  // 3）1v1 的其它形状一个字都没变（槽位、回合顺序、结算）
  const g = new Game({ random: seeded() });
  g.start('jotaro', 'dio');
  assert.deepEqual(g.s.slots, ['p1', 'p2']);
  assert.deepEqual(g.turnOrder(), ['p1', 'p2']);
  const seen = [g.s.turn]; g.endTurn(); seen.push(g.s.turn); g.endTurn(); seen.push(g.s.turn);
  assert.deepEqual(seen, ['p1', 'p2', 'p1']);

  // 4）1v1 里给一个 2v2 才有的槽位没有意义：不会凭空多出一个位子
  const odd = solo('jotaro', 'dio', { control: { p1: 'human', p2: 'ai', p1b: 'ai' } });
  assert.deepEqual(Object.keys(odd.s.control), ['p1', 'p2'], '只有参战的槽位进控制表');
  assert.equal(odd.isAI('p1b'), false, '没参战的位子一律当真人（它根本不会行动）');

  // 5）剧情模式：控制表说了不算——永远是"玩家真人 / 敌方人机"
  const story = new Game({ random: seeded() });
  story.setRoster({ p1b: 'kakyoin', p2b: 'iggy', control: { p1: 'ai', p2: 'ai' } });
  story.start('jotaro', 'kakyoin', 'ai', { story: 'chapter-1' });
  assert.deepEqual(story.s.slots, ['p1', 'p2'], '剧情仍然是 1v1');
  assert.deepEqual(story.s.control, { p1: 'human', p2: 'ai' }, '★ 剧情模式忽略控制表：玩家真人、敌方人机');
});

// ===================== 选人页与网址参数（逐位开关 / ?ai=） =====================
test('★ 选人页：每位一个真人/人机开关；网址 ?ai= 能按位子指定人机', async () => {
  const { draftControl, applyAiParam, draftOrder } = await import('../src/ui/hud.js');
  // 1）纯函数：控制表 + ?ai= 解析
  const draft = { p1: 'jotaro', p2: 'dio', p1b: null, p2b: null, v2v: false, mode: 'hotseat',
    control: { p1: 'human', p2: 'ai', p1b: 'human', p2b: 'ai' } };
  assert.deepEqual(draftControl(draft), { p1: 'human', p2: 'ai' }, '1v1 只看参战的两个位子');
  assert.deepEqual(draftOrder(draft), ['p1', 'p2']);
  draft.v2v = true;
  assert.deepEqual(draftControl(draft), { p1: 'human', p2: 'ai', p1b: 'human', p2b: 'ai' }, '2v2 四个位子');
  assert.deepEqual(applyAiParam(draft, 'p1b,p2'), { p1: 'human', p2: 'ai', p1b: 'ai', p2b: 'human' },
    '★ ?ai=p1b,p2：列到的位子是人机，其余参战位子都是真人');
  assert.deepEqual(applyAiParam(draft, ''), { p1: 'human', p2: 'human', p1b: 'human', p2b: 'human' },
    '?ai= 空串 ＝ 四个位子全是真人');
  assert.deepEqual(applyAiParam(draft, 'p2,p1b,p2b,p1'), { p1: 'ai', p2: 'ai', p1b: 'ai', p2b: 'ai' },
    '★ 四个位子全人机（观战）');
  applyAiParam(draft, 'p9,zz');
  assert.equal(Object.values(draftControl(draft)).every(v => v === 'human'), true, '认不出的槽位名直接忽略');
  // 老写法（只有 mode 字段的大厅数据）仍然能算出 P2 侧人机
  assert.deepEqual(draftControl({ p1: 'a', p2: 'b', mode: 'ai' }), { p1: 'human', p2: 'ai' },
    '没有 control 字段时退回 mode 的兼容默认值');

  // 2）渲染：每位一个开关，位置在这一位的选人面板**上方**
  await withDom(async dom => {
    const { renderDraft } = await import('../src/ui/hud.js');
    renderDraft({ p1: 'jotaro', p2: 'dio', p1b: 'kakyoin', p2b: 'iggy', v2v: true, mode: 'hotseat',
      control: { p1: 'human', p2: 'ai', p1b: 'ai', p2b: 'human' }, focus: { p1: 'p1', p2: 'p2' } });
    const html = dom.get('draftP1').innerHTML;
    const slotsInSwitches = [...html.matchAll(/data-control-slot="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual([...new Set(slotsInSwitches)], ['p1', 'p1b'], 'P1 一侧两个位子各一个开关');
    assert.equal(html.indexOf('side-controls') < html.indexOf('draft-slots'), true, '★ 开关在这一位选人面板的上方');
    assert.match(html, /data-control-slot="p1" data-control="ai"/, '每个开关都能切成"人机"');
    assert.match(html, /data-control="ai"[^>]*>人机</, '开关上的字就是用户拍定的「人机」');
    assert.match(html, /data-control="human"[^>]*>真人</, '另一半是「真人」');
    assert.match(dom.get('draftP2').innerHTML, /data-control-slot="p2b"/, 'P2 一侧的第二个位子也有开关');
    // 选人顺序条与状态文案跟着控制表走
    assert.match(dom.get('draftOrder').innerHTML, /P2 ①<\/b><small>[^<]*· 电脑/, '顺序条要标出这一位是电脑');
    assert.match(dom.get('draftHint').textContent, /人机位/, '底部提示要说清哪些位子是人机会自动行动');
    // 人机位没选角色时同样不能开打（开始条件＝所有参战位子都选好）
    renderDraft({ p1: 'jotaro', p2: 'dio', p1b: null, p2b: 'iggy', v2v: true, mode: 'hotseat',
      control: { p1: 'human', p2: 'ai', p1b: 'ai', p2b: 'human' }, focus: { p1: 'p1', p2: 'p2' } });
    assert.equal(dom.get('startBtn').disabled, true, '人机位也得选好角色才能开打');
    // 1v1 只有两个开关（每一位一颗"真人"/一颗"人机"，所以"位子数"要去重）
    renderDraft({ p1: 'jotaro', p2: 'dio', v2v: false, mode: 'hotseat', control: { p1: 'human', p2: 'ai' }, focus: { p1: 'p1', p2: 'p2' } });
    const solo1v1 = [...new Set([...dom.get('draftP1').innerHTML.matchAll(/data-control-slot="([^"]+)"/g)].map(m => m[1]))];
    assert.deepEqual(solo1v1, ['p1'], '1v1 时每一侧只有一个开关');
    assert.equal(dom.get('draftP1').innerHTML.includes('draft-slots'), false, '1v1 不显示第二个角色的槽位行');
  });

  // 3）接线（静态）：main.js 用控制表开打、网址参数能按位子指定人机
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const hud = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  assert.match(main, /const humanTurn = \(\) => !game\.isAI\(game\.s\.turn\)/, '★ 所有"该不该等玩家"的判断都读控制表');
  assert.match(main, /control: draft\.story \? null : controlTable\(\)/, '开打前把逐位控制表交给 setRoster（start() 的写法不动）');
  assert.match(main, /game\.setRoster\(\{/, '第二对角色与控制表走 setRoster');
  assert.match(main, /game\.start\(draft\.p1, draft\.p2, draft\.mode, \{ story: draft\.story \}\)/, 'start() 的调用写法不许变');
  assert.match(main, /query\.has\('ai'\)/, '缺少 ?ai= 直开参数');
  assert.match(main, /applyAiParam\(draft, query\.get\('ai'\)\)/, '?ai= 要按位子写进控制表');
  assert.match(main, /if \(query\.get\('mode'\) === 'ai'\)/, '?mode=ai 仍然要能用（等价于 P2 侧人机）');
  assert.match(main, /query\.get\('v2v'\) === '1'/, '?v2v=1 仍然要能用');
  assert.match(main, /button\.dataset\.controlSlot/, '逐位开关要有接线');
  assert.match(main, /game\.isAI\(event\.side\) \? '电脑行动' : '你的回合'/, '★ 回合横幅文案跟着当前位子的控制表走');
  assert.match(hud, /export function draftControl\(/, 'hud 需要"draft → 控制表"的单一来源');
  assert.match(hud, /export function applyAiParam\(/, 'hud 需要 ?ai= 的解析（可单独测）');
  // 不许再有"按整方判断 AI"的老写法（2v2 与混合位子下会错）
  assert.equal(main.includes('game.s.mode'), false, 'main.js 里不该再用 game.s.mode 判断 AI');
  assert.equal(hud.includes("s.mode === 'ai' && team === 'p2'"), false, 'hud 里不该再按整方判断 AI');
});
