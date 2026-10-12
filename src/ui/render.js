import { hexPath, hexDist, tileKey, drawSlab, drawLabels, drawMoveHint, drawAttackZone, drawSelected, drawTargetRing, CANVAS_W, CANVAS_H, R } from '../core/hex.js';
import { slotName, ITEM_TYPES } from '../core/game.js';
import { CHARACTER_ART, artKeys, ARENAS, TERRAIN_SKINS, terrainSkinPath, PART_SPRITES } from './assets.js';

/** 场地背景的键名前缀：带这个前缀的不做描边处理，而是单独放进 this.arenas。 */
const ARENA_PREFIX = 'arena:';

export const SPRITES = Object.fromEntries([
  ...['rock', 'bush', 'heal', 'hazard'].map(key => [key, `assets/out/terrain/${key}@2x.png`]),
  // 战斗场地背景（剧情章节指定，例如"在客机上"）：键名带 arena: 前缀
  ...Object.entries(ARENAS).map(([key, url]) => [`${ARENA_PREFIX}${key}`, url]),
  // 单单位角色（乔瑟夫）没有替身立绘，artKeys 会把它过滤掉
  ...Object.values(CHARACTER_ART).flatMap(artKeys).map(key => [key, `assets/out/standees/${key}.webp`]),
  // 场地专属地形皮肤：键名是 `<场地>-<地形>`（例如飞机上的 plane-rock＝行李箱堆）。
  // 效果与默认地形一一对应，只是长得符合场景；没做皮肤就自动退回默认图。
  ...TERRAIN_SKINS.map(key => [key, terrainSkinPath(key)]),
  // 第五章「力量」的船体要害棋子素材（锅炉／承重柱／绞盘／阀门）
  ...Object.entries(PART_SPRITES),
]);
export async function loadSprites() {
  const entries = await Promise.all(Object.entries(SPRITES).map(([key, url]) => new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve([key, null]), 12000);
    img.onload = () => { clearTimeout(timer); resolve([key, img]); };
    img.onerror = () => { clearTimeout(timer); resolve([key, null]); };
    img.src = url;
  })));
  return { sprites: new Map(entries.filter(([, img]) => img)), missing: entries.filter(([, img]) => !img).map(([key]) => key) };
}

const normalPalette = { p1: '#85adee', p2: '#ec91b6' };
const contrastPalette = { p1: '#87beff', p2: '#ffc078' };
const ink = '#110d1c';
const terrainSizes = {
  rock: 42, bush: 40, heal: 33, hazard: 42,
  // 场地皮肤（飞机机舱版）：尺寸与默认那套一致，保证换场景后视觉大小不变
  'plane-rock': 42, 'plane-bush': 40, 'plane-heal': 33, 'plane-hazard': 42,
  // 船体要害的四个钢制部件：画得比地形大一点，因为它们是"要打的目标"，得比装饰显眼
  'part-boiler': 54, 'part-column': 54, 'part-winch': 54, 'part-valve': 54,
};
const direction = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];

/**
 * ★★ 格内小字与条形的一组度量（**唯一一处**，别在画棋子的那几十行里再写魔数）。
 *
 * 为什么 2026-10-05 要动它们：棋盘 14×11 → 18×13 之后，逻辑画布从 877×643 长到 **1106×742**，
 * 而 `layout.js` 会把画布**缩放到容器里**——于是屏幕上的格子小了约 **13%**（桌面，受高度限制）
 * 到 **21%**（窄屏，按容器宽度铺满）。字号原样不动的话，"P1 · 主"在桌面上只剩 7 点几像素，
 * 名字与血条就看不清了。所以格内这几种小字按**同一比例（约 +12%）**放大，并做两件配套的事：
 *   · 名字那一行改到**裁剪之外**画：尖顶六边形越往下越窄，8.5px 的名字原本就贴着裁剪边，
 *     放大后两端的笔画必然被切掉。挪到 `g.restore()` 之后 + 补一圈深色描边
 *     （照 `drawSniperCrosshair` 里「冷枪」两个字的写法），压在任何底图上都读得清；
 *   · 名字背后那块深色底衬（原来是 ±19 收窄到 ±7 的梯形）跟着加宽到 **±24 → ±10**，
 *     保证放大后的字仍然落在深底上，而不是飘在格子花纹里。
 *
 * ⚠️ 上限是"六边形的宽度"：裁剪半径 r = R−1 = 32，在 dy 处的半宽
 *   = √3/2×32 = 27.7px（|dy| ≤ r/2 = 16），再往下按 √3×(32−dy) 收窄。
 *   所以**不能**把名字再放大：dy=25 处只剩 12.1px 半宽，字再宽就会露到格外去。
 *   `tests/board-size.test.js` 按 R 把这几个量核对回来（含状态小标必须完整落在六边形里），别凭感觉改。
 */
const TILE_TEXT = {
  tagFont: 9.5,        // 棋子名字/身份那一行「P1 · 主」（原 8.5）
  tagY: 25,            // 那一行相对格子中心的下移量（原 24.5）
  barW: 36,            // 血条宽（原 34）
  barH: 2.6,           // 血条高（原 2）
  barY: 16.5,          // 血条顶边相对格子中心的下移量（原 18；上移是为了给放大后的名字让位）
  plateTop: 19,        // 名字底衬：顶边（半宽 plateTopHalf，原 19 → 收窄到 7）
  plateTopHalf: 24,
  plateBot: 31,        // 名字底衬：底边（半宽 plateBotHalf）
  plateBotHalf: 10,
  badgeW: 16,          // 状态小标：**尺寸一个字没动**（16×11 @ cy−19）——
  badgeH: 11,          //   它是"六边形里塞得下的极限"，再大就会顶到裁剪边（见下面 drawUnit 里的算式）。
  badgeY: 19,
  smallFont: 9,        // 状态小标 + 地面上那些小字（镜面／冷枪／皇帝／暗枪／柱名）的字号（原 8）
};

/**
 * 格子里那种"贴在底部的小字"：**深色描边 + 彩色填充**（照「冷枪」那一套写法）。
 * 棋子名字、宝石柱名都用它——所以它一律画在**裁剪之外**，字不会被六边形切掉两端的笔画。
 */
function drawTileTag(g, t, text, color, y = TILE_TEXT.tagY) {
  g.save();
  g.font = `bold ${TILE_TEXT.tagFont}px sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 2.6; g.strokeStyle = 'rgba(10,6,12,.85)';
  g.strokeText(text, t.cx, t.cy + y);
  g.fillStyle = color;
  g.fillText(text, t.cx, t.cy + y);
  g.restore();
}

export class BoardVisual {
  constructor(game) {
    this.game = game;
    this.tiles = game.tiles;
    this.canvas = document.getElementById('board');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.base = document.createElement('canvas');
    this.bctx = this.base.getContext('2d', { alpha: false });
    this.sprites = new Map();
    this.outlined = new Map();
    this.palette = normalPalette;
    this.reducedMotion = false;
    this.effects = [];
    this.moves = new Map();
    this.baseKey = '';
    this.lastDraw = '';
    this.stageFlash = null;      // 换场地那一下的冲击动画（见 stageImpact）
    this.pixelRatio = 1;
    this.drawCount = 0;
    this.baseDrawCount = 0;
    this.resize(1);
  }
  resize(scale) {
    this.pixelRatio = Math.min(2, Math.max(.5, (window.devicePixelRatio || 1) * scale));
    for (const c of [this.base, this.canvas]) {
      c.width = Math.round(CANVAS_W * this.pixelRatio);
      c.height = Math.round(CANVAS_H * this.pixelRatio);
    }
    for (const g of [this.bctx, this.ctx]) {
      g.setTransform(this.canvas.width / CANVAS_W, 0, 0, this.canvas.height / CANVAS_H, 0, 0);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
    }
    this.redrawBase();
    this.lastDraw = '';
  }
  setSprites(sprites) {
    this.sprites = new Map();
    this.arenas = new Map();
    for (const [key, img] of sprites) {
      // 场地背景单独收一份，不做描边（它是铺满画布的大图，描边既没意义又吃显存）
      if (key.startsWith(ARENA_PREFIX)) { this.arenas.set(key.slice(ARENA_PREFIX.length), img); continue; }
      this.sprites.set(key, img);
      if (terrainSizes[key]) continue;
      const c = document.createElement('canvas');
      c.width = img.width + 12; c.height = img.height + 12;
      const g = c.getContext('2d');
      for (const [x, y] of [[-3, 0], [3, 0], [0, -3], [0, 3], [-2, -2], [2, 2], [-2, 2], [2, -2]]) g.drawImage(img, 6 + x, 6 + y);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#100b18'; g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'source-over';
      g.drawImage(img, 6, 6);
      this.outlined.set(key, c);
    }
    this.redrawBase();
    this.lastDraw = '';
  }
  preferences({ reducedMotion, highContrast }) {
    this.reducedMotion = reducedMotion;
    this.palette = highContrast ? contrastPalette : normalPalette;
    if (reducedMotion) this.moves.clear();
    this.redrawBase();
    this.lastDraw = '';
  }
  reset() { this.moves.clear(); this.effects.length = 0; this.baseKey = ''; this.lastDraw = ''; this.stageFlash = null; }
  onEvent(event) {
    const start = performance.now();
    if (event.type === 'move' && !this.reducedMotion) {
      this.moves.set(event.unit, { from: event.from, path: event.path, start, duration: event.path.length * 100 });
    }
    if (['hit', 'heal', 'place'].includes(event.type) && event.tile) {
      this.effects.push({ ...event, start, duration: this.reducedMotion ? 650 : 850 });
    }
    if (event.type === 'skill') {
      const unit = this.game.unit(event.unit);
      if (unit) this.effects.push({ ...event, tile: this.game.tile(unit), start, duration: 650 });
    }
  }
  /** 当前这一局该用哪张场地背景：由剧情章节指定（`STORY_CHAPTERS[].arena`），没指定就用默认深色底。
   *  ⚠️ 走引擎的 `game.arenaKey()`——「力量」那一关拆掉一个要害就会**中途换场地**，
   *     那种覆盖值存在引擎里，渲染层直接读 s.story.arena 是读不到的。 */
  arenaKey() { return this.game.arenaKey ? this.game.arenaKey() : (this.game.s.story?.arena || null); }
  /**
   * ★ 换场地时来一下"船体塌了一层"的冲击（由 main.js 在收到 `stage` 事件时调用）。
   * 用户反馈"击败要害后无明显场景变化"——静态换背景太容易被忽略，所以加一段短暂的
   * **压黑 → 白闪 → 一道横向撕裂线**，视觉上像"这一层塌了"。
   * `reducedMotion` 时整段跳过（只剩文字横幅），不靠动画传达信息。
   */
  stageImpact() {
    this.redrawBase();                    // 立刻按新场地重画静态层，别等下一帧的比较
    if (this.reducedMotion) return;
    this.stageFlash = { start: (typeof performance !== 'undefined' ? performance.now() : Date.now()), duration: 900 };
  }
  /**
   * 静态层（背景 + 地砖 + 地形 + 甲板）的缓存键：**地形或场地变了才需要重画**。
   *
   * ⚠️ 这个键必须**只在这一处生成**。加战场背景时把 arena 拼进了 `baseKey`，
   *    却忘了 `render()` 里那句比较还在用 `JSON.stringify(terrain)`（没有 arena），
   *    于是两者**永远不相等** → 静态层**每帧重画一次（每秒 60 次）**，
   *    等于缓存完全失效；桌面看不出来，手机上是白白耗电发热。
   *    现在两边都调这个方法，不可能再写岔。
   * ★★ 2026-10-05 加地图体系：键里再加上**地图键**（`game.mapId()`）。
   *    水与木甲板是"按地图数据铺的"（`isWaterTile` → 地图的甲板矩形），所以
   *    **只要地图换了，静态层就必须重画**——光看地形 JSON 与 arena 不足以覆盖这种情况
   *    （两张地图完全可能用同一个背景、同样的地形格数）。
   */
  baseStateKey() { return `${JSON.stringify(this.game.s.terrain)}|${this.arenaKey()}|${this.game.mapId?.() ?? ''}|${this.itemKey()}`; }
  /**
   * ★★ 道具的缓存键（2026-10-05）：静态层（`redrawBase`）里画着道具图标，
   * 所以"捡走一个 / 刷新一个"必须让静态层重画——只写死"地形 + 场地"的话图标会留在原地。
   * 键只取"种类 @ 格子"（`id` 里带着 epoch，不适合进缓存键）。
   */
  itemKey() {
    return (this.game.s.items || []).map(item => `${item.type}@${item.row},${item.col}`).join(';');
  }
  redrawBase() {
    const g = this.bctx, terrain = this.game.s.terrain;
    const arena = this.arenaKey();
    const arenaImage = arena ? this.arenas?.get(arena) : null;
    this.baseKey = this.baseStateKey();
    this.baseDrawCount++;
    if (arenaImage) {
      // 按"铺满"方式画（等比放大到刚好盖住画布，多出来的部分居中裁掉），再压一层暗色蒙版：
      // 背景是给人看的，棋子必须还能看清，所以宁可压暗一点。
      const scale = Math.max(CANVAS_W / arenaImage.width, CANVAS_H / arenaImage.height);
      const w = arenaImage.width * scale, h = arenaImage.height * scale;
      g.drawImage(arenaImage, (CANVAS_W - w) / 2, (CANVAS_H - h) / 2, w, h);
      // ⚠️ 蒙版别调太重：地砖现在是半透明的（见下面 slabAlpha），蒙版和地砖会**叠着一起压暗**，
      //    两层各压一次的结果是"背景画了等于没画"（甲板图就是这样，第一版几乎看不见）。
      //    0.32 + 半透明地砖 = 场地看得出来、棋子照样清楚。
      g.fillStyle = 'rgba(12,9,18,.32)';
      g.fillRect(0, 0, CANVAS_W, CANVAS_H);
    } else {
      g.fillStyle = '#17131f';
      g.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
    const light = g.createRadialGradient(CANVAS_W * .7, CANVAS_H * .2, 20, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * .8);
    light.addColorStop(0, '#50425655'); light.addColorStop(1, '#15102000');
    g.fillStyle = light; g.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // ⚠️ 地砖是**不透明色块**（hex.js 的 TILE_LIGHT/TILE_DARK），会把背景图整片盖住——
    //    只在格子缝和棋盘外圈露一点点。也就是说"战场背景"这个功能做出来之后，
    //    画好的背景其实**几乎看不见**（客机/海面那两张一直若有若无，就是这个原因）。
    //    所以有背景图时把地砖调成**半透明**，让脚下的地面透出来；没有背景的普通对局一点不变。
    if (arenaImage) g.globalAlpha = .5;
    for (const t of this.tiles) drawSlab(g, t, R - .8);
    g.globalAlpha = 1;
    // 海面关卡：水和木甲板铺在地砖**之上**（先把所有地砖画完再铺，否则后一格的地砖会盖住前一格的水）
    if (this.game.wateryArena?.()) this.drawSea(g);
    for (const t of this.tiles) {
      hexPath(g, t.cx, t.cy, R - 1);
      g.fillStyle = this.game.wateryArena?.()
        ? (this.game.isWaterTile(t) ? 'rgba(64,140,214,.14)' : 'rgba(190,150,96,.07)')
        : (t.col < 7 ? 'rgba(93,119,175,.045)' : 'rgba(170,100,139,.035)');
      g.fill();
      const type = terrain[tileKey(t)];
      if (type) this.drawTerrain(g, t, type);
    }
    // ★★ 道具（2026-10-05 用户拍板）：画在**地形之后、棋子之前**（棋子压在上面，不会被糊住）。
    //   它属于"铺在地上的那一层"，所以和地形一样进静态层（缓存键里带着道具，见 itemKey）。
    for (const item of this.game.s.items || []) this.drawItem(g, this.game.at(item.row, item.col), item);
    drawLabels(g, this.tiles);
    // Delicate corner registration marks, outside all playable hexagons.
    g.strokeStyle = '#9b805855'; g.lineWidth = 1;
    for (const [x, y, dx, dy] of [[3, 4, 1, 1], [CANVAS_W - 3, 4, -1, 1], [3, CANVAS_H - 4, 1, -1], [CANVAS_W - 3, CANVAS_H - 4, -1, -1]]) {
      g.beginPath(); g.moveTo(x + 16 * dx, y); g.lineTo(x, y); g.lineTo(x, y + 16 * dy); g.stroke();
    }
  }
  /**
   * 水域地图（地图特性 `features.water`）的两层：**水**（甲板以外的全部格子）和画面正中那条 **木甲板**
   * （2026-10-05 用户拍板后是"全宽、厚 3 行"的一条带子，18×13 上是行 5~7、共 54 格）。
   * 甲板是代码画的（背景图里只有海，没有船）——范围由 `game.isWaterTile()` 决定（数据来自地图的
   * 甲板尺寸，见 rules.js 的 `deckRectOf` / `SEA_DECK`），和「哪里算水、要减速」用的是同一份数据，
   * 所以画面和规则不可能对不上。
   * ★ 甲板改成全宽带子**不需要改这里的笔法**：② 段的路径是"把甲板格一个个拼起来"、缝线只画在甲板的
   *   包围盒里（`box`），所以甲板多宽多厚都照旧画得对（这也是当初不去写死 4×5 的原因）。
   * ⚠️ 2026-10-05 加地图体系之后，这一套**原样复用**给地图「浅滩水路」（第四章也是它）——
   *    不另画一套风格：换地图只换"哪些格子算水"，笔法一个字都没动。
   */
  drawSea(g) {
    const deck = this.tiles.filter(t => !this.game.isWaterTile(t));
    if (!deck.length) return;
    // ① 水：整体压一层深蓝，把「脚下是海」这件事说清楚
    g.save();
    g.fillStyle = 'rgba(14,46,92,.34)';
    g.fillRect(0, 0, CANVAS_W, CANVAS_H);
    g.restore();
    // ② 木甲板：先把这块区域的六边形拼成一条path，再整体填木色 + 甲板缝
    const box = deck.reduce((a, t) => ({
      x0: Math.min(a.x0, t.cx - R), y0: Math.min(a.y0, t.cy - R),
      x1: Math.max(a.x1, t.cx + R), y1: Math.max(a.y1, t.cy + R),
    }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    g.save();
    g.beginPath();
    for (const t of deck) {
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 30);
        const x = t.cx + (R - .8) * Math.cos(a), y = t.cy + (R - .8) * Math.sin(a);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
    }
    const wood = g.createLinearGradient(0, box.y0, 0, box.y1);
    wood.addColorStop(0, '#8a6236'); wood.addColorStop(.5, '#7a5530'); wood.addColorStop(1, '#5f4225');
    g.fillStyle = wood;
    g.fill();
    // 甲板缝：横向的木板线，只画在甲板范围内
    g.clip();
    g.strokeStyle = 'rgba(48,30,14,.55)'; g.lineWidth = 1.4;
    for (let y = box.y0; y <= box.y1; y += 11) {
      g.beginPath(); g.moveTo(box.x0, y + .5); g.lineTo(box.x1, y + .5); g.stroke();
    }
    g.strokeStyle = 'rgba(255,226,180,.09)'; g.lineWidth = 2;
    for (let y = box.y0 + 5; y <= box.y1; y += 22) {
      g.beginPath(); g.moveTo(box.x0, y); g.lineTo(box.x1, y); g.stroke();
    }
    // 甲板边缘的湿痕 + 高光，做出"船浮在水上"的厚度
    g.strokeStyle = 'rgba(232,214,178,.5)'; g.lineWidth = 2.4; g.stroke();
    g.restore();
  }
  /** 地形该用哪张图：有场地背景时优先用该场地的皮肤（例如飞机上的 `plane-rock`＝行李箱堆，
   * 而不再是野外的岩石），没做这套皮肤就退回默认图。**效果完全不变，只是长得符合场景。**
   */
  terrainSpriteKey(type) {
    const arena = this.arenaKey();
    if (arena && this.sprites?.has(`${arena}-${type}`)) return `${arena}-${type}`;
    return type;
  }
  drawTerrain(g, t, type) {
    const spriteKey = this.terrainSpriteKey(type);
    const img = this.sprites.get(spriteKey);
    g.save();
    hexPath(g, t.cx, t.cy, R - 5);
    g.clip();
    g.fillStyle = type === 'hazard' ? '#85944819' : type === 'bush' ? '#5e966516' : '#cbae7c08';
    g.fill();
    g.beginPath(); g.ellipse(t.cx - 3, t.cy + 10, 16, 6, -.1, 0, Math.PI * 2);
    g.fillStyle = '#0f0b1b88'; g.fill();
    if (img) {
      const size = terrainSizes[spriteKey] || terrainSizes[type] || 38;
      // Fixed logical bounds, never a multiplier of arbitrary source pixel dimensions.
      g.drawImage(img, t.cx - size / 2, t.cy - size / 2, size, size);
    } else {
      g.fillStyle = '#c4b080'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(({ rock: '岩', bush: '草', heal: '+', hazard: '毒' })[type] || '', t.cx, t.cy);
    }
    g.restore();
    if (type === 'heal') {
      g.fillStyle = '#c6e3b8'; g.fillRect(t.cx - 8, t.cy + 20, 16, 2);
    } else if (type === 'hazard') {
      g.fillStyle = '#c2bc78'; g.beginPath(); g.moveTo(t.cx, t.cy + 18); g.lineTo(t.cx + 3, t.cy + 23); g.lineTo(t.cx - 3, t.cy + 23); g.fill();
    }
  }
  /**
   * ★★ 2026-10-05 用户拍板：**可拾取道具的棋盘图标**（种类、颜色与数值见 core/rules.js 的 `ITEM_TYPES`）。
   *
   * 三条口径：
   *   ① **一眼与别的东西分得开**：一枚"深色圆盘托底 + 各自颜色的菱形徽章 + 一个汉字"——
   *      与地形字形（岩／草／+／毒 那种裸字）、宝石柱（竖立的晶体）、反光点（压扁的椭圆镜面）、
   *      三种射击预告（圆环＋虚线＋十字准星）在形状与配色上都不同；
   *   ② **糊不到棋子和名字**：它画在格子中心**偏上**（`cy − 5`）、直径不到格子的六成；
   *      而且按规则"走上去就捡走"，所以**格子上本来就不会同时站着棋子**（唯一例外是潜沙换位那种
   *      不走 `move()` 的交换，那时棋子照旧压在图标上面）；
   *   ③ `save` / `restore` 严格配平（渲染冒烟逐帧比对），而且**不用 16×11 的 `fillRect`**——
   *      那是状态小标的尺寸，测试靠它数标记数。
   */
  drawItem(g, t, item) {
    if (!t || !item) return;
    const def = ITEM_TYPES?.[item.type];
    if (!def) return;
    const cx = t.cx, cy = t.cy - 5, r = 8.4;
    g.save();
    // ① 托底的深色圆盘：把徽章从地砖上"托"起来（有水的地图上照样看得清）
    g.beginPath(); g.arc(cx, cy, r + 3.2, 0, Math.PI * 2);
    g.fillStyle = 'rgba(10,8,18,.66)'; g.fill();
    g.strokeStyle = 'rgba(255,244,224,.28)'; g.lineWidth = 1; g.stroke();
    // ② 菱形徽章：颜色是这一种道具的"身份证"（五种各不相同）
    g.beginPath();
    g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy);
    g.closePath();
    g.fillStyle = def.color; g.globalAlpha = .94; g.fill(); g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,250,238,.9)'; g.lineWidth = 1.4; g.stroke();
    // ③ 一个汉字（力／盾／风／时／链）：色盲玩家也能靠字认出来
    g.fillStyle = '#14101d';
    g.font = `bold ${TILE_TEXT.smallFont}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(def.glyph, cx, cy + .5);
    // ④ 两道向上的小反光：说明"这是能拿走的东西"，不是地面装饰
    g.strokeStyle = 'rgba(255,246,226,.55)'; g.lineWidth = 1.2;
    for (const dx of [-3.4, 3.4]) {
      g.beginPath();
      g.moveTo(cx + dx, cy - r - 2);
      g.lineTo(cx + dx, cy - r - 6);
      g.stroke();
    }
    g.restore();
  }
  boundary(g, tiles, color) {
    const keys = new Set(tiles.map(t => `${t.q},${t.r}`));
    g.save(); g.strokeStyle = color; g.lineWidth = 1.8;
    g.beginPath();
    for (const t of tiles) for (let i = 0; i < 6; i++) {
      const [dq, dr] = direction[i];
      if (keys.has(`${t.q + dq},${t.r + dr}`)) continue;
      const a = (60 * i - 30) * Math.PI / 180, b = a + Math.PI / 3;
      g.moveTo(t.cx + (R - 1.5) * Math.cos(a), t.cy + (R - 1.5) * Math.sin(a));
      g.lineTo(t.cx + (R - 1.5) * Math.cos(b), t.cy + (R - 1.5) * Math.sin(b));
    }
    g.stroke(); g.restore();
  }
  position(u, now) {
    // 空单位直接返回，避免单单位角色（没有同伴）在动画查询里把整帧搞崩
    if (!u) return null;
    const animation = this.moves.get(u.id);
    if (!animation) return this.game.tile(u);
    const progress = animation.duration <= 0 ? 1 : Math.max(0, Math.min(1, (now - animation.start) / animation.duration));
    if (progress >= 1) { this.moves.delete(u.id); return this.game.tile(u); }
    const points = [animation.from, ...animation.path];
    const index = Math.min(points.length - 2, Math.floor(progress * (points.length - 1)));
    const fraction = progress * (points.length - 1) - index, a = points[index], b = points[index + 1];
    return { cx: a.cx + (b.cx - a.cx) * fraction, cy: a.cy + (b.cy - a.cy) * fraction };
  }
  render(view, now) {
    const state = this.game.s;
    const terrainKey = this.baseStateKey();
    if (terrainKey !== this.baseKey) this.redrawBase();
    this.effects = this.effects.filter(e => now - e.start < e.duration);
    // 换场地的冲击动画也算"动起来"，否则下面那句"没变化就跳过"会把它吃掉
    const flashing = this.stageFlash && now - this.stageFlash.start < this.stageFlash.duration;
    const dynamic = flashing || this.effects.length || this.moves.size || state.shotAim
      || (this.game.emperorMarks?.() || []).length
      || (this.game.darkgunMarks?.() || []).length
      || (!this.reducedMotion && (view.selected || state.fire.length));
    const stamp = `${this.game.revision}|${view.hover ? tileKey(view.hover) : ''}|${view.inspected?.id}|${view.pointerDown}|${view.keyboard}|${this.baseDrawCount}`;
    if (!dynamic && this.lastDraw === stamp) return;
    this.lastDraw = stamp;
    this.drawCount++;
    const g = this.ctx, time = this.reducedMotion ? 0 : now / 1000;
    g.drawImage(this.base, 0, 0, this.base.width, this.base.height, 0, 0, CANVAS_W, CANVAS_H);
    const u = view.selected || view.inspected;
    if (u) {
      const range = view.selected ? view.range : u.range;
      if ((range || view.bladeTiles?.length) && !['emerald', 'flame', 'darkgun'].includes(state.pendingSkill)) {
        const zone = view.bladeTiles?.length ? view.bladeTiles
          : this.tiles.filter(t => hexDist(this.game.tile(u), t) > 0 && hexDist(this.game.tile(u), t) <= range);
        g.save(); if (!view.selected) g.globalAlpha = .55;
        for (const t of zone) drawAttackZone(g, t);
        this.boundary(g, zone, '#d58d9c80');
        g.restore();
      }
    }
    for (const t of view.reach) drawMoveHint(g, t);
    this.boundary(g, view.reach, '#89d4c49c');
    for (const t of view.placeTiles) {
      hexPath(g, t.cx, t.cy, R - 2);
      g.fillStyle = '#dec98820'; g.fill();
      g.strokeStyle = '#ead3a070'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#e6c788'; g.beginPath();
      g.moveTo(t.cx, t.cy - 4); g.lineTo(t.cx + 3, t.cy); g.lineTo(t.cx, t.cy + 4); g.lineTo(t.cx - 3, t.cy); g.fill();
    }
    if (view.selected) {
      // 单单位角色（乔瑟夫）没有同伴：没有 partner 就跳过连携虚线。
      // 以前这里没守，partner 返回 undefined 会让 position() 抛错、整帧中断，
      // 结果是"选中他之后其他棋子的立绘全部消失"。
      const mate = this.game.partner(view.selected);
      if (mate) {
        const a = this.position(view.selected, now), b = this.position(mate, now);
        g.save(); g.strokeStyle = this.palette[view.selected.side]; g.globalAlpha = .6; g.lineWidth = 1.5; g.setLineDash([3, 5]);
        g.beginPath(); g.moveTo(a.cx, a.cy + 15); g.lineTo(b.cx, b.cy + 15); g.stroke(); g.restore();
      }
    }
    if (view.path?.length && view.selected) {
      g.save(); g.strokeStyle = '#daf2d4'; g.lineWidth = 2; g.setLineDash([3, 4]);
      const from = this.game.tile(view.selected);
      g.beginPath(); g.moveTo(from.cx, from.cy);
      for (const t of view.path) g.lineTo(t.cx, t.cy);
      g.stroke(); g.restore();
    }
    // ★ 第八章「反光点」：**排在火焰与棋子之前**——它是铺在地上的镜面，
    //   火焰盖上去（＝封住）要看得见"火压在镜面上"，棋子站上去也该压在它上面。
    for (const m of state.mirrors || []) this.drawMirror(g, this.game.tile(m), m, time);
    // ★ 第八章「场边冷枪」的**弹道预告**：也画在棋子之前（虚线 + 目标格的红色警戒底色），
    //   这样棋子、标签、"镜面"那些字全都压在它上面，读起来一点都不糊（第③步 drawMirror 的放法）。
    //   目标格上的**准星（红圈 + 十字）**排在棋子之后另画一次，见下面 drawSniperCrosshair。
    const aim = state.shotAim;
    const aimTile = aim ? this.game.at(aim.row, aim.col) : null;
    if (aimTile) {
      const shooter = state.units.find(u => u.id === aim.shooterId);
      this.drawSniperAim(g, shooter ? this.position(shooter, now) : null, aimTile, time);
    }
    // ★★ 「皇帝」锁定的预告：**与冷枪同一套画法**（弹道虚线 + 目标格警戒底色），
    //    只是换成他的金色——冷枪挪开那一格就躲开，皇帝锁的是**单位**、挪开也躲不掉；准星那一层排棋子之后。
    const marks = this.game.emperorMarks?.() || [];
    for (const entry of marks) {
      const tile = this.game.tile(entry.unit);
      if (tile) this.drawEmperorAim(g, entry.by ? this.position(entry.by, now) : null, tile, time);
    }
    // ★★ 「暗枪」埋下的标记（2026-10-05 用户拍板）：**换一种颜色（暗紫）**，与上面那两种一眼分得开——
    //    红色＝冷枪的弹道、金色＝「皇帝」锁定、暗紫＝埋在地上的暗枪。同样**画在棋子之前**，
    //    所以棋子立绘、名字牌、镜面那些字全压在它上面（准星那一层另排在棋子之后）。
    //    ⚠️ 它是"埋在这一格上的枪"：**格子**才是标的（不像皇帝锁的是单位），所以这里也不画弹道虚线。
    const buried = this.game.darkgunMarks?.() || [];
    for (const entry of buried) this.drawDarkgunAim(g, entry.tile, time);
    for (const f of state.fire) this.drawFire(g, this.game.tile(f), f.side, time);
    for (const p of state.pillars) this.drawPillar(g, this.game.tile(p), p);
    const positions = state.units.map(u => ({ u, t: this.position(u, now) })).sort((a, b) => a.t.cy - b.t.cy);
    for (const { u, t } of positions) {
      // ★ 2026-10-03：吊死者**能栖在岩石上**（用户拍板）。地形画在底图上、棋子画在它上面，
      //   所以本来就不会被糊住；但"站在一块石头上"这件事得**一眼看出来**，所以在棋子之前
      //   补一圈亮边（画在底图与棋子之间，压住岩石、又不挡立绘）。
      if (this.game.mirrorWalker?.(u) && this.game.isRock?.(this.game.tile(u))) this.drawPerch(g, t, time);
      this.drawUnit(g, t, u, view.selected?.id === u.id, time);
    }
    for (const target of view.attackable) drawTargetRing(g, this.game.tile(target), time);
    // ★ 东方仗助「修复」：**可治疗的友军**用绿环（同一套呼吸环，只换颜色）——
    //   于是"红环＝可以打、绿环＝可以治"一眼分得开（用户要求的"普攻可以选择友方"）。
    for (const target of view.fixable || []) drawTargetRing(g, this.game.tile(target), time, '80,220,150');
    // ★ 冷枪的准星画在**棋子之后**：线条细、虚线，压在立绘上也只是"罩了一层准星"，
    //   立绘与名字仍然一眼看得清（用户要求：不能盖住棋子与标签的可读性）。
    if (aimTile) this.drawSniperCrosshair(g, aimTile, time);
    // ★★ 「皇帝」的准星（金色，写「皇帝」两个字）：同样排在棋子之后——
    //    被锁定的单位**挪到哪儿都躲不掉**，所以准星要一直罩在它头上。
    for (const entry of marks) {
      const tile = this.game.tile(entry.unit);
      if (tile) this.drawEmperorCrosshair(g, tile, time);
    }
    // ★★ 「暗枪」的准星（暗紫，写「暗枪」两个字）：同样排在棋子之后——
    //    它是"埋在这一格上的枪"，格子上有没有人都得看得见（谁踩上来谁挨），
    //    所以这一层压在立绘上只是罩一圈细线，立绘与名字仍然一眼看得清。
    for (const entry of buried) this.drawDarkgunCrosshair(g, entry.tile, time);
    if (view.selected && !this.moves.has(view.selected.id)) drawSelected(g, this.game.tile(view.selected), time);
    if (view.hover) {
      g.save(); hexPath(g, view.hover.cx, view.hover.cy, R - 1.5);
      g.strokeStyle = view.invalid ? '#b4a5bca0' : view.pointerDown ? '#ffe6a7' : '#e7dbe2e0';
      g.lineWidth = view.keyboard || view.pointerDown ? 2.8 : 1.6;
      if (view.invalid) g.setLineDash([3, 3]);
      g.stroke(); g.restore();
    }
    for (const event of this.effects) this.drawEffect(g, event, now);
    this.drawStageFlash(g, now);
  }
  /** 换场地那一下的"船体塌陷"：压黑 → 白闪 → 一道横向撕裂线（三段式，900ms）。 */
  drawStageFlash(g, now) {
    const flash = this.stageFlash;
    if (!flash) return;
    const p = (now - flash.start) / flash.duration;
    if (p >= 1) { this.stageFlash = null; return; }
    g.save();
    if (p < .22) {
      // ① 先压黑（"这一层塌下来"）
      g.fillStyle = `rgba(6,5,10,${Math.min(.92, p / .22 * .92)})`;
    } else if (p < .4) {
      // ② 白闪一下，把"刚换过东西"砸进眼里
      g.fillStyle = `rgba(232,222,255,${Math.max(0, (1 - (p - .22) / .18)) * .34})`;
    } else {
      // ③ 慢慢褪掉，让新背景从暗里透出来
      g.fillStyle = `rgba(6,5,10,${Math.max(0, (1 - (p - .4) / .6)) * .5})`;
    }
    g.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // 撕裂线：一道横向的裂缝从中间撕开
    const tear = 1 - Math.abs(p - .45) / .35;
    if (tear > 0) {
      const y = CANVAS_H * .5, span = CANVAS_W * tear;
      g.strokeStyle = `rgba(255,238,214,${tear * .7})`;
      g.lineWidth = 2 + tear * 2;
      g.beginPath();
      for (let x = -span / 2; x <= span / 2; x += 14) {
        const px = CANVAS_W / 2 + x, py = y + Math.sin(x / 26) * 7;
        if (x === -span / 2) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.stroke();
    }
    g.restore();
  }
  /**
   * ★ 2026-10-03：**栖在岩石上的吊死者**的立足标记（用户要求"棋子盖在岩石上没问题，
   *   但别让它被岩石的图形糊住"）。
   * 地形画在底图（`redrawBase`）上、棋子画在底图之后，所以棋子本来就压在岩石之上；
   * 这里再补一圈**冷色的镜面亮边 + 两道立足反光**，画在底图与棋子**之间**：
   *   ① 压住岩石那几张图的碎边，读起来是"它站在这块石头上"，不是"它陷在石头里"；
   *   ② 排在棋子之前，所以**盖不住立绘、名字与血条**（与 drawMirror 同一条口径）。
   * ⚠️ 只在"反光点机制那一幕 + 脚下是岩石"时才画（`mirrorWalker` / `isRock` 两处判定都由调用方给）。
   */
  drawPerch(g, t, time) {
    if (!t) return;
    const pulse = .72 + Math.sin(time * 2.1) * .16;
    g.save();
    // ① 脚下那圈亮边（比六边形小一圈，贴着岩石的边缘，不越出格子）
    g.beginPath(); g.ellipse(t.cx, t.cy + 12, R - 8, (R - 8) * .46, 0, 0, Math.PI * 2);
    g.fillStyle = `rgba(168,214,238,${.22 * pulse})`; g.fill();
    g.strokeStyle = `rgba(223,244,255,${pulse})`; g.lineWidth = 1.8; g.stroke();
    // ② 两道向上的短反光：说明它是"立在石头上"而不是"沉在石头里"
    g.strokeStyle = `rgba(223,244,255,${.7 * pulse})`; g.lineWidth = 1.4;
    for (const dx of [-13, 13]) {
      g.beginPath();
      g.moveTo(t.cx + dx, t.cy + 8);
      g.lineTo(t.cx + dx * .62, t.cy - 6);
      g.stroke();
    }
    g.restore();
  }
  drawUnit(g, t, u, selected, time) {
    const color = this.palette[u.side], isStand = u.kind === 'stand';
    const key = CHARACTER_ART[u.fighter][u.kind], img = this.outlined.get(key);
    // 2v2：一个角色被打倒之后，他的棋子**直接从棋盘上离场**（`Game.removeFallenSlot`，2026-10-04
    // 用户要求"倒下就不要再占位置"）——渲染按 `s.units` 走，所以移除即消失，不会留下鬼影。
    // ⚠️ 旧口径是"棋子留在场上、压暗成尸体"，那套画法**已经删掉**：现在根本画不到那种棋子。
    g.save();
    hexPath(g, t.cx, t.cy, R - 1);
    g.clip();
    g.beginPath(); g.ellipse(t.cx - 3, t.cy + 19, 21, 8, -.1, 0, Math.PI * 2);
    g.fillStyle = '#090611b8'; g.fill();
    // 站在水里的棋子：下半格漫上一层海水 + 两条会流动的浪线，看起来就是半身泡在水里。
    // 这是「水域 −1 移动」唯一的画面提示，所以必须显眼（判定见 game.isWaterTile）。
    if (this.game.inWater?.(u)) {
      const surface = t.cy + 3, drift = time * 1.6;
      g.beginPath(); g.rect(t.cx - R, surface, R * 2, R * 2);
      g.fillStyle = 'rgba(40,110,188,.42)'; g.fill();
      g.lineWidth = 1.8;
      for (let i = 0; i < 2; i++) {
        const y = surface + 2 + i * 8;
        g.beginPath();
        for (let k = -R; k <= R; k += 4) {
          const x = t.cx + k, wobble = Math.sin(k / 6 + drift * (i ? -2.1 : 2.4) + i) * 1.9;
          if (k === -R) g.moveTo(x, y + wobble); else g.lineTo(x, y + wobble);
        }
        g.strokeStyle = i ? 'rgba(186,228,255,.5)' : 'rgba(240,250,255,.85)';
        g.stroke();
      }
    }
    if (isStand) {
      g.beginPath(); g.ellipse(t.cx, t.cy + 14, 22, 10, 0, 0, Math.PI * 2);
      g.fillStyle = '#aba0ea15'; g.fill();
      g.strokeStyle = '#c8bafa70'; g.lineWidth = 1; g.stroke();
    }
    g.beginPath();
    if (u.side === 'p1') g.ellipse(t.cx, t.cy + 19, 18, 7, 0, 0, Math.PI * 2);
    else { g.moveTo(t.cx - 21, t.cy + 19); g.lineTo(t.cx, t.cy + 12); g.lineTo(t.cx + 21, t.cy + 19); g.lineTo(t.cx, t.cy + 26); g.closePath(); }
    g.fillStyle = this.rgba(color, .24); g.fill();
    g.strokeStyle = selected ? '#efd292' : color; g.lineWidth = 1.8; g.stroke();
    if (img) {
      const height = isStand ? 52 : 50, width = height * img.width / img.height;
      g.globalAlpha = isStand ? .93 : 1;
      g.drawImage(img, t.cx - width / 2, t.cy + 20 - height, width, height);
    } else {
      g.fillStyle = color; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText(isStand ? '替' : '主', t.cx, t.cy + 3);
    }
    g.globalAlpha = 1;
    // Team and role survive both color blindness and identical character matchups.
    // ★ 2026-10-05：底衬跟着放宽（±24 → ±10，原 ±19 → ±7），好兜住放大后的那一行名字（见 TILE_TEXT）。
    g.fillStyle = ink;
    g.beginPath(); g.moveTo(t.cx - TILE_TEXT.plateTopHalf, t.cy + TILE_TEXT.plateTop);
    g.lineTo(t.cx + TILE_TEXT.plateTopHalf, t.cy + TILE_TEXT.plateTop);
    g.lineTo(t.cx + TILE_TEXT.plateBotHalf, t.cy + TILE_TEXT.plateBot);
    g.lineTo(t.cx - TILE_TEXT.plateBotHalf, t.cy + TILE_TEXT.plateBot);
    g.closePath(); g.fill();
    const { barW, barH, barY } = TILE_TEXT;
    const ratio = this.game.s.hp[u.slot] / this.game.fighter(u.slot).hp;
    g.fillStyle = '#494050'; g.fillRect(t.cx - barW / 2, t.cy + barY, barW, barH);
    g.fillStyle = ratio > .3 ? '#a5d5b5' : '#ee968c';
    g.fillRect(t.cx - barW / 2, t.cy + barY, barW * Math.max(0, ratio), barH);
    // 状态小标（灼烧 / 溺水）：**必须画在六边形的内切范围里**。
    // ⚠️ 原来把它们贴在 cy-28 那种"上角"位置，而尖顶六边形越往上越窄（y=cy-28 时半宽只剩 8.7px），
    //    标记整个落在裁剪区之外——也就是说灼烧标记一直是看不见的。这几个常量按"放得下"反推出来：
    //    裁剪半径是 R-1 = 32，在 dy = badgeY(=19) 处的半宽 = √3×(32−19) = 22.5px ≥ 6 + badgeW(=22)。
    //    ⚠️⚠️ 2026-10-05 棋盘放大时这一组**一个数都没动**：它已经贴着内切宽的极限，
    //       字号 +1 是在 16×11 的框里把字挤紧一点（"灼2"这类最多 2 个字符，放得下）。
    //    改这几个数字之前先看 `tests/dark-blue-moon.test.js` 与 `tests/board-size.test.js`
    //    里那两条"标记必须在六边形内"的测试。
    const BADGE_W = TILE_TEXT.badgeW, BADGE_H = TILE_TEXT.badgeH, BADGE_Y = TILE_TEXT.badgeY;
    const badges = [];
    if (this.game.s.burn[u.slot]) badges.push({ bg: '#512e31', ink: '#ffbf90', text: `灼${this.game.s.burn[u.slot]}` });
    // 溺水：数字是「还能挣扎几个回合结束」（每个回合结束掉真实伤害）
    if (this.game.drowning?.(u.slot)) badges.push({ bg: '#183a5e', ink: '#a8dcff', text: `溺${this.game.s.drown[u.slot]}` });
    g.font = `bold ${TILE_TEXT.smallFont}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    badges.forEach((badge, index) => {
      const y = t.cy - BADGE_Y + index * BADGE_H;
      g.fillStyle = badge.bg; g.fillRect(t.cx + 6, y, BADGE_W, BADGE_H);
      g.fillStyle = badge.ink; g.fillText(badge.text, t.cx + 6 + BADGE_W / 2, y + BADGE_H / 2);
    });
    // 被藤蔓缠住：左上角一枚绿色标记（移动 −1 的警示），同样要留在六边形内部
    if (this.game.vined?.(u)) {
      g.fillStyle = '#2c4a2f'; g.fillRect(t.cx - 6 - BADGE_W, t.cy - BADGE_Y, BADGE_W, BADGE_H);
      g.fillStyle = '#9fe0a8'; g.fillText('藤', t.cx - 6 - BADGE_W / 2, t.cy - BADGE_Y + BADGE_H / 2);
    }
    // 出局的角色：**这里不再压灰罩**——倒下的棋子已经离场（见上面那段说明），画不到这一支；
    // 旧写法是"在 alpha 之外再补一层灰罩，避免被立绘盖住"，随那条取舍一起删掉了。
    g.restore();
    // ★★ 队伍与身份那一行（`P1 · 主` / 2v2 时的 `P1·2 · 主`）：**画在裁剪之外**。
    //    六边形在 dy=25 处只剩 12px 半宽，2v2 的那一串字有 34px 宽——留在裁剪里必被切掉两端笔画。
    //    所以改由 `drawTileTag()` 在 restore 之后画（深色描边 + 队伍色填充），
    //    与「冷枪」「暗枪」那两个字同一套写法（见 TILE_TEXT 那段说明）。
    drawTileTag(g, t, `${slotName(u.slot)} · ${isStand ? '替' : '主'}`, color);
    // 水中的棋子再套一圈青色边（画在裁剪之外，才不会被裁掉）：一眼就能认出"它正泡在水里"
    if (this.game.inWater?.(u)) {
      hexPath(g, t.cx, t.cy, R - 2.5);
      g.strokeStyle = 'rgba(126,214,255,.8)'; g.lineWidth = 2; g.stroke();
    }
  }
  /**
   * ★★ 第八章「反光点」：铺在**地面**上的镜面／水洼（用户定：画成镜面／水洼，不是棋子）。
   * 三条口径：
   *   ① 镜面只占格子的**中下部**（一枚压扁的椭圆），上半格留空——棋子站上去时立绘压在它上面，
   *      两边还能露出镜面的亮边，所以"它站在反光点上"仍然一眼看得清；
   *   ② 没被封＝亮青白色的镜面 + 一道缓慢扫过的反光；**被封住＝烧暗、裂开、边上留一圈焦痕**；
   *   ③ 标签只在**格子上没有人**的时候写（有棋子时会被它脚下的队伍条糊住，不如不写）。
   */
  drawMirror(g, t, m, time) {
    if (!t) return;
    const sealed = !!m.sealed;
    g.save();
    hexPath(g, t.cx, t.cy, R - 3); g.clip();
    const grad = g.createLinearGradient(t.cx - R, t.cy - 6, t.cx + R, t.cy + 22);
    grad.addColorStop(0, sealed ? '#332d38' : '#f2fbff');
    grad.addColorStop(.45, sealed ? '#1e1a24' : '#9dc9dd');
    grad.addColorStop(1, sealed ? '#15121a' : '#57849f');
    g.globalAlpha = sealed ? .52 : .72;
    g.beginPath(); g.ellipse(t.cx, t.cy + 8, R - 6, (R - 6) * .58, 0, 0, Math.PI * 2);
    g.fillStyle = grad; g.fill();
    if (sealed) {
      // 封住的镜面：一道裂纹 + 几点没熄的余烬（"这个点已经废了"）
      g.globalAlpha = .8; g.strokeStyle = '#8d8794'; g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(t.cx - 19, t.cy + 2); g.lineTo(t.cx - 4, t.cy + 7);
      g.lineTo(t.cx + 3, t.cy - 1); g.lineTo(t.cx + 18, t.cy + 5);
      g.stroke();
      g.globalAlpha = .55; g.fillStyle = '#c8703a';
      for (const [dx, dy] of [[-11, 13], [4, 16], [13, 9]]) {
        g.beginPath(); g.arc(t.cx + dx, t.cy + dy, 1.6, 0, Math.PI * 2); g.fill();
      }
    } else {
      // 扫过去的反光带：镜面"会动"才像镜子（减弱动效时 time 恒为 0，它就停在中间）
      const shift = Math.sin(time * .9) * 9;
      g.globalAlpha = .45; g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(t.cx - 22 + shift, t.cy + 24); g.lineTo(t.cx - 4 + shift, t.cy - 6);
      g.lineTo(t.cx + 5 + shift, t.cy - 6); g.lineTo(t.cx - 13 + shift, t.cy + 24);
      g.closePath(); g.fill();
    }
    g.restore();
    // 外圈：亮镜面＝青白细线；被封＝暗灰虚线
    g.save();
    hexPath(g, t.cx, t.cy, R - 6);
    g.strokeStyle = sealed ? 'rgba(140,131,148,.55)' : 'rgba(214,244,255,.75)';
    g.lineWidth = sealed ? 1 : 1.6;
    if (sealed) g.setLineDash([3, 4]);
    g.stroke();
    if (!this.game.s.units.some(u => u.row === t.row && u.col === t.col)) {
      g.fillStyle = sealed ? '#9a93a2' : '#e6f6ff';
      g.font = `bold ${TILE_TEXT.smallFont}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(sealed ? '镜·封' : '镜面', t.cx, t.cy + 18);
    }
    g.restore();
  }
  /**
   * ★ 第八章「场边冷枪」的**弹道预告**（用户定：开火前一个回合在地面画出弹道与目标格）。
   * 画两层，都排在棋子之前：
   *   ① 从枪手到目标格的一条**虚线**（慢速流动，一眼看出"这一枪正在瞄"）；
   *   ② 目标格的**红色警戒底色**——提醒"站这儿会挨枪"，挪开就躲开了。
   * ⚠️ 只铺在地上，不画棋子／标签那一层，所以谁站在准星里、脚下写着什么，照样看得清。
   */
  drawSniperAim(g, from, t, time) {
    if (!t) return;
    g.save();
    hexPath(g, t.cx, t.cy, R - 3); g.clip();
    g.fillStyle = 'rgba(214,54,64,.22)'; g.fill();
    g.restore();
    if (!from) return;
    g.save();
    g.strokeStyle = 'rgba(255,132,120,.85)';
    g.lineWidth = 1.8;
    g.setLineDash([7, 6]);
    g.lineDashOffset = -((time * 30) % 13);
    g.beginPath(); g.moveTo(from.cx, from.cy + 14); g.lineTo(t.cx, t.cy + 14); g.stroke();
    g.restore();
  }
  /**
   * ★ 冷枪瞄准中的目标格：**红圈 + 十字准星**（排在棋子之后，所以"谁被瞄着"一眼可见）。
   * ⚠️ 线条一律细、带虚线、脉动只在透明度上做：立绘与"P1 · 主"那行队伍标签都不被涂掉。
   * ⚠️ 「冷枪」两个字**只在格子上没人时写**（与 drawMirror 的标签同一口径）：
   *    格子下缘那一带就是棋子的名字 + 血条，硬写上去会把立绘的可读性糊掉；
   *    有棋子站着时，红圈／十字／地面那一层红色 + 状态栏「目标 F6」已经把话说清了。
   */
  drawSniperCrosshair(g, t, time) {
    const pulse = .6 + .4 * Math.sin(time * 5.2);
    const arm = .5 + .45 * pulse;
    g.save();
    hexPath(g, t.cx, t.cy, R - 2);
    g.strokeStyle = `rgba(255,72,84,${.45 + .45 * pulse})`;
    g.lineWidth = 1.6 + pulse;
    g.setLineDash([6, 5]);
    g.lineDashOffset = -((time * 16) % 11);
    g.stroke();
    g.setLineDash([]);
    // 十字：四条从格子边缘指向中心的短刻度，正中留空给立绘
    g.strokeStyle = `rgba(255,214,204,${arm})`;
    g.lineWidth = 1.6;
    for (const [x0, y0, x1, y1] of [[t.cx, t.cy - R + 4, t.cx, t.cy - R + 13], [t.cx, t.cy + R - 15, t.cx, t.cy + R - 6],
      [t.cx - R + 12, t.cy + 6, t.cx - R + 21, t.cy + 6], [t.cx + R - 21, t.cy + 6, t.cx + R - 12, t.cy + 6]]) {
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    g.restore();
    if (this.game.s.units.some(u => u.row === t.row && u.col === t.col)) return;
    g.save();
    g.font = `bold ${TILE_TEXT.smallFont}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 2.6; g.strokeStyle = 'rgba(10,6,12,.8)';
    g.strokeText('冷枪', t.cx, t.cy + 26);
    g.fillStyle = `rgba(255,150,140,${.7 + .3 * pulse})`;
    g.fillText('冷枪', t.cx, t.cy + 26);
    g.restore();
  }
  /**
   * ★★ 「皇帝」锁定的**弹道预告**（霍尔·霍斯，2026-10-03 用户拍板）：与冷枪那一套同款、同分层，
   * 只是颜色换成他的金色：
   *   ① 从他（出手的那枚棋子）到**被锁定的单位**一条虚线；
   *   ② 目标格一层金色警戒底色。
   * ⚠️ 与冷枪的区别要一眼看得出来：冷枪**挪开那一格就躲开了**，皇帝锁的是**单位**——它走到哪都躲不掉，
   *    所以这条虚线会跟着那枚棋子跑（每帧按它当前所在格重画）。
   */
  drawEmperorAim(g, from, t, time) {
    if (!t) return;
    g.save();
    hexPath(g, t.cx, t.cy, R - 3); g.clip();
    g.fillStyle = 'rgba(200,162,74,.26)'; g.fill();
    g.restore();
    if (!from) return;
    g.save();
    g.strokeStyle = 'rgba(255,214,140,.85)';
    g.lineWidth = 1.8;
    g.setLineDash([9, 6]);
    g.lineDashOffset = -((time * 22) % 15);
    g.beginPath(); g.moveTo(from.cx, from.cy + 14); g.lineTo(t.cx, t.cy + 14); g.stroke();
    g.restore();
  }
  /**
   * ★★ 「皇帝」锁定的准星（排在棋子之后）：金色细圈 + 刻度 + 一行「皇帝」。
   * ⚠️ 与冷枪同样的两条读法（见 drawSniperCrosshair）：线条一律细、脉动只做透明度；
   *    「皇帝」两个字**只在格子上没人时**写，有人站着时靠金圈与状态栏标签说明。
   * ⚠️ 两个字写在 `t.cy + 35`（冷枪那行在 +26）：**两个预告可能同时挂着**（阶段 1 就是如此），
   *    错开一行才读得清是谁在瞄。
   */
  drawEmperorCrosshair(g, t, time) {
    const pulse = .6 + .4 * Math.sin(time * 4.4);
    g.save();
    hexPath(g, t.cx, t.cy, R - 2);
    g.strokeStyle = `rgba(240,196,96,${.42 + .45 * pulse})`;
    g.lineWidth = 1.6 + pulse;
    g.setLineDash([8, 6]);
    g.lineDashOffset = -((time * 13) % 14);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = `rgba(255,232,186,${.4 + .45 * pulse})`;
    g.lineWidth = 1.6;
    for (const [x0, y0, x1, y1] of [[t.cx, t.cy - R + 4, t.cx, t.cy - R + 13], [t.cx, t.cy + R - 15, t.cx, t.cy + R - 6],
      [t.cx - R + 12, t.cy + 6, t.cx - R + 21, t.cy + 6], [t.cx + R - 21, t.cy + 6, t.cx + R - 12, t.cy + 6]]) {
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    g.restore();
    // ⚠️ 与冷枪那条不同：冷枪瞄的是**格子**（格子上可能没人），皇帝锁的**一定是**格子上那个单位——
    //    所以「皇帝」这两个字**始终**要写出来；格子上有人时就挪到左上角，
    //    免得糊住棋子下缘那一行名字与血条（冷枪／镜面为了不糊立绘选择了"有人就不写"）。
    const occupied = this.game.s.units.some(u => u.row === t.row && u.col === t.col);
    g.save();
    g.font = `bold ${TILE_TEXT.smallFont}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 2.6; g.strokeStyle = 'rgba(10,6,12,.8)';
    const x = occupied ? t.cx - R + 11 : t.cx, y = occupied ? t.cy - R + 12 : t.cy + 35;
    g.strokeText('皇帝', x, y);
    g.fillStyle = `rgba(255,214,140,${.7 + .3 * pulse})`;
    g.fillText('皇帝', x, y);
    g.restore();
  }
  /**
   * ★★ 「暗枪」埋下的标记（2026-10-05 用户拍板）——**地面那一层**，画在棋子之前。
   *
   * 三套预告要一眼分得开（用户要求）：
   *   · 红色 ＝「场边冷枪」的弹道（`drawSniperAim`，弹道虚线 + 红色警戒底色）；
   *   · 金色 ＝「皇帝」锁定（`drawEmperorAim`，弹道虚线 + 金色警戒底色）；
   *   · **暗紫 ＝「暗枪」埋下的两个位置**（这一处）：**没有弹道虚线**——它不像前两种是"某一枪正在瞄"，
   *     而是"这一格被埋了一杆枪"（标的**是格子**，不是单位，也不认枪手站在哪）。
   *
   * 画法（都只铺在地上、线细、脉动只做透明度）：
   *   ① 整格一层暗紫底色（"这一格不对劲"）；
   *   ② **两个小圆点**——照 `icons.js` 里那支「短枪口 + 两点落位」的图形，把"一次埋两个位置"这件事
   *      直接画在格子上（两格各一个点，一眼看出它们是一对）；
   *   ③ 准星（紫圈 + 四条刻度）与「暗枪」两个字排在**棋子之后**另画，见下面 drawDarkgunCrosshair。
   * ⚠️ 棋子立绘、名字牌、镜面那些字全都压在它上面，所以这一层糊不到立绘的可读性。
   */
  drawDarkgunAim(g, t, time) {
    if (!t) return;
    const pulse = .6 + .4 * Math.sin(time * 3.6);
    g.save();
    hexPath(g, t.cx, t.cy, R - 3); g.clip();
    g.fillStyle = 'rgba(122,74,196,.28)'; g.fill();
    g.restore();
    // 落位点：一颗（每格一颗），暗紫细芯 + 一圈更淡的光晕——"这里埋着一杆枪"
    g.save();
    g.beginPath(); g.arc(t.cx, t.cy + 2, 2.2, 0, Math.PI * 2);
    g.fillStyle = `rgba(206,162,255,${.5 + .4 * pulse})`; g.fill();
    g.beginPath(); g.arc(t.cx, t.cy + 2, 4.6, 0, Math.PI * 2);
    g.strokeStyle = `rgba(168,112,244,${.25 + .3 * pulse})`; g.lineWidth = 1; g.stroke();
    g.restore();
  }
  /**
   * ★★ 「暗枪」的准星（排在**棋子之后**，所以"哪一格埋着枪"不会被立绘挡住）。
   * ⚠️ 与冷枪（`drawSniperCrosshair`）、皇帝（`drawEmperorCrosshair`）同样的两条读法：
   *    线条一律细、脉动只做透明度；两个字带描边，压在任何底色上都读得清。
   * ⚠️ 与那两条的一条**关键区别**：冷枪瞄的是格子（可能没人）、皇帝锁的一定有人，
   *    而暗枪**标的也是格子**、但"谁踩谁挨"——所以「暗枪」两个字**在有人时也要写**，
   *    只是挪到**格子右上角**（有人时皇帝那两个字在左上角，两套错开才读得清是谁的标记）；
   *    没人时写在格子下缘 `t.cy + 44`（冷枪那行在 +26、皇帝在 +35，三行错开）。
   */
  drawDarkgunCrosshair(g, t, time) {
    const pulse = .6 + .4 * Math.sin(time * 3.6);
    g.save();
    hexPath(g, t.cx, t.cy, R - 2);
    g.strokeStyle = `rgba(168,112,244,${.42 + .45 * pulse})`;
    g.lineWidth = 1.6 + pulse;
    g.setLineDash([4, 7]);
    g.lineDashOffset = -((time * 11) % 11);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = `rgba(206,170,255,${.4 + .45 * pulse})`;
    g.lineWidth = 1.6;
    for (const [x0, y0, x1, y1] of [[t.cx, t.cy - R + 4, t.cx, t.cy - R + 13], [t.cx, t.cy + R - 15, t.cx, t.cy + R - 6],
      [t.cx - R + 12, t.cy + 6, t.cx - R + 21, t.cy + 6], [t.cx + R - 21, t.cy + 6, t.cx + R - 12, t.cy + 6]]) {
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    g.restore();
    const occupied = this.game.s.units.some(u => u.row === t.row && u.col === t.col);
    g.save();
    g.font = `bold ${TILE_TEXT.smallFont}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 2.6; g.strokeStyle = 'rgba(10,6,12,.8)';
    const x = occupied ? t.cx + R - 11 : t.cx, y = occupied ? t.cy - R + 12 : t.cy + 44;
    // ⚠️ 这两个字与 `drawSniperCrosshair`／`drawEmperorCrosshair` 一样**直接写死**：
    //    render.js 只从 game.js 取 `slotName`，不引 SKILLS（那两份也不引）。
    g.strokeText('暗枪', x, y);
    g.fillStyle = `rgba(206,162,255,${.7 + .3 * pulse})`;
    g.fillText('暗枪', x, y);
    g.restore();
  }
  drawFire(g, t, side, time) {
    g.save(); hexPath(g, t.cx, t.cy, R - 4); g.clip();
    g.fillStyle = '#cf613829'; g.fill();
    for (let i = -1; i <= 1; i++) {
      const x = t.cx + i * 10, y = t.cy + 12;
      const rise = 20 + Math.sin(time * 4 + i * 2) * 3;
      g.beginPath(); g.moveTo(x - 6, y); g.quadraticCurveTo(x - 9, y - 8, x + 2, y - rise);
      g.quadraticCurveTo(x + 1, y - 10, x + 8, y - 5); g.quadraticCurveTo(x + 7, y + 2, x - 6, y);
      g.fillStyle = i === 0 ? '#ffb768' : '#e68652'; g.fill();
    }
    g.restore(); hexPath(g, t.cx, t.cy, R - 3);
    g.strokeStyle = this.palette[side]; g.lineWidth = 1.4; g.stroke();
    g.fillStyle = this.palette[side]; g.font = `bold ${TILE_TEXT.smallFont}px sans-serif`; g.textAlign = 'center'; g.fillText(side.toUpperCase(), t.cx, t.cy + 26);
  }
  /** 柱子／船体要害。**两者长得完全不同**：绿宝石柱是水晶，船体要害是钢块。
   *  ⚠️ 船体要害如果沿用柱子的画法，玩家会以为那是"绿宝石柱"（花京院的技能产物），
   *     完全读不出"这是船的部件、能拆"。所以这里单独画：钢色块 + 铆钉 + 接缝 + 名字。 */
  drawPillar(g, t, p) {
    const col = this.palette[p.side];
    g.save(); hexPath(g, t.cx, t.cy, R - 1); g.clip(); g.fillStyle = '#08091588'; g.beginPath(); g.ellipse(t.cx - 4, t.cy + 17, 16, 6, 0, 0, Math.PI * 2); g.fill();
    if (p.part) {
      // —— 船体要害：优先用美术图（锅炉／承重柱／绞盘／阀门），找不到图才退回代码画的钢块 ——
      const spriteKey = p.partKey || null;
      const img = spriteKey ? this.sprites.get(spriteKey) : null;
      if (img) {
        const size = terrainSizes[spriteKey] || 52;
        g.drawImage(img, t.cx - size / 2, t.cy - 6 - size / 2, size, size);
      } else {
        const block = () => {
          g.beginPath();
          g.moveTo(t.cx, t.cy - 25); g.lineTo(t.cx + 15, t.cy - 8); g.lineTo(t.cx + 11, t.cy + 16);
          g.lineTo(t.cx, t.cy + 22); g.lineTo(t.cx - 11, t.cy + 16); g.lineTo(t.cx - 15, t.cy - 8);
          g.closePath();
        };
        block(); g.fillStyle = '#5b636e'; g.fill();
        g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
        // 受光面 + 铆钉 + 接缝，做出"一块厚钢板"的感觉
        g.beginPath(); g.moveTo(t.cx, t.cy - 22); g.lineTo(t.cx + 8, t.cy - 6); g.lineTo(t.cx + 5, t.cy + 14); g.lineTo(t.cx, t.cy + 18); g.closePath();
        g.fillStyle = '#8e97a3'; g.fill();
        g.fillStyle = '#3c434c';
        for (const [rx, ry] of [[-8, -6], [8, -6], [-6, 10], [6, 10]]) {
          g.beginPath(); g.arc(t.cx + rx, t.cy + ry, 1.7, 0, Math.PI * 2); g.fill();
        }
        g.beginPath(); g.moveTo(t.cx - 7, t.cy + 1); g.lineTo(t.cx + 7, t.cy + 1);
        g.strokeStyle = '#39404a'; g.lineWidth = 1.6; g.stroke();
      }
      // 拆坏之后：不管有没有图，都在上面盖一道裂纹（受损一眼看得出）
      if (p.hp < p.maxHp * .6) {
        g.beginPath(); g.moveTo(t.cx - 11, t.cy - 3); g.lineTo(t.cx + 3, t.cy - 6); g.lineTo(t.cx - 2, t.cy + 9);
        g.strokeStyle = '#d9dee6'; g.lineWidth = 1.4; g.stroke();
      }
    } else {
      g.beginPath(); g.moveTo(t.cx, t.cy - 24); g.lineTo(t.cx + 13, t.cy - 7); g.lineTo(t.cx + 9, t.cy + 15); g.lineTo(t.cx, t.cy + 21); g.lineTo(t.cx - 9, t.cy + 15); g.lineTo(t.cx - 13, t.cy - 7); g.closePath();
      g.fillStyle = '#5caf97'; g.fill(); g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.moveTo(t.cx, t.cy - 22); g.lineTo(t.cx + 8, t.cy - 6); g.lineTo(t.cx + 5, t.cy + 14); g.lineTo(t.cx, t.cy + 18); g.closePath(); g.fillStyle = '#c5ecc4'; g.fill();
      if (p.hp < p.maxHp * .6) { g.beginPath(); g.moveTo(t.cx - 10, t.cy); g.lineTo(t.cx + 2, t.cy - 3); g.lineTo(t.cx - 1, t.cy + 8); g.strokeStyle = ink; g.lineWidth = 1.3; g.stroke(); }
    }
    // 名字底衬 + 血条：跟着棋子的那套度量走（`TILE_TEXT`），放大后两者在屏幕上仍然一样大
    g.fillStyle = ink;
    g.fillRect(t.cx - TILE_TEXT.plateTopHalf + 3, t.cy + TILE_TEXT.plateTop,
      (TILE_TEXT.plateTopHalf - 3) * 2, TILE_TEXT.plateBot - TILE_TEXT.plateTop);
    g.fillStyle = '#474154';
    g.fillRect(t.cx - TILE_TEXT.barW / 2, t.cy + TILE_TEXT.barY, TILE_TEXT.barW, TILE_TEXT.barH);
    g.fillStyle = col;
    g.fillRect(t.cx - TILE_TEXT.barW / 2, t.cy + TILE_TEXT.barY, TILE_TEXT.barW * p.hp / p.maxHp, TILE_TEXT.barH);
    g.restore();
    // 船体要害那条牌子直接写**部件名**（"锅炉"/"承重柱"）——它是这一关唯一要打的目标，
    // 名字比"P2 · 柱"有用得多；绿宝石柱仍然写阵营与用途。
    // ⚠️ 与棋子名字同一套写法：**裁剪之外 + 深色描边**（见 `drawTileTag` 与 `TILE_TEXT` 的说明）。
    drawTileTag(g, t, p.part ? p.name : `${p.side.toUpperCase()} · 柱`, col);
  }
  drawEffect(g, e, now) {
    const p = Math.max(0, Math.min(1, (now - e.start) / e.duration)), t = e.tile;
    if (!t) return;
    g.save();
    if (e.type === 'hit' && p < .2 && !this.reducedMotion) {
      hexPath(g, t.cx, t.cy, R - 2); g.fillStyle = `rgba(244,224,198,${.35 * (1 - p / .2)})`; g.fill();
    }
    if (e.type === 'skill' || e.type === 'place') {
      if (!this.reducedMotion) {
        g.globalAlpha = (1 - p) * .6; g.strokeStyle = e.skill === 'time' ? '#e8ce85' : '#ccb4e7'; g.lineWidth = 2;
        g.beginPath(); g.arc(t.cx, t.cy, 12 + p * 33, 0, Math.PI * 2); g.stroke();
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(t.cx + Math.cos(a) * 28, t.cy + Math.sin(a) * 28); g.lineTo(t.cx + Math.cos(a) * (33 + p * 17), t.cy + Math.sin(a) * (33 + p * 17)); g.stroke(); }
      }
    } else {
      const y = t.cy - 25 - (this.reducedMotion ? 0 : p * 24);
      g.globalAlpha = p > .65 ? (1 - p) / .35 : 1;
      g.font = 'bold 23px "Smiley Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const label = `${e.type === 'heal' ? '+' : '−'}${e.amount}`;
      g.strokeStyle = ink; g.lineWidth = 4; g.strokeText(label, t.cx, y);
      g.fillStyle = e.type === 'heal' ? '#bfedbb' : '#ffe0bb'; g.fillText(label, t.cx, y);
    }
    g.restore();
  }
  rgba(color, a) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
}
