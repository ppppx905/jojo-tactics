import { RULE, FIGHTERS, SKILLS, MAPS, DEFAULT_MAP_ID, resolveMapId, mapList, skillSetFor, otherSide, teamOf, slotIndex, slotName, playableFighters, ITEM_TYPES } from '../core/game.js';
import { hexDist, tileKey, tileLabel } from '../core/hex.js';
import { icon } from './icons.js';
import { CHARACTER_ART, portrait, piece } from './assets.js';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const plain = value => String(value ?? '').replace(/<[^>]*>/g, '');
const unitName = u => `${u.kind === 'stand' ? '替身' : '使者'} · ${u.name}`;
/**
 * 替身名。注意：乔瑟夫是单单位角色（没有替身棋子，stand 为 null），
 * 但他**确实有替身「隐者之紫」**（技能 vine 的喊声就是 HERMIT PURPLE），
 * 所以界面只能说他"只有本体上阵"，绝不能写成"无替身"。
 */
const standName = f => f.stand ? f.stand.name : (f.standName || '');
const standLabel = f => f.stand ? f.stand.name : (f.standName ? `${f.standName} · 只有本体上阵` : '只有本体 · 无替身');
const $ = id => document.getElementById(id);

/**
 * ★★ 2v2 选人：**轮流各选两个**——P1 选一个 → P2 选一个 → P1 再选一个 → P2 再选一个。
 * 返回值是**槽位键**的列表，正好就是出手顺序（每个队的第 1 个角色，再每个队的第 2 个角色）。
 * 1v1 时只有前两个。
 */
export function draftOrder(draft) {
  return draft?.v2v ? ['p1', 'p2', 'p1b', 'p2b'] : ['p1', 'p2'];
}
/** 现在轮到选哪个槽位（都选齐了返回 null）。 */
export function nextDraftPick(draft) {
  return draftOrder(draft).find(slot => !draft?.[slot]) || null;
}
/** 一个槽位在界面上叫什么：`'p1'` → `P1 ①`，`'p1b'` → `P1 ②`。 */
export const pickLabel = slot => `${teamOf(slot).toUpperCase()} ${slotIndex(slot) ? '②' : '①'}`;
/** 控制表的两种取值在界面上的叫法。 */
export const controlLabel = control => (control === 'ai' ? '电脑' : '真人');

/**
 * ★★ 控制表：`draft` → **每个参战槽位**由谁操作（`'human'` / `'ai'`）。
 *
 * 唯一口径：每个位子各自决定是真人还是人机（用户拍定的设计），所以这里逐槽位算，
 * **不再**用"整个模式是 ai 还是 hotseat"来判断某一方。
 * `draft.control[槽位]` 有明确取值就用它；否则退回兼容默认值——
 * `draft.mode === 'ai'`（老的大厅数据 / 只有一个 mode 字段的调用点）＝ P2 侧人机、P1 侧真人，
 * 否则两边都真人。这样 `renderDraft({ p1, p2, mode: 'ai' })` 这种老写法照样能用。
 */
export function draftControl(draft) {
  const table = {};
  for (const slot of draftOrder(draft)) {
    const given = draft?.control?.[slot];
    table[slot] = given === 'ai' || given === 'human' ? given
      : (draft?.mode === 'ai' && teamOf(slot) === 'p2' ? 'ai' : 'human');
  }
  return table;
}
/**
 * ★ 网址参数 `?ai=槽位,槽位`（例如 `?ai=p1b,p2`）：**列到的位子是人机，其余参战位子都是真人**。
 * 空串（`?ai=`）＝四个位子全是真人；没写参数就别调它（保持大厅默认：P2 侧人机）。
 * 认不出的槽位名直接忽略，不会污染控制表。
 */
export function applyAiParam(draft, value) {
  const wanted = String(value ?? '').split(',').map(part => part.trim()).filter(Boolean);
  const next = {};
  for (const slot of draftOrder(draft)) next[slot] = wanted.includes(slot) ? 'ai' : 'human';
  draft.control = { ...draft.control, ...next };
  return draft.control;
}
/**
 * ★★ 2026-10-05 加地图体系：大厅里选的**地图**（`MAPS` 的键）写进 draft。
 * 与 `applyAiParam` 同一套写法——**认不出的地图名一律退回 `default`，绝不抛错**：
 * 网址参数（`?map=shallows`）、大厅按钮、以及将来任何调用点都共用这一个收敛口径。
 */
export function applyMapParam(draft, value) {
  draft.map = resolveMapId(value);
  return draft.map;
}
/** 当前这张地图在界面上叫什么（认不出的键退回默认地图的名字）。 */
export function mapLabel(key) { return MAPS[resolveMapId(key)]?.name || MAPS[DEFAULT_MAP_ID].name; }

/** 一位的「真人 / 人机」开关（放在这一位选人面板的上方）。
 *  按钮上的字用用户拍定的「真人 / 人机」；状态文案（顺序条、槽位行、底部提示）里用「电脑」，
 *  好让人一眼看出"这一位是电脑在玩"。 */
function controlSwitch(slot, control) {
  const buttons = ['human', 'ai'].map(kind => {
    const text = kind === 'ai' ? '人机' : '真人';
    return `<button type="button" class="control-toggle${control === kind ? ' is-on' : ''}" data-control-slot="${slot}" data-control="${kind}" aria-pressed="${control === kind}" aria-label="${pickLabel(slot)} 由${controlLabel(kind)}操作">${text}</button>`;
  }).join('');
  return `<div class="control-slot" data-control-for="${slot}"><small>${pickLabel(slot)}</small>${buttons}</div>`;
}

export function renderDraft(draft) {
  const order = draftOrder(draft), active = nextDraftPick(draft), control = draftControl(draft);
  for (const team of ['p1', 'p2']) {
    const slots = draft.v2v ? [team, `${team}b`] : [team];
    // 这个面板的名单要给**哪个槽位**选人：界面上刚点过的那个优先，否则跟"轮到谁选"
    const focused = slots.includes(draft.focus?.[team]) ? draft.focus[team]
      : (slots.includes(active) ? active : slots[0]);
    const key = draft[focused], f = FIGHTERS[key];
    // ★ 每位一个「真人 / 人机」开关，摆在这一位的选人面板**上方**
    //   （2v2 时这一侧有两个位子＝两个开关；1v1 一个）。
    const switches = `<div class="side-controls" role="group" aria-label="${team.toUpperCase()} 各角色由谁操作">${slots.map(slot => controlSwitch(slot, control[slot])).join('')}</div>`;
    // 只列可选角色：剧情 boss（灰塔）带 boss 标记，不进选人界面
    const roster = playableFighters().map(item => `<button class="draft-pick" data-draft-side="${team}" data-draft-slot="${focused}" data-fighter="${item.key}" aria-pressed="${item.key === key}" aria-label="${pickLabel(focused)} 选择${item.user.name}${item.stand ? `与${item.stand.name}` : item.standName ? `与${item.standName}（只有本体上阵）` : '（只有本体）'}"><img src="${portrait(item.key)}" alt="" width="768" height="512"><span class="draft-pick-name">${item.user.name}</span></button>`).join('');
    // 2v2：先给这一侧的两个角色槽位各一行，点一行就切到给那一行选人
    const slotStrip = draft.v2v ? `<div class="draft-slots" role="group" aria-label="${team.toUpperCase()} 的两个角色">${slots.map(slot => {
      const picked = FIGHTERS[draft[slot]];
      const state = picked ? picked.user.name : '待选';
      const tone = draft[slot] ? '' : ' is-empty';
      return `<button type="button" class="draft-slot${slot === focused ? ' is-active' : ''}${tone}${active === slot ? ' is-turn' : ''}" data-draft-focus="${slot}" aria-pressed="${slot === focused}"><small>第 ${slotIndex(slot) + 1} 个角色${active === slot ? ' · 轮到' : ''} · ${controlLabel(control[slot])}</small><b>${esc(state)}</b></button>`;
    }).join('')}</div>` : '';
    const detail = f ? `<div class="draft-detail"><div class="draft-detail-heading"><h2>${f.user.name}</h2><span class="stand-name">${standLabel(f)}</span></div><p class="draft-bio">${CHARACTER_ART[f.key].brief}</p><div class="draft-stats"><div><small>共享生命</small><b>${f.hp}</b></div><div><small>基础防御</small><b>${f.def}</b></div><div><small>${f.stand ? '替身攻击' : '本体攻击'}</small><b>${f.stand ? f.stand.dmg : f.user.dmg}</b></div><div><small>${f.stand ? '连携距离' : '攻击范围'}</small><b>${f.stand ? f.distLimit : f.user.range}<small style="display:inline"> 格</small></b></div></div><div class="draft-skills">${skillSetFor(f.key).map(id => `<span>${icon(id)} ${SKILLS[id].name}${SKILLS[id].altName ? `／${SKILLS[id].altName}` : ''}</span>`).join('')}</div></div>`
      : '<div class="draft-detail"><p class="draft-bio">还没选角色——从上面的名单里挑一个。</p></div>';
    $(`draftP${team.slice(1)}`).innerHTML = `<div class="draft-header"><strong>${team.toUpperCase()} / ${control[team] === 'ai' ? '电脑对手' : '替身使者'}</strong><span>${team === 'p1' ? '先手' : '后手'}${draft.v2v ? ` · 两个角色${active && teamOf(active) === team ? ' · 轮到你选' : ''}` : ` · ${CHARACTER_ART[FIGHTERS[draft[team]]?.key]?.type || ''}`}</span></div>
      ${switches}${slotStrip}<div class="fighter-roster">${roster}</div>${detail}`;
  }
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === draft.mode)));
  // 1v1 / 2v2 开关：**默认 1v1**。人机与 2v2 现在能同时开（每个位子各自真人/人机），所以不再禁用。
  const solo = $('teamSize1'), duo = $('teamSize2');
  if (solo) solo.setAttribute('aria-pressed', String(!draft.v2v));
  if (duo) {
    duo.setAttribute('aria-pressed', String(!!draft.v2v));
    duo.title = '每方两个角色，共 8 枚棋子（交替出手）；每个位子都能单独设成真人或人机';
  }
  // 选人顺序：P1 ① → P2 ① → P1 ② → P2 ②（1v1 时只有前两个，这一条不显示）
  const strip = $('draftOrder');
  if (strip) {
    strip.hidden = !draft.v2v;
    strip.innerHTML = !draft.v2v ? '' : `<span class="draft-order-title">选人顺序</span>${order.map(slot => {
      const picked = FIGHTERS[draft[slot]];
      // 顺序条上把"这一位归谁玩"一起写出来（例如「P2①（电脑）」），免得选到一半忘了哪个位子是人机
      return `<button type="button" class="draft-step${draft[slot] ? ' is-done' : ''}${active === slot ? ' is-turn' : ''}" data-draft-focus="${slot}" aria-pressed="${draft[slot] ? 'true' : 'false'}"><b>${pickLabel(slot)}</b><small>${picked ? esc(picked.user.name) : '待选'} · ${controlLabel(control[slot])}</small></button>`;
    }).join('')}`;
  }
  // ★★ 2026-10-05 加地图体系：**地图选择器**（一张地图 ＝ 一套地形布局 ＋ 配套背景画）。
  //   ⚠️ 按钮是**按 `MAPS` 数据渲染**的（不是写死在 index.html 里），所以以后加地图只改 rules.js
  //      那一份数据，界面自动多一颗按钮。风格沿用大厅现有的「对战人数」那一组（同一套 class）。
  //   ⚠️ 认不出的 `draft.map` 由 `resolveMapId()` 收敛成 default —— 老调用点（没有 map 字段的
  //      draft 对象）渲染出来就是"默认战场"被选中，与改动前的行为一致。
  const mapPicker = $('mapPick');
  const currentMap = resolveMapId(draft?.map);
  if (mapPicker) {
    mapPicker.innerHTML = `<span>地图</span>${mapList().map(item => `<button type="button" class="team-mode" data-map="${esc(item.id)}" aria-pressed="${item.id === currentMap}" title="${esc(item.blurb || '')}" aria-label="地图 ${esc(item.name)}：${esc(item.blurb || '')}">${esc(item.name)}</button>`).join('')}`;
  }
  // 当前地图的玩法说明（一句话）：选之前就能看出"这张图打起来哪里不一样"
  const mapNote = $('mapNote');
  if (mapNote) mapNote.textContent = MAPS[currentMap]?.blurb || '';
  const start = $('startBtn');
  // ★ 所有参战位子（**人机位也一样**）都选好角色才能开打。引擎里还有一层同样的校验兜底。
  const missing = order.filter(slot => !draft[slot]);
  if (start) {
    start.disabled = missing.length > 0;
    start.setAttribute('aria-disabled', String(missing.length > 0));
  }
  const aiSlots = order.filter(slot => control[slot] === 'ai');
  $('draftHint').textContent = missing.length
    ? `还差 ${missing.map(pickLabel).join('、')} 没选——每一位（含人机位）都要选好角色才能开打。`
    : aiSlots.length === order.length ? `${order.length === 4 ? '四个' : '两个'}位子全是人机——进入战场后两边会自己打完，你只负责看。`
      : aiSlots.length ? `人机位（${aiSlots.map(pickLabel).join('、')}）会自动行动，真人位等你的操作。`
        : draft.v2v ? '2v2：每方两个角色、各自一条血、各自 3 点行动点；出手顺序 P1① → P2① → P1② → P2②。'
          : '两位玩家轮流使用同一设备。P1 先行。';
  // 界面自己报出角色数量：万一浏览器加载到旧版缓存，"共 4 名角色"一眼就能看出来
  const tag = $('buildTag');
  if (tag) tag.textContent = `共 ${playableFighters().length} 名角色 · ${draft.v2v ? '2v2 双人对战' : '本地对局'}`;
}

/**
 * ★ 这一关的**特殊机制**（第 4、5、6 关才有）——抽成独立的一份 HTML，
 * 因为现在有**两个地方**要显示同一段文字：
 *   ① 剧情页右边的「本关规则」（进战斗前先看一遍）
 *   ② 战斗中工具栏的「关卡机制」按钮弹出来的框（用户 2026-09-27 要求"可以重新在对战中看关卡机制"）
 * 两处共用同一个函数，改机制文案只用改 rules.js 的 specialRules，不会再出现"一处更新一处漏"。
 */
export function specialRulesHtml(chapter) {
  if (!chapter?.specialRules?.length) return '';
  const rows = ['<p class="story-special-title">◆ 这一关的特殊机制</p>'];
  for (const rule of chapter.specialRules) {
    rows.push(`<p class="story-special">${rule.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`);
  }
  return rows.join('');
}

/** 把一章的角色改动写成说明（技能被换掉了哪些、觉醒了什么 + 这一关的特殊机制）。
 *  ★ 2026-10-03：`view` 是 `storySceneAt()` 的结果——一章两场（第八章两阶段）时，
 *    "你操控谁、电脑操控谁"与「本关规则」都要按**当前这一幕**那一份来写，
 *    否则第二场会写着第一场的阵容与规则。没传 `view` 就退回章节自己的口径（旧调用点不受影响）。 */
function storyRulesHtml(chapter, view = null) {
  const lineup = view?.lineup || { player: chapter.player, enemy: chapter.enemy };
  const ally = lineup.ally ? `，电脑控制的友军：<b>${FIGHTERS[lineup.ally].label}</b>` : '';
  const rows = [`<p>你操控 <b>${FIGHTERS[lineup.player].label}</b>，电脑操控 ${FIGHTERS[lineup.enemy].label}${ally}。</p>`];
  for (const [key, swap] of Object.entries(chapter.swaps || {})) {
    const fighter = FIGHTERS[key];
    const names = (swap.skills || skillSetFor(key)).map(id => SKILLS[id].name).join(' / ');
    const removed = swap.skills ? skillSetFor(key).filter(id => !swap.skills.includes(id)).map(id => SKILLS[id].name) : [];
    rows.push(`<p><b>${fighter.label}</b> 技能：${names}${removed.length ? `<em>（本关暂时没有 ${removed.join('、')}）</em>` : ''}</p>`);
    if (swap.rage) rows.push(`<p class="story-rage"><b>${swap.rage.name}</b>：${swap.rage.desc}</p>`);
  }
  // ★ 这一关和普通对局不一样的地方（第 4、5、6 关、第八章的两场才有）：单独成块、金色边框，别跟角色改动混在一起。
  //   用户 2026-09-27 要求"加上提示表明关卡特殊机制"——进战斗前先看清楚，不会进去才发现规则变了。
  rows.push(specialRulesHtml({ specialRules: view?.specialRules || chapter.specialRules }));
  if (chapter.brief) rows.unshift(`<p class="story-brief">${chapter.brief}</p>`);
  return rows.join('');
}

/**
 * 剧情模式章节列表：已解锁的渲染成按钮（点了直接跳进那一章），未解锁的只显示标题。
 * `rows` 来自 src/ui/story.js 的 storyRoadmap()，`cleared` 是已通关（＝已解锁）的章节 id。
 * `trialAll` 为真时（网址带 `?unlock=all`）是**试玩用的临时全解锁**，列表上会标出来，
 * 免得开着这个开关还以为自己已经通关了。
 */
export function renderStoryMenu(rows, { cleared = [], trialAll = false } = {}) {
  $('storyChapters').innerHTML = rows.map(row => {
    const done = cleared.includes(row.chapterId);
    // 章节解锁规则：**第一章永远能进；之后每一章要求「上一章已通关」**。
    // ⚠️ 别写成 `row.index === 0 || done`——done 判断的是"这一章自己通关了"，
    //    而没解锁的章节根本进不去，于是第二章（以及以后每一章）永远打不开。
    //    （只有第一章时看不出这个错，加了第二章才暴露出来。）
    const previousCleared = row.chapterIndex > 0 && cleared.includes(rows[row.chapterIndex - 1]?.chapterId);
    const open = row.playable && (row.index === 0 || previousCleared);
    const badge = done ? '已解锁' : open ? '可进入' : '未解锁';
    const note = row.kind === 'arc' ? ' · 尚未开放' : '';
    const inner = `<span class="story-chapter-no">${esc(row.label)}</span>` +
      `<span class="story-chapter-name"><b>${esc(row.title)}</b><span class="story-badge">${badge}</span></span>` +
      `<small>${esc(row.range)}${note}</small>`;
    return open
      ? `<li class="story-chapter is-open${done ? ' is-cleared' : ''}"><button type="button" data-story-chapter="${row.chapterIndex}">${inner}</button></li>`
      : `<li class="story-chapter is-locked"><div>${inner}</div></li>`;
  }).join('');
  // 试玩模式必须显眼：否则过几天再看会以为"关卡解锁坏了"。
  // ⚠️ 这条提示写在**列表自己里面**（而不是去改页面上别处的文案），
  //    这样渲染函数是自足的、也测得到（hud.test.js 读的就是这个容器的内容）。
  if (trialAll) {
    $('storyChapters').innerHTML = '<li class="story-trial">【试玩模式 · 全解锁】'
      + '网址带着 ?unlock=all，所有已做好的章节都能直接进；去掉这个参数就恢复正常的"通关才解锁"。</li>'
      + $('storyChapters').innerHTML;
  }
}

/**
 * 剧情模式演出页：显示当前场景的档案正文与「本关规则」。
 * `view` 来自 src/ui/story.js 的 storySceneAt()，按钮文字由它决定（继续 / 开始对决 / 返回标题）。
 */
export function renderStoryStage(chapter, view) {
  $('storyStageLabel').textContent = chapter.label;
  $('storyStageRange').textContent = view.range || '';
  $('storyStageEyebrow').textContent = view.note ? `${chapter.eyebrow} · ${view.note}` : chapter.eyebrow;
  $('storyStageTitle').textContent = view.title || chapter.title;
  $('storyStageBody').innerHTML = (view.paragraphs || []).map(text => `<p>${text}</p>`).join('');
  $('storyStageRules').innerHTML = storyRulesHtml(chapter, view);
  // ★ 2026-10-03：这一句按**当前这一幕的阵容**写（一章两场时两场的人不一样）。
  const lineup = view.lineup || { player: chapter.player, enemy: chapter.enemy };
  const allyText = lineup.ally ? `，${FIGHTERS[lineup.ally].label} 由电脑控制` : '';
  $('storyStageHint').textContent = view.button.action === 'battle'
    ? `接下来：你操控 ${FIGHTERS[lineup.player].label}，电脑操控 ${FIGHTERS[lineup.enemy].label}${allyText}。`
    : view.button.action === 'next' ? '读完这一页，继续往下看。' : '本章到此结束，回标题页可以选择别的模式。';
  $('storyStageNext').innerHTML = `${view.button.label} <span>▸</span>`;
}

/**
 * 一个**角色槽位**在信息栏里的内容（血量 / 行动点 / 两枚棋子 / 连携 / 技能 / 状态标签）。
 *
 * ⚠️ 1v1 时这段 HTML 与改动前**逐字相同**（`slot` 就是 `'p1'`/`'p2'`），所以外观与手感不变；
 * 2v2 时同一侧会调用两次，各自显示**自己那条血、自己的 3 点行动点、自己的冷却与技能**。
 */
function bayBody(game, slot, { inspecting = null, isActing = false, humanTurn = true } = {}) {
  const s = game.s, f = game.fighter(slot), health = s.hp[slot], label = game.healthLabel?.(slot) || '共享生命';
  return `<div class="bay-health"><div class="hp-line"><span class="hp-caption">${icon('heart')} ${label}</span><span class="hp-value ${health <= f.hp * .3 ? 'low' : ''}" data-hp="${slot}">${health} <small>/ ${f.hp}</small></span></div><div class="hpbar ${health <= f.hp * .3 ? 'low' : ''}" role="meter" aria-label="${slotName(slot)}${label}" aria-valuenow="${health}" aria-valuemin="0" aria-valuemax="${f.hp}"><i style="width:${Math.max(0, health / f.hp * 100)}%"></i></div><div class="bay-ap"><span>基础防御 ${f.def}</span><span>行动点 <b data-ap="${slot}">${s.ap[slot]} / ${s.turnAP[slot]}</b></span></div></div>
      <div class="unit-list">${s.units.filter(u => u.slot === slot).map(u => {
        const selected = s.selectedId === u.id, isInspected = inspecting?.id === u.id;
        return `<button class="unit-option ${selected ? 'selected' : ''} ${isInspected ? 'inspecting' : ''}" data-unit="${u.id}" aria-pressed="${selected}" aria-label="${isActing && humanTurn ? '选择' : '查看'}${unitName(u)}"><img class="unit-mini" src="${piece(f.key, u.kind)}" alt="" width="192" height="288"><span class="unit-text"><span class="unit-name"><small>${u.kind === 'stand' ? '替' : '主'}</small>${u.name}</span><span class="unit-stats"><span title="${game.mirrorWalker?.(u) ? '在反光点与岩石之间跳（无视距离）' : `移动步数${game.vined(u) ? '（被藤蔓缠住 −1）' : ''}`}">${icon('move')}<b>${game.mirrorWalker?.(u) ? '镜面' : game.moveRange(u)}</b></span><span title="当前防御，含地形与柱子">${icon('shield')}<b>${game.defense(u).total}</b></span>${u.range ? `<span title="攻击 / 射程${game.armorPierceOf?.(u) ? `（穿甲 ${game.armorPierceOf(u)}：打人时目标防御 −${game.armorPierceOf(u)}，下限 0）` : ''}">${icon('attack')}<b>${game.unitAttack(u)} / ${u.range}</b></span>` : '<span>无普攻</span>'}${game.vined(u) ? `<span class="vine-mark" title="被藤蔓缠住：移动 −${RULE.vineMovePenalty}">${icon('vine')}</span>` : ''}</span></span><span class="unit-key">${u.kind === 'user' ? '1' : '2'}</span></button>`;
      }).join('')}</div><div class="tether-stat"><span>${icon('link')} 同伴连携</span><b>${f.stand ? tetherText(game, slot) : '本体单独行动'}</b></div>
      <div class="bay-skills">${game.skills(slot).map(key => {
        const status = game.skillStatus(slot, key), skill = SKILLS[key];
        let label = status.passive ? status.status : status.cd ? `冷却 ${status.cd}` : key === 'time' ? (s.timeUsed[slot] ? '本局已用' : game.timeAvailable(slot) ? '可发动' : s.timeLocked[slot] ? '窗口已过' : '半血解锁')
          : key === 'blaze' && s.blazeUsed[slot] ? '本局已用' : `${skill.cost} AP`;
        return `<button class="bay-skill" data-inspect-skill="${key}" data-side="${slot}" aria-label="查看${game.skillLabel(key, slot)}说明，${esc(label)}">${icon(key)}<b>${game.skillLabel(key, slot)}</b><small class="${label === '可发动' ? 'ready' : ''}">${esc(label)}</small></button>`;
      }).join('')}</div><div class="status-tags">${pillarTag(game, slot)}${itemTags(game, slot)}${s.burn[slot] ? `<span class="status-tag">灼烧 ${s.burn[slot]} 层 · 治疗减半</span>` : ''}${s.traumaCut[slot] ? `<span class="status-tag">创伤 · 替身防御 −${s.traumaCut[slot]}</span>` : ''}${s.vampCharged[slot] ? '<span class="status-tag good">吸血鬼已强化</span>' : ''}${s.timeReady[slot] ? '<span class="status-tag good">时停仅本回合可用</span>' : ''}${s.skipSide === slot ? '<span class="status-tag good">时间停止生效中</span>' : ''}${s.armorOff?.[slot] ? `<span class="status-tag warn">卸甲 · 防御归零 +${RULE.armorAP} AP</span>` : ''}${s.swordBuff?.[slot] ? `<span class="status-tag good">精湛剑术 · 攻击力 +${s.swordBuff[slot]}/${RULE.masteryMax}</span>` : ''}${Object.keys(s.vine || {}).some(id => id.startsWith(`${slot}-`)) ? `<span class="status-tag warn">藤蔓 · 移动 −${RULE.vineMovePenalty}</span>` : ''}${s.extraAP?.[slot] && game.skills(slot).includes('nextline') ? '<span class="status-tag good">已预判 · 下回合 +1 AP</span>' : ''}${s.sandGuard?.[slot] ? `<span class="status-tag good">潜沙 · 基础防御 +${SKILLS.dive.guard}</span>` : ''}${s.sandBlind?.[slot] ? `<span class="status-tag warn">流沙迷眼 · 普攻 ${Math.round(SKILLS.sandblast.miss * 100)}% 打空</span>` : ''}${game.drowning?.(slot) ? `<span class="status-tag warn">溺水 · 还剩 ${s.drown[slot]} 个回合结束，共 ${s.drown[slot] * SKILLS.drag.drownDmg} 点真实伤害</span>` : ''}${game.storyStatus?.(slot) ? `<span class="status-tag ${game.storyRage(slot) ? 'good' : ''}">${esc(game.storyStatus(slot))}</span>` : ''}${game.shipRule?.() && teamOf(slot) === 'p2' ? shipProgressTags(game) : ''}${game.ebonyRule?.() && teamOf(slot) === 'p2' ? ebonyTags(game) : ''}${game.mirrorRule?.() && teamOf(slot) === 'p2' ? mirrorTags(game) : ''}${game.sniperRule?.() && game.sniperUnit?.()?.slot === slot ? sniperTags(game) : ''}${emperorTags(game, slot)}${darkgunTags(game, slot)}${s.eroded?.[slot] ? `<span class="status-tag warn">侵蚀 · 每次自己普攻 −${SKILLS.erosion.erosionDmg} HP</span>` : ''}${s.slimeGuard?.[slot] ? `<span class="status-tag good">史莱姆防御 · 基础防御 +${SKILLS.slime.guard}</span>` : ''}</div>`;
}

export function renderCards(game, { inspecting = null, humanTurn = true } = {}) {
  const s = game.s, twoSided = game.twoSided?.() === true;
  // ★ 谁在玩这个位子：**逐槽位**读控制表（引擎的 isAI）。
  //   `game.isAI` 不存在时才退回旧口径（mode === 'ai' 且是 P2 侧）——
  //   只是给"手工造的假 game 对象"兜底，不是正常路径。
  const aiAt = slot => (game.isAI ? game.isAI(slot) : s.mode === 'ai' && teamOf(slot) === 'p2');
  for (const team of ['p1', 'p2']) {
    const el = $(`sideP${team.slice(1)}`);
    const slots = game.teamSlots(team);
    if (!slots.length || !game.fighter(slots[0])) { el.innerHTML = ''; continue; }
    const isTurn = s.phase === 'battle' && slots.includes(s.turn);
    const state = s.phase === 'result' ? (s.winner === team ? '胜利' : '落败') : isTurn ? '● 行动中' : '等待回合';
    const head = (slot) => {
      const f = game.fighter(slot), acting = s.phase === 'battle' && slot === s.turn;
      return `<div class="bay-heading"><strong>${slotName(slot)}<span class="player-label"> / ${aiAt(slot) ? 'COMPUTER' : 'PLAYER'}</span></strong><span class="compact-name">${f.user.name}</span><span class="${acting ? 'current' : ''}">${acting ? '● 行动中' : state}</span></div>`;
    };
    el.classList.toggle('is-turn', isTurn);
    el.classList.toggle('is-2v2', twoSided);
    // 一侧两个位子可以一个真人一个电脑：全电脑标 COMPUTER、全真人标 PLAYER、混合两个都标出来
    const teamLabel = slots.every(aiAt) ? 'COMPUTER' : slots.some(aiAt) ? 'PLAYER + COMPUTER' : 'PLAYER';
    // ---- 1v1：与改动前逐字相同的单角色面板（大立绘 + 身体内容） ----
    if (!twoSided) {
      const slot = slots[0], f = game.fighter(slot), art = CHARACTER_ART[f.key];
      el.innerHTML = `${head(slot)}
      <div class="bay-portrait"><img src="${portrait(f.key)}" alt="${f.user.name}肖像" width="768" height="512"><div class="portrait-grid"></div><div class="bay-name"><span class="roman">${art.roman}</span><h2>${f.user.name}</h2><span class="archetype">${art.type}</span></div></div>
      <div class="bay-body">${bayBody(game, slot, { inspecting, isActing: isTurn, humanTurn })}</div>`;
      continue;
    }
    // ---- 2v2：一侧**上下两行角色信息**，当前行动的那位高亮 ----
    el.innerHTML = `<div class="bay-heading"><strong>${team.toUpperCase()}<span class="player-label"> / ${teamLabel}</span></strong><span class="compact-name">两个角色</span><span class="${isTurn ? 'current' : ''}">${state}</span></div>
      <div class="bay-body bay-rows">${slots.map(slot => {
        const f = game.fighter(slot), acting = s.phase === 'battle' && slot === s.turn;
        const down = (s.hp[slot] ?? 0) <= 0;
        return `<div class="side-row${acting ? ' is-acting' : ''}${down ? ' is-down' : ''}" data-row="${slot}">
          <div class="side-row-head"><img class="side-row-face" src="${portrait(f.key)}" alt="" width="768" height="512"><div class="side-row-copy"><span class="eyebrow">${slotName(slot)} · ${slotIndex(slot) + 1} 号角色</span><h3>${f.user.name}</h3><small>${f.stand ? standName(f) : standLabel(f)}</small></div><span class="${acting ? 'current' : ''}">${down ? '已倒下' : acting ? '● 行动中' : state}</span></div>
          ${bayBody(game, slot, { inspecting, isActing: acting, humanTurn })}
        </div>`;
      }).join('')}</div>`;
  }
}

function command({ id, name, meta, glyph, key = '', enabled, active, passive, reason }) {
  // aria-disabled keeps the reason reachable by keyboard and touch.
  return `<button class="command ${active ? 'active' : ''} ${passive ? 'passive' : ''}" data-command="${id}" aria-disabled="${!enabled}" aria-pressed="${!!active}" aria-label="${esc(`${name}，${meta}${reason ? '，' + reason : ''}`)}">${icon(glyph)}<span class="command-name">${name}</span><span class="command-meta">${esc(meta)}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
}
export function renderActions(game, { humanTurn = true, busy = false } = {}) {
  const s = game.s, u = game.selected, side = s.turn, team = teamOf(side);
  if (!game.fighter(side)) return;
  const active = humanTurn && !busy && s.phase === 'battle', ready = active && !!u;
  // ★ 现在这个位子是真人还是人机：**逐槽位**读控制表，不再按"整方是不是 P2"判断。
  //   人机位行动时界面进入"等待"态（不给按钮、不要求玩家点），四个位子全是人机就是观战。
  const waiting = game.isAI ? game.isAI(side) : s.mode === 'ai' && teamOf(side) === 'p2';
  // 2v2 时底部这一整条（当前行动者 / 行动点 / 技能按钮）**跟着高亮的那一位走**：
  // 因为 `s.turn` 就是"现在该谁出手的槽位"，所有取值都按它算。
  $('modeLabel').textContent = s.story ? `剧情模式 · ${s.story.label}`
    : game.allAI?.() ? '观战 · 双方都是电脑'
    : game.hasAI?.() ? '挑战电脑'
      : game.twoSided?.() ? '2v2 双人同屏' : '双人同屏';
  $('roundLabel').innerHTML = `ROUND <b>${String(game.roundNumber()).padStart(2, '0')}</b>`;
  $('actorSummary').className = `actor-summary ${team}`;
  $('actorSummary').innerHTML = u ? `<img class="actor-img" src="${piece(u.fighter, u.kind)}" alt="" width="192" height="288"><div class="actor-copy"><span class="eyebrow">${slotName(side)} / 当前行动者</span><h3>${u.name}</h3><small>${u.kind === 'stand' ? '替身' : '使者'} · ${tileLabel(game.tile(u))}</small><div class="actor-distance">连携 ${tetherText(game, side)}</div></div>`
    : `<div class="actor-idle">${icon(waiting ? 'time' : 'stand')}</div><div class="actor-copy"><span class="eyebrow">${slotName(side)} / ${waiting ? 'COMPUTER TURN' : 'YOUR TURN'}</span><h3>${waiting ? '电脑行动中' : '轮到你了'}</h3><small>${waiting ? '这一位由电脑操作 · 正在行动' : `操作 ${game.fighter(side).user.name} 开始行动`}</small><div class="actor-distance">${game.fighter(side).user.name}${standName(game.fighter(side)) ? ` · ${standName(game.fighter(side))}` : ''}</div></div>`;
  // 单单位角色（乔瑟夫）没有替身按钮，连携信息也换成「本体单独行动」
  const kinds = game.fighter(side)?.stand ? ['user', 'stand'] : ['user'];
  const tether = game.fighter(side)?.stand ? tetherText(game, side) : '单独行动';
  $('actorSummary').querySelector('.actor-copy').insertAdjacentHTML('beforeend', `<div class="actor-shortcuts">${kinds.map(kind => `<button data-unit="${side}-${kind}" aria-pressed="${u?.kind === kind}" ${active ? '' : 'disabled'}>${kind === 'user' ? '使者' : '替身'}</button>`).join('')}<span>${tether}</span></div>`);
  const items = [command({ id: 'move', name: '移动', meta: '1 AP', glyph: 'move', enabled: ready && s.ap[side] >= RULE.moveCost, active: !!u && s.action === 'move', reason: !u ? '先选择单位' : '选择可移动落点' }),
    command({ id: 'attack', name: '普通攻击', meta: '1 AP', glyph: 'attack', enabled: ready && !!u.range && s.ap[side] >= RULE.attackCost, active: !!u && s.action === 'attack', reason: !u ? '先选择单位' : !u.range ? '这个单位没有普攻' : '选择射程内的目标' })];
  game.skills(side).forEach((key, index) => {
    const sk = SKILLS[key], status = game.skillStatus(side, key, u);
    const meta = sk.passive ? '被动 · 自动' : status.cd ? `CD ${status.cd} · ${sk.cost} AP` : `${sk.cost} AP${['time', 'blaze'].includes(key) ? ' · 限1次' : ''}`;
    items.push(command({ id: key, name: game.skillLabel(key, side), meta, glyph: key, key: ['Q', 'W', 'E'][index], enabled: ready && status.enabled,
      active: s.pendingSkill === key, passive: sk.passive, reason: !u ? '先选择释放单位' : status.reason || status.status }));
  });
  // 被藤蔓缠住时多一个「挣脱」按钮：花 1 AP 解除移动 −1（无冷却）
  if (u && game.vined(u)) {
    const why = game.breakReason(u);
    items.push(command({ id: 'breakfree', name: '挣脱藤蔓', meta: `${RULE.vineBreakAP} AP`, glyph: 'vine', enabled: ready && !why,
      reason: why || `解除移动 −${RULE.vineMovePenalty}，不消耗冷却` }));
  }
  $('skillbar').innerHTML = items.join('');
  $('apDisplay').className = team;
  $('apDisplay').innerHTML = `<div class="ap-heading"><b>${slotName(side)} 回合</b><span>行动点</span></div><div class="ap-meter"><span class="ap-pips" aria-hidden="true">${Array.from({ length: s.turnAP[side] }, (_, i) => `<i class="ap-pip ${i < s.ap[side] ? 'on' : ''}"></i>`).join('')}</span><span class="ap-value" aria-label="剩余 ${s.ap[side]} 行动点，共 ${s.turnAP[side]}">${s.ap[side]}<small> / ${s.turnAP[side]}</small></span></div>`;
  $('btnEnd').disabled = !active;
  $('btnEnd').innerHTML = waiting ? '电脑行动中' : busy ? '行动结算中' : '结束回合 <span>→</span>';
  // ★ 认输按**队**算（2026-10-03 用户定）：本队只要有一位真人就能认输——所以"队友是电脑"时，
  //   轮到电脑那位也能替本队认输；四个位子全人机（观战）时谁都认不了。
  const resign = $('resignBtn');
  if (resign) {
    const mine = game.teamHasHuman ? game.teamHasHuman(s.turn) : true;
    resign.disabled = s.phase !== 'battle' || !mine;
  }
  $('turnNote').textContent = s.skipSide ? `下一回合：${slotName(s.skipSide)} 将被跳过` : waiting ? '对手行动结束后轮到你' : s.ap[side] ? '未使用的行动点不会保留' : '行动点已用完';
  $('cancelBtn').disabled = !u || !active;
  const note = waiting ? '电脑正在行动。可打开菜单暂停，或查看单位与技能说明。' : s.notice?.text || '选择己方单位开始行动。';
  // ★★ 东方仗助「重组」：**点技能 → 选目标 → 选选项**（用户 2026-10-09 改的流程）。
  //   ① 还没选目标：只提示"在棋盘上点一个角色"；
  //   ② 选好目标：列出**这个目标可用**的效果（清状态 / 回滚 N 回合前），不可用的置灰并写明理由。
  //   渲染口径与「铺设完成 / 收手埋枪」那两颗按钮完全同款（同一处、同一套 `.finish-flame` 样式）。
  const rebuildPicker = s.pendingSkill === 'rebuild' ? (() => {
    const info = game.actionView().rebuild || {};
    if (!info.target) {
      return `<span class="rebuild-hint">在棋盘上点一个目标（友军或敌人）</span><button class="finish-flame" id="rebuildCancelBtn">取消</button>`;
    }
    const buttons = (info.options || []).map(o => `<button class="finish-flame" id="rebuildOptionBtn" data-mode="${o.mode}"${o.ok ? '' : ` disabled title="${esc(o.reason)}"`}>${esc(o.label)}（${o.cost} AP）</button>`).join('');
    return `<span class="rebuild-hint">目标：${esc(info.target.name)}</span>${buttons}<button class="finish-flame" id="rebuildRetargetBtn">换个目标</button><button class="finish-flame" id="rebuildCancelBtn">取消</button>`;
  })() : '';
  $('info').className = !waiting && s.notice?.level === 'warn' ? 'warn' : '';
  $('info').innerHTML = `${icon(!waiting && s.notice?.level === 'warn' ? 'alert' : 'chevron')}<span>${esc(note)}</span>${rebuildPicker}${s.pendingSkill === 'flame' ? `<button class="finish-flame" id="finishFlameBtn">${s.flamePlaced.length ? '完成铺设' : '取消铺设'}</button>` : ''}${s.pendingSkill === 'darkgun' ? `<button class="finish-flame" id="finishDarkgunBtn">${s.darkPlaced.length ? '收手（已埋的标记照旧生效）' : '取消埋枪'}</button>` : ''}`;
}

/**
 * 「同伴连携」那一栏的口径。
 *
 * ★ 第八章：吊死者**只在反光点与岩石之间跳**，而且用户定的是"**跳到任意一个反光点**"——
 *   它的跳跃**不受连携距离限制**。所以这一栏不能照常显示 "6/4 格"：那看起来像违规，
 *   玩家会以为这一步走不了（实际走得了）。凡是"只走反光点／岩石"的棋子一律写「镜面跳跃」。
 */
function tetherText(game, slot) {
  const stand = game.s?.units?.find(u => u.slot === slot && u.kind === 'stand');
  if (game.mirrorWalker?.(stand)) return '镜面跳跃 · 无视距离（落点：反光点 / 岩石）';
  return `${game.pairDistance(slot)} / ${game.distLimit(slot)} 格`;
}

const terrainNames = { rock: '岩石', bush: '草丛', heal: '恢复点', hazard: '毒沼' };
/**
 * ★ 「力量」那一关（第五章）常驻的两条提示（用户 2026-09-27 要求"适当增加文字提示"）：
 *   `船体要害 1/3 · 走廊深处` —— 玩家随时知道**打到第几个了、现在在哪一层**，
 *   否则换背景这件事很容易被忽略（拆完一个要害除了画面变暗一点，界面上没有任何字）。
 *   最后一条在猩猩登场后改写成"猩猩已现身"，把阶段切换也点出来。
 */
function shipProgressTags(game) {
  const rule = game.shipRule?.();
  if (!rule) return '';
  const total = rule.parts.length;
  const done = game.s.partsBroken || 0;
  const layer = game.arenaName?.() || '';
  const bossOut = game.s.units?.some(u => u.side === 'p2');
  const tags = [`<span class="status-tag warn">船体要害 ${done}/${total}${layer ? ` · ${esc(layer)}` : ''}</span>`];
  if (bossOut) tags.push('<span class="status-tag warn">★ 猩猩已现身</span>');
  else {
    const left = total - done;
    tags.push(`<span class="status-tag">还剩 ${left} 个要害才逼他现身</span>`);
  }
  if (rule.drainPerTurn) tags.push(`<span class="status-tag warn">船体挤压 · 每回合 −${rule.drainPerTurn} HP</span>`);
  if (game.shipBreakBonus?.('p1')) tags.push(`<span class="status-tag good">破口 · 攻击力 +${game.shipBreakBonus('p1')}</span>`);
  // ★ 拆要害的代价（用户 2026-09-27）：拆掉第 1 个移动 −1、第 2 个行动点 −1、第 3 个全部恢复。
  //   这条必须常驻显示——否则玩家只会觉得"我的棋子怎么突然走不动了 / 行动点怎么少了"。
  const penalty = game.shipPenalty?.('p1');
  if (penalty && (penalty.move || penalty.ap)) {
    tags.push(`<span class="status-tag warn">船体压在身上 · ${[penalty.move ? `移动 −${penalty.move}` : '', penalty.ap ? `行动点 −${penalty.ap}` : ''].filter(Boolean).join(' / ')}</span>`);
  } else if (done >= total) {
    tags.push('<span class="status-tag good">船身被撕开 · 移动与行动点恢复、不再持续掉血</span>');
  }
  return tags.join('');
}

/**
 * ★ 第六章「黑檀之魔」的常驻提示（用户要求"表明关卡特殊机制"）。
 * 憎恨值是这一关**唯一的玩法**，必须让玩家随时看得见：
 *   · 现在是几点憎恨、它因此攻击力 +几
 *   · "打它 = 喂它"这句话必须写出来（打本体也算）
 * ⚠️ 原来还有一条"它躲进暗处、现在打不到它"——用户 2026-09-27 把这个机制整个删了，
 *    所以这里不再有"打不到"的状态提示（`game.ebonyHidden` 也已经不存在）。
 */
function ebonyTags(game) {
  const rule = game.ebonyRule?.();
  if (!rule) return '';
  const level = game.hatredLevel?.() || 0;
  const tags = [`<span class="status-tag">憎恨 ${level}/${rule.hatredMax} · 人偶攻击力 +${level * rule.hatredAtkBonus}</span>`];
  tags.push('<span class="status-tag">打它 = 喂它 · 每打中一次憎恨 +1（打本体也算）</span>');
  // 憎恨会自己掉：**整整一个回合没打到它**，下个回合开始就 −1。
  // 原来这条写的是"你这回合没打到它 → 它会冷静一点"，但它是按 `level > 0` 无条件显示的，
  // 玩家刚打完一下也照样显示，等于说错话——改成只陈述规则本身，不再假装知道玩家做了什么。
  if (level > 0) tags.push('<span class="status-tag good">整整一个回合不打它 → 憎恨 −1</span>');
  return tags.join('');
}

/**
 * ★ 第八章「皇帝与吊死者」的常驻提示：**反光点还剩几个**。
 * 这一关的胜负手就是"用火把镜面一个个封掉"（点越少它越难走位），所以剩余数量必须随时看得见。
 *
 * ⚠️ 第二句话的口径是**"它现在还有没有地方跳"**，而不是简单的"封满了没有"：
 *   火焰**铺不到有棋子的格子**（见 `Game.placement`），而吊死者**永远站在一个还没被封的镜面上**，
 *   所以"它踩着的那一个"其实封不掉——等玩家烧掉其余 3 个，它的走位余地就已经很窄了。
 *   这时候直接由 `reachable()` 判空来提示"无处可跳"，比死等 0/4 有用得多。
 * ★ 2026-10-03 用户第三次拍板（落点并上**未被占用的岩石格**）之后，这一条**不用改判据**：
 *   `reachable()` 里已经含了岩石，所以"反光点全封光但场上还有空岩石"时它**不会**误报"无处可跳"
 *   （只有"没有点、也没有空岩石"才报）。这里只把第三句的说明补上"岩石"两个字。
 */
function mirrorTags(game) {
  const rule = game.mirrorRule?.();
  if (!rule) return '';
  const total = game.s.mirrors?.length || 0;
  const left = game.openMirrors?.().length || 0;
  const ghost = game.s.units?.find(u => game.mirrorWalker?.(u));
  const stuck = !!ghost && game.reachable(ghost).length === 0;
  const tags = [`<span class="status-tag ${left ? '' : 'warn'}">${rule.name}还剩 ${left}/${total}</span>`];
  if (stuck) tags.push('<span class="status-tag good">★ 吊死者无处可跳 · 只能停在原地出手</span>');
  else if (left < total) tags.push(`<span class="status-tag">被封住的${rule.name}不再能落人</span>`);
  else tags.push(`<span class="status-tag warn">吊死者只在${rule.name}与岩石之间跳 · 用火封镜</span>`);
  return tags.join('');
}
/**
 * ★ 第八章「场边冷枪」的常驻提示：**枪手什么时候开下一枪**。
 * 口径（用户定，数值见 SNIPER）：每 `interval` 回合开一枪，**开火的前一个回合地面会画出弹道**。
 * 所以标签分两种：
 *   · 已经画好弹道（`s.shotAim`）→ 「瞄准中 · 下一回合开火」，并把**目标格**报出来；
 *   · 还没画 → 「再等 N 个回合」（N 从当前的轮次算出来，与 `Game.tickSniper` 同一套口径）。
 * 文案全部取自 `SNIPER`（`game.sniperRule()`），界面里不再手写一遍。
 * ⚠️ 2026-10-03 改版：这一章分成两场之后，冷枪**只在阶段 1**生效，而且那一条"他钉在外圈、
 *    打不死"的说法**已经按用户要求撤掉了**（单挑要能追能打）——所以这里不再挂那条标签。
 */
function sniperTags(game) {
  const rule = game.sniperRule?.();
  if (!rule) return '';
  const s = game.s, aim = s.shotAim;
  const key = game.keySlot?.();
  const keyName = key ? game.fighter(key)?.user?.name : null;
  const tags = [`<span class="status-tag">${rule.name} · 每 ${rule.interval} 回合 ${rule.dmg} 点真实伤害（无视防御）</span>`];
  if (aim) {
    tags.push(`<span class="status-tag warn">${rule.aimText} · 目标 ${tileLabel(game.at(aim.row, aim.col))}（挪开那一格就躲开了）</span>`);
  } else {
    const round = game.roundNumber?.() || 1;
    const left = rule.interval - ((round - 1) % rule.interval);
    tags.push(`<span class="status-tag">${rule.name} · 再等 ${left} 个回合开火</span>`);
  }
  // ★ 胜负口径：声明了 phaseWin 的场次是"打到半血即胜"、声明了 storyLoss 的场次是"打不过的剧情战"，
  //   别的场次才看关键槽位——三者都由章节数据给出。
  //   ⚠️ 2026-10-03 第三条用户拍板之后第八章阶段 1 不再声明 phaseWin（改回"打空血才算赢"）；
  //      ★★ 同一天第四条又把它改成**必败剧情战**（声明 `storyLoss`），所以那一场挂的是
  //      "这一场打不过"那条——**不能**再写"打倒 霍尔·霍斯 就赢"（他这一场有剧本保护、打不死）。
  //   ⚠️ 顺序：storyLoss → phaseWin → keySlot（三者互斥，各自的机制分支都保留）。
  const phase = game.phaseWinRule?.();
  const loss = game.storyLossRule?.();
  if (loss) {
    tags.push(`<span class="status-tag warn">这一场打不过 · 撑到剧情那一刻就结束（他不会被打倒）</span>`);
  } else if (phase) {
    tags.push(`<span class="status-tag good">打到共享生命的一半就结束这一场 · 判你赢${keyName ? `（不必打倒 ${keyName}）` : ''}</span>`);
  } else if (keyName) {
    tags.push(`<span class="status-tag good">打倒 ${keyName} 就赢</span>`);
  }
  return tags.join('');
}
/**
 * ★★ 霍尔·霍斯的两个新技能（2026-10-03 用户拍板）的状态标签，**一个函数管两头**：
 *   · 他自己那一栏：「瞄准 · 剩余 N 次无视防御」（次数用光就不显示）；
 *   · **被锁定的那个角色**那一栏：「皇帝」锁定中 · 一回合后受到 10 点伤害（计防御 · 躲不掉）。
 * ⚠️ 「瞄准」那一句按**技能归属**过滤（`game.skills(slot)` 里有 `aim` 才可能显示次数），
 *    免得别的角色的槽位上凭空空出一句"剩余 0 次"之类的怪话（次数本来是 0，就不会显示）。
 * ⚠️ 被锁定的那一栏**不做角色过滤**：谁被锁了就在谁那一行报出来（这才是玩家要看的）。
 */
function emperorTags(game, slot) {
  const s = game.s, tags = [];
  const charges = s.aimCharges?.[slot] || 0;
  if (charges > 0 && game.skills(slot).includes('aim')) {
    tags.push(`<span class="status-tag good">${SKILLS.aim.name} · 剩余 ${charges} 次无视防御</span>`);
  }
  if (s.emperorMark?.[slot]) {
    const mark = s.emperorMark[slot];
    const unit = s.units?.find(u => u.id === mark.unitId) || null;
    tags.push(`<span class="status-tag warn">「${SKILLS.emperor.name}」锁定中 · 一回合后受到 ${unit ? game.emperorDamage(unit) : SKILLS.emperor.dmg} 点伤害（计防御 · 躲不掉）</span>`);
  }
  return tags.join('');
}
/**
 * ★★ 「暗枪」（2026-10-05 用户拍板）的状态标签，**一个函数管两头**（照 `emperorTags` 的写法）：
 *   · **埋枪的人**那一栏：「暗枪已标记 N 格 · 对手回合结束时结算 8 点（计防御）」
 *     （N 只数他自己埋的，同队的别人不白拿）；还没埋满就把"还能再标几格"也说清楚；
 *   · **对面**那一栏：「对方的暗枪正指着这里的 N 格 · 回合结束时踩在上面受 8 点伤害（计防御）」——
 *     用户要的就是"对手看得见、能躲开"，所以这一句必须挂在被指着的那一方身上。
 * ⚠️ 数值全部取自 `SKILLS.darkgun`（`dmg` / `marks` / `range`），界面里不手写一遍。
 * ⚠️ 与冷枪／皇帝那两条**三套颜色、三套说法**：冷枪是"挪开那一格就躲开了"、皇帝是"挪开也躲不掉"、
 *    暗枪是"埋在地上的格子，谁踩谁挨，挪开那一步就走掉了"——所以措辞也各写各的。
 */
function darkgunTags(game, slot) {
  const sk = SKILLS.darkgun;
  const marks = game.darkgunMarks?.() || [];
  if (!marks.length) return '';
  const tags = [];
  const mine = marks.filter(m => m.by === slot);
  if (mine.length) {
    tags.push(`<span class="status-tag warn">${sk.name}已标记 ${mine.length} 格 · 对手回合结束时结算 ${sk.dmg} 点（计防御）${mine.length < sk.marks ? ` · 还能再标 ${sk.marks - mine.length} 格` : ''}</span>`);
  }
  const incoming = marks.filter(m => m.side !== teamOf(slot));
  if (incoming.length) {
    tags.push(`<span class="status-tag warn">对方的${sk.name}正指着这里的 ${incoming.length} 格 · 回合结束时踩在上面受 ${sk.dmg} 点伤害（计防御 · 挪开那一步就走掉了）</span>`);
  }
  return tags.join('');
}
/**
 * 场地专属的地形叫法：效果完全一样，只是名字与外观要符合场景。
 * 例：飞机上不该出现"沼泽/岩石/草丛"，改用机舱里的东西（见 render.js 的 plane-* 皮肤）。
 */
// 第五章「力量」：整艘船都是替身。船里没有岩石和草丛，只有钢壁与管线。
// 四层场地共用这一套叫法（拆掉要害就会往船里推进一层，叫法不该跟着变）。
const shipTerrainNames = { rock: '船体钢壁', bush: '管线掩护', heal: '补给箱', hazard: '破裂的蒸汽管' };
const arenaTerrainNames = {
  plane: { rock: '堆叠的行李箱', bush: '座椅掩护', heal: '送餐车', hazard: '泄漏的燃油' },
  'ship-deck': shipTerrainNames,
  'ship-corridor': shipTerrainNames,
  'ship-engine': shipTerrainNames,
  'ship-broken': shipTerrainNames,
};
const terrainName = (type, arena) => arenaTerrainNames[arena]?.[type] || terrainNames[type] || '空地';
export function tileDescription(game, tile) {
  if (!tile) return '空地';
  // ⚠️ 场地要读 game.arenaKey()（引擎里的当前值）：第五章拆掉一个要害会**中途换场地**，
  //    只读 s.story.arena 会一直停在第一层。
  const ty = game.s.terrain[tileKey(tile)], fire = game.fireAt(tile), arena = game.arenaKey?.() ?? game.s.story?.arena;
  // 船体要害值得单独说一句：它是这一关唯一能打的目标，玩家得一眼看出"这是要害、还剩多少血"
  const pillar = game.pillarAt?.(tile);
  const part = pillar?.part ? `${pillar.name}（船体要害 ${pillar.hp}/${pillar.maxHp}）` : '';
  // ★ 第八章「反光点」：鼠标停上去就要看出"这格是不是吊死者能落的点、有没有被封"
  const mirror = game.mirrorAt?.(tile);
  const shine = mirror ? (mirror.sealed
    ? `${game.mirrorRule?.()?.name || '反光点'}（已被火焰封住 · 不再能落人）`
    : `${game.mirrorRule?.()?.name || '反光点'} · 吊死者的落点之一`) : '';
  // ★ 2026-10-03：吊死者**也栖得进岩石**（没被占用的那些），所以这一类障碍格要说明白——
  //   否则玩家看到它站在一块岩石上会以为是显示错误（这一句只在开反光点机制的那一幕里出现）。
  const perch = game.mirrorRule?.() && ty === 'rock' ? '吊死者也能栖在这一格（岩石里）' : '';
  // ★ 第八章「场边冷枪」：鼠标停上去就要看出"这一格是不是正在被瞄、站这儿会不会挨枪"。
  //   ⚠️ 2026-10-03 改版后枪手**打得死、也会走位**（`immune`/`pinned` 两条已按用户要求撤掉），
  //      所以"他钉在这里、打不死"那一句也一并删了——留着会骗玩家。
  const sniper = game.sniperRule?.();
  const aim = sniper ? game.s.shotAim : null;
  const shot = aim && aim.row === tile.row && aim.col === tile.col
    ? `${sniper.name}的弹道穿过这里 · 站在格子上会被打中（${sniper.dmg} 点真实伤害，无视防御）· 挪开就躲开了` : '';
  // ★★ 「皇帝」锁定：鼠标停上去就要看出"这一格上的单位被锁定了、一回合后要挨多少（而且躲不掉）"。
  //   ⚠️ 与冷枪那一条分得清清楚楚：冷枪**挪开就没事**，皇帝锁的是**单位**、挪开也躲不掉。
  const locked = game.emperorMarks?.().find(entry => entry.unit.row === tile.row && entry.unit.col === tile.col);
  const lock = locked
    ? `「${SKILLS.emperor.name}」锁定着这里的单位 · 一回合后受到 ${game.emperorDamage(locked.unit)} 点伤害（计防御 · 挪开也躲不掉）` : '';
  // ★★ 「暗枪」标记：鼠标停上去就要看出"这一格被埋了枪、对手回合结束时站在这儿的敌人会挨多少"。
  //   ⚠️ 与上面两条分得清清楚楚：冷枪是**弹道**（下一回合开火、挪开就躲开）、
  //      皇帝锁的是**单位**（挪开也躲不掉）、暗枪是**埋在这一格上的雷**——
  //      "谁踩谁挨、走开就没事"，所以说法也不一样。
  //   ⚠️ 取值用 `entry.row` / `entry.col`：`game.darkgunMarks()` 是把标记**平铺**出来再加一格
  //      `tile`（`{ by, side, row, col, round, name, tile }`）——与 `emperorMarks()`（那一份是
  //      `{ slot, mark, unit, by }`、要读 `entry.mark.row`）**形状不同**，别照抄上面那条的写法。
  const buried = game.darkgunMarks?.().find(entry => entry.row === tile.row && entry.col === tile.col);
  const dark = buried
    ? `${SKILLS.darkgun.name}标记着这一格 · 对手回合结束时站在格上的敌方单位受到 ${SKILLS.darkgun.dmg} 点伤害（计防御 · 走开就没事）` : '';
  // ★★ 2026-10-05 用户拍板：**可拾取的道具**——鼠标停上去就要看出"这是什么道具、捡了有什么用"。
  //   ⚠️ 文案与数值全部取自 `ITEM_TYPES`（`stat` / `amount` / `duration`），界面里不手写数值；
  //      「连携」对**没有替身棋子**的角色会改成移动 +1，所以这一格要把那条例外也说清楚。
  //   ⚠️ 这里**不按"现在轮到谁"挑槽位**：盘面上每个槽位都可能来捡，所以只写这件道具本身的效果，
  //      例外那一句只在"这一局真的有单单位角色"时才挂上（判据是 `FIGHTERS.x.stand`，不按角色名）。
  const picked = game.itemAt?.(tile);
  const pickedDef = picked ? ITEM_TYPES[picked.type] : null;
  const soloInPlay = (game.s.slots || []).some(slot => !game.fighter?.(slot)?.stand);
  const item = pickedDef
    ? `${pickedDef.name}道具 · 走上去就能捡走：${pickedDef.stat} +${pickedDef.amount}（${pickedDef.duration}）`
      + (pickedDef.buff === 'dist' && soloInPlay ? '（没有替身棋子的角色捡到它会改成移动 +1）' : '')
    : '';
  // 「邻石 +1 防」是"紧邻障碍物"的意思：野外叫岩石，机舱里就是行李箱堆
  const adj = game.adjRock(tile) ? `邻${arenaTerrainNames[arena]?.rock || terrainNames.rock} +1 防` : '';
  // 水域地图先交代脚下是什么：水里的玩家方移动 −1，这一条必须让玩家在格子上就能看到
  // ⚠️ 惩罚值读**当前地图的数据**（`game.waterPenalty()`），没开局/老调用点退回 RULE 的口径——
  //    两个数现在是同一个（浅滩水路地图引用 RULE.waterMovePenalty），但地图才是"这张图减多少"的来源。
  const ground = game.wateryArena?.()
    ? [game.isWaterTile(tile) ? `水面 · 移动 −${game.waterPenalty?.() ?? RULE.waterMovePenalty}` : '木甲板']
    : [];
  return [...ground, item, part, shine, perch, shot, lock, dark, terrainName(ty, arena), fire ? `${fire.side.toUpperCase()} 火焰` : '', adj].filter(Boolean).join(' · ');
}
export function hoverPreview(game, tile, inspected = null) {
  const u = game.selected, target = inspected || (tile && game.occupant(tile)), s = game.s;
  let content = '', invalid = false, path = [];
  // ★★ 「暗枪」：瞄准的是**格子**（被棋子占着的格子也能标），所以它自己一条分支、**排在最前面**——
  //    不这么写的话，悬停到敌方棋子身上会掉进下面那条"攻击预览"，然后被 `attackReason` 一句
  //    "这个技能不能用于攻击"顶掉（假的可选/不可选）。
  if (s.pendingSkill === 'darkgun' && tile && u) {
    const reason = game.darkgunTileReason(u, tile);
    invalid = !!reason;
    const victim = game.darkgunVictim(tile, u.side);
    content = `${icon('darkgun')}<span class="target-name">${tileLabel(tile)}</span><span class="${reason ? 'unavailable' : ''}">${reason ? esc(reason)
      : `可标记（第 ${s.darkPlaced.length + 1}/${SKILLS.darkgun.marks} 格）${victim
        ? ` · 这里站着 ${victim.name}：结算时受 ${game.darkgunDamage(victim)} 点伤害（计防御）`
        : ' · 这一格现在没人，对手走上来才挨'}`}</span>`;
  } else if (target && u && s.pendingSkill === 'rebuild') {
    // ★★ 「重组」的第一步：点哪个棋子当目标。预览要说清"点它之后能做什么"
    //   （可用的效果 + 对敌人会造成多少伤害），不能走下面那条"攻击预览"——
    //   `attackReason` 会以"这个技能不能用于攻击"把它顶掉，看起来像不可选。
    const reason = game.rebuildTargetReason(u, target);
    invalid = !!reason;
    const options = reason ? [] : game.rebuildOptions(u, target).filter(o => o.ok);
    content = `${icon('rebuild')}<span class="target-name">${target.name}</span>${reason
      ? `<span class="unavailable">${esc(reason)}</span>`
      : `<span>点它选定目标 → 再选效果：${options.map(o => esc(o.label)).join(' / ') || '当前没有可用的效果'}</span>`}`;
  } else if (target && u && target.side === u.side && game.fixTargets(u).includes(target)) {
    // ★★ 东方仗助「修复」：**普攻指向友军＝治疗**——预览要把"能回多少血"说清楚
    //   （读的是 `game.preview()` 里那份友好目标的预览，口径与 `mend()` 完全一致）。
    const pv = game.preview(u, target);
    const full = pv.healActual < pv.heal;
    invalid = false;
    content = `${icon('target')}<span class="target-name">${target.name}</span><b class="damage-preview">+${pv.healActual}</b>`
      + `<span>${pv.hp} → ${pv.hpAfter} HP</span><span class="preview-defense">修复 · 攻击力 − ${SKILLS.fix.mendMinus}${full ? '（受治疗效果限制）' : ''}</span>`;
  } else if (target && u && target.side !== u.side && !['emerald', 'flame'].includes(s.pendingSkill)) {
    const skill = s.pendingSkill, pv = game.preview(u, target, skill);
    // ★★ 「皇帝」是"锁定一个单位"而不是当场攻击：判定要走 emperorReason——
    //    `attackReason` 的技能白名单里没有它，拿它判定会一律报"这个技能不能用于攻击"。
    const reason = skill === 'emperor' ? game.emperorReason(u, target) : game.attackReason(u, target, skill);
    invalid = !!reason;
    const result = reason ? `<span class="unavailable">${esc(reason)}</span>`
      // 「皇帝」的伤害**一回合之后**才落地，所以预览要把"延迟"写出来，别让玩家以为点下去就掉血
      : skill === 'emperor'
        ? `<b class="damage-preview">−${pv.damage}</b><span>一回合后 ${pv.hp} → ${pv.hpAfter} HP</span><span class="preview-defense">防御 ${pv.defense.total}（照常结算）</span>${pv.lethal ? '<span class="lethal">一回合后可终结</span>' : ''}`
        // ★ 穿甲（吊死者那 2 点）：预览里的这层防御**已经削过了**，所以要把"为什么这么低"说清楚，
        //   否则玩家会以为界面算错了（`pv.defense.pierce` 只有带 armorPierce 的出手方才有）。
        : `<b class="damage-preview">−${pv.damage}</b><span>${pv.hp} → ${pv.hpAfter} HP</span><span class="preview-defense">防御 ${pv.defense.total}${pv.defense.pierce ? `（穿甲 −${pv.defense.pierce}）` : ''}</span>${pv.heal ? `<span>吸血 +${pv.heal}</span>` : ''}${pv.lethal ? `<span class="lethal">${pv.wins ? '可终结' : '可击碎'}</span>` : ''}`;
    content = `${icon('target')}<span class="target-name">${target.name}</span>${result}`;
  } else if (s.pendingSkill && ['emerald', 'flame'].includes(s.pendingSkill) && tile) {
    const valid = game.placement(u).includes(tile);
    invalid = !valid;
    content = `${icon(s.pendingSkill)}<span class="target-name">${tileLabel(tile)}</span><span class="${valid ? '' : 'unavailable'}">${valid ? '可放置' : '不可放置'} · ${esc(tileDescription(game, tile))}</span>`;
  } else if (target) {
    // 2v2 时同一个队有两个角色，所以目标前面写的是**它在哪个角色名下**（P1 / P1·2）
    content = `${icon(target.kind === 'stand' ? 'stand' : target.kind === 'pillar' ? 'emerald' : 'user')}<span class="target-name">${target.kind === 'pillar' ? target.side.toUpperCase() : slotName(target.slot)} ${target.name}</span><span>${target.kind === 'pillar' ? `${target.hp}/${target.maxHp} HP · 打碎不反噬 · 该方每回合回血 ${RULE.pillarRegen}（不叠加）` : `防御 ${game.defense(target).total} · ${target.range ? `当前威胁 ${target.range} 格` : '无法普通攻击'}`}</span>`;
  } else if (tile && u) {
    const reason = game.moveReason(u, tile);
    invalid = !!reason;
    if (!reason) path = game.paths(u).get(tileKey(tile)) || [];
    // 单单位角色（乔瑟夫）没有同伴：这一项显示为「本体单独行动」，不能去算连携距离
    const partner = game.partner(u), dist = partner ? hexDist(tile, game.tile(partner)) : null;
    const ty = s.terrain[tileKey(tile)], fireCrossed = path.some(t => game.fireAt(t)?.side === otherSide(u.side));
    const danger = (fireCrossed ? RULE.fireDmg : 0) + (ty === 'hazard' ? RULE.hazardDmg : 0);
    const effect = ty === 'heal' ? `恢复 +${game.healAmount(u.slot, RULE.healAmt)} HP` : danger ? `危险 −${danger} HP` : tileDescription(game, tile);
    const tether = game.mirrorWalker?.(u) ? '镜面跳跃 · 无视距离（反光点 / 岩石）'
      : dist === null ? '本体单独行动' : `连携 ${dist}/${game.distLimit(u.slot)}`;
    content = `${icon('move')}<span class="target-name">${tileLabel(tile)}</span><span class="${reason ? 'unavailable' : ''}">${reason ? esc(reason) : `${path.length} 步 · 1 AP · ${tether} · ${esc(effect)}`}</span>`;
  } else if (tile) {
    const type = s.terrain[tileKey(tile)];
    const detail = { rock: '不可通行 · 相邻 +1 防', bush: `掩护 +3 防${s.bushTimer[tileKey(tile)] ? ` · 剩 ${s.bushTimer[tileKey(tile)]} 次回合切换` : ''}`, heal: '恢复 10 HP · 满血保留', hazard: '停留结算 −3 HP' }[type] || '选择己方单位，规划下一步';
    content = `<span class="target-name">${tileLabel(tile)} · ${esc(tileDescription(game, tile))}</span><span>${detail}</span>`;
  }
  return { content, invalid, path };
}

/** 绿宝石柱护体：这个角色的**任一棋子紧贴着一根己方柱子**（含第五章的船体要害）时 +1 防御。
 *  2026-10-03 用户要求「给个提示」——所以做成状态标签，跟侵蚀／史莱姆防御那些排在一起。 */
function pillarTag(game, slot) {
  const units = game.s?.units || [];
  const touching = units.some(u => u.slot === slot && game.pillarDef?.(u));
  return touching ? '<span class="status-tag good">绿宝石柱护体 · 防御 +1</span>' : '';
}

/**
 * ★★ 2026-10-05 用户拍板：**这个角色从道具拿到的加成**（地形交互那一层）。
 * 口径（用户原话："状态栏要能看出这个角色拿到了什么加成，例如「力量 · 攻击 +2」这类标签，
 * 跟既有的'精湛剑术/潜沙'那些排在一起"）：
 *   · **按角色槽位**读那本账（`game.itemBuffs(slot)`）——同一队另一个角色一点都沾不上；
 *   · 文案与数值**从 `ITEM_TYPES` 的数据拼**（`名称 · 加什么 +几`），界面里不手写"力量 +2"；
 *   · 同一件捡到两次就显示累计值（`攻击 +4`），因为账本本来就是累加的；
 *   · 「时间」**不进这张表**：它是"当场 +1 行动点"，用完就没有了——它的痕迹在战斗记录与提示里，
 *     状态栏里挂一条"曾经 +1 AP"反而是假话（那个加成早就花掉了）。
 */
function itemTags(game, slot) {
  const buffs = game.itemBuffs?.(slot);
  if (!buffs) return '';
  return Object.values(ITEM_TYPES)
    .filter(def => def.buff !== 'ap' && (buffs[def.buff] || 0) > 0)
    .map(def => `<span class="status-tag good">${esc(def.name)} · ${esc(def.stat)} +${buffs[def.buff]}</span>`)
    .join('');
}

/** 战斗记录：棋盘下方那块**常驻面板**显示全部流程；弹窗（全屏）里也照旧渲染一份。 */
export function renderLog(game) {
  const typeIcon = e => ({ hit: 'attack', heal: 'heart', move: 'move', skill: e.skill || 'star', place: 'emerald', start: 'flag', turn: 'chevron', status: 'shield', result: 'flag', skip: 'time' })[e.type] || 'log';
  const row = e => `<div class="log-row ${e.type}"><span class="log-turn">T${String(e.turn).padStart(2, '0')}</span>${icon(typeIcon(e))}<span>${esc(e.text)}</span></div>`;
  const inline = $('fullLogInline');
  if (inline) {
    inline.innerHTML = game.s.log.map(row).join('');
    inline.scrollTop = inline.scrollHeight;   // 永远停在最新一条
  }
  if ($('logDialog').open) {
    $('fullLog').innerHTML = game.s.log.map(row).join('');
    $('fullLog').scrollTop = $('fullLog').scrollHeight;
  }
}
