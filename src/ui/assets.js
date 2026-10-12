export const CHARACTER_ART = {
  jotaro: { user: 'jotaro', stand: 'star_platinum', roman: 'JOTARO KUJO', type: '近战 · 精准破防', quote: '呀嘞呀嘞 daze。', accent: '#a78bda', brief: '贴近敌人，以欧拉欧拉突破防御。生命低于一半时，抓住仅此一回合的时停机会。' },
  dio: { user: 'dio', stand: 'the_world', roman: 'DIO', type: '续航 · 时间支配', quote: '世界，时间停止！', accent: '#e2bf5d', brief: '用使者的吸血维持生命，还能朝 3 格内掷出飞刀。生命低于一半后可以停住时间：对手的一个回合被跳过，而你多打一回合——那一回合里飞刀不占冷却，可以连续掷。' },
  kakyoin: { user: 'kakyoin', stand: 'hierophant', roman: 'NORIAKI KAKYOIN', type: '远程 · 阵地控制', quote: '接招吧，绿宝石水花！', accent: '#6dc6a2', brief: '保持三格连携距离，用宝石柱强化替身。柱子越多，绿宝石水花的爆发越强。' },
  avdol: { user: 'avdol', stand: 'magicians_red', roman: 'MUHAMMAD AVDOL', type: '灼烧 · 区域压制', quote: 'YES! I AM!', accent: '#e89459', brief: '攻击叠加持续灼烧，火焰道路封锁路线。必要时清除火焰，恢复自己的生命。' },
  polnareff: { user: 'polnareff', stand: 'silver_chariot', roman: 'JEAN PIERRE POLNAREFF', type: '爆发 · 卸甲换速', quote: '接招吧！', accent: '#9fb4d8', brief: '卸下铠甲换取行动点，攻击力随每次出手累积；再用直线剑刃在远处收割。防御一旦放弃就不会回来。' },
  // 单单位角色：stand 为 null 表示没有替身棋子（渲染、加载、界面都要跳过替身那一份）
  // ⚠️ 但他有替身「隐者之紫」（见 rules.js 的 standName），文案里不能写成"无替身"
  joseph: { user: 'joseph', stand: null, roman: 'JOSEPH JOESTAR', type: '战术 · 位移反制', quote: '你的下一句话是……', accent: '#c9a06a', brief: '替身「隐者之紫」不单独上阵，由本体自己打：3 格射程的普攻配合藤蔓缠绕限制对手走位，再用无视防御的波纹疾走收割被缠住的目标。' },
  iggy: { user: 'iggy', stand: 'the_fool', roman: 'IGGY', type: '机动 · 沙之替身', quote: '汪！', accent: '#dcc27e', brief: '小型犬与沙之替身「愚者」都很能跑（伊奇 4 格、愚者 4 格、连携 3 格）：潜沙不消耗行动点、随时互换位置并加防御；扬沙造成 3 点真实伤害、还让对手普攻有 30% 打空；贴身再用沙之爪打半血收益最高。' },
  // 剧情 boss：灰塔（第 9–10 话）。rules.js 里带 boss:true，**不进选人列表**，只在剧情模式当敌方。
  // 肖像与插画都已就位（portraits/gray_fly.webp、cutins/gray_fly.webp），所以不再带 artOptional，
  // 会正常参与"素材缺失"检查，结算画面也能正常出图。
  gray_fly: { user: 'gray_fly', stand: 'tower_of_gray', roman: 'GRAY FLY', type: '剧情 boss · 极速刺客', quote: '……', accent: '#b9bfc9', brief: '客机上的刺客。替身「灰塔」移动 5 格、全场最快，连携距离长达 4 格——可以远远放它出去贴脸；但射程只有 1、替身防御加成也只有 1，针舌穿刺对已经受伤的目标更狠。' },
  // 剧情 boss：暗蓝之月（第 14–16 话，开往新加坡的船上）。同样不进选人列表。
  // 四张素材（本体立绘 / 替身立绘 / 选人肖像 / 大招插画）都已就位，所以**不带 artOptional**，正常参与素材缺失检查。
  fake_captain: { user: 'fake_captain', stand: 'dark_blue_moon', roman: 'DARK BLUE MOON', type: '剧情 boss · 水下伏击', quote: '海面上没有你的规矩。', accent: '#2b4f8a', brief: '把对手拖进水里再用吸盘补刀的水生替身。替身射程只有 1、连携距离 3，但「拖入水下」挂上的【溺水】每回合结束都会掉真实伤害，它自己每回合还能靠「水下呼吸」回血——这一战不能拖。' },
  // 剧情 boss：力量（第 17–19 话，海面上那艘货轮）。
  // ⚠️ **单棋子 boss：替身「力量」没有棋子**（stand 为 null），因为整艘船就是它——
  //    由**整张棋盘**来当（船体要害 / 棋盘变形 / 分层推进，见 rules.js 的 STRENGTH）。
  //    所以这一关只需要 3 张图（本体立绘 + 肖像 + 插画），**省下替身立绘那一份**；
  //    船体要害用的是另一套小图（见下面的 PART_SPRITES）。
  //    三张都已就位，所以不再带 artOptional，正常参与素材缺失检查。
  forever: { user: 'forever', stand: null, roman: 'STRENGTH', type: '剧情 boss · 会呼吸的船', quote: '这整艘船，都是我的替身。', accent: '#7d6a52', brief: '使用者是一只猩猩，替身「力量」则是这艘货轮本身——它没有身体，整张棋盘就是它。船体要害一次只露出一个、固定在角落；从开局起你每个回合都在被船体挤压掉血，而每拆掉一个要害，你的攻击力就 +1。三个都拆完，猩猩才会现身。' },
  // 剧情 boss：黑檀之魔（第 20–22 话，新加坡旅馆的单人房间）。
  // ★ 四件套已齐（2026-09-30 补齐），所以**不再挂 artOptional**，正常参与素材缺失检查。
  //   造型依据：用户提供的**官方替身卡片**（`design/review/黑檀之魔-参考资料-官方卡片.png`，
  //   裁出人偶那张 `…-卡片裁剪.png` 一直留着，以后要重画照它来）。
  //   ⚠️ 教训：第一版把替身"真身"（深绿金属装甲、多只圆眼）的脸按到了人偶身上，
  //      被用户判定"差很多"；Wiki 上那张 `EbonyDevil.png` 是**真身原型**，游戏里用的是**人偶**，别混。
  ebony: { user: 'devo', stand: 'ebony_devil', roman: 'EBONY DEVIL', type: '剧情 boss · 暗处的人偶', quote: '越恨我，我越有力气。', accent: '#c9a227', brief: '使用者德沃操纵人偶，自己绝不出手——但他也站在场上，你可以直接打他（他没有替身那 +2 防御，打起来更疼）。替身「黑檀之魔」靠「被憎恨」变强：你每打中对方一次，憎恨 +1（打本体也算）、它攻击力 +1，最多 +4；你整整一个回合不打它，憎恨才会掉 1 点。' },
  // 剧情 boss：黄色节制（第 23–26 话，新加坡）。**单单位**（照乔瑟夫的做法：替身糊在身上，只有本体一枚棋子）。
  // ★ 三张素材已齐（2026-09-30），所以**不再挂 artOptional**，正常参与素材缺失检查。
  //   造型依据：用户提供的 `design/review/黄色节制-参考资料-{本体-动画截图,官方卡片}.png`
  //   ＋从 Fandom 图片服务器捞到的 `黄色节制-参考资料-替身-wiki.webp`（替身包住承太郎那张，看材质）。
  //   提示词：`design/prompts/{standees-rubber_soul,portraits-temperance,cutins-temperance}.txt`。
  temperance: { user: 'rubber_soul', stand: null, roman: 'YELLOW TEMPERANCE', type: '剧情 boss · 披着同伴的脸', quote: '这张脸，你认得吧？', accent: '#d9b53c', brief: '它顶着花京院的脸混进队伍——开局那一方就是花京院本人，用的是他的数值与技能。共享生命掉到一半以下，伪装破裂、现出本体「拉巴索 & 黄色节制」，并且血量重置为满血。本体没有连携限制，而且挂着【侵蚀】：他打中你之后，你每次自己出手普攻都会额外掉血——被打中之后就别再无脑平A了。' },
  // ★★ 剧情 boss：J·凯尔 & 吊死者（第八章／第 27–32 话，印度）。
  //   设计：`design/第八章设计草案.md`。本体立绘（geil）／选人肖像／大招插画都已就位；
  //   ⚠️ **替身「吊死者」的立绘（hanged_man）还差一张**——`tools/check-assets.mjs` 会把它算成缺失，
  //      画好放进来就归零（第八章正式开打前必须补上，否则那个棋子上是占位图形）。
  //   造型依据：用户提供的 `design/review/J凯尔-参考资料-本体-动画截图.png`、
  //   `design/review/吊死者-参考资料-替身-wiki.png`（裹绷带、只露一只眼、握大刀）。
  //   ★ 2026-10-04 用户要求②（顺手清理）：`brief` 里那处 `**自带 2 点穿甲**` 的 markdown 星号也去掉了
  //     （界面上是纯文本，星号会原样显示出来）。**只删星号，措辞与数值一字未动**。
  geil: { user: 'geil', stand: 'hanged_man', roman: 'J. GEIL', type: '剧情 boss · 镜中杀手', quote: '……', accent: '#9fb3c8', brief: '杀害波鲁纳雷夫妹妹的凶手，两只手都是右手。替身「吊死者」不进路面——它走反光的地方：镜面、金属、水洼，也钻得进岩石与建筑里（只要那块石头没被人占着，它花 1 点行动点就能跳过去，跳多远都行）。本体要贴到 1 格才打得动人；那个裹着绷带、只露出一只眼的替身有 3 格射程、还自带 2 点穿甲——挨它一刀，你身上的防御先被削掉 2 点，光靠草丛与石头挡不住它。' },
  // ★★ 霍尔·霍斯 & 皇帝（第八章阶段 1）。⚠️⚠️ **2026-10-03 第三条用户拍板：他改成了 PvP 可选角色**
  //   （`rules.js` 的 `FIGHTERS.emperor` 去掉了 `boss: true`）——于是他会出现在选人列表里，
  //   这一栏的 `type` 就**不能再写"剧情 boss"**（选人页头部与角色信息栏都会直接显示它，
  //   写成 boss 会与"能选他"自相矛盾）。这里跟着改成其他可选角色那种"定位 · 特点"的写法。
  // ★★ 2026-10-04 用户要求②（任务二）：`brief` 重写成**一句起头的短文案**（原来 143 字、还有一处裸露的
  //   markdown 星号，界面上会原样显示成 `**不单独占棋子**`）。口径照 jotaro / joseph / kakyoin 那几条：
  //   **2～3 句、简短、不带任何 markdown**，说清"他是谁 ＋ 射程 5 的枪手 ＋ 两个技能"。
  emperor: { user: 'hol_horse', stand: null, roman: 'HOL HORSE', type: '远程 · 外圈枪手', quote: '安心吧，我不会打偏的。', accent: '#c8a24a', brief: '替身「皇帝」就是他手上那把大号左轮，由他本人开枪，射程 5。他钉在远处放枪、不肯近身：「瞄准」让接下来两次攻击无视防御，「皇帝」则锁定一个单位，一回合后落下 10 点伤害。' },
  // ★★ 第四部：东方仗助 & 疯狂钻石（2026-10-09 用户设计：数值、被动与两个技能都由他拍板）。
  //   ⚠️ 三张图（立绘／肖像／插画）**还没画**——用户明确说"先不用管图"，所以先挂 `artOptional`：
  //      主界面不弹"素材未加载"警告，`tools/check-assets.mjs` 也不算它缺失。
  //      **图补齐后要把 `artOptional` 删掉**（见交接文档 §2 那条"素材可选"机制）。
  //      ⚠️ 右侧角色舱的肖像是写死的 `<img src="portraits/josuke.webp">`，图没画时那里会是破图
  //      （`artOptional` 只管预加载清单，管不到这一处，见交接文档陷阱 26）。
  josuke: { user: 'josuke', stand: 'crazy_diamond', roman: 'JOSUKE HIGASHIKATA', type: '支援 · 修复与破坏', quote: '我的疯狂钻石，会把一切修好。', accent: '#57c9d6', artOptional: true,
    brief: '普攻可以打在友军身上：治疗对方 攻击力 − 2 点生命；打在敌人身上则随机削掉它一项数值。近身有两倍攻击力的重拳，还能把队友重组回几个回合前。' },
};
export const portrait = key => `assets/out/portraits/${key}.webp`;
export const cutin = key => `assets/out/cutins/${key}.webp`;
export const piece = (fighter, kind) => `assets/out/standees/${CHARACTER_ART[fighter][kind]}.webp`;
/** 某个角色需要加载的立绘键（单单位角色没有替身那一份）。 */
export const artKeys = art => [art.user, art.stand].filter(Boolean);
/**
 * 战斗场地背景：铺在棋盘底下（会再压一层暗色蒙版，保证棋子可读）。
 * 指定方式有两条（都是**数据**说了算，别在别处按章节判断）：
 *   · 剧情章节——`STORY_CHAPTERS` 里写 `arena: 'plane'`，比如灰塔那一战发生在客机上；
 *   · ★ 地图自带的配套背景（2026-10-05 加地图体系）——`MAPS[地图].arena`，
 *     比如「浅滩水路」就是 `sea`。自由对局选到那张图，背景就跟着走（见 game.js 的 arenaKey）。
 * 两条都没指定就用默认的深色底。
 */
export const ARENAS = {
  plane: 'assets/out/arenas/plane.webp',
  // 海面：第四章（开往新加坡的船上）与地图「浅滩水路」共用这一张。
  // 背景里只有海，**船上的木甲板是代码画的**（见 render.js 的 drawSea 与 SEA_DECK 木甲板）。
  sea: 'assets/out/arenas/sea.webp',
  // 第五章「力量」：**一艘船分四层**，拆掉一个要害就推进一层（引擎中途换场地，见 game.js 的 arenaKey）
  'ship-deck': 'assets/out/arenas/ship-deck.webp',
  'ship-corridor': 'assets/out/arenas/ship-corridor.webp',
  'ship-engine': 'assets/out/arenas/ship-engine.webp',
  'ship-broken': 'assets/out/arenas/ship-broken.webp',
};
/**
 * ⚠️ **待补的场地背景**：这些键名已经登记在 `ARENAS` 里，但图**还没画完**——
 * 因为「拆一个要害换一层场地」是第五章的核心表现，键名漏登记的话背景会**静默变回默认深色底**，
 * 玩家只会觉得"这关怎么没背景"，很难查。
 * `tools/check-assets.mjs` 会把这里的键列成「待补（可选）」而不是缺失；**图画好后要把键从这里删掉**。
 * 第五章四层船舱（2026-09-27 全部画完 → 清单已清空）：deck / corridor / engine / broken。
 * ⚠️ 留着这个空集合是有意的：它和 `check-assets.mjs` 的配合已经用上两次，下次做新场地直接往里加键。
 */
export const PENDING_ARENAS = new Set();
/**
 * 场地专属的**地形皮肤**：效果与默认地形（岩石/草丛/恢复点/毒沼）一一对应，只换外观与名字。
 * 键名规则 `<场地>-<地形>`，渲染层据此取名，找不到皮肤就自动退回默认图（见 render.js 的 terrainSpriteKey）。
 */
export const TERRAIN_SKINS = ['plane-rock', 'plane-bush', 'plane-heal', 'plane-hazard'];
export const terrainSkinPath = key => `assets/out/terrain-plane/${key}@2x.png`;
/**
 * ★ 第五章「力量」的**敌方「船体要害」棋子素材**（键 → 图片路径）。
 * 这些是场景里的钢制部件（锅炉／承重柱／绞盘／阀门），由 `tools/slice.mjs` 从
 * `assets/src/parts-ship.png` 这张 2×2 拼版图切出来的（洋红幕抠底 + 裁边居中）。
 * 键名与 `rules.js` 里 `STRENGTH.parts[].key` 一一对应；渲染层找不到图就退回代码画的钢块。
 */
export const PART_SPRITES = {
  'part-boiler': 'assets/out/parts/part-boiler@2x.png',
  'part-column': 'assets/out/parts/part-column@2x.png',
  'part-winch': 'assets/out/parts/part-winch@2x.png',
  'part-valve': 'assets/out/parts/part-valve@2x.png',
};
