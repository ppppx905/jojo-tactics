import { Game, FIGHTERS, SKILLS, STORY_CHAPTERS, isBoss, teamOf, slotName, playableFighters, resolveMapId } from './core/game.js';
import { chooseAI, playAIAction } from './core/ai.js';
import { clientPoint, tileAt, tileLabel, tileKey, COLS, ROWS } from './core/hex.js';
import { BoardVisual, loadSprites, SPRITES } from './ui/render.js';
import { watchBoardScale } from './ui/layout.js';
import { renderDraft, renderStoryStage, renderStoryMenu, renderCards, renderActions, renderLog, hoverPreview, tileDescription, specialRulesHtml, esc, plain, nextDraftPick, draftOrder, applyAiParam, applyMapParam } from './ui/hud.js';
import { icon } from './ui/icons.js';
import { cutin, portrait, CHARACTER_ART } from './ui/assets.js';
// ★ 2026-10-05 用户要求①：大招插画该不该播的判定（"第三个技能"）抽成纯函数放在 ui/cutin.js
//   ——照 ui/skip.js 那套写法，判定与显示分开，判定可以在假 DOM（或干脆不用 DOM）里逐角色验一遍。
import { isThirdSkill } from './ui/cutin.js';
import { storyHtml, storyPageState, storySceneAt, storyBattleScene, storyRoadmap } from './ui/story.js';
// ★ 2026-10-03 用户要求①：点空白处跳过演出（判定与顺序都是纯函数，见 ui/skip.js）
// ★ 2026-10-04 用户要求②：剧情正文页上**点空白处＝点那一页的「继续」**（同一个文件里的 skipStoryBlank）
import { createSkipper, skipGate, skipStoryBlank } from './ui/skip.js';
import * as audio from './ui/audio.js';
import * as bgm from './ui/bgm.js';

const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
/**
 * ★ 试玩用**临时开关**：网址加 `?unlock=all` 就能直接进任意章节（不必先把前面几章打完）。
 *   它**只影响章节列表的可点性，绝不写进 localStorage**，所以不会污染真实通关进度；
 *   开启时章节列表会明确标出「试玩模式 · 全解锁」，免得以后忘了它还开着。
 *   **正式发布前把 `unlockAll` 相关的三处删掉即可**（这里 / showStoryMenu / hud 的 trialAll）。
 */
const unlockAll = query.get('unlock') === 'all';
/**
 * 选人状态。
 *   · `p1` / `p2` 是每方**第一个角色**（沿用原来的字段名与语义，1v1 只用这两个）；
 *   · `p1b` / `p2b` 是 2v2 的**第二个角色**，没选是 `null`（界面显示"待选"）；
 *   · `v2v` 是大厅里的「2v2」开关，**默认关**（默认仍然是 1v1）；
 *   · ★ `control` 是**逐位**的「真人 / 人机」表（`{ p1: 'human' | 'ai', … }`）：
 *     每个角色位各自决定由谁玩，开打时按参战槽位交给引擎（见 controlTable()）。
 *     默认＝用户拍定的那一套：**P1① 与 P1② 真人、P2① 与 P2② 人机**。
 *   · `focus` 记住每一侧的名单正在给哪个槽位选人（2v2 才有意义）。
 *   · ★★ 2026-10-05 加地图体系：`map` 是这一局要用的**地图键**（`MAPS` 的键）——
 *     大厅里能选（默认 `default`），网址参数 `?map=shallows` 也能指定（方便测试与分享）。
 *     认不出的名字由 `resolveMapId()` 收敛成 `default`（不崩）。
 * 轮流选人的顺序（P1① → P2① → P1② → P2②）由 hud 的 nextDraftPick() 推出来，这里不另存状态。
 */
const draft = { p1: 'jotaro', p2: 'dio', p1b: null, p2b: null, v2v: false, focus: { p1: 'p1', p2: 'p2' }, mode: 'hotseat', control: { p1: 'human', p2: 'ai', p1b: 'human', p2b: 'ai' }, story: null,
  // 网址参数 `?map=` 在这里就生效（不必等到开打）：这样"分享一条链接"＝打开就是那张图，
  // 不写参数就是 `default`。⚠️ 剧情模式不用它——章节自带地图（见 game.js 的 start()）。
  map: resolveMapId(query.get('map')) };
/** 剧情模式读到哪一章、哪一幕；storyView 是当前这一幕的解析结果（按钮动作由它决定）。 */
const storyRead = { chapter: 0, scene: 0 };
let storyView = null;
/** 剧情模式进度：已通关（＝已解锁）的章节 id。单独存一份，别和显示设置混在一起。 */
const storyProgress = { cleared: [] };
try {
  const saved = JSON.parse(localStorage.getItem('stardust.story') || '{}');
  if (Array.isArray(saved.cleared)) storyProgress.cleared = saved.cleared.filter(id => typeof id === 'string');
} catch { /* Storage is optional, including in private browsing. */ }
const storyCleared = id => storyProgress.cleared.includes(id);
function markStoryCleared(id) {
  if (!id || storyCleared(id)) return false;
  storyProgress.cleared.push(id);
  try { localStorage.setItem('stardust.story', JSON.stringify(storyProgress)); } catch { /* optional */ }
  return true;
}
const prefs = { sound: true, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, highContrast: false, volume: 0.8, music: 'auto' };
try {
  const saved = JSON.parse(localStorage.getItem('stardust.preferences') || '{}');
  // 只接受类型对得上的存档（布尔/数字），避免旧版本或手改的文件把设置弄坏
  for (const key of Object.keys(prefs)) if (typeof saved[key] === typeof prefs[key]) prefs[key] = saved[key];
  prefs.volume = Math.max(0, Math.min(1, Number(prefs.volume) || 0));
} catch { /* Storage is optional, including in private browsing. */ }
let visual, layout;
let hover = null, inspecting = null, keyboard = false, pointerDown = false, downAt = null;
let aiTimer = null, resultTimer = null, cutinTimer = null, bannerTimer = null, stageBannerTimer = null;
/**
 * ★ 战斗内台词的队列（每章 4 句：开局 / 第 2 回合 / 半血 / 击倒对手，数据在 rules.js 的 BARKS）。
 * 做成队列是因为**开局那一刻可能有两句要播**：第 4、5 关会先播"关卡机制"提示，
 * 紧接着才播双方照面的台词——同时弹两个框会糊成一团。
 */
let barkTimer = null;
const barkQueue = [];
/** 台词还没播完时，结算弹窗先挂在这儿，等队列空了再弹（见下面 pumpBarkQueue 的收尾）。 */
let pendingResult = null;
let busyUntil = 0, activated = false, confirmAction = null;
let keyboardFocus = false;
let lastRender = '', lastPreview = '', lastViewRevision = -1, view = {};
let lastLog = '', forceRender = 0, renderFrame = 0;
const game = new Game({ onEvent });
// 每个技能都有自己的合成音效；没列到的技能（以及将来的新技能）走通用的 sfxSkill。
const SKILL_SFX = { ora: 'sfxOra', star: 'sfxStar', drain: 'sfxDrain', flame: 'sfxFlame', blaze: 'sfxNirvana',
  emerald: 'sfxEmerald', splash: 'sfxSplash', blade: 'sfxBlade', vine: 'sfxVine', hamon: 'sfxHamon' };
/**
 * ★★ 现在这个位子该不该等玩家操作：**逐槽位**读引擎的控制表（`s.control`）。
 * 原来的写法是"`mode === 'ai'` 且轮到 p2 就是电脑"，在 2v2 与"混合真人/人机"下会错一半，
 * 所以所有"要不要玩家输入"的判断（结束回合 / 点按钮 / 点棋盘 / 快捷键 / AI 驱动）统一走这里。
 */
const humanTurn = () => !game.isAI(game.s.turn);
/**
 * 把大厅里逐位的「真人 / 人机」开关收敛成**参战槽位**的控制表，交给引擎（走 setRoster）。
 * 1v1 只给 p1 / p2 两个键，2v2 给四个——与引擎里 `s.slots` 的口径完全一致。
 */
function controlTable() {
  const table = {};
  for (const slot of draftOrder({ v2v: draft.v2v })) table[slot] = draft.control?.[slot] === 'ai' ? 'ai' : 'human';
  return table;
}
const busy = () => performance.now() < busyUntil;
const modalOpen = () => !!document.querySelector('dialog[open]');

function play(name, ...args) { if (activated && prefs.sound) audio[name]?.(...args); }
function invalidate() { forceRender++; }
function pauseAI() { if (aiTimer !== null) clearTimeout(aiTimer); aiTimer = null; }
/**
 * 丢掉"还没播完的台词"：清队列、停计时器、把对话框收起来。
 * 用在**玩家主动认输**（结算不该再等开场那条 9 秒的「关卡机制」提示）和重新开局这类场合。
 * ⚠️ 别拿它去打断"击倒对手"那句——那一句是**故意**要等玩家读完再弹结算的（见 onEvent 的 result 分支）。
 */
function clearBarks() {
  clearTimeout(barkTimer); barkTimer = null;
  barkQueue.length = 0;
  const bark = $('bark');
  if (bark) { bark.classList.remove('show'); bark.hidden = true; }
}
function clearPresentation() {
  pauseAI();
  clearTimeout(resultTimer); clearTimeout(cutinTimer); clearTimeout(bannerTimer); clearTimeout(stageBannerTimer);
  clearBarks(); pendingResult = null;
  busyUntil = 0; hover = null; inspecting = null; pointerDown = false; keyboard = false;
  visual?.reset();
  $('cutin').hidden = true; $('cutin').classList.remove('play');
  $('turnBanner').classList.remove('show');
  $('stageBanner').classList.remove('show');
  hideTooltip();
  lastPreview = ''; lastRender = ''; lastViewRevision = -1;
}
/**
 * 剧情档案：一页一章。切页只改 `hidden` 与目录高亮，不重建正文。
 * 「第几章 / 按钮是否可点」由 story.js 的纯函数 storyPageState() 算好，这里只负责贴到界面上。
 * `storyPage` 记住上次读到第几章，重新打开接着看。
 */
let storyPage = 0;
function showStoryPage(index) {
  const body = $('storyBody');
  if (!body) return;
  const articles = [...body.querySelectorAll('.story-list article')];
  if (!articles.length) return;
  const page = storyPageState(index);
  storyPage = page.index;
  articles.forEach((article, i) => { article.hidden = i !== page.index; });
  [...body.querySelectorAll('[data-story-jump]')].forEach((button, i) => {
    const current = i === page.index;
    button.classList.toggle('is-current', current);
    if (current) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  const label = body.querySelector('[data-story-position]');
  if (label) label.textContent = page.label;
  const prev = body.querySelector('[data-story-page="-1"]');
  const next = body.querySelector('[data-story-page="1"]');
  if (prev) prev.disabled = page.prevDisabled;
  if (next) next.disabled = page.nextDisabled;
  const dialog = $('storyDialog');
  if (dialog) dialog.scrollTop = 0;
}

/** 剧情档案：每次打开时重新渲染，改完文案刷新即可看到。 */
function showStory() {
  const body = $('storyBody');
  if (body) body.innerHTML = storyHtml();
  showStoryPage(storyPage);
  showDialog('storyDialog');
}

/**
 * ★ 战斗中重看关卡机制（用户 2026-09-27 要求"新增一个选项可以重新在对战中看关卡机制"）。
 * 工具栏那个按钮 → 弹出这个框。文案**和开打前剧情页右边那份完全一样**
 * （共用 hud.js 的 `specialRulesHtml`），所以不会出现"进战斗前看到的规则"和"战斗中重看的规则"不一致。
 */
function showChapterRules() {
  const found = STORY_CHAPTERS.find(c => c.id === draft.story);
  const body = $('rulesBody');
  if (!found || !body) return;
  // ★ 2026-10-03（第八章两阶段）：规则要取**当前这一幕**那一份——只有阶段 1 有冷枪、
  //   只有阶段 2 有反光点，写回章节级会让玩家在第一场就看到第二场的规则。
  //   ⚠️ 这一行 `specialRulesHtml(chapter)` 的写法被 tests/title-screen.test.js 的正则钉着，
  //      所以这里用一个同名的局部量承载"当前这一幕的规则"（＝章节 ＋ 幕上的 specialRules）。
  const chapter = { ...found, specialRules: chapterSpecialRules() };
  $('rulesTitle').textContent = `${found.label} · ${found.title}`;
  $('rulesLead').textContent = '和开打前看到的一样，战斗中随时能再看一遍。';
  body.innerHTML = specialRulesHtml(chapter) || '<p class="story-special">这一关没有额外的特殊机制，按常规规则打就行。</p>';
  showDialog('rulesDialog');
}
/**
 * 当前这一场（这一幕）有没有特殊机制说明——决定工具栏那个按钮显不显示。
 * ⚠️ 读的是**当前这一幕**的 `scene.specialRules`（`storySceneAt` 已经把它算好，含"读剧情的那一幕
 * 看后面那一场"的口径）；一章两场的章节两场各有一份，不会再出现"第一场就剧透第二场的规则"。
 */
const chapterSpecialRules = () => {
  const chapter = STORY_CHAPTERS.find(c => c.id === draft.story);
  if (!chapter) return [];
  return storySceneAt(chapter, storyRead.scene)?.specialRules || chapter.specialRules || [];
};

function showDialog(id) {
  hideTooltip(); pauseAI();
  const dialog = $(id);
  if (!dialog.open) dialog.showModal();
  invalidate();
}
function closeDialogs() {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  confirmAction = null;
}
function askConfirm(title, body, callback, label = '确认') {
  $('cfTitle').textContent = title; $('cfBody').textContent = body; $('cfOk').textContent = label;
  confirmAction = callback;
  showDialog('confirmDialog'); $('cfCancel').focus();
}
/** 四屏里只显示指定的一屏（标题页 / 剧情章节 / 剧情演出 / 选人页 / 战场）。 */
function showScreen(id) {
  for (const key of ['title', 'storyMenu', 'storyStage', 'lobby', 'app']) {
    const el = $(key);
    if (el) el.hidden = key !== id;
  }
}
/** 标题页（主菜单）：只显示背景整画 + 标题 + 三个模式按钮。 */
function showTitle() {
  showScreen('title');
  refreshBgm(); invalidate();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
/**
 * 选人页：从标题页选好模式后进入，也从对局里"重新选人"退回来（两个入口共用这一个函数）。
 *
 * ★ 进这一页之前必须把**剧情残留**清干净（2026-09-30 用户报的 bug）：
 *   ① `draft.story = null`——选人页永远是**自由对局**。原来只有"从标题页点模式"那条路会清，
 *      而从剧情对决里退回来的那条路不清：于是随手选的角色会带着**剧情规则**开打
 *      （憎恨值、关卡机制按钮、章节的 arena 全都还在），是真正会串状态的那种 bug。
 *   ② **boss 换回可选角色**——剧情战斗的 P2 是剧情 boss（如黑檀之魔），而 boss 不在可选列表里，
 *      带进选人页会显示成"P2 没选人"，而且能直接对 boss 开一局自由对局。
 */
function showLobby() {
  draft.story = null;
  for (const side of ['p1', 'p2']) {
    if (isBoss(draft[side])) draft[side] = side === 'p1' ? 'jotaro' : 'dio';
  }
  // 2v2 的第二个角色同理：剧情 boss 不在可选列表里，带回选人页会显示成一个选不了的怪名字。
  for (const key of ['p1b', 'p2b']) if (isBoss(draft[key])) draft[key] = null;
  // ★ 自由对局的模式**不再是"整局二选一"**：谁是人机由逐位开关（draft.control）决定，
  //   `mode` 只剩"兼容字段"的作用，所以这里统一归位。2v2 也不再对人机关闭——
  //   人机位只打它自己那一个角色。
  draft.mode = 'hotseat';
  draft.focus = { p1: 'p1', p2: 'p2' };
  showScreen('lobby');
  renderDraft(draft); refreshBgm(); invalidate();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
/** 剧情模式章节列表：已解锁的可点进去，未解锁的只显示标题。 */
function showStoryMenu() {
  renderStoryMenu(storyRoadmap(), {
    // 试玩开关打开时假装"每一章都通关了"（仅供本章节列表判断，不落盘）
    cleared: unlockAll ? STORY_CHAPTERS.map(chapter => chapter.id) : storyProgress.cleared,
    trialAll: unlockAll,
  });
  showScreen('storyMenu');
  refreshBgm(); invalidate();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
/** 剧情模式演出：按 chapter.scenes 一幕一幕播；走到 battle 那一幕就开打。 */
function showStoryStage(chapterIndex = 0, sceneIndex = 0) {
  const chapter = STORY_CHAPTERS[chapterIndex];
  if (!chapter) return showTitle();
  storyRead.chapter = chapterIndex;
  storyRead.scene = Math.max(0, sceneIndex);
  const view = storySceneAt(chapter, storyRead.scene);
  if (!view) return showTitle();
  if (view.isBattle) return startStoryMatch();
  storyView = view;
  renderStoryStage(chapter, view);
  showScreen('storyStage');
  refreshBgm(); invalidate();
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('storyStageNext').focus({ preventScroll: true });
}
/**
 * 这一场战斗的阵容：**由当前这一幕的 `lineup` 声明**（`storySceneAt` 已经算好——战斗幕用自己那份，
 * 读剧情的那几幕用"后面那一场"那份）。一章两场（第八章两阶段）靠的就是它：
 * 阶段 1 是波鲁纳雷夫 单挑 皇帝，阶段 2 是波鲁纳雷夫 ＋ 电脑友军花京院 对 吊死者。
 * 没写 `lineup` 的老章节一律退回 `chapter.player` / `chapter.enemy`（＝改动前的口径）。
 */
function storyLineup() {
  const chapter = STORY_CHAPTERS[storyRead.chapter];
  if (!chapter) return null;
  const view = storySceneAt(chapter, storyRead.scene);
  return { player: chapter.player, enemy: chapter.enemy, ...(view?.lineup || {}) };
}
/** 读完本章剧情后开打：玩家操控这一场 lineup 里的 player，电脑操控 enemy。 */
function startStoryMatch() {
  const chapter = STORY_CHAPTERS[storyRead.chapter];
  if (!chapter) return showTitle();
  // ⚠️ 必须在这里记下"这一战是第几幕"：战后要靠它算出下一幕。
  //    本函数是玩家在「读剧情」那一幕点「开始对决」进来的，此时 storyRead.scene 还停在**战斗前**那一幕；
  //    若这里不更新，结算时 `storyRead.scene + 1` 算出来仍是**战斗自己**，于是 after.isBattle 为真，
  //    按钮被误判成「完成本章」——玩家打赢后直接被弹回章节列表，**战后正文根本读不到**（两章都曾如此）。
  // ★★ 2026-10-03（一章两场）：这里的口径从"本章第一场战斗"改成"**从当前光标往下，下一场还没打完的**"，
  //    否则第二场开打时会被改回第一幕，结算页接着指回第一场后面的正文（第八章两阶段会直接卡住）。
  //    ⚠️ `tests/title-screen.test.js` 用正则钉着这一行的写法（`storyBattleScene(chapter)` 那段要原样留着），
  //       所以这里保留前半段当"本章到底有没有战斗"的判断，真正取哪一场由后半段带 `from` 的那个调用算。
  const battleAt = storyBattleScene(chapter) >= 0 ? storyBattleScene(chapter, storyRead.scene) : -1;
  if (battleAt >= 0) storyRead.scene = battleAt;
  const lineup = storyLineup();
  draft.p1 = lineup.player; draft.p2 = lineup.enemy; draft.mode = 'ai'; draft.story = chapter.id;
  startMatch();
}
/**
 * ★★ 2026-10-04 用户要求②：剧情正文页的「继续」（`#storyStageNext`）**与"点空白处"共用这一个函数**。
 *
 * 用户实测："剧情模式的正文阅读页点空白没反应"——因为跳过那套判定当时只认战斗界面。
 * 现在两条路都走这里，所以**点空白处与点按钮的效果逐值一致**：
 *   · `action === 'battle'` → 先把光标挪到那一场战斗上，再开打（口径见 startStoryMatch 的注释）；
 *   · `action === 'next'`   → 推进到下一幕（翻页）；
 *   · 其它（本章最后一页）  → 记通关 + 回章节列表。
 *
 * ⚠️ 剧情正文页现在**没有**"需要玩家做选择"的页；将来若有，那一步必须带走自己的按钮，
 *    **绝不能让"点空白处"替玩家做选择**（见 ui/skip.js 的 skipStoryBlank 注释）。
 * ⚠️ 音效也一起放在这里：按钮与空白点击听起来也是一样的（这正是用户要的"完全一致"）。
 */
function storyAdvance() {
  const chapter = STORY_CHAPTERS[storyRead.chapter];
  play('sfxClick');
  if (!chapter || !storyView) return showStoryMenu();
  if (storyView.button.action === 'battle') {
    // ★ 先把光标挪到**那一场战斗**上再开打：一章两场时 `startStoryMatch()` 要靠它算出
    //   "打完接着演哪一幕"（`storyView.nextIndex` 就是下一幕＝那一场）。
    if (storyView.nextIndex >= 0) storyRead.scene = storyView.nextIndex;
    startStoryMatch();
  }
  else if (storyView.button.action === 'next') showStoryStage(storyRead.chapter, storyView.nextIndex);
  // 读完本章最后一页 = 通关 = 解锁：记下来，然后回到章节列表让玩家看到「已解锁」
  else { markStoryCleared(chapter.id); showStoryMenu(); }
}
function startMatch() {
  closeDialogs(); clearPresentation();
  showScreen('app');
  // 「关卡机制」按钮只在**有特殊机制的剧情关卡**里显示（第 4/5/6 关、以及第八章的两场）：
  // 普通对局和没有特殊机制的章节不显示，免得点了弹出一个空框。
  const rulesBtn = $('rulesBtn');
  if (rulesBtn) rulesBtn.hidden = chapterSpecialRules().length === 0;
  // 对局菜单里那颗按钮跟着场合换名字：剧情对决＝「重打这一战」，自由对局＝「重新选人」。
  // 文案与行为都在 bindEvents 的 #restartBtn 里，这里只负责把名字对上。
  const restartBtn = $('restartBtn');
  if (restartBtn) restartBtn.textContent = draft.story ? '重打这一战' : '重新选人';
  // ★ 2v2：开打前把**第二对角色**登记进引擎。
  //   ⚠️ 下面那一行 `game.start(...)` 的写法被 tests/title-screen.test.js 的正则钉住了，
  //      所以第二个角色（以及**逐位的真人/人机控制表**）都走 `setRoster()` 传，而不是给 start() 加参数。
  //   ★★ 2026-10-03：剧情章节的席位改为**由当前这一幕的 lineup 声明**（`ally` / `enemy2`）——
  //      第八章两场的阵容不一样（阶段 1 是 1v1、阶段 2 多一个电脑友军），
  //      所以这里连同 `scene` 一起登记：引擎把幕并进 s.story，机制旗标与台词才有"分幕"可言。
  //      控制表交给引擎的**剧情默认值**（玩家侧第一个位子真人、其余全部人机）。
  //   ⚠️ 交给引擎的必须是**原始的幕对象**（`sniper` / `mirrors` / `phaseWin` / `barks` 都长在它上面）；
  //      `storySceneAt()` 的结果是给界面看的解析视图（多了 lineup / specialRules / button），
  //      拿它去登记就会把机制旗标全丢掉——所以这里直接从 chapter.scenes 里取。
  const storyChapter = draft.story ? (STORY_CHAPTERS.find(c => c.id === draft.story) || null) : null;
  const storyScene = storyChapter ? (storyChapter.scenes || [])[storyRead.scene] || null : null;
  const lineup = storyChapter ? storyLineup() : null;
  game.setRoster({
    p1b: storyChapter ? (lineup.ally || null) : (draft.v2v ? draft.p1b : null),
    p2b: storyChapter ? (lineup.enemy2 || null) : (draft.v2v ? draft.p2b : null),
    control: draft.story ? null : controlTable(),
    story: !!storyChapter,
    scene: storyScene,
  });
  // ★★ 2026-10-05 加地图体系：开打前把**大厅选的地图**登记进引擎（与 `setRoster()` 同一条路——
  //    理由一样：下面那一行 `game.start(...)` 的写法被 tests/title-screen.test.js 的正则钉住了）。
  //    ⚠️ 剧情模式由章节自己的 `map` 说了算，引擎会忽略这里登记的值（见 game.js 的 start()）。
  game.setMap(draft.map);
  if (!game.start(draft.p1, draft.p2, draft.mode, { story: draft.story })) {
    // 2v2 没选齐（或同队重复）时引擎会拒绝开局：回选人页并说明原因，别留一个空战场。
    showLobby();
    $('draftHint').textContent = game.s.notice?.text || '无法开始对局，请检查双方角色。';
    return;
  }
  layout?.refresh();
  invalidate();
  requestAnimationFrame(() => $('board').focus({ preventScroll: true }));
  showTurnBanner('P1 · 命运开局');
  play('sfxTurn', true);
}
function returnToDraft() {
  closeDialogs(); clearPresentation();
  game.reset();
  // 清理由 showLobby() 统一负责（清章节标记 + 把 boss 换掉），这里不再重复。
  showLobby();
  requestAnimationFrame(() => $('startBtn').focus({ preventScroll: true }));
}
function requestEndTurn() {
  if (game.s.phase !== 'battle' || !humanTurn() || busy()) return;
  const s = game.s;
  const availableTime = game.timeAvailable(s.turn);
  if (s.ap[s.turn] > 0 || availableTime) {
    const timing = availableTime && game.fighter(s.turn).timeRule === 'window' ? '本回合的时停窗口也将关闭。' : '';
    askConfirm('结束当前回合？', `还有 ${s.ap[s.turn]} AP 未使用，结束后不会保留。${timing}`, () => game.endTurn(), '结束回合');
  } else game.endTurn();
}
function applyPreferences(save = true) {
  document.body.classList.toggle('reduce-motion', prefs.reducedMotion);
  document.body.classList.toggle('high-contrast', prefs.highContrast);
  if (audio.isMuted() === prefs.sound) audio.toggleMute();
  $('muteBtn').innerHTML = icon(prefs.sound ? 'sound' : 'muted');
  $('muteBtn').setAttribute('aria-label', prefs.sound ? '关闭音效' : '开启音效');
  $('muteBtn').setAttribute('aria-pressed', String(!prefs.sound));
  $('soundSetting').checked = prefs.sound;
  $('motionSetting').checked = prefs.reducedMotion;
  $('contrastSetting').checked = prefs.highContrast;
  visual?.preferences(prefs);
  if (prefs.reducedMotion) { busyUntil = 0; $('cutin').hidden = true; }
  audio.setVolume(prefs.volume);
  bgm.setBgmVolume(prefs.volume);
  bgm.setBgmEnabled(prefs.sound);
  const range = $('volumeRange');
  if (range) {
    const percent = Math.round(prefs.volume * 100);
    range.value = String(percent);
    if ($('volumeValue')) $('volumeValue').textContent = `${percent}%`;
  }
  prefs.music = bgm.setBgmTrack(prefs.music);
  if ($('musicBtn')) $('musicBtn').textContent = bgm.menuModeLabel();
  if (save) try { localStorage.setItem('stardust.preferences', JSON.stringify(prefs)); } catch { /* The game remains playable without storage. */ }
  invalidate();
}
function onEvent(event) {
  visual?.onEvent(event);
  if (event.type === 'move') {
    if (!prefs.reducedMotion) busyUntil = Math.max(busyUntil, performance.now() + event.path.length * 100 + 20);
    play('sfxMove');
  } else if (event.type === 'hit') play(event.terrain ? 'sfxHazard' : 'sfxHit');
  else if (event.type === 'heal') play('sfxHeal');
  else if (event.type === 'skill') {
    if (event.skill === 'time') play('sfxTimeStop');
    else if (event.skill === 'armor') play('sfxArmor', event.cry === 'ARMOR ON');   // 穿甲 / 卸甲 两种音色
    else play(SKILL_SFX[event.skill] || 'sfxSkill');
    // ★ 2026-10-03 用户要求：**boss 放「史莱姆防御」时也要播它那张大招插画**
    //   （第七章黄色节制此前只在结算画面用过那张图，战斗里一点演出都没有）。
    // ★ 2026-10-05 用户要求①：**「技能白名单」∪「该角色技能表里的第三个技能」**（不足三个技能＝没有第三技能）。
    if (['ora', 'time', 'splash', 'flame', 'blaze', 'blade', 'armor', 'vine', 'hamon', 'drag', 'sucker', 'slime'].includes(event.skill) || isThirdSkill(event.side ? game.skills(event.side) : [], event.skill)) showCutin(event);
  } else if (event.type === 'cutin') {
    // ★ 不是技能、但也要放大招插画的事件（第六章「憎恨」第一次叠满，见 game.addHatred）。
    //   走同一条显示通道，所以动画、时长、暂停节奏、减弱动效的处理全都一致。
    play('sfxMenacing');
    showCutin(event);
  } else if (event.type === 'skip') {
    play('sfxTimeResume');            // 时停结束：世界重新开始走动
  } else if (event.type === 'status' && event.key === 'nextline') {
    play('sfxPredict');               // 「你的下一句话是」预判成功
  } else if (event.type === 'bark') {
    // ★ 开局那一刻，第 4、5 关要先提示"这一关的特殊机制"，再播双方照面的台词。
    //   机制**合成一条**（框里分几行列出）——逐条排队会连播十几二十秒，太拖。
    if (event.key === 'start') {
      const rules = game.s.story?.specialRules || [];
      if (rules.length) barkQueue.push({ who: '关卡机制', lines: rules.map(rule => rule.replace(/\*\*/g, '')) });
    }
    // `kind` 记住这是四句里的哪一句（start / turn2 / half / death）：
    // 「击倒对手」那句要单独少停 1 秒，见下面 pumpBarkQueue 里的时长计算。
    barkQueue.push({ who: event.who, whoKey: event.whoKey, text: event.text, kind: event.key });
    pumpBarkQueue();
  } else if (event.type === 'stage') {
    // ★ 战场换层（第五章「力量」拆掉一个船体要害）。用户反馈"拆完之后看不出场景变化"，
    //   所以这里给一条**比回合横幅更大的横幅**：明确写出"推进到第几层、还剩几个要害"。
    play(event.boss ? 'sfxMenacing' : 'sfxSkill');
    showStageBanner(event);
  } else if (event.type === 'unmask') {
    // ★ 第七章：伪装破裂（对手顶着的那张脸掉了）。用同一条大字横幅 + 一声低沉提示。
    play('sfxMenacing');
    showUnmaskBanner(event);
  } else if (event.type === 'phasewin') {
    // ★ 「打到半血即胜」的演出（章节数据 `scene.phaseWin`，见 game.phaseWinIfNeeded）。
    //   和「伪装破裂」共用同一条大字横幅——三行字都由引擎拼好，界面只负责摆上去。
    //   演出之后紧跟着就是 `result`（checkEnd 判玩家胜），结算弹窗会等横幅放完再弹。
    //   ⚠️ 2026-10-03 第三条用户拍板之后**第八章阶段 1 不再声明它**（改回"把他血打空才算赢"），
    //      所以这条接线现在没有章节会走到；机制保留，别删（用户明确要求保留这套引擎代码）。
    play('sfxMenacing');
    showUnmaskBanner({ kicker: event.kicker, title: event.title, tail: event.tail });
  } else if (event.type === 'storyloss') {
    // ★★ **必败剧情战**的演出（章节数据 `scene.storyLoss`，见 game.storyLossIfNeeded）。
    //   和「伪装破裂」「打到半血即胜」共用同一条大字横幅——三行字都由引擎拼好，界面只负责摆上去。
    //   演出之后紧跟着就是 `result`（checkEnd 判**玩家战败**），而结算页会按 `s.storyLoss`
    //   给「继续」（接着演下一幕正文）——**不是重打这一场**（见 wireResultActions）。
    play('sfxMenacing');
    showUnmaskBanner({ kicker: event.kicker, title: event.title, tail: event.tail });
  } else if (event.type === 'turn') {
    // event.side 现在可能是**槽位**（2v2 的 'p1b'），所以配色 / 音效一律按队别看。
    play('sfxTurn', teamOf(event.side) === 'p1');
    if (game.fighter(event.side) && game.s.hp[event.side] / game.fighter(event.side).hp <= 1 / 3) {
      setTimeout(() => play('sfxMenacing'), 300);   // 残血回合：低音脉动
    }
    // 文案跟着**当前位子的控制表**走：人机位＝「电脑行动」，真人位＝「你的回合」。
    // （四个位子全是人机时两边都是「电脑行动」，一眼看出这是观战。）
    const who = game.isAI(event.side) ? '电脑行动' : '你的回合';
    const name = game.s.twoSided?.() ? ` · ${game.fighter(event.side)?.user.name || ''}` : '';
    showTurnBanner(`${slotName(event.side)} · ${who}${name}`);
    inspecting = null;
  } else if (event.type === 'result') {
    pauseAI();
    // 胜利音效分两种（真人赢 / 电脑赢）：读的是"赢家那个位子由谁操作"，不再按整局模式判断。
    play('sfxResult', !game.isAI(event.side));
    const epoch = game.epoch;
    const show = () => { if (epoch === game.epoch && game.s.phase === 'result') showResult(); };
    // ★ 结算弹窗要**等最后一句台词播完**再弹：否则"击倒对手"那句只闪 0.5 秒就被弹窗盖住，
    //   玩家根本读不到（台词条在棋盘里，弹窗是顶层，一定盖得住）。
    clearTimeout(resultTimer);
    if (event.resigned) {
      // ★★ 主动认输＝立即结算（2026-09-30 用户报"点击认输结算太慢"）：
      //   认输时多半还排着开场那条「关卡机制」提示（最长 9 秒）、或一两句战斗台词，
      //   按原来的逻辑要等它们**全部播完**才弹结算（最坏 12 秒兜底），可玩家已经不想看了。
      //   所以这里直接**丢掉还没播的台词**，只留一点点时间让点击反馈落地。
      clearBarks();
      pendingResult = null;
      resultTimer = setTimeout(show, prefs.reducedMotion ? 30 : 180);
    } else if (barkTimer !== null || barkQueue.length) {
      pendingResult = show;
      // ⚠️ 兜底：台词是**排队**播的，万一队列里排了太多句、或者计时器出了岔子，
      //    绝不能因此让玩家看不到结算——最多等 12 秒就弹。（队列正常播完时会提前清掉这个计时器）
      resultTimer = setTimeout(() => { const queued = pendingResult; pendingResult = null; if (queued) queued(); }, 12000);
    } else {
      resultTimer = setTimeout(show, prefs.reducedMotion ? 50 : 500);
    }
  }
  refreshBgm();
  invalidate();
}

/**
 * ⚠️ 这两个导出**只给测试用**（`tests/cutin-third-skill.test.js`）：那一条用例在**假 DOM** 里
 *    `import('../src/main.js')`，然后直接拿引擎摆好的技能表驱动**真实的 `onEvent`**——
 *    这样"第三个技能会播大招插画"验的是**接线本身**，而不是只做一遍源码正则检查。
 *    浏览器侧 `index.html` 不读它们（`?test` 那份 `window.__jojo` 照旧单独挂）。
 */
export { game, onEvent };

/** 背景音乐场景：主界面与常规局面播放主界面播放列表，任一方残血时切危急曲。
 *  残血判定收敛在 `game.lowHealth()` 里（口径＝共享生命 ≤ 上限的一半，**含正好一半**），
 *  别在这里再手写一遍比较——漏掉"正好一半"就会出现音乐该响却不响的问题。 */
function refreshBgm() {
  bgm.playBgm(game.lowHealth() ? 'danger' : 'menu');
}
/**
 * ★ 战斗内台词：一次只显示一句，播完自动接下一句。
 * 「旁白」不带冒号、按旁白样式显示；其余按"说话人 + 台词"显示。
 */
function pumpBarkQueue() {
  if (barkTimer !== null) return;             // 正在播，等它播完自己接下一句
  const line = barkQueue.shift();
  const node = $('bark');
  if (!line || !node) return;
  // 机制提示可能有好几条：`lines` 是"同一个框里逐行列出"，`text` 是普通一句台词
  const lines = line.lines?.length ? line.lines : [line.text];
  const narration = line.who === '旁白' || line.who === '关卡机制';
  const body = lines.map(t => `<p>${esc(t)}</p>`).join('');
  // ★ 左侧立绘：用该角色的**大招插画**（762×506 的横版插图）。
  //   一开始用的是棋子立绘（透明底小全身图），但缩到对话框里只有 68×102、像个小棋子，
  //   用户 2026-09-27 要求换成大招图——同一张图在结算画面也当背景，风格统一、辨识度高。
  //   没有 whoKey 的（旁白、关卡机制）不加这一列，框会自动收成窄版。
  let face = '';
  if (line.whoKey && CHARACTER_ART[line.whoKey]) {
    face = `<img class="bark-face" src="${cutin(line.whoKey)}" alt="" width="762" height="506">`;
  }
  const head = narration
    ? `<span class="bark-narration">${esc(line.who)}</span>`
    : `<span class="bark-who">${esc(line.who)}</span>`;
  const linesHtml = narration
    ? `<div class="bark-lines">${body}</div>`
    : `<div class="bark-lines"><p>「${esc(line.text)}」</p></div>`;
  // ★ 2026-10-03 用户要求①：台词下面挂一句**很小很淡**的提示，让玩家知道能点空白处跳过
  //   （刻意只说这一句、不做教学；棋盘图例里还有同样的一行，两处都看得到）。
  node.innerHTML = face + `<div class="bark-body">${head}${linesHtml}<span class="skip-hint">点空白处跳过</span></div>`;
  if (!face) node.classList.add('is-narration');
  else node.classList.remove('is-narration');
  node.hidden = false;
  node.classList.remove('show');
  void node.offsetWidth;
  node.classList.add('show');
  // 按字数给阅读时间：单句 4.4 秒封顶，多条机制的整块最多 9 秒。
  // ★ 「击倒对手」那句（line.kind === 'death'）**少停 1 秒**（用户 2026-09-30：「胜利也拖得有点长了，减一秒看看」）：
  //   胜利结算要等这一句播完才弹，而它是单句里最长的一档（4.4 秒封顶）+ 0.5 秒停顿 ≈ 5 秒，玩家觉得拖。
  //   只改这一句——开场机制提示（最长 9 秒）与第 2 回合/半血那两句**保持原样**，别顺手一起缩短。
  const chars = lines.join('').length;
  const base = lines.length > 1 ? Math.min(9000, 2200 + chars * 110) : Math.min(4400, 1800 + chars * 130);
  const ms = line.kind === 'death' ? Math.max(2200, base - 1000) : base;
  barkTimer = setTimeout(finishBarkLine, ms);
}
/**
 * ★★ 一条台词**播完之后的收尾**：收起这一条 → 队列里还有就接着播 → 都没有时把等着的结算弹出来。
 *
 * ⚠️ **计时器到点（自己播完）**与**玩家点空白处跳过**（2026-10-03 用户要求①）**共用这一个函数**：
 *    所以"跳过"与"等它自己播完"的后续行为逐值一致，也不会出现"跳掉了却没人接下一句"的鬼影。
 */
function finishBarkLine() {
  clearTimeout(barkTimer); barkTimer = null;
  const node = $('bark');
  if (node) { node.classList.remove('show'); node.hidden = true; }
  if (barkQueue.length) { pumpBarkQueue(); return; }
  // 队列空了：如果结算弹窗在等，就让它出来（留一点余韵；顺便清掉那个 12 秒兜底计时器，别弹两次）
  const show = pendingResult;
  pendingResult = null;
  if (show) { clearTimeout(resultTimer); resultTimer = setTimeout(show, 500); }
}
/**
 * ★★ 2026-10-03 用户要求①：**点空白处跳过正在播的那一条**。
 *
 * 判定"这一点算不算空白"与"按什么顺序收"在 `ui/skip.js`（纯函数，测试直接跑它）；
 * 这里只注入三条通道各自的"收掉它"，因为只有这一层才拿得到计时器与节点：
 *   ① 战斗台词（队列里正在播的那一条）→ **只收这一条**，再点接下一句（不是一次全清）；
 *   ② 大字横幅（伪装破裂／剧情触发／阶段切换）；
 *   ③ 提示（HUD 里那行 notice）。
 *
 * ⚠️ 三条都把自己的**计时器**清掉，所以不会留下"过一秒又冒出来"的鬼影；
 * ⚠️ **结算弹窗、认输/重开的确认框、剧情阅读页里要玩家做选择的地方一律不跳**——
 *    它们要么根本不是"空白"（`dialog` 等，见 SKIP_OWNED），要么被调用处的 `modalOpen()` 挡住。
 * ⚠️ 只动**点击**：键盘一个键都不碰（Space 仍然是结束回合）。
 */
const skipPresentation = createSkipper({
  bark: () => {
    if (barkTimer === null) return false;      // 没有正在播的那一条
    finishBarkLine();                          // 与"它自己播完"完全同一条收尾逻辑
    return true;
  },
  banner: () => {
    const banner = $('stageBanner');
    if (!banner || !banner.classList.contains('show')) return false;
    clearTimeout(stageBannerTimer); stageBannerTimer = null;
    banner.classList.remove('show');
    return true;
  },
  notice: () => {
    if (!game.dismissNotice()) return false;   // 提示是"一句话播报"，收掉它＝它播完了
    invalidate();
    return true;
  },
});
function showTurnBanner(text) {
  const banner = $('turnBanner');
  clearTimeout(bannerTimer);
  banner.textContent = text;
  banner.classList.remove('show');
  if (prefs.reducedMotion) return;
  void banner.offsetWidth;
  banner.classList.add('show');
  bannerTimer = setTimeout(() => banner.classList.remove('show'), 1100);
}
/**
 * ★ 棋盘上方那条**大字横幅**：第五章「力量」的换层与第七章「伪装破裂」共用同一个元素与停留时间。
 * 停留 2.6 秒，并且**不受"减弱动效"影响也要显示文字**（只是不播动画）。
 */
function showBigBanner(kicker, title, tail, { impact = false } = {}) {
  const banner = $('stageBanner');
  if (!banner) return;
  banner.innerHTML = `<span class="stage-kicker">${esc(kicker)}</span><b>${esc(title)}</b><span class="stage-tail">${esc(tail)}</span>`;
  clearTimeout(stageBannerTimer);
  banner.classList.remove('show');
  void banner.offsetWidth;
  banner.classList.add('show');
  stageBannerTimer = setTimeout(() => banner.classList.remove('show'), 2600);
  if (impact) visual?.stageImpact?.();   // 棋盘上也来一下"重击"，让这件事不容易被忽略
}
/**
 * ★ 战场换层的横幅（第五章「力量」拆掉一个船体要害时）。
 * 用户 2026-09-27 反馈"击败要害后无明显场景变化"，所以这条横幅要**明确**三件事：
 * ① 船体塌了一层（换场地了）② 现在是第几层、叫什么 ③ 还剩几个要害 / 猩猩是否现身。
 */
function showStageBanner(event) {
  const total = event.total || 3;
  const step = `船体要害 ${event.done}/${total}`;
  const tail = event.boss
    ? '船身被撕开 —— 猩猩被迫现身，可以打他了；移动与行动点恢复、不再持续掉血'
    : `下一个要害「${event.part || '？'}」已经露出来${event.penalty ? ` · 船体压身：${event.penalty}` : ''}`;
  showBigBanner(`船体往里塌了一层 · ${step}`, event.layer || '', `${event.boss ? '★ ' : ''}${tail}`, { impact: true });
}
/**
 * ★ 第七章的「伪装破裂」横幅：对手顶着的那张脸掉了。
 * 事件里带的就是要显示的三行字（引擎拼好），界面只负责摆上去——和换层共用同一个横幅元素。
 */
function showUnmaskBanner(event) {
  showBigBanner(event.kicker || '伪装破裂', event.title || '', event.tail || '', { impact: true });
}
function showCutin(event) {
  // 双形态技能（装甲／卸甲）出手时要显示当前形态的名字，事件里带的就是出手那一刻的名字。
  // ⚠️ 用 `?.` 兜底：`cutin` 事件（第六章憎恨叠满）**没有 skill 字段**，
  //    写成 `SKILLS[event.skill].name` 会直接抛错、把整个大招画面吃掉。
  const label = event.label || SKILLS[event.skill]?.name || 'STAND ABILITY';
  if (prefs.reducedMotion) { showTurnBanner(label); return; }
  const node = $('cutin');
  // 每个技能配一句喊话；没有的就不显示这一行（以前会把 undefined 原样印在动画上）
  const cry = event.cry || { ora: 'オラオラオラ', time: 'ゴゴゴゴ', splash: 'エメラルド・スプラッシュ', flame: 'ドドドド', blaze: 'NIRVANA', blade: 'SILVER CHARIOT', vine: 'HERMIT PURPLE', hamon: 'SUNLIGHT YELLOW OVERDRIVE', drag: 'DARK BLUE MOON', sucker: 'DARK BLUE MOON' }[event.skill] || '';
  node.style.backgroundImage = `url("${cutin(event.fighter)}")`;
  node.innerHTML = `<div class="cutin-copy"><span>${event.side.toUpperCase()} / STAND ABILITY</span><b>${label}</b>${cry ? `<em>${cry}</em>` : ''}</div>`;
  node.hidden = false; node.classList.remove('play'); void node.offsetWidth; node.classList.add('play');
  busyUntil = Math.max(busyUntil, performance.now() + 1050);
  clearTimeout(cutinTimer);
  cutinTimer = setTimeout(() => { node.hidden = true; node.classList.remove('play'); }, 1080);
}
function showResult() {
  const s = game.s, winner = s.winner, fighter = game.fighter(winner), stats = s.stats[winner];
  $('resultArt').style.backgroundImage = `url("${cutin(fighter.key)}")`;
  // ★★ 必败剧情战（`s.storyLoss`）：这一场判的是玩家战败，但**不是"你打输了"**——剧情本来就这么走。
  //   所以标题不写"P2 胜利"，改成剧情口径；下面那行 `resultReason` 照旧由引擎给
  //   （＝"阿布德尔挡下了那一枪 · 这一场到此为止"），一眼就能看出是剧情而不是败仗。
  $('resultTitle').textContent = s.storyLoss
    ? `剧情 · ${s.resultReason || '这一场到此为止'}`
    : `${winner.toUpperCase()} · ${fighter.user.name} 胜利`;
  // ★ 2026-10-03：轮次改读 `game.roundNumber()`——第八章阶段 2 是**3 个角色位**（波波 ＋ 电脑友军
  //   花京院 对 J·凯尔），原来那句 `(turnNumber + 1) / 2` 只对 2 个位子成立（2v2 也一直是错的）。
  $('resultReason').textContent = `${s.resultReason} · 第 ${game.roundNumber()} 轮结束`;
  $('resultStats').innerHTML = `<div class="result-stat"><b>${stats.damage}</b><span>累计造成伤害</span></div><div class="result-stat"><b>${stats.skills}</b><span>技能释放</span></div><div class="result-stat"><b>${s.hp[winner]} / ${fighter.hp}</b><span>剩余共享生命</span></div>`;
  wireResultActions(s, winner);
  closeDialogs(); showDialog('resultDialog'); $('rematchBtn').focus();
}
/**
 * 结算弹窗的按钮按场合换文案与行为：
 * 剧情模式赢下战斗＝**只给「继续」**（接着演战斗之后的正文，读完才算通关解锁）；
 * 剧情模式输了 / 认输＝**再战一场／返回章节选择**（直接退回章节列表，不绕标题页，也不让玩家卡在剧情里出不去）；
 * 普通对局＝再战一局／重新选人。
 */
function wireResultActions(s, winner) {
  const retry = $('rematchBtn'), leave = $('newMatchBtn');
  const showLeave = visible => { leave.hidden = !visible; };
  // ★ 2026-10-07（用户要求）：剧情战斗里"不打了"要回**章节选择**，不再绕一趟标题页——
  //   玩家本来就是从章节列表进来的，退出时就该退回同一层。
  //   自由对局那颗仍是「重新选人」（`returnToDraft`），一个字不动。
  const toStoryMenu = () => { closeDialogs(); play('sfxClick'); showStoryMenu(); };
  const chapterIndex = s.story ? STORY_CHAPTERS.findIndex(chapter => chapter.id === s.story.id) : -1;
  const after = s.story ? storySceneAt(s.story, storyRead.scene + 1) : null;

  // ★★ 必败剧情战（`s.storyLoss`，见 game.storyLossIfNeeded）：**判的是玩家战败，但剧情必须往下走**——
  //   原作里阿布德尔替波鲁纳雷夫挡下那一枪而死，这一场本来就不是给玩家赢的。
  //   所以这里的按钮与"打贏了"那条路**完全一样**（「继续 / 下一场」＋收起「返回标题」），
  //   ⚠️ 绝不能落到下面那条"再战一场"上（那会把玩家卡在必败的一战里反复重打，剧情永远推不下去）。
  const storyForward = winner === 'p1' || !!s.storyLoss;
  if (chapterIndex >= 0 && storyForward) {
    // ★★ 2026-10-03（一章两场）：`after` 可能是**第二场战斗**（第八章打完阶段 1 之后）。
    //   旧写法把"下一幕是战斗"当成"本章完了"，一点就把玩家弹回章节列表、第二场根本打不到。
    //   所以下面第一行仍是老口径（它同时兜住 `after === null`＝本章最后一幕就是战斗的情况；
    //   ⚠️ 这一行的写法被 tests/title-screen.test.js 的正则钉着，不许改），
    //   "下一幕还是战斗"由紧接着的第二行改成「下一场」。
    retry.textContent = after && !after.isBattle ? '继续' : '完成本章';
    if (after?.isBattle) retry.textContent = '下一场';
    if (!after) {
      retry.onclick = () => { closeDialogs(); markStoryCleared(s.story.id); showStoryMenu(); };
    } else {
      retry.onclick = () => { closeDialogs(); showStoryStage(chapterIndex, after.index); };
    }
    showLeave(false);                      // 打赢了（或**必败剧情战**走完演出）就把「返回标题」收起来，只留一个「继续」
    return;
  }
  showLeave(true);
  if (chapterIndex >= 0) {
    retry.textContent = '再战一场';
    retry.onclick = startMatch;
    // ★★ 2026-10-07：剧情里输了 / 认输之后那颗按钮**直接回章节选择**（原来写的是「返回标题」→ 标题页，
    //   玩家要再点一次「剧情模式」才回得到章节列表）。剧情进度不动，回来可以重打这一战。
    leave.textContent = '返回章节选择';
    leave.onclick = toStoryMenu;
    return;
  }
  retry.textContent = '再战一局';
  retry.onclick = startMatch;
  leave.textContent = '重新选人';
  leave.onclick = returnToDraft;
}
function scheduleAI() {
  if (aiTimer !== null || game.s.phase !== 'battle' || humanTurn() || busy() || modalOpen() || document.hidden) return;
  const epoch = game.epoch;
  aiTimer = setTimeout(() => {
    aiTimer = null;
    if (epoch !== game.epoch || game.s.phase !== 'battle' || humanTurn() || busy() || modalOpen() || document.hidden) return;
    const plan = chooseAI(game);
    if (plan && !playAIAction(game, plan)) {
      // A rejected decision never spins or spends AP: give the turn back cleanly.
      game.endTurn();
    }
  }, prefs.reducedMotion ? 350 : 680);
}
function maintainFocus(callback) {
  const before = document.activeElement;
  const attributes = ['data-command', 'data-unit', 'data-inspect-skill', 'data-draft-side', 'data-draft-focus', 'data-control-slot'];
  const attribute = attributes.find(key => before?.hasAttribute?.(key));
  const value = attribute && before.getAttribute(attribute);
  const side = before?.dataset?.side;
  callback();
  if (attribute && !document.contains(before)) {
    const matches = document.querySelectorAll(`[${attribute}="${value}"]${side ? `[data-side="${side}"]` : ''}`);
    const replacement = [...matches].find(node => !node.disabled && node.getClientRects().length > 0);
    replacement?.focus({ preventScroll: true });
  }
}
function tick(now) {
  renderFrame = requestAnimationFrame(tick);
  if (!visual || $('app').hidden || document.hidden) return;
  // 有弹窗盖在棋盘上时（玩法指南 / 剧情档案 / 设置 / 结算…）不必重绘：
  // 遮罩后面根本看不见，却会和遮罩的模糊叠加成明显的滚动卡顿。
  // 关闭弹窗的处理里会 invalidate() 补一次绘制，所以不会漏帧。
  if (document.querySelector('dialog[open]')) return;
  const revision = game.revision;
  if (lastViewRevision !== revision) { view = game.actionView(); lastViewRevision = revision; }
  // ★ 2026-10-04：正在"查看"的那枚棋子可能已经**不在场上了**（角色被打倒 → 棋子离场，见
  //   `Game.removeFallenSlot`）——立刻放下它。否则棋盘上会留一圈"查看中"的攻击范围残影，
  //   而棋子本身已经画不出来了（渲染按 `s.units` 走）。放下它不改变对局状态，只是清掉查看目标。
  if (inspecting && !game.s.units.includes(inspecting)) inspecting = null;
  const renderKey = `${revision}|${busy()}|${forceRender}|${inspecting?.id || ''}`;
  if (renderKey !== lastRender) {
    lastRender = renderKey;
    maintainFocus(() => {
      renderCards(game, { inspecting, humanTurn: humanTurn() });
      renderActions(game, { humanTurn: humanTurn(), busy: busy() });
    });
  }
  const logKey = `${game.s.log.at(-1)?.id}|${$('logDialog').open}`;
  if (lastLog !== logKey) { renderLog(game); lastLog = logKey; }
  const previewKey = `${revision}|${hover ? tileKey(hover) : ''}|${inspecting?.id || ''}`;
  if (previewKey !== lastPreview) {
    lastPreview = previewKey;
    const preview = hoverPreview(game, hover, inspecting);
    $('targetPreview').innerHTML = preview.content;
    view = { ...view, path: preview.path, invalid: preview.invalid };
    if (keyboard && hover) $('boardReadout').textContent = `${tileLabel(hover)}，${plain(preview.content)}。`;
  }
  visual.render({ ...view, hover, inspected: inspecting || (!game.selected && hover ? game.occupant(hover) : null), pointerDown, keyboard }, now);
  scheduleAI();
}

function pointerTile(event) {
  const p = clientPoint($('board').getBoundingClientRect(), event.clientX, event.clientY);
  return tileAt(game.tiles, p.x, p.y);
}
function commandClick(key, target) {
  if (game.s.phase !== 'battle') return;
  if (!humanTurn()) { game.fail('电脑正在行动，请等待回合结束。'); return; }
  if (busy()) { game.fail('当前行动正在结算，请稍候。'); return; }
  if (SKILLS[key]?.passive) { showTooltip(target, key); game.notice(`${SKILLS[key].name}为被动：${game.skillStatus(game.s.turn, key).status}`); return; }
  const u = game.selected;
  if (!u) { game.fail('先选择己方使者或替身，再选择行动。'); return; }
  if (key === 'move' || key === 'attack') {
    if (!game.s.ap[u.slot]) game.fail('行动点不足，请结束回合；时间停止不消耗行动点。');
    else game.chooseAction(key);
  } else if (key === 'breakfree') game.breakFree(u);
  else if (game.s.pendingSkill === key) game.cancel();
  else game.beginSkill(u, key);
  inspecting = null;
  hideTooltip();
  $('turnBanner').classList.remove('show');
  play('sfxClick');
}
function hideTooltip() { $('skillTooltip').hidden = true; }
function showTooltip(button, skill = button?.dataset?.inspectSkill || button?.dataset?.command) {
  if (!button || !SKILLS[skill]) return;
  const side = button.dataset.side || game.s.turn;
  if (!game.fighter(side)) return;
  const spec = SKILLS[skill], state = game.skillStatus(side, skill, button.dataset.command ? game.selected : null);
  const node = $('skillTooltip');
  node.innerHTML = `<h3>${spec.name}</h3><div class="tooltip-meta">${spec.passive ? '被动 · 自动触发' : `${spec.cost} AP · ${spec.range ? `射程 ${spec.range} · ` : ''}${spec.cd ? `冷却 ${spec.cd} 个己方回合` : '本局限用一次'}`}<br>${esc(state.status)}</div><p>${esc(plain(spec.desc))}</p>`;
  node.hidden = false;
  const rect = button.getBoundingClientRect(), tip = node.getBoundingClientRect();
  node.style.left = `${Math.max(10, Math.min(innerWidth - tip.width - 10, rect.left + rect.width / 2 - tip.width / 2))}px`;
  node.style.top = `${Math.max(10, rect.top - tip.height - 10)}px`;
}
function selectFromCard(id) {
  if (game.s.phase !== 'battle') return;
  const unit = game.unit(id);
  if (!unit) return;
  // 只能选**当前行动的那个角色**的棋子（2v2 时同一队另一个角色现在不能动）
  if (humanTurn() && unit.slot === game.s.turn && !busy()) { inspecting = null; game.select(id); }
  else { inspecting = unit; hover = game.tile(unit); invalidate(); }
  hideTooltip();
  $('turnBanner').classList.remove('show');
  play('sfxClick');
}
function updateConnection() {
  const node = $('connection');
  node.hidden = navigator.onLine;
  node.textContent = navigator.onLine ? '' : '当前离线 · 本地对局可继续';
  node.title = '本地模式不依赖对战服务器。';
}

function bindEvents() {
  document.addEventListener('pointerdown', () => { keyboardFocus = false; }, true);
  document.addEventListener('keydown', () => { keyboardFocus = true; }, true);
  document.addEventListener('pointerdown', () => {
    if (activated) return;
    activated = true;
    try { audio.unlockAudio(); } catch { /* Audio is optional. */ }
    try { bgm.unlockBgm(); } catch { /* Music is optional. */ }
  }, { once: true });
  document.addEventListener('keydown', () => {
    if (activated) return;
    activated = true;
    try { audio.unlockAudio(); } catch { /* Audio is optional. */ }
    try { bgm.unlockBgm(); } catch { /* Music is optional. */ }
  }, { once: true });
  document.addEventListener('click', event => {
    // ★★ 2026-10-03 用户要求①：**点棋盘以外的空白处**＝跳过正在播的那一条演出
    //   （战斗台词 / 大字横幅 / 提示，见上面的 skipPresentation 与 ui/skip.js）。
    //   ⚠️ 只认"有主的东西"以外的点击：按钮、棋子、棋盘格、对话框、弹窗（含结算与确认框）
    //      一律走它们自己原来的分支，这里一个字都不碰；下面的按钮分派**一个字都没改**。
    if (skipGate({
      inBattle: game.s.phase === 'battle',
      appHidden: !!$('app')?.hidden,
      modalOpen: modalOpen(),
      target: event.target,
      root: $('app'),
    })) skipPresentation();
    // ★★ 2026-10-04 用户要求②：**剧情正文页**（读小说那几页）上点空白处＝点那一页的「继续」。
    //   ⚠️ 这是**另一条独立闸门**，与上面战斗那条互不干扰（`skipGate` 一个字都没改）：
    //      · 只有 `#storyStage` 在台面上才可能生效——标题页 / 章节列表 / 选人页 / 战斗 / 结算页全判否；
    //      · 点在按钮、对话框、卡片上时 `isBlankClick` 判否 → 继续走下面**原样未动**的按钮分派；
    //      · 有弹窗开着（`modalOpen()`）一律不跳，所以结算弹窗与确认框照旧只能点按钮。
    //   ⚠️ 调的是 `storyAdvance`——**与 `#storyStageNext` 的 onclick 是同一个函数**，行为逐值一致。
    skipStoryBlank({
      stageHidden: $('storyStage')?.hidden !== false,
      modalOpen: modalOpen(),
      target: event.target,
      root: $('storyStage'),
      advance: storyAdvance,
    });
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-help')) { showDialog('helpDialog'); play('sfxClick'); }
  else if (button.hasAttribute('data-story')) { showStory(); play('sfxClick'); }
    else if (button.hasAttribute('data-close')) button.closest('dialog')?.close();
    else if (button.dataset.mode) { draft.mode = button.dataset.mode; draft.story = null; play('sfxClick'); showLobby(); }
    else if (button.dataset.titleMode === 'story') { play('sfxClick'); showStoryMenu(); }
    else if (button.dataset.storyChapter !== undefined) {
      play('sfxClick'); showStoryStage(Number(button.dataset.storyChapter), 0);
    }
    else if (button.dataset.teamSize) {
      // 1v1 / 2v2 开关：**默认 1v1**；人机与 2v2 可以同时开（每个位子各自真人/人机）。
      const wantDuo = button.dataset.teamSize === '2v2';
      draft.v2v = wantDuo;
      draft.focus = { p1: 'p1', p2: 'p2' };
      play('sfxClick'); showLobby();
    }
    else if (button.dataset.map) {
      // ★★ 2026-10-05 加地图体系：大厅里的**地图按钮**（一张地图 ＝ 一套地形布局 ＋ 配套背景画）。
      //   只改这一局的"地图"这一项，别的（角色、人数、真人/人机）都不动；
      //   按钮是 hud 按 rules.js 的 `MAPS` 渲染出来的，所以加地图不用碰这里。
      //   ⚠️ 认不出的地图名由 `applyMapParam()` 收敛成 default（不会崩）。
      applyMapParam(draft, button.dataset.map);
      renderDraft(draft);
      document.querySelector(`[data-map="${draft.map}"]`)?.focus({ preventScroll: true });
      play('sfxClick');
    }
    else if (button.dataset.controlSlot) {
      // ★ 逐位的「真人 / 人机」开关（在该位选人面板上方）：只改这一位，不动别人。
      const slot = button.dataset.controlSlot;
      if (['p1', 'p2', 'p1b', 'p2b'].includes(slot)) {
        draft.control = { ...draft.control, [slot]: button.dataset.control === 'ai' ? 'ai' : 'human' };
      }
      renderDraft(draft);
      document.querySelector(`[data-control-slot="${slot}"][data-control="${draft.control[slot]}"]`)?.focus({ preventScroll: true });
      play('sfxClick');
    }
    else if (button.dataset.draftFocus) {
      // 点"第 N 个角色"那一行 / 选人顺序上的那一步：把这一侧的名单切给那个槽位
      const slot = button.dataset.draftFocus;
      draft.focus = { ...draft.focus, [teamOf(slot)]: slot };
      play('sfxClick'); renderDraft(draft);
    }
    else if (button.dataset.draftSide) {
      // 名单里的角色 → 写给它所属的那个**角色槽位**（1v1 时就是 p1 / p2）
      const team = button.dataset.draftSide, key = button.dataset.fighter, slot = button.dataset.draftSlot || team;
      draft[slot] = key;
      // 选完这一位就自动跳到"这一侧还没选的那个槽位"（都选好了就留在原地，方便改主意）
      const pending = nextDraftPick(draft);
      draft.focus = { ...draft.focus, [team]: pending && teamOf(pending) === team ? pending : slot };
      renderDraft(draft);
      document.querySelector(`[data-draft-side="${team}"][data-fighter="${key}"]`)?.focus({ preventScroll: true });
      play('sfxClick');
    } else if (button.dataset.unit) selectFromCard(button.dataset.unit);
    else if (button.dataset.command) commandClick(button.dataset.command, button);
    else if (button.dataset.inspectSkill) showTooltip(button);
    else if (button.id === 'finishFlameBtn') { if (humanTurn() && !busy()) game.finishFlame(); }
    // ★ 暗枪（2026-10-05）：同一套"提前收手"的按钮（埋到一半也能按 Esc 收手，见 game.cancel）。
    else if (button.id === 'finishDarkgunBtn') { if (humanTurn() && !busy()) game.finishDarkgun(); }
    // ★★ 东方仗助「重组」（2026-10-09 用户要求的新流程）：**点技能 → 选目标 → 选选项**。
    //   "点目标"那一步在棋盘上（`game.pickRebuildTarget()`，由 `actionAt` 转过去）；
    //   这几颗按钮只在目标已经选定之后才出现，点下去分别是：执行 / 换个目标 / 取消。
    else if (button.id === 'rebuildOptionBtn') {
      if (humanTurn() && !busy()) game.confirmRebuild(game.selected, button.dataset.mode);
    } else if (button.id === 'rebuildRetargetBtn') {
      if (humanTurn() && !busy()) {
        game.s.rebuildTarget = null;
        game.notice(`${SKILLS.rebuild.name}：换一个目标（在棋盘上点一个角色）。`);
        game.touch();
      }
    } else if (button.id === 'rebuildCancelBtn') { if (humanTurn() && !busy()) game.cancel(); }
  });
  $('startBtn').onclick = startMatch;
  const backBtn = $('backToTitle');
  if (backBtn) backBtn.onclick = () => { closeDialogs(); play('sfxClick'); showTitle(); };
  const storyBack = $('storyBack');
  if (storyBack) storyBack.onclick = () => { closeDialogs(); play('sfxClick'); showStoryMenu(); };
  const storyMenuBack = $('storyMenuBack');
  if (storyMenuBack) storyMenuBack.onclick = () => { closeDialogs(); play('sfxClick'); showTitle(); };
  const storyNext = $('storyStageNext');
  if (storyNext) storyNext.onclick = storyAdvance;
  $('btnEnd').onclick = requestEndTurn;
  $('cancelBtn').onclick = () => { if (humanTurn() && !busy()) game.cancel(); inspecting = null; };
  $('menuBtn').onclick = () => {
    // 菜单里的「认输」按**本队有没有真人**决定可不可用（2026-10-03 用户定：按队算，不按当前位子算）
    $('resignBtn').disabled = game.teamHasHuman ? !game.teamHasHuman() : !humanTurn();
    showDialog('menuDialog');
  };
  $('settingsBtn').onclick = () => showDialog('settingsDialog');
  // 战斗中重看这一关的特殊机制（只有第 4/5/6 关有这个按钮）
  $('rulesBtn').onclick = () => { showChapterRules(); play('sfxClick'); };
  // 主界面音量滑杆：拖动即时生效，和其它设置一起记在浏览器里
  const volumeRange = $('volumeRange');
  if (volumeRange) {
    volumeRange.oninput = () => { prefs.volume = Number(volumeRange.value) / 100; applyPreferences(); };
    volumeRange.onchange = () => play('sfxClick');
  }
  // 主界面音乐切换：自动轮流 → Setting Off → Stand Proud → 关闭 → 回到自动
  const musicBtn = $('musicBtn');
  if (musicBtn) {
    musicBtn.onclick = () => {
      const order = ['auto', 'setting-off', 'stand-proud', 'off'];
      prefs.music = order[(order.indexOf(prefs.music) + 1) % order.length];
      applyPreferences();
      play('sfxClick');
    };
  }
  // 剧情档案：一页一章——目录点章节名直接跳到那章，翻页条切上一章 / 下一章
  document.addEventListener('click', event => {
    const jump = event.target.closest('[data-story-jump]');
    if (jump) {
      showStoryPage(Number(jump.dataset.storyIndex) || 0);
      play('sfxClick');
      return;
    }
    const step = event.target.closest('[data-story-page]');
    if (step && !step.disabled) {
      showStoryPage(storyPage + Number(step.dataset.storyPage));
      play('sfxClick');
    }
  });
  // 档案打开时用左右方向键翻页（棋盘的方向键另有 board 焦点守卫，互不干扰）
  document.addEventListener('keydown', event => {
    const dialog = $('storyDialog');
    if (!dialog || !dialog.open) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    showStoryPage(storyPage + (event.key === 'ArrowRight' ? 1 : -1));
    play('sfxClick');
  });
  bgm.onStatus(state => {
    const label = $('musicState');
    if (label) label.textContent = state.unavailable ? '音乐文件无法播放' : state.playing ? '音乐播放中' : '音乐待播放';
  });
  $('muteBtn').onclick = () => { prefs.sound = !prefs.sound; applyPreferences(); play('sfxClick'); };
  $('soundSetting').onchange = event => { prefs.sound = event.target.checked; applyPreferences(); };
  $('motionSetting').onchange = event => { prefs.reducedMotion = event.target.checked; applyPreferences(); };
  $('contrastSetting').onchange = event => { prefs.highContrast = event.target.checked; applyPreferences(); };
  $('logBtn').onclick = () => {
    const open = $('logPanel').classList.toggle('open');
    $('logBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    renderLog(game);
    const inline = $('fullLogInline');
    if (inline) inline.scrollTop = inline.scrollHeight;
  };
  $('logFullBtn').onclick = () => { showDialog('logDialog'); renderLog(game); };
  $('restartBtn').onclick = () => {
    const chapter = STORY_CHAPTERS.find(c => c.id === draft.story);
    $('menuDialog').close();
    // ★ 剧情对决里没有"重新选人"（角色由章节固定）——用户 2026-09-30 报的 bug：
    //   原来这颗按钮在剧情里也能点，一点就退回选人页（还会把章节规则带进自由对局）。
    //   现在剧情里它是「重打这一战」：重开本章战斗，**剧情进度不动**
    //   （storyRead.scene 仍停在战斗这一幕，打赢照样接着演战后正文）。
    if (chapter) {
      askConfirm('重打这一战？', `当前这场战斗的进度会清空，重新开始「${chapter.label} · ${chapter.title}」；剧情进度不受影响。`, startMatch, '重打这一战');
      return;
    }
    askConfirm('重新选择角色？', '当前对局的进度会清空，重新选择双方角色后开始新对局。', returnToDraft, '重新选人');
  };
  $('resignBtn').onclick = () => {
    // ★ 认输按**队**算（2026-10-03 用户拍定）：本队只要有一位真人就能认输——队友是电脑时，
    //   轮到电脑那一位也能替本队认输。这里挡的只有"本队全是电脑"（观战）那种情况。
    const canResign = game.teamHasHuman ? game.teamHasHuman() : humanTurn();
    if (!canResign) { game.fail('这一队全由电脑操作，没有你能认输的一手。'); return; }
    const side = game.s.turn;
    $('menuDialog').close();
    askConfirm(`${slotName(side)} 确认认输？`, game.s.twoSided?.() ? '认输＝这一队立刻落败，本局立即结束。' : '认输后本局立即结束，对方获胜。', () => game.resign(side), '确认认输');
  };
  $('cfCancel').onclick = () => { confirmAction = null; $('confirmDialog').close(); };
  $('cfOk').onclick = () => { const action = confirmAction; confirmAction = null; $('confirmDialog').close(); action?.(); };
  $('rematchBtn').onclick = startMatch;
  $('newMatchBtn').onclick = returnToDraft;
  $('resultDialog').addEventListener('cancel', event => event.preventDefault());
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('close', () => { hideTooltip(); invalidate(); if (dialog.id === 'confirmDialog') confirmAction = null; });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog || dialog.id === 'resultDialog') return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
  });
  document.addEventListener('pointerover', event => {
    const b = event.target.closest('[data-inspect-skill], [data-command]');
    if (b && !b.contains(event.relatedTarget)) showTooltip(b);
  });
  document.addEventListener('pointerout', event => {
    const b = event.target.closest('[data-inspect-skill], [data-command]');
    if (b && !b.contains(event.relatedTarget)) hideTooltip();
  });
  document.addEventListener('focusin', event => {
    const b = event.target.closest('[data-inspect-skill], [data-command]');
    if (b && keyboardFocus) showTooltip(b); else hideTooltip();
  });
  document.addEventListener('focusout', event => { if (event.target.matches('[data-inspect-skill], [data-command]')) hideTooltip(); });

  const board = $('board');
  board.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' && downAt) return;
    hideTooltip();
    keyboard = false; hover = pointerTile(event); inspecting = null;
  });
  board.addEventListener('pointerleave', () => { if (!keyboard) hover = null; pointerDown = false; });
  board.addEventListener('pointerdown', event => { pointerDown = true; downAt = { x: event.clientX, y: event.clientY }; });
  board.addEventListener('pointerup', () => { pointerDown = false; });
  board.addEventListener('pointercancel', () => { pointerDown = false; downAt = null; });
  board.addEventListener('click', event => {
    const t = pointerTile(event);
    pointerDown = false; keyboard = false;
    if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 10) { downAt = null; return; }
    downAt = null; hover = t; hideTooltip();
    $('turnBanner').classList.remove('show');
    if (!t || game.s.phase !== 'battle') return;
    const target = game.occupant(t);
    if (!humanTurn() || (!game.selected && target?.slot !== game.s.turn && target)) { inspecting = target; invalidate(); return; }
    if (busy()) { game.fail('当前行动正在结算，请稍候。'); return; }
    inspecting = null;
    game.actionAt(t);
    board.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', event => {
    if (modalOpen() || event.altKey || event.ctrlKey || event.metaKey || $('app').hidden) return;
    if (event.target.matches('input, textarea, select') || event.target.isContentEditable) return;
    if (event.key === 'Escape') {
      event.preventDefault(); hideTooltip(); inspecting = null;
      if (humanTurn() && !busy()) game.cancel();
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && event.target === board) {
      event.preventDefault(); keyboard = true; inspecting = null;
      const t = hover || game.tile(game.selected) || game.at(5, 6);
      let { row, col } = t;
      if (event.key === 'ArrowUp') row--;
      if (event.key === 'ArrowDown') row++;
      if (event.key === 'ArrowLeft') col--;
      if (event.key === 'ArrowRight') col++;
      if (event.key === 'Home') { row = 0; col = 0; }
      if (event.key === 'End') { row = ROWS - 1; col = COLS - 1; }
      hover = game.at(Math.max(0, Math.min(ROWS - 1, row)), Math.max(0, Math.min(COLS - 1, col)));
      const scale = parseFloat(board.dataset.scale), well = $('boardWell');
      const x = hover.cx * scale;
      if (x - well.scrollLeft < 40) well.scrollLeft = Math.max(0, x - 45);
      else if (x - well.scrollLeft > well.clientWidth - 40) well.scrollLeft = x - well.clientWidth + 45;
      const y = hover.cy * scale;
      if (y - well.scrollTop < 40) well.scrollTop = Math.max(0, y - 45);
      else if (y - well.scrollTop > well.clientHeight - 40) well.scrollTop = y - well.clientHeight + 45;
      return;
    }
    if (!humanTurn() || busy()) return;
    if (event.key === 'Enter' && event.target === board && hover) { event.preventDefault(); game.actionAt(hover); }
    else if (event.key === '1' || event.key === '2') {
      event.preventDefault(); const unit = game.s.units.find(u => u.slot === game.s.turn && u.kind === (event.key === '1' ? 'user' : 'stand'));
      if (unit) { inspecting = null; game.select(unit.id); hover = game.tile(unit); keyboard = true; }
      $('turnBanner').classList.remove('show');
      $('board').focus({ preventScroll: true });
    } else if (['q', 'w', 'e'].includes(event.key.toLowerCase())) {
      const key = game.skills(game.s.turn)[['q', 'w', 'e'].indexOf(event.key.toLowerCase())];
      if (key) { event.preventDefault(); commandClick(key, document.querySelector(`[data-command="${key}"]`)); }
    } else if (event.code === 'Space' && !event.target.closest('button')) { event.preventDefault(); requestEndTurn(); }
  });
  window.addEventListener('online', updateConnection);
  window.addEventListener('offline', updateConnection);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAI(); });
  window.addEventListener('blur', () => { pointerDown = false; });
}

/** 素材没加载出来时给一句看得懂的解释：绝大多数情况是 HTML 和 assets 文件夹分家了。 */
function showArtWarning(missingCount) {
  const node = $('artWarning');
  if (!node) return;
  const total = Object.keys(SPRITES).length + Object.keys(CHARACTER_ART).length * 2;
  const advice = location.protocol === 'file:'
    ? '你现在是直接双击 HTML 打开的，它必须和同级的 assets 文件夹待在一起：把整个压缩包完整解压后再打开，不要只复制 HTML，也不要在压缩包里直接双击。'
    : '当前是本地服务器打开的：请确认 assets/out 目录完整，然后刷新页面重试。';
  node.innerHTML = `<b>有 ${missingCount} 张素材图没加载出来</b>（共 ${total} 张）。${advice}缺图的单位会先显示成占位符号，游戏仍可继续玩。`;
  node.hidden = false;
}

async function boot() {
  try {
    $('settingsBtn').innerHTML = icon('settings');
    // 关卡机制按钮用「带文字的文档」图标，和剧情档案（书）区分开
    $('rulesBtn').innerHTML = icon('log');
    document.querySelector('.toolbar [data-help]').innerHTML = icon('help');
    document.querySelector('.toolbar [data-story]').innerHTML = icon('book');
    visual = new BoardVisual(game);
    applyPreferences(false);
    bindEvents();
    renderDraft(draft);
    const loaded = await loadSprites();
    visual.setSprites(loaded.sprites);
    // Warm the four small illustrations for immediate in-game feedback.
    const artMissing = [];
    // 剧情 boss 的肖像／插画可以暂时缺（artOptional）：肖像只在选人界面用，而 boss 不进选人列表；
    // 插画只在结算画面当背景。所以先不把它们算进"素材缺失"，免得主界面一直弹警告。
    const artLoads = Object.keys(CHARACTER_ART).filter(key => !CHARACTER_ART[key].artOptional).flatMap(key => [cutin(key), portrait(key)]).map(url => new Promise(resolve => {
      const image = new Image();
      image.onload = resolve;
      image.onerror = () => { artMissing.push(url); resolve(); };
      image.src = url;
      setTimeout(resolve, 6000);
    }));
    await Promise.all(artLoads);
    $('boot').hidden = true; showTitle();
    refreshBgm();
    layout = watchBoardScale(scale => visual.resize(scale));
    updateConnection();
    const missing = [...loaded.missing, ...artMissing];
    if (missing.length) {
      showArtWarning(missing.length);
      console.warn('Artwork unavailable:', missing.join(', '));
    }
    window.__jojoReady = true;
    window.dispatchEvent(new CustomEvent('jojo:ready'));
    // 手动验证用：`?test` 会把引擎与大厅状态挂到 window.__jojo（控制台里可以直接看控制表）
    if (query.has('test')) window.__jojo = { game, visual, draft, get hover() { return hover; }, get busy() { return busy(); }, get humanTurn() { return humanTurn(); }, get preferences() { return { ...prefs }; } };
    renderFrame = requestAnimationFrame(tick);
    if (query.has('auto') || query.has('demo')) {
      // `?vs=a,b` ＝ P1 / P2 两方角色；2v2（`?v2v=1`）时再多写两个：`?vs=a,b,c,d`
      // 其中 `c` 是 P1 的第二个角色、`d` 是 P2 的第二个角色。
      const [a, b, c, d] = (query.get('vs') || 'jotaro,dio').split(',');
      if (FIGHTERS[a]) draft.p1 = a;
      if (FIGHTERS[b]) draft.p2 = b;
      // ★ 2v2 与人机**可以同时开**（每个位子各自真人/人机）：先定人数，再定谁是人机。
      if (query.get('v2v') === '1') {
        draft.v2v = true;
        if (FIGHTERS[c] && !FIGHTERS[c].boss) draft.p1b = c;
        if (FIGHTERS[d] && !FIGHTERS[d].boss) draft.p2b = d;
        // 网址直开时补上没写的第二个角色：这样 `?auto&v2v=1` 一条 URL 就能进 2v2
        const pool = playableFighters().map(f => f.key);
        const fill = team => draft[`${team}b`] || pool.find(key => key !== draft[team] && !isBoss(key)) || pool[0];
        draft.p1b = fill('p1'); draft.p2b = fill('p2');
      }
      // 谁是人机，两条网址路线（**后写的覆盖先写的**）：
      //   ① `?mode=ai` ＝ 老写法，等价于"P2 侧（含 2v2 的 P2②）全是人机"；
      //   ② `?ai=p1b,p2` ＝ 精确到**位子**：列到的位子是人机，其余参战位子都是真人；
      //      空串（`?ai=`）＝ 全部真人；`p1b`/`p2b` 只在 2v2 里算参战位子。
      if (query.get('mode') === 'ai') { draft.mode = 'ai'; applyAiParam(draft, 'p2,p2b'); }
      if (query.has('ai')) applyAiParam(draft, query.get('ai'));
      startMatch();
      if (query.has('demo')) game.select('p1-stand');
    }
  } catch (error) {
    $('bootText').textContent = '战场加载失败，请刷新页面重试。';
    $('bootRetry').hidden = false;
    console.error(error);
  }
}
boot();
