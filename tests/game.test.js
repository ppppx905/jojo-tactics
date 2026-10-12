import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, RULE, FIGHTERS, SKILLS } from '../src/core/game.js';
import { tileKey, hexDist, COLS } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';

function seeded(seed = 42) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
function fixture(a = 'jotaro', b = 'dio') {
  const game = new Game({ random: seeded() });
  game.start(a, b);
  game.s.terrain = {};
  for (const [id, row, col] of [['p1-user', 5, 3], ['p1-stand', 5, 4], ['p2-user', 5, 6], ['p2-stand', 5, 5]]) Object.assign(game.unit(id), { row, col });
  return game;
}
function pillar(game, side, row, col, hp = 10) {
  const p = { id: `${side}-${row}-${col}`, kind: 'pillar', name: '绿宝石柱', side, row, col, hp, maxHp: 10 };
  game.s.pillars.push(p); return p;
}

test('character, skill and shared rule numbers retain their recorded values', () => {
  const baseline = JSON.parse(fs.readFileSync(new URL('../tools/rules-fingerprint.json', import.meta.url)));
  assert.deepEqual(RULE, baseline.RULE);
  for (const [key, values] of Object.entries(baseline.FIGHTERS)) {
    const f = FIGHTERS[key];
    const actual = { hp: f.hp, def: f.def, distLimit: f.distLimit, standDefBonus: f.standDefBonus,
      dmg: f.stand ? f.stand.dmg : (f.user.dmg || 0), range: f.stand ? f.stand.range : (f.user.range || 0),
      moveU: f.user.move, moveS: f.stand ? f.stand.move : 0,
      ...(f.solo ? { solo: true } : {}), ...(f.timeRule ? { timeRule: f.timeRule } : {}),
      ...(f.standName ? { standName: f.standName } : {}),
      ...(f.boss ? { boss: true } : {}) };
    assert.deepEqual(actual, values);
  }
  for (const [key, values] of Object.entries(baseline.SKILLS)) for (const [field, expected] of Object.entries(values)) {
    assert.equal(field === 'passive' ? !!SKILLS[key][field] : SKILLS[key][field], expected, `${key}.${field}`);
  }
});

test('terrain counts, protected spawn areas and duplicate fighter identities', () => {
  const g = new Game({ random: seeded() }); g.start('avdol', 'avdol');
  // ★ 2026-10-05：棋盘 14×11(154 格) → 18×13(234 格)，**地形数量按面积等比放大**（×1.52，四舍五入）：
  //   岩石 6→9、草丛 4→6、恢复点 2→3、毒沼 2→3。判据（不与出生点相邻）一个字没动，见下面那条。
  assert.deepEqual(Object.fromEntries(['rock', 'bush', 'heal', 'hazard'].map(t => [t, Object.values(g.s.terrain).filter(x => x === t).length])), { rock: 9, bush: 6, heal: 3, hazard: 3 });
  for (const u of g.s.units) for (const t of g.tiles.filter(t => g.s.terrain[tileKey(t)])) assert.ok(hexDist(g.tile(u), t) > 1);
  assert.equal(new Set(g.s.units.map(u => u.id)).size, 4);
  // ⚠️ 阿布德尔血量 2026-09-30 从 45 改成 40（用户要求），所以这里是 40/40
  assert.deepEqual(g.s.hp, { p1: 40, p2: 40 });
});

test('开局站位左右镜像对称：双方都是替身靠中、使者在两侧', () => {
  const g = new Game({ random: seeded() }); g.start('jotaro', 'dio');
  const at = id => { const u = g.unit(id); return [u.row, u.col]; };
  const [rowP1, colP1User] = at('p1-user');
  // ★ 2026-10-05 棋盘放大后重排的 1v1 四枚棋子：行＝棋盘正中的那一行(13 行 → 6)，
  //   列从旧的 2/4 ↔ 11/9 变成 **3/5 ↔ 14/12**（离左右边各 3 列，镜像列 ＝ COLS−1−列 ＝ 17−列）。
  assert.deepEqual(at('p1-user'), [6, 3]);
  assert.deepEqual(at('p1-stand'), [6, 5]);
  // P2 与 P1 关于棋盘中心左右镜像（18 列 → 镜像列 = COLS − 1 − 列）；镜像列**由 COLS 算**，不写死
  assert.deepEqual(at('p2-user'), [rowP1, COLS - 1 - colP1User]);
  assert.deepEqual(at('p2-stand'), [6, COLS - 1 - 5]);
  // 双方替身都比使者更靠近中线，且同伴连携距离相同
  const toCenter = id => Math.abs((COLS - 1) / 2 - g.unit(id).col);
  assert.ok(toCenter('p1-stand') < toCenter('p1-user'), 'P1 替身更靠中');
  assert.ok(toCenter('p2-stand') < toCenter('p2-user'), 'P2 替身更靠中');
  assert.equal(g.pairDistance('p1'), g.pairDistance('p2'));
});

test('one move consumes one AP, respects blockers and final partner distance', () => {
  const g = fixture(), u = g.unit('p1-user');
  const target = g.reachable(u)[0];
  assert.ok(g.move(u, target)); assert.equal(g.s.ap.p1, 2);
  assert.equal(g.tile(u), target); assert.ok(g.pairDistance('p1') <= 2);
  const blocked = g.reachable(u)[0]; g.s.terrain[tileKey(blocked)] = 'rock';
  assert.equal(g.move(u, blocked), false); assert.equal(g.s.ap.p1, 2);
  assert.match(g.s.notice.text, /岩石/);
  assert.equal(g.move(u, g.at(10, 13)), false); assert.match(g.s.notice.text, /同伴/);
  assert.equal(g.move(g.unit('p2-user'), g.at(5, 8)), false);
});

test('rejected attacks and skills never spend AP, cooldown or HP', () => {
  const g = fixture(), u = g.unit('p1-user'), stand = g.unit('p1-stand'), target = g.unit('p2-user');
  assert.equal(g.attack(u, target), false);
  assert.equal(g.beginSkill(u, 'ora'), false);
  assert.equal(g.beginSkill(stand, 'drain'), false);
  Object.assign(target, { row: 10, col: 13 });
  assert.equal(g.attack(stand, target, 'ora'), false);
  assert.equal(g.s.ap.p1, 3); assert.equal(g.s.hp.p2, 40); assert.deepEqual(g.s.cd.p1, {});
});

test('normal attack and all four damage skills match the displayed damage and defense preview', () => {
  for (const [fighter, skill, expected] of [['jotaro', null, 2], ['jotaro', 'ora', 12], ['jotaro', 'star', 1], ['kakyoin', 'splash', 10], ['dio', 'drain', 1]]) {
    const g = fixture(fighter, 'dio');
    const u = g.unit(skill === 'drain' ? 'p1-user' : 'p1-stand'), target = g.unit('p2-stand');
    Object.assign(u, { row: 5, col: 4 });
    g.s.terrain['5,5'] = 'bush'; g.s.terrain['4,5'] = 'rock';
    pillar(g, 'p1', 1, 1); pillar(g, 'p1', 1, 2);
    const pv = g.preview(u, target, skill);
    assert.equal(pv.damage, expected, `${fighter} / ${skill}`);
    const before = g.s.hp.p2;
    assert.ok(g.attack(u, target, skill));
    assert.equal(before - g.s.hp.p2, pv.damage);
    assert.equal(g.s.hp.p2, pv.hpAfter);
    assert.equal(g.s.ap.p1, 3 - (skill ? SKILLS[skill].cost : 1));
  }
});

test('splash scales 6 + 6 per pillar and its cooldown is 3', () => {
  const g = fixture('kakyoin', 'dio'), u = g.unit('p1-stand'), target = g.unit('p2-stand');
  Object.assign(u, { row: 5, col: 4 });
  assert.equal(SKILLS.splash.cd, 3, 'CD 3 回合');
  assert.equal(SKILLS.splash.base, 6);
  assert.equal(SKILLS.splash.perPillar, 6);
  assert.equal(g.preview(u, target, 'splash').attack, SKILLS.splash.base, '无柱子时 6');
  pillar(g, 'p1', 1, 1);
  assert.equal(g.preview(u, target, 'splash').attack, SKILLS.splash.base + SKILLS.splash.perPillar, '1 根柱子 = 12');
  pillar(g, 'p1', 1, 2);
  assert.equal(g.preview(u, target, 'splash').attack, SKILLS.splash.base + 2 * SKILLS.splash.perPillar, '2 根柱子 = 18');
  assert.ok(g.attack(u, target, 'splash'));
  assert.equal(g.s.cd.p1.splash, 3, '使用后进入 3 回合冷却');
});

test('pillar defense, capacity, damage bonus and no backlash when shattered', () => {
  const g = fixture('kakyoin', 'dio'), stand = g.unit('p1-stand');
  g.select(stand.id); assert.ok(g.beginSkill(stand, 'emerald'));
  const t = g.placement(stand).find(t => hexDist(t, g.tile(stand)) === 1);
  assert.equal(SKILLS.emerald.cost, 1, '绿宝石消耗 1 AP');
  assert.ok(g.place(stand, t));
  assert.equal(g.s.ap.p1, 2, '放一根柱子只花 1 AP（起手 3 → 2）');
  assert.equal(g.s.cd.p1.emerald, 2);
  // 新建宝石柱的血量必须来自规则数据（现为 10），别让这个数值悄悄跑掉
  const created = g.s.pillars.at(-1);
  assert.equal(SKILLS.emerald.pillarHp, 10, '绿宝石柱血量应为 10');
  assert.equal(created.hp, 10, '新柱子出生即满血 10');
  assert.equal(created.maxHp, 10, '新柱子上限 10');
  assert.equal(g.pillarDef(stand), 1); assert.equal(g.damageBonus(stand), 1);
  pillar(g, 'p1', 1, 1); pillar(g, 'p1', 1, 2); g.s.cd.p1.emerald = 0; g.s.ap.p1 = 3;
  assert.match(g.skillReason(stand, 'emerald'), /上限/);
  // 打碎宝石柱：不再反噬花京院方，也不会因此直接获胜，局面继续
  const target = g.s.pillars[0]; target.hp = 1; g.s.hp.p1 = 4; g.s.turn = 'p2';
  const attacker = g.unit('p2-stand'); Object.assign(attacker, { row: target.row, col: target.col + 1 });
  const pv = g.preview(attacker, target);
  assert.equal(pv.lethal, true, '这一击足以打碎柱子');
  assert.equal(pv.wins, false, '打碎柱子不算获胜');
  assert.equal(pv.backlash, undefined, '预览里已没有反噬伤害');
  assert.ok(g.attack(attacker, target));
  assert.equal(g.s.pillars.includes(target), false, '柱子被打碎并移除');
  assert.equal(g.s.hp.p1, 4, '花京院方不因柱子碎裂掉血');
  assert.equal(g.s.phase, 'battle', '对局继续，碎柱不会终结比赛');
});

test('绿宝石柱：贴着多根柱子也封顶 +1 防御（2026-10-03 用户从「贴几根加几点」改成不叠加）', () => {
  const g = fixture('kakyoin', 'dio'), stand = g.unit('p1-stand');
  const before = g.defense(stand).total;
  const near = g.tiles.filter(t => hexDist(t, g.tile(stand)) === 1).slice(0, 2);
  assert.equal(near.length, 2, '替身周围至少有两格可摆柱子');
  near.forEach((t, i) => g.s.pillars.push({ id: `np-${i}`, kind: 'pillar', name: '绿宝石柱', side: 'p1', row: t.row, col: t.col, hp: 10, maxHp: 10 }));
  assert.equal(g.pillarDef(stand), 1, '紧贴一根就是 +1');
  assert.equal(g.defense(stand).total, before + 1, '紧贴两根也还是 +1（不叠加）');
  // 「己方」按**同队**算：2v2 里队友贴着同一根柱子同样吃得到
  const p0 = g.s.pillars.at(-1);
  const buddy = near.find(t => !(t.row === p0.row && t.col === p0.col));
  assert.equal(g.pillarDef({ slot: 'p1b', kind: 'user', row: buddy.row, col: buddy.col }), 1, '同队队友贴着同一根柱子也 +1');
});

test('pillar regen: 只要场上有己方柱子，自己回合开始时回 1 HP（不叠加、有上限、受灼烧减疗）', () => {
  assert.equal(RULE.pillarRegen, 1, '有柱子时每回合的回血量应为 1');

  // 没有柱子 → 不回血
  const none = fixture('kakyoin', 'dio');
  none.s.hp.p1 = 20;
  none.endTurn(); none.endTurn();
  assert.equal(none.s.turn, 'p1', '已轮回到花京院自己的回合');
  assert.equal(none.s.hp.p1, 20, '一根柱子都没有时不回血');

  // 1 根 → +1
  const one = fixture('kakyoin', 'dio');
  one.s.hp.p1 = 20; pillar(one, 'p1', 1, 1);
  one.endTurn(); one.endTurn();
  assert.equal(one.s.hp.p1, 21, '1 根柱子回 1 HP');

  // 3 根 → 仍然只回 1（不叠加，这是本条规则的重点）
  const three = fixture('kakyoin', 'dio');
  three.s.hp.p1 = 20;
  pillar(three, 'p1', 1, 1); pillar(three, 'p1', 1, 2); pillar(three, 'p1', 2, 1);
  three.endTurn(); three.endTurn();
  assert.equal(three.s.hp.p1, 21, '3 根柱子也只回 1 HP（不叠加）');

  // 只有柱子的主人享受：对手回合开始时不给自己回血
  const opp = fixture('kakyoin', 'dio');
  opp.s.hp.p1 = 20; pillar(opp, 'p1', 1, 1);
  opp.endTurn();
  assert.equal(opp.s.turn, 'p2', '轮到 DIO');
  assert.equal(opp.s.hp.p1, 20, '对手回合开始不会给花京院回血');

  // 对手的柱子也不会给花京院回血
  const theirs = fixture('kakyoin', 'dio');
  theirs.s.hp.p1 = 20; pillar(theirs, 'p2', 1, 1); pillar(theirs, 'p2', 1, 2);
  theirs.endTurn(); theirs.endTurn();
  assert.equal(theirs.s.hp.p1, 20, '敌方柱子不回己方的血');

  // 不会超过血量上限
  const capped = fixture('kakyoin', 'dio');
  capped.s.hp.p1 = FIGHTERS.kakyoin.hp - 1;
  pillar(capped, 'p1', 1, 1); pillar(capped, 'p1', 1, 2); pillar(capped, 'p1', 2, 1);
  capped.endTurn(); capped.endTurn();
  assert.equal(capped.s.hp.p1, FIGHTERS.kakyoin.hp, '回血不会超过血量上限');

  // 灼烧减疗：本应回 1，受灼烧影响减半向上取整 → 仍是 1；
  // 期间自己回合结束先被灼烧扣了 3 点，所以 20 − 3 + 1 = 18
  const burned = fixture('kakyoin', 'dio');
  burned.s.hp.p1 = 20; burned.s.burn.p1 = 3;
  pillar(burned, 'p1', 1, 1); pillar(burned, 'p1', 1, 2); pillar(burned, 'p1', 2, 1);
  burned.endTurn(); burned.endTurn();
  assert.equal(burned.s.hp.p1, 18, '灼烧时回血减半（20 − 灼烧3 + 减半后的1 = 18）');
});

test('DIO drain heals actual capped amount, crystals do not provide blood, >10 enables empowerment', () => {
  const g = fixture('dio', 'avdol'), dio = g.unit('p1-user'), target = g.unit('p2-user');
  // ⚠️ DIO 血量 2026-09-30 改为 40，所以这里不能再用 40 起步（满血就吸不回来、永远触发不了强化）。
  Object.assign(dio, { row: 5, col: 4 }); g.s.hp.p1 = 30; g.s.drainHeal.p1 = 10;
  const pv = g.preview(dio, target, 'drain');
  assert.ok(g.attack(dio, target, 'drain')); assert.equal(g.s.hp.p1, 30 + pv.heal);
  assert.ok(g.s.vampCharged.p1);
  const crystal = pillar(g, 'p2', 4, 4); g.s.cd.p1.drain = 0;
  const before = g.s.hp.p1; assert.ok(g.attack(dio, crystal, 'drain')); assert.equal(g.s.hp.p1, before);
});

test('trauma applies once and affects only stand defense; burn stacks, end damage and healing reduction agree', () => {
  const g = fixture('kakyoin', 'dio'), u = g.unit('p1-stand'), target = g.unit('p2-stand');
  assert.ok(g.attack(u, target)); assert.equal(g.standBonus('p2'), 1); assert.equal(g.s.traumaUsed.p1, true);
  assert.ok(g.attack(u, target)); assert.equal(g.s.traumaCut.p2, 1); assert.equal(g.fighter('p2').def, 2);
  const fire = fixture('avdol', 'dio'), attacker = fire.unit('p1-stand'), victim = fire.unit('p2-user');
  for (let i = 0; i < 4; i++) { fire.s.ap.p1 = 5; assert.ok(fire.attack(attacker, victim)); }
  // ★ 灼烧上限 2026-09-30 从 3 改成 2（用户："阿布德尔灼烧层数改为 2"）
  assert.equal(RULE.burnMax, 2, '灼烧上限为 2 层');
  assert.equal(fire.s.burn.p2, 2, '打再多也只叠到上限 2 层');
  assert.equal(fire.heal('p2', 7, '测试治疗', victim), 4);
  fire.endTurn(); const hp = fire.s.hp.p2; fire.endTurn(); assert.equal(fire.s.hp.p2, hp - 2, '2 层灼烧 = 回合结束掉 2 点血');
});

test('flame placement charges on first valid tile only, accepts continuations with zero AP and preserves committed tiles', () => {
  assert.equal(SKILLS.flame.cost, 1, '★ 用户 2026-09-30：火焰道路 2 AP → 1 AP');
  const g = fixture('avdol', 'dio'), u = g.unit('p1-stand'); g.s.ap.p1 = 2;
  g.select(u.id); g.beginSkill(u, 'flame');
  assert.equal(g.s.ap.p1, 2); assert.equal(g.place(u, g.at(0, 13)), false); assert.equal(g.s.ap.p1, 2);
  g.cancel(); assert.equal(g.s.fire.length, 0); assert.equal(g.s.ap.p1, 2);
  g.beginSkill(u, 'flame'); g.place(u, g.placement(u)[0]); assert.equal(g.s.ap.p1, 1, '第一格扣掉这次的消耗（现在是 1 AP）');
  assert.equal(g.s.pendingSkill, 'flame');
  g.place(u, g.placement(u)[0]); assert.equal(g.s.ap.p1, 1, '后续火焰格不再扣 AP'); assert.equal(g.s.fire.length, 2);
  const first = g.s.fire[0], second = g.s.fire[1]; assert.equal(hexDist(g.tile(first), g.tile(second)), 1);
  g.cancel(); assert.equal(g.s.pendingSkill, null); assert.equal(g.s.fire.length, 2); assert.equal(g.s.cd.p1.flame, 2);
  assert.match(g.s.notice.text, /不会撤销/);
});

test('fire triggers once per movement, own fire is harmless and lethal crossings stop at the death tile', () => {
  for (const [own, lethal] of [[false, false], [true, false], [false, true]]) {
    const g = fixture(), u = g.unit('p1-user');
    const target = g.reachable(u).find(t => g.paths(u).get(tileKey(t)).length >= 2);
    const path = g.paths(u).get(tileKey(target));
    g.s.fire = path.map(t => ({ row: t.row, col: t.col, side: own ? 'p1' : 'p2' }));
    if (lethal) g.s.hp.p1 = 3;
    const before = g.s.hp.p1; g.move(u, target);
    assert.equal(before - g.s.hp.p1, own ? 0 : 3); assert.equal(g.s.burn.p1, own ? 0 : 1);
    if (lethal) { assert.equal(g.s.winner, 'p2'); assert.equal(g.tile(u), path[0]); }
  }
});

test('blaze clears all fire, respects burn healing, and can only be used once', () => {
  const g = fixture('avdol', 'dio'), u = g.unit('p1-stand');
  assert.match(g.skillReason(u, 'blaze'), /没有火焰/);
  g.s.fire = [{ side: 'p1', row: 0, col: 0 }, { side: 'p2', row: 0, col: 1 }, { side: 'p2', row: 0, col: 2 }];
  g.s.hp.p1 = 30; g.s.burn.p1 = 1;
  assert.ok(g.beginSkill(u, 'blaze')); assert.equal(g.s.fire.length, 0); assert.equal(g.s.hp.p1, 33);
  assert.equal(g.s.ap.p1, 2); assert.match(g.skillReason(u, 'blaze'), /已使用/);
});

test('terrain landing effects: full-health pickup retained, capped heal consumed, bushes expire and poison can end a game', () => {
  const g = fixture(), u = g.unit('p1-user'), tile = g.tile(u);
  g.s.terrain[tileKey(tile)] = 'heal'; g.applyTerrain(u); assert.equal(g.s.terrain[tileKey(tile)], 'heal');
  g.s.hp.p1 = 38; g.applyTerrain(u); assert.equal(g.s.hp.p1, 40); assert.equal(g.s.terrain[tileKey(tile)], undefined);
  g.s.terrain[tileKey(tile)] = 'bush'; g.applyTerrain(u);
  g.endTurn(); assert.equal(g.s.terrain[tileKey(tile)], 'bush');
  g.endTurn(); assert.equal(g.s.terrain[tileKey(tile)], undefined);
  g.s.terrain[tileKey(tile)] = 'hazard'; g.s.hp.p1 = 3; g.applyTerrain(u); g.checkEnd();
  assert.equal(g.s.hp.p1, 0); assert.equal(g.s.winner, 'p2');
});

test('Jotaro can select and stop time at zero AP; a skipped turn requires no manual input', () => {
  const g = fixture(); g.s.hp.p1 = 20; g.s.ap.p1 = 0; g.checkTimeWindow();
  assert.ok(g.select('p1-stand')); assert.ok(g.beginSkill(g.selected, 'time'));
  assert.equal(g.s.ap.p1, 0); g.endTurn();
  assert.equal(g.s.turn, 'p1'); assert.equal(g.s.turnNumber, 3); assert.equal(g.s.ap.p1, 3);
  assert.equal(g.s.log.filter(e => e.type === 'skip').length, 1);
  assert.match(g.skillReason(g.unit('p1-stand'), 'time'), /已使用/);
});

test('missed Jotaro window stays closed; DIO can retain it and empowered AP is visible as four', () => {
  const g = fixture(); g.s.hp.p1 = 20; g.checkTimeWindow(); g.endTurn(); g.endTurn();
  assert.equal(g.timeAvailable('p1'), false); assert.match(g.skillReason(g.unit('p1-stand'), 'time'), /已错过/);
  const dio = fixture('dio', 'avdol'); dio.s.hp.p1 = FIGHTERS.dio.hp / 2;   // 半血线（血量不再写死，跟着数据走）
  dio.endTurn(); dio.endTurn(); assert.ok(dio.timeAvailable('p1'));
  dio.s.vampCharged.p1 = true; dio.beginSkill(dio.unit('p1-stand'), 'time'); dio.endTurn();
  assert.equal(dio.s.turn, 'p1'); assert.equal(dio.s.ap.p1, 4); assert.equal(dio.s.turnAP.p1, 4);
  dio.endTurn(); dio.endTurn(); assert.equal(dio.s.ap.p1, 3);
});

test('cooldowns tick on own turns; reset clears pending actions, results, status, AP and logs', () => {
  const g = fixture(); const u = g.unit('p1-stand'); g.attack(u, g.unit('p2-stand'), 'ora');
  assert.equal(g.s.cd.p1.ora, 2); g.endTurn(); assert.equal(g.s.cd.p1.ora, 2); g.endTurn(); assert.equal(g.s.cd.p1.ora, 1);
  g.endTurn(); g.endTurn(); assert.equal(g.s.cd.p1.ora, 0);
  g.s.burn.p1 = 2; g.s.skipSide = 'p2'; g.select(u.id); g.beginSkill(u, 'star');
  const epoch = g.epoch; g.resign('p1'); assert.equal(g.s.winner, 'p2'); assert.equal(g.attack(u, g.unit('p2-user')), false);
  g.reset(); assert.ok(g.epoch > epoch);
  assert.equal(g.s.phase, 'select'); assert.equal(g.selected, null); assert.equal(g.s.pendingSkill, null);
  assert.equal(g.s.skipSide, null); assert.deepEqual(g.s.ap, { p1: 0, p2: 0 }); assert.deepEqual(g.s.log, []);
  assert.deepEqual(g.s.burn, { p1: 0, p2: 0 }); assert.equal(g.s.units.length, 0);
  g.start('avdol', 'kakyoin', 'ai'); assert.deepEqual(g.s.hp, { p1: 40, p2: 40 }); assert.equal(g.s.mode, 'ai');
});

test('all 16 fighter pairings over two maps converge with valid AP, HP, positions and partner distances', () => {
  for (const seed of [13, 9421]) for (const a of Object.keys(FIGHTERS)) for (const b of Object.keys(FIGHTERS)) {
    const g = new Game({ random: seeded(seed) }); g.start(a, b); let actions = 0;
    while (g.s.phase === 'battle' && actions < 500) {
      assert.ok(playAIAction(g, chooseAI(g)), `${a}/${b}: rejected decision`); actions++;
      for (const side of ['p1', 'p2']) {
        assert.ok(Number.isFinite(g.s.hp[side]) && g.s.hp[side] >= 0 && g.s.hp[side] <= g.fighter(side).hp);
        assert.ok(Number.isInteger(g.s.ap[side]) && g.s.ap[side] >= 0 && g.s.ap[side] <= 4);
        assert.ok(g.pairDistance(side) <= g.distLimit(side));
      }
      const occupied = [...g.s.units, ...g.s.pillars].map(u => tileKey(g.tile(u)));
      assert.equal(new Set(occupied).size, occupied.length);
    }
    assert.equal(g.s.phase, 'result', `${a}/${b} seed ${seed} did not finish`);
  }
});

test('★ 认输的 result 事件带 resigned 旗标（界面据此跳过排队台词、立刻弹结算）', () => {
  // 用户 2026-09-30：「点击认输结算太慢」——认输时还排着开场那条 9 秒的「关卡机制」提示，
  // 原来的逻辑要等台词全部播完才弹结算。旗标让界面能区分"主动认输"和"被击倒"。
  const events = [];
  const g = new Game({ random: seeded(21), onEvent: event => events.push(event) });
  g.start('jotaro', 'dio', 'ai');
  const last = () => events.filter(event => event.type === 'result').at(-1);

  g.resign('p1');
  assert.equal(g.s.phase, 'result');
  assert.equal(g.s.winner, 'p2', '认输＝对方获胜');
  assert.equal(last()?.resigned, true, '★ 主动认输要带 resigned: true');
  assert.equal(last()?.reason, 'P1 主动认输');

  // 被击倒（共享生命归零）不能带这个旗标——那种情况仍然要等"击倒对手"那句台词播完
  const killed = [];
  const g2 = new Game({ random: seeded(22), onEvent: event => killed.push(event) });
  g2.start('jotaro', 'dio', 'ai');
  g2.s.hp.p1 = 0;
  assert.equal(g2.checkEnd(), true);
  const result = killed.filter(event => event.type === 'result').at(-1);
  assert.equal(result?.resigned, false, '击倒对手不是认输，界面仍要等台词');
  assert.equal(result?.reason, '共享生命归零');
});
