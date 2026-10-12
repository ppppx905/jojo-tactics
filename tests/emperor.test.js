/**
 * 第八章「皇帝与吊死者」（第 27–32 话）——**第②步**的回归：
 * 两个 boss 的数据、素材登记、章节入口、AI 能打完。
 *
 * 设计文档：`design/第八章设计草案.md`（数值全部经用户逐条拍板）；
 * ★★ **2026-10-03 用户改版：这一章拆成了两阶段两场**，规格文档是 `design/第八章-两阶段改版.md`，
 *    它覆盖草案里"单场战斗／三人同场"那部分。所以这个文件里三处断言按改版改掉了：
 *      · 章节入口：`['read','battle','read']` → **`['read','battle','read','read','battle','read']`**（一章两场）；
 *      · 席位：`chapter.ally` / `chapter.enemy2`（章节级）→ **各幕的 `scene.lineup`**（两场阵容不一样）；
 *      · 规则文案：章节级 `specialRules` → **各幕的 `scene.specialRules`**（只有阶段 1 有冷枪、
 *        只有阶段 2 有反光点）。
 *    ✅ 反光点（第③步）与场边冷枪（第④步）的机制回归分别在 `mirrors.test.js` / `sniper.test.js`，
 *       两阶段的整体回归在 `tests/chapter8-phases.test.js`。
 *    ⏳ 还没做（别在这些测试里提前假设）：AI 友军优先烧镜面（第⑤步）。
 *
 * ★★ **2026-10-03 第三条用户拍板（本次改版的最后一轮）**，这个文件里被它**直接推翻**的断言
 *    （只有这几条，其余一个字没动）：
 *      · 幕数：`['read','battle','read','read','battle','read']` → **`['read','battle','read','battle','read']`**
 *        （中间**只读第 3 段**；第 4–6 段整合到两场之后）；
 *      · 战后切片：`scenes.at(-1).from` 由 **5 → 3**（＝读第 4、5、6 段）；
 *      · 阶段 1 的胜负口径：`/一半/` → **把他打空才算赢**，并新增两条"「瞄准」「皇帝」不在规则里抄机制"；
 *      · `FIGHTERS.emperor.boss`：**`true` → `undefined`**（他改成 PvP 可选角色）；
 *      · 选人列表：`list.includes('emperor')` 由 **false → true**（`geil` 仍然 false）。
 *    阶段 1 的"打空血才判胜 / 半血不再结束"的回归在 `tests/chapter8-rework.test.js`。
 *
 * ★★★ **2026-10-03 第四条用户拍板**（阶段 1 改成"注定打不过"的剧情战），这个文件里被它
 *    **直接推翻**的断言只有这两处（其余一个字没动）：
 *      · 战后切片：`scenes.at(-1).from === 3`（第 4–6 段）→ **`parts: [[3,4],[5,6]]`**
 *        （第 5 段挪到两场之间去了，战后只剩第 4、6 段，**不连续**所以改用 `parts`）；
 *      · 阶段 1 的规则文案：`/打到 0 就结束这一场/` ＋ `/一半/` 不许出现 → 改成
 *        **"这一场你赢不了"＋"最低只会停在 1"＋"一半"＋"故事照常往下走"**。
 *    阶段 1 必败剧情战本身的回归在 `tests/chapter8-scripted-loss.test.js`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, STORY_CHAPTERS, playableFighters } from '../src/core/game.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { CHARACTER_ART } from '../src/ui/assets.js';

const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
/** 两幕战斗（阶段 1 / 阶段 2）——**按阵容认**，不写死下标（免得以后插一幕就全崩）。 */
const phase1 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'emperor');
const phase2 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'geil');
/** 按某一幕的阵容开一局（＝ main.js 里 startStoryMatch + startMatch 那一套的等价写法）。 */
function startStage(game, scene) {
  const { player, ally = null, enemy, enemy2 = null } = scene.lineup;
  game.setRoster({ p1b: ally, p2b: enemy2, story: true, scene });
  return game.start(player, enemy, 'ai', { story: chapter8.id });
}

test('第八章数据：两阶段两场（读→打→读→打→读）、每场自带阵容与旗标、台词与本关规则都写齐', () => {
  assert.ok(chapter8, '第八章要在章节列表里');
  assert.equal(chapter8.label, '第八章');
  assert.equal(chapter8.eyebrow, 'CHAPTER 08');
  assert.equal(chapter8.title, '皇帝与吊死者');
  assert.equal(chapter8.player, 'polnareff');
  assert.equal(chapter8.enemy, 'geil');
  // ★ 改版：席位从章节级挪到**幕**上（两场阵容不一样），章节上不再有 ally / enemy2。
  assert.equal(chapter8.ally, undefined, '★ 阵容改成按幕声明：阶段 1 没有友军');
  assert.equal(chapter8.enemy2, undefined, '★ 阶段 2 的敌人也由幕声明');
  assert.deepEqual(chapter8.scenes.map(s => s.kind), ['read', 'battle', 'read', 'battle', 'read'],
    '★ 一章两场：读（战前）→ 打（阶段 1）→ 读（中间，**只读第 3 段**）→ 打（阶段 2）→ 读（战后）');
  assert.equal(chapter8.scenes[0].upto, 2, '★ 战前＝第 1–2 段');
  assert.deepEqual(phase1.lineup, { player: 'polnareff', enemy: 'emperor' }, '★ 阶段 1：波鲁纳雷夫单挑皇帝');
  assert.deepEqual(phase2.lineup, { player: 'polnareff', ally: 'kakyoin', enemy: 'geil' },
    '★ 阶段 2：波鲁纳雷夫 ＋ 电脑控制的花京院 对 吊死者');
  // ★★ 2026-10-03 第三条用户拍板：**第 4、5、6 段一起放在两场之后**（`from: 3` ＝ 第 4 段开头），
  //    于是第 5 段（封镜逼现身 ＋ 阿布德尔中弹）不再提前泄露阶段 2 的内容。
  assert.equal(chapter8.scenes.at(-1).kind, 'read');
  // ★★ 2026-10-03 第四条用户拍板：战后改读**第 4、6 段**（第 5 段挪到两场之间去了——阿布德尔的死
  //    就发生在阶段 1 之后）。两段**不连续**，所以写的是 `parts`（半开区间），不再是 `from`。
  assert.deepEqual(chapter8.scenes.at(-1).parts, [[3, 4], [5, 6]], '★ 战后＝第 4 段 ＋ 第 6 段');
  assert.equal(chapter8.scenes.at(-1).from, undefined, '★ 不连续的切法用 parts，不用 from/upto');
  // ★★ 两条机制**分属两场**：旗标写在幕上，绝不写回章节级（否则两场都会带上不该有的机制）。
  assert.equal(phase1.sniper, true, '★ 冷枪只在阶段 1 生效');
  assert.equal(phase1.mirrors, undefined, '★ 阶段 1 没有反光点');
  assert.equal(phase2.mirrors, true, '★ 反光点只在阶段 2 生效');
  assert.equal(phase2.sniper, undefined, '★ 阶段 2 没有冷枪');
  assert.equal(chapter8.mirrors, undefined, '★ 章节级不许再挂 mirrors（"只要在第八章就都生效"是错的）');
  assert.equal(chapter8.sniper, undefined, '★ 章节级不许再挂 sniper');
  // ★ 章节级那份台词＝**第一场**的四句（本章默认）；第二场在幕上整份覆盖。
  for (const key of ['start', 'turn2', 'half', 'death']) {
    assert.ok(chapter8.barks?.[key], `四句台词缺 ${key}`);
    assert.ok(phase2.barks?.[key], `★ 阶段 2 也要有自己的四句（缺 ${key}）`);
  }
  assert.equal(phase2.barks.turn2.key, 'kakyoin', '★ 阶段 2 里阿布德尔已经不在场：说话人是花京院');
  // ★ 本关规则也按幕走：只有阶段 1 写冷枪、只有阶段 2 写反光点。
  const rules1 = (phase1.specialRules || []).join('');
  const rules2 = (phase2.specialRules || []).join('');
  assert.ok((phase1.specialRules || []).length >= 2, '阶段 1 的规则要写');
  assert.ok((phase2.specialRules || []).length >= 2, '阶段 2 的规则要写');
  assert.ok(/冷枪/.test(rules1) && /弹道/.test(rules1) && /6 点真实伤害/.test(rules1),
    '★ 阶段 1 的规则必须写清冷枪与弹道预告');
  // ★★★ 2026-10-03 第四条用户拍板：阶段 1 改成**"注定打不过"的剧情战**（原作里阿布德尔替波鲁纳雷夫
  //    挡下那一枪而死）。所以规则里**不再**写"打倒他就赢"，改成如实告诉玩家怎么结束这一场：
  //    他打不死（剧本保护到 1）＋ 波波掉到一半就是终点（判玩家战败、但故事继续）。
  assert.match(rules1, /这一场你赢不了/, '★ 阶段 1 的胜负口径：赢不了（旧的"打到 0 就结束这一场"已撤）');
  assert.match(rules1, /最低只会停在 1/, '★ 剧本保护要写清楚（他没有"被打倒"这回事）');
  assert.match(rules1, /一半/, '★ 触发点＝波波掉到一半（旧断言"规则里不许出现一半"被这条改版推翻）');
  assert.match(rules1, /故事照常往下走/, '★ 要写清"不是重打这一场"（剧情继续）');
  assert.equal(/打倒他就赢|打到 0 就结束这一场/.test(rules1), false, '★ 旧口径必须从规则里消失');
  assert.equal(/挡下|中弹|救他|扑上来/.test(rules1), false, '★ 规则里不许提前剧透"阿布德尔会来挡枪"');
  assert.equal(/反光点/.test(rules1), false, '★ 阶段 1 没有反光点，规则里不许提');
  // ★★ 2026-10-03 第五条用户要求：**「瞄准」「皇帝」两个技能不在本关规则里再抄一遍机制说明**
  //    （技能栏上已经写着，用户之前就退回了一次）。
  assert.equal(/瞄准/.test(rules1), false, '★ 规则里不许再抄一遍「瞄准」的机制说明');
  assert.equal(/锁定/.test(rules1), false, '★ 规则里不许再抄一遍「皇帝」的锁定说明');
  assert.ok(/反光点/.test(rules2) && /吊死者/.test(rules2), '★ 阶段 2 的规则必须写清反光点');
  assert.equal(/冷枪/.test(rules2), false, '★ 阶段 2 没有冷枪，规则里不许提');
  assert.equal(/阿布德尔由/.test(rules2), false, '★ 阿布德尔已经不在场了');
});

test('★ 两个对手的数值与用户拍板的一致（改之前必须先问）', () => {
  const geil = FIGHTERS.geil;
  assert.equal(geil.boss, true);
  assert.equal(geil.hp, 45, '共享血 45（比常规 boss 高 5，因为玩家手上有两个角色）');
  assert.equal(geil.def, 2);
  assert.equal(geil.distLimit, 4, '连携距离 4（吊死者常驻反光点，离本体很远）');
  // ★★ 2026-10-03 用户要求②：**替身防御加成 1 → 2**（`standDefBonus`，只动他一个）。
  //    ⚠️ 这一条是那次改动**直接推翻**的断言（原来写的是 1，理由写作"逮到它就打得痛"），
  //       除此之外这一条一个字没动；别的角色的那份断言（tower-of-gray / kakyoin 等）照旧是 1。
  assert.equal(geil.standDefBonus, 2, '★ 替身防御加成 2——逮到吊死者也要多啃一层防御');
  assert.deepEqual([geil.user.move, geil.user.range, geil.user.dmg], [3, 1, 6], '本体：移动 3 / 射程 1 / 攻击 6');
  // ★★ 2026-10-03 用户**第三次拍板**：给吊死者三条加强（见 `tests/hanged-man.test.js`）——
  //    **射程 2 → 3**、**自带 2 点穿甲**（`stand.armorPierce`）、**落点并上"未被占用的岩石格"**。
  //    ⚠️ 这条断言是那次加强**直接推翻**的（原来写的是 `[3, 2, 8]`），除此之外一个字没动：
  //       攻击 8 照旧、移动仍然是 3（理由见 rules.js 里 `FIGHTERS.geil` 那段注释）。
  assert.deepEqual([geil.stand.move, geil.stand.range, geil.stand.dmg], [3, 3, 8], '吊死者：射程 3 / 攻击 8（移动仍然是 3）');
  assert.equal(geil.stand.armorPierce, 2, '★ 自带 2 点穿甲（数据字段，只在 preview 里生效）');
  const emperor = FIGHTERS.emperor;
  // ★★ 2026-10-03 第三条用户拍板：**皇帝改成 PvP 可选角色** —— `boss: true` 撤掉了，
  //    于是他出现在选人列表里、真人也能亲手用「瞄准」与「皇帝」（见下面那条"两个 boss"的断言）。
  assert.equal(emperor.boss, undefined, '★ 他不再是 boss：不进选人列表的那条限制已经撤掉');
  assert.equal(emperor.solo, true, '霍尔·霍斯是单单位：皇帝不单独占棋子');
  assert.equal(emperor.stand, null);
  assert.equal(emperor.standName, '皇帝');
  assert.equal(emperor.hp, 40);
  // ★★ 2026-10-03 第二轮（用户拍板「重做霍尔·霍斯」，数值不许改）：**射程 4 → 5**。
  //    ⚠️ 这一条是那次重做**直接推翻**的断言（原来写的是 `[2, 4, 7]`），除此之外一个字没动：
  //       攻击 7 / 移动 2 照旧；射程 5 也不在 tools/rules-fingerprint.json 的基线里（那份压根没有 emperor 这一项）。
  //    ⚠️ 与射程一起加的还有两个技能（「瞄准」/「皇帝」），它们的回归在 `tests/emperor-skills.test.js`。
  assert.deepEqual([emperor.user.move, emperor.user.range, emperor.user.dmg], [2, 5, 7], '枪手：射程 5 / 攻击 7 / 移动 2');
  // ★★ 2026-10-03 改版：阶段 1 是**单挑**，所以旧设计那两条旗标按用户要求撤掉了
  //   （"撤掉 immune/pinned 在本章的作用"）——他能被打伤、也能追，靠射程与移动拉开距离。
  assert.equal(emperor.user.sniper, true, '★ 只剩 sniper 一个旗标（冷枪）');
  assert.equal(emperor.user.immune, undefined, '★ 「打不死」已撤：单挑要能打伤他');
  assert.equal(emperor.user.pinned, undefined, '★ 「钉在外圈」已撤：单挑要能追能打');
  // ★★ 2026-10-03 第三条用户拍板：**皇帝改成 PvP 可选角色（进选人列表）**，
  //    而 `geil`（J·凯尔）**仍然保持 boss: true、不进列表**（他是阶段 2 的敌人）。
  const list = playableFighters().map(f => f.key);
  assert.equal(list.includes('geil'), false, '★ J·凯尔仍然不进选人列表');
  assert.equal(list.includes('emperor'), true, '★ 皇帝现在进选人列表（用户要求：真人也能亲手用他那两个技能）');
});

test('素材登记：本体立绘与肖像／插画都指向已就位的图（替身立绘还差一张）', () => {
  const geil = CHARACTER_ART.geil;
  assert.equal(geil.user, 'geil');
  assert.equal(geil.stand, 'hanged_man', '吊死者要有自己那一份立绘键');
  assert.ok(fs.existsSync(new URL('../assets/out/standees/geil.webp', import.meta.url)), '本体立绘要在');
  assert.ok(fs.existsSync(new URL('../assets/out/portraits/geil.webp', import.meta.url)), '肖像要在');
  assert.ok(fs.existsSync(new URL('../assets/out/cutins/geil.webp', import.meta.url)), '大招插画要在');
  // ★ 2026-10-03：这张图**已经补上了**（用户确认那版，压成 192×288 的 hanged_man.webp）——
  //   断言从"必须是缺失状态"翻过来，素材检查也因此归零（缺失 0 项）。
  assert.ok(fs.existsSync(new URL('../assets/out/standees/hanged_man.webp', import.meta.url)),
    '★ 吊死者的替身立绘必须就位（第八章那个棋子靠它，缺了就是占位图形）');
  const emperor = CHARACTER_ART.emperor;
  assert.equal(emperor.user, 'hol_horse', '他的本体立绘键叫 hol_horse');
  assert.equal(emperor.stand, null, '单单位没有替身那一份');
  assert.ok(fs.existsSync(new URL('../assets/out/standees/hol_horse.webp', import.meta.url)));
  // ⚠️ 肖像与插画的文件名必须跟着 CHARACTER_ART 的**键**（emperor），不是本体立绘键——
  //    这一条踩过坑：一开始存成了 hol_horse.webp，check-assets 直接报缺失。
  assert.ok(fs.existsSync(new URL('../assets/out/portraits/emperor.webp', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../assets/out/cutins/emperor.webp', import.meta.url)));
});

test('★ 第八章两场都能真的开打：阶段 1 是 1v1、阶段 2 是"波波 ＋ 电脑友军 对 J·凯尔"', () => {
  // ① 阶段 1：波鲁纳雷夫 单挑 皇帝——**阿布德尔不上场**，所以就是普通的 1v1 两个槽位。
  const one = new Game({ random: () => 0.5 });
  assert.equal(startStage(one, phase1), true);
  assert.deepEqual(one.s.slots, ['p1', 'p2'], '★ 阶段 1 是 1v1（没有友军）');
  assert.deepEqual(one.s.control, { p1: 'human', p2: 'ai' });
  assert.equal(one.s.units.length, 3, '波鲁纳雷夫 2 + 霍尔·霍斯 1（皇帝不单独占棋子）');
  assert.equal(one.s.hp.p2, 40);
  assert.equal(one.s.fighters.p2.key, 'emperor');
  assert.equal(one.s.units.filter(u => u.slot === 'p2').length, 1);
  assert.equal(one.sniperRule() !== null, true, '★ 这一场带冷枪');
  assert.deepEqual(one.s.mirrors, [], '★ 这一场没有反光点');

  // ② 阶段 2：波鲁纳雷夫 ＋ 电脑控制的花京院 对 吊死者——玩家侧两个角色、敌方一个（2 打 1）。
  const two = new Game({ random: () => 0.5 });
  assert.equal(startStage(two, phase2), true);
  assert.deepEqual(two.s.slots, ['p1', 'p1b', 'p2'], '★ 章节写死的席位允许"只给一边"（第八章阶段 2 就是 2 打 1）');
  assert.deepEqual(two.s.control, { p1: 'human', p1b: 'ai', p2: 'ai' }, '电脑友军与敌人都归电脑');
  assert.equal(two.s.units.length, 6, '波鲁纳雷夫 2 + 花京院 2 + J·凯尔 & 吊死者 2');
  assert.equal(two.s.hp.p1b, FIGHTERS.kakyoin.hp, '★ 友军是花京院');
  assert.equal(two.s.fighters.p1b.key, 'kakyoin');
  assert.equal(two.s.hp.p2, 45);
  assert.equal(two.s.fighters.p2.key, 'geil');
  assert.equal(two.sniperRule(), null, '★ 这一场没有冷枪');
  assert.equal(two.s.mirrors.length, 4, '★ 这一场有反光点');
  assert.deepEqual(two.turnOrder(), ['p1', 'p2', 'p1b'], '出手顺序仍然是交错的（3 个位子）');
});

test('★ 第八章两场都能被 AI 自动打完（AI 不能因为机制或移动力卡死）', () => {
  for (const [name, scene] of [['阶段 1', phase1], ['阶段 2', phase2]]) {
    for (const seed of [13, 7919]) {
      let state = seed;
      const game = new Game({ random: () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296) });
      startStage(game, scene);
      let guard = 0;
      while (game.s.phase === 'battle' && guard++ < 900) {
        const plan = chooseAI(game);
        if (!plan || !playAIAction(game, plan)) game.endTurn();
      }
      assert.ok(guard < 900, `${name} seed ${seed}：不能死在循环里`);
      assert.equal(game.s.phase, 'result', `${name} seed ${seed}：这一局要能分出胜负`);
      assert.ok(['p1', 'p2'].includes(game.s.winner), '胜负落在某一队上');
    }
  }
});
