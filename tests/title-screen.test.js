/**
 * 标题页（主菜单）的结构回归。
 *
 * 这一页是「整画背景 + 标题 + 模式选项」，改动它很容易出现
 * 「少一个按钮 / 背景图路径写错 / 剧情模式忘了禁用」这类静默问题，
 * 而浏览器里不一定会报错，所以用静态断言把关键结构钉住
 * （见《开发交接文档》§6 陷阱 2）。
 *
 * ★ 2026-10-04 用户拍定：**「人机对战」不再是一个单独的模式入口**——
 *   「对战」与「剧情」两个入口，人机与否改由大厅里**逐位**的开关决定。
 *   所以下面第一条从"三个选项"改成"两个选项"（这是用户明确改掉的设计，不是回归）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const main = fs.readFileSync(new URL('src/main.js', root), 'utf8');

const parseModes = () => [...html.matchAll(
  /<button type="button" class="title-mode"([^>]*)><span class="mode-number">(\d+)<\/span><span class="title-mode-text"><b>([^<]+)<\/b><small>([^<]+)<\/small>/g,
)].map(m => ({ attrs: m[1].trim(), number: m[2], label: m[3], note: m[4] }));

test('标题页：主标题、副标题与两个模式选项齐全且编号正确', () => {
  assert.match(html, /<section id="title"[^>]*class="title-screen"/, '缺少标题页容器 #title');
  assert.match(html, /<h1 id="titleHeading"[^>]*>星尘战棋<\/h1>/, '主标题应为「星尘战棋」');
  assert.match(html, /<p class="title-sub">命运，由你落子<\/p>/, '副标题应为「命运，由你落子」');

  const modes = parseModes();
  assert.equal(modes.length, 2, `模式选项应为 2 个（「对战」与「剧情」），实际 ${modes.length}`);
  assert.deepEqual(modes.map(m => m.number), ['01', '02'], '两个选项应按 01 / 02 编号');
  assert.deepEqual(modes.map(m => m.label), ['剧情模式', '对战'], '两个选项的文字');
});

test('标题页：两个模式都可点，各自绑定到对应入口', () => {
  const [story, versus] = parseModes();
  // 注意：必须按「独立的属性名」判断，不能用 includes('disabled')——
  // aria-disabled="true" 里就含有 disabled 子串，那样写会导致这条断言永远为真。
  const flag = mode => mode.attrs.split(/\s+/);

  assert.match(story.attrs, /data-title-mode="story"/, '「剧情模式」应绑定 data-title-mode="story"');
  assert.match(story.note, /第一章/, '「剧情模式」应标注第一章节名');
  assert.equal(flag(story).includes('disabled'), false, '「剧情模式」现在应该可点');

  assert.match(versus.attrs, /data-mode="hotseat"/, '「对战」应绑定 hotseat');
  assert.equal(flag(versus).includes('disabled'), false, '「对战」必须可点');
  assert.match(versus.note, /人机/, '「对战」的说明要写出"每位可设真人或人机"');
  // ★ 用户拍定：不再有单独的人机对战入口（人机改由大厅里逐位的开关决定）
  assert.equal(html.includes('data-mode="ai"'), false, '不应再有单独的「人机对战」按钮');
  assert.equal(/<b>人机对战<\/b>/.test(html), false, '「人机对战」的文字入口应已删除');
});

test('标题页：不做默认高亮，只有悬停/键盘聚焦才高亮', () => {
  const css = fs.readFileSync(new URL('src/ui/layout.css', root), 'utf8');
  assert.equal(/\.title-mode\[aria-pressed="true"\]/.test(css), false,
    '不应再用 aria-pressed 做「默认选中」高亮（用户要求取消）');
  assert.match(css, /\.title-mode:hover:not\(:disabled\)/, '应有鼠标悬停高亮规则');
  assert.match(css, /\.title-mode:focus-visible/, '键盘聚焦高亮必须保留，否则 Tab 看不到焦点');
});

test('战场工具栏：有「关卡机制」按钮，可以在战斗中重看这一关的特殊规则', () => {
  // 用户 2026-09-27 要求"新增一个选项可以重新在对战中看关卡机制"。
  // 按钮默认 hidden：只有带 specialRules 的章节（第 4/5/6 关）开打时才显示，
  // 普通对局点了会弹出一个空框，所以必须由 startMatch 按章节决定显不显示。
  assert.match(html, /<button class="icon-btn" id="rulesBtn"[^>]*hidden/, '工具栏应有默认隐藏的 #rulesBtn');
  assert.match(html, /<dialog id="rulesDialog"/, '缺少关卡机制弹窗 #rulesDialog');
  for (const id of ['rulesTitle', 'rulesLead', 'rulesBody']) {
    assert.ok(html.includes(`id="${id}"`), `缺少关卡机制弹窗里的 #${id}`);
  }
  assert.match(main, /function showChapterRules\(/, '缺少打开关卡机制弹窗的 showChapterRules()');
  // ★ 弹窗文案必须和剧情页那份**同一份来源**（hud 的 specialRulesHtml），
  //   否则又会出现"进战斗前写的规则"和"战斗中重看的规则"两套说法。
  assert.match(main, /import \{[^}]*specialRulesHtml[^}]*\} from '\.\/ui\/hud\.js'/, 'main.js 要共用 hud 的 specialRulesHtml');
  assert.match(main, /body\.innerHTML = specialRulesHtml\(chapter\)/, '弹窗内容要来自 specialRulesHtml');
  assert.match(main, /\$\('rulesBtn'\)\.onclick/, '按钮要有接线');
  assert.match(main, /rulesBtn\.hidden = chapterSpecialRules\(\)\.length === 0/, '按钮要按"这一关有没有特殊机制"显示');
  assert.match(main, /\$\('rulesBtn'\)\.innerHTML = icon\(/, '按钮图标要在启动时填上');
});

test('★★ 剧情对决里没有「重新选人」：对局菜单那颗按钮改成「重打这一战」（回归）', () => {
  // 用户 2026-09-30 报的 bug：剧情战斗里点「对局菜单」→「重新选人」→ 直接被扔回选人页；
  // 而且那条路没清掉"当前是第几章"，随手选的角色会带着**剧情规则**开打（憎恨值、关卡机制按钮都在）。
  // 现在：剧情里那颗按钮是「重打这一战」（重开本章战斗，剧情进度不动）。
  assert.match(main, /restartBtn\.textContent = draft\.story \? '重打这一战' : '重新选人'/,
    '★ 按钮名字要跟着场合换（自由对局仍是「重新选人」）');

  const start = main.indexOf("$('restartBtn').onclick");
  const end = main.indexOf("$('resignBtn').onclick");
  assert.ok(start > 0 && end > start, '找不到 #restartBtn 的处理函数');
  const handler = main.slice(start, end);
  assert.match(handler, /const chapter = STORY_CHAPTERS\.find\(c => c\.id === draft\.story\)/,
    '★ 要先判断"当前是不是剧情战斗"');
  assert.match(handler, /askConfirm\('重打这一战？'/, '剧情里要问的是「重打这一战？」');
  assert.match(handler, /startMatch, '重打这一战'/, '★ 剧情里点它＝重开本章战斗（不是回选人页）');
  const storyBranch = handler.slice(handler.indexOf('if (chapter)'));
  assert.equal(storyBranch.slice(0, storyBranch.indexOf('}')).includes('returnToDraft'), false,
    '★ 剧情分支里绝不能出现 returnToDraft');

  // 选人页是唯一入口，必须在那一处把剧情残留清干净
  const lobby = main.slice(main.indexOf('function showLobby('), main.indexOf('function showStoryMenu('));
  assert.match(lobby, /draft\.story = null/, '★ 进选人页必须清掉"当前是第几章"');
  assert.match(lobby, /isBoss\(draft\[side\]\)/, '★ 剧情 boss 要换回可选角色（boss 不在可选列表里，带进去会显示成"P2 没选人"）');
});

test('★★ 剧情战斗里输了 / 认输：结算弹窗那颗直接回章节选择，不绕标题页（2026-10-07 用户要求）', () => {
  // 用户原话：「剧情对战中退出直接返回章节选择界面」。
  // 旧行为：剧情里输了（或认输）→ 结算是「返回标题」→ 标题页 → 还得再点一次「剧情模式」才回到章节列表。
  // 现在：直接 `showStoryMenu()`。⚠️ 只改剧情这一支——自由对局那颗仍是「重新选人」（`returnToDraft`）。
  assert.match(main, /const toStoryMenu = \(\) => \{[^}]*showStoryMenu\(\)/,
    '★ 要有一个"回章节列表"的出口函数（closeDialogs + showStoryMenu）');

  const branch = main.slice(main.indexOf('showLeave(true);'), main.indexOf('$(\'newMatchBtn\').onclick'));
  assert.ok(branch.length > 0, '找不到结算弹窗那颗"离开"按钮的分支');
  const story = branch.slice(branch.indexOf('if (chapterIndex >= 0)'));
  const storyHead = story.slice(0, story.indexOf('retry.textContent = \'再战一局\''));
  assert.match(storyHead, /leave\.textContent = '返回章节选择'/, '★ 剧情里那颗按钮应叫「返回章节选择」');
  assert.match(storyHead, /leave\.onclick = toStoryMenu/, '★ 点了要直接回章节列表');
  assert.equal(storyHead.includes('toTitle'), false, '★ 剧情分支里不该再有"回标题页"那条老路（别留死代码）');
  // 自由对局不受影响
  assert.match(branch, /leave\.textContent = '重新选人'/, '自由对局那颗仍是「重新选人」');
  assert.match(branch, /leave\.onclick = returnToDraft/, '自由对局那颗仍旧走 returnToDraft');
});

test('★ 主动认输要立刻弹结算，不等排队中的台词（回归）', () => {
  // 用户 2026-09-30：「点击认输结算太慢」。原因是结算要等"还没播完的台词"播完，
  // 而认输时多半还排着开场那条最长 9 秒的「关卡机制」提示。
  assert.match(main, /function clearBarks\(\)/, '缺少"丢掉没播完的台词"的工具函数');
  assert.match(main, /if \(event\.resigned\)/, '★ result 事件要按 resigned 分支');
  const branch = main.slice(main.indexOf('if (event.resigned)'), main.indexOf('} else if (barkTimer !== null'));
  assert.match(branch, /clearBarks\(\)/, '★ 认输要丢掉没播完的台词（含开场机制提示）');
  assert.match(branch, /pendingResult = null/, '认输时不该还挂着"等台词播完再弹结算"的挂起状态');
  assert.match(branch, /setTimeout\(show, prefs\.reducedMotion \? \d+ : 180\)/, '★ 认输后要很快弹结算（约 0.2 秒）');
  // 被击倒仍然要等"击倒对手"那句读完（这是之前用户明确要求过的，别被这次改动误伤）
  assert.match(main, /\} else if \(barkTimer !== null \|\| barkQueue\.length\) \{[\s\S]*?pendingResult = show;/,
    '★ 非认输（被击倒）仍然要等台词播完再弹结算');
});

test('★ 「击倒对手」那句台词少停 1 秒，其余台词时长不变（回归）', () => {
  // 用户 2026-09-30：「胜利也拖得有点长了，减一秒看看」——
  // 胜利结算要等这句播完才弹，它是单句里最长的一档（4.4 秒封顶）。
  assert.match(main, /kind: event\.key/, '★ 台词入队时要记住这是哪一句（start / turn2 / half / death）');
  assert.match(main, /const ms = line\.kind === 'death' \? Math\.max\(2200, base - 1000\) : base;/,
    '★ 只有击倒那句减 1 秒（开场机制提示与第 2 回合/半血那两句必须原样）');
});

test('剧情模式：章节列表与演出页的结构都齐全', () => {
  assert.match(html, /<section id="storyMenu"[^>]*class="story-menu-screen"/, '缺少剧情模式章节列表 #storyMenu');
  for (const id of ['storyChapters', 'storyMenuBack']) {
    assert.ok(html.includes(`id="${id}"`), `缺少章节列表元素 #${id}`);
  }
  assert.match(html, /<section id="storyStage"[^>]*class="story-stage"/, '缺少剧情演出页 #storyStage');
  for (const id of ['storyStageLabel', 'storyStageTitle', 'storyStageBody', 'storyStageRules', 'storyStageNext', 'storyBack']) {
    assert.ok(html.includes(`id="${id}"`), `缺少剧情演出页元素 #${id}`);
  }
  assert.match(html, /本关规则/, '演出页应有「本关规则」区块');
});

test('标题页背景：指向 assets/out/lobby 的整画，且文件真实存在', () => {
  const img = html.match(/<div class="title-backdrop"[^>]*><img src="([^"]+)"/);
  assert.ok(img, '缺少标题页背景 <img>');
  assert.equal(img[1], 'assets/out/lobby/title-bg.webp', '背景图路径（相对项目根目录）');
  assert.ok(fs.existsSync(new URL(img[1], root)), `背景图文件不存在：${img[1]}`);
  assert.ok(fs.statSync(new URL(img[1], root)).size > 20000, '背景图文件过小，可能是坏图');
});

test('选人页：新增返回标题的入口，旧的同屏模式选择已移除', () => {
  assert.match(html, /<button class="btn quiet" id="backToTitle">/, '选人页缺少「返回标题」按钮');
  assert.match(html, /id="startBtn"/, '选人页仍需要「进入战场」按钮');
  assert.equal(/mode-picker/.test(html), false, '同屏的 .mode-picker 应已删除（模式选择搬到标题页）');
  assert.equal(/lobby-heading/.test(html), false, '旧的 .lobby-heading 应已删除（改到标题页）');
});

test('流程接线：标题页 ⇄ 剧情 ⇄ 选人页 ⇄ 战场的切换都在 main.js 里', () => {
  assert.match(main, /function showScreen\(id\)/, '缺少统一的屏幕切换 showScreen()');
  assert.match(main, /for \(const key of \['title', 'storyMenu', 'storyStage', 'lobby', 'app'\]\)/, 'showScreen 应覆盖五个屏幕');
  for (const fn of ['showTitle', 'showLobby', 'showStoryMenu', 'showStoryStage', 'startStoryMatch', 'startMatch']) {
    assert.match(main, new RegExp(`function ${fn}\\(`), `缺少 ${fn}()`);
  }

  const body = (from, to) => main.slice(main.indexOf(`function ${from}(`), main.indexOf(`function ${to}(`));
  assert.match(body('showTitle', 'showLobby'), /showScreen\('title'\)/, 'showTitle 应切到标题页');
  const lobbyBody = body('showLobby', 'showStoryMenu');
  assert.match(lobbyBody, /showScreen\('lobby'\)/, 'showLobby 应切到选人页');
  assert.match(lobbyBody, /renderDraft\(draft\)/, 'showLobby 应渲染选人界面');
  const menuBody = body('showStoryMenu', 'showStoryStage');
  assert.match(menuBody, /showScreen\('storyMenu'\)/, 'showStoryMenu 应切到章节列表');
  assert.match(menuBody, /renderStoryMenu\(storyRoadmap\(\)/, '章节列表要用路线图渲染');
  assert.match(menuBody, /cleared:.*storyProgress\.cleared/, '章节列表要带上已解锁进度');
  // 试玩用临时开关（?unlock=all）：只影响列表可点性，**不能写进 localStorage**
  assert.match(menuBody, /trialAll: unlockAll/, '试玩开关要传给章节列表（列表上要标出来）');
  assert.doesNotMatch(menuBody, /markStoryCleared|setItem/, '★ 试玩开关绝不能写进通关进度');
  const stageBody = body('showStoryStage', 'startStoryMatch');
  assert.match(stageBody, /showScreen\('storyStage'\)/, 'showStoryStage 应切到剧情页');
  assert.match(stageBody, /renderStoryStage\(/, 'showStoryStage 应渲染剧情内容');
  const storyStart = body('startStoryMatch', 'startMatch');
  assert.match(storyStart, /draft\.story = chapter\.id/, '剧情开打要带上章节 id');
  assert.match(storyStart, /draft\.mode = 'ai'/, '剧情模式由电脑控制对手');

  assert.match(main, /\$\('boot'\)\.hidden = true; showTitle\(\);/, '启动后应进入标题页');
  assert.match(main, /showScreen\('app'\)/, '进入战场要切到战场屏');
  assert.match(main, /game\.start\(draft\.p1, draft\.p2, draft\.mode, \{ story: draft\.story \}\)/, '开打时要把剧情规则传给引擎');
  assert.match(main, /button\.dataset\.mode\) \{[^}]*showLobby\(\)/, '点对战模式后应进入选人页');
  assert.match(main, /dataset\.titleMode === 'story'[^}]*showStoryMenu\(\)/, '点剧情模式应进入章节列表');
  assert.match(main, /dataset\.storyChapter[^}]*showStoryStage\(/, '点已解锁章节应直接跳进那一章');
  assert.match(main, /draft\.story = null/, '切到普通对战时必须清掉剧情规则');
  assert.match(main, /backToTitle/, '「返回标题」按钮要有接线');
  assert.match(main, /storyMenuBack/, '章节列表的「返回标题」要有接线');
  assert.match(main, /storyStageNext/, '剧情页的「继续 / 完成本章」按钮要有接线');
  // 通关＝解锁：读完本章最后一页要落盘进度并回到章节列表
  assert.match(main, /markStoryCleared\(chapter\.id\)/, '读完本章要记为已解锁');
  assert.match(main, /localStorage\.setItem\('stardust\.story'/, '解锁进度要写进 localStorage');
  // 剧情打赢后结算弹窗只留「继续」
  assert.match(main, /retry\.textContent = after && !after\.isBattle \? '继续' : '完成本章'/, '剧情打赢后主按钮应是「继续」');
  assert.match(main, /showLeave\(false\)/, '剧情打赢后应收起「返回标题」，只留一个按钮');
  // ★ 点「继续」必须真的接到战后那一幕（不然打完了剧情就断了）
  assert.match(main, /showStoryStage\(chapterIndex, after\.index\)/, '★ 点「继续」要接着播战后那一幕');
  assert.match(main, /const after = s\.story \? storySceneAt\(s\.story, storyRead\.scene \+ 1\) : null/,
    '★ 「战后那一幕」要由当前幕次 +1 推出来（不能写死索引）');
  // ★★ 曾经的 bug：开打时没更新 storyRead.scene，于是"战后那一幕"算成了战斗自己，
  //    按钮被误判成「完成本章」，玩家一按就被弹回章节列表、战后正文读不到（两章都中招）。
  assert.match(main, /import \{[^}]*storyBattleScene[^}]*\} from '\.\/ui\/story\.js'/,
    '★ main.js 要导入 storyBattleScene');
  assert.match(main, /const battleAt = storyBattleScene\(chapter\)/, '★ 开打时要查出战斗在第几幕');
  assert.match(main, /if \(battleAt >= 0\) storyRead\.scene = battleAt/, '★ 开打时必须把 storyRead.scene 记成战斗那一幕');
});
