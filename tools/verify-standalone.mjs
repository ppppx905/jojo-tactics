// 单文件版验证：① 静态核对 import/export 名称匹配 ② 用假 DOM 真跑一遍打包结果
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const norm = p => p.split('\\').join('/');
const OUT = join(ROOT, 'jojo战棋-单文件版.html');
const html = readFileSync(OUT, 'utf8');
const bundle = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];

/* ================= ① 静态核对 ================= */
// 自动扫描 src 下全部模块（不再手写清单：新增模块时不会漏检）
const collectModules = dir => readdirSync(join(ROOT, dir), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory()
    ? collectModules(join(dir, entry.name))
    : (entry.name.endsWith('.js') ? [join(dir, entry.name).replace(/\\/g, '/')] : []));
const files = collectModules('src').sort();
const exportsOf = {};
for (const f of files) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(n => names.add(n.replace(/\s+as\s+.*$/, '').trim()));
  for (const m of src.matchAll(/^\s*export\s+(?:async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  exportsOf[f] = names;
}
let problems = 0;
for (const f of files) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/^\s*import\s+\{([^}]*)\}\s+from\s+'([^']+)'/gm)) {
    const dep = norm(relative(ROOT, resolve(dirname(join(ROOT, f)), m[2])));
    for (const raw of m[1].split(',')) {
      const n = raw.trim().replace(/\s+as\s+.*$/, '').trim();
      if (!n) continue;
      if (!exportsOf[dep] || !exportsOf[dep].has(n)) { console.log(`❌ ${f} 引用了 ${dep} 的 ${n}，但那边没有导出`); problems++; }
    }
  }
}
console.log(`① 静态核对：${problems === 0 ? '全部匹配 ✓' : problems + ' 处问题'}`);
console.log(`   各模块导出数量：${files.map(f => f.split('/').pop().replace('.js', '') + '=' + exportsOf[f].size).join(' ')}`);

/* ================= ② 假 DOM 真跑 ================= */
let booted = false, err = null, log = [];
const asyncErrors = [];
process.on('unhandledRejection', r => asyncErrors.push('未处理的 Promise 拒绝: ' + (r && r.message ? r.message : r)));
process.on('uncaughtException', e => asyncErrors.push('未捕获异常: ' + e.message));
const noop = () => {};
function stubEl(tag = 'div') {
  const el = { tagName: tag.toUpperCase(), style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    children: [], childNodes: [], textContent: '', innerHTML: '', value: '', checked: false, disabled: false, hidden: false,
    appendChild(c) { this.children.push(c); return c; }, append: noop, prepend: noop, removeChild: noop, remove: noop, replaceWith: noop, replaceChildren: noop,
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop, toggleAttribute: noop,
    addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0 }),
    focus: noop, blur: noop, scrollIntoView: noop, animate: () => ({ finished: Promise.resolve(), cancel: noop }),
    insertAdjacentHTML: noop, insertBefore: noop, cloneNode() { return stubEl(tag); },
    offsetWidth: 100, offsetHeight: 100, clientWidth: 100, clientHeight: 100,
    getContext: () => ctxStub(), width: 1200, height: 700,
    play: () => Promise.resolve(), pause: noop,
  };
  el.parentElement = null; el.parentNode = null; el.firstChild = null; el.lastChild = null; el.nextSibling = null;
  return el;
}
function ctxStub() {
  const c = { canvas: { width: 1200, height: 700 } };
  return new Proxy(c, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'createPattern' || p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
      if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      if (p === 'putImageData') return noop;
      return noop;
    }, set() { return true; },
  });
}
const document = {
  getElementById: id => (document.__els[id] ||= stubEl('div')),
  querySelector: sel => (document.__q[sel] ||= stubEl('div')),
  querySelectorAll: sel => (document.__qAll[sel] ||= [stubEl('div'), stubEl('div')]),
  createElement: t => stubEl(t), createElementNS: (_, t) => stubEl(t),
  createDocumentFragment: () => stubEl('fragment'),
  addEventListener: noop, removeEventListener: noop,
  body: stubEl('body'), documentElement: stubEl('html'), head: stubEl('head'),
  fonts: { ready: Promise.resolve(), load: () => Promise.resolve([]), add: noop },
  hidden: false, visibilityState: 'visible', __els: {}, __q: {}, __qAll: {},
};
const raf = cb => { /* 不真正循环动画，只记录 */ return 1; };
const sandbox = {
  document, console, Math, JSON, Date, performance: { now: () => 0 },
  setTimeout: (f) => { try { f(); } catch (e) { err = e; } return 0; }, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
  requestAnimationFrame: raf, cancelAnimationFrame: noop,
  addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop }),
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  AudioContext: class { constructor() { this.state = 'running'; this.destination = {}; this.currentTime = 0; } createOscillator() { return { connect: noop, start: noop, stop: noop, frequency: { setValueAtTime: noop, exponentialRampToValueAtTime: noop }, type: '' }; } createGain() { return { connect: noop, gain: { setValueAtTime: noop, exponentialRampToValueAtTime: noop, linearRampToValueAtTime: noop, value: 0 } }; } createBiquadFilter() { return { connect: noop, frequency: { setValueAtTime: noop }, Q: { setValueAtTime: noop }, type: '' }; } createBuffer() { return { getChannelData: () => new Float32Array(8) }; } createBufferSource() { return { connect: noop, start: noop, buffer: null }; } resume() { return Promise.resolve(); } close() { return Promise.resolve(); } },
  Image: class { constructor() { this.width = 100; this.height = 100; this.naturalWidth = 100; this.naturalHeight = 100; this.complete = true; }
    set src(v) { this._src = v; if (this.onload) this.onload(); } get src() { return this._src; }
    addEventListener(t, f) { if (t === 'load') this.onload = f; } },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: noop },
  OffscreenCanvas: class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return ctxStub(); } },
  navigator: { userAgent: 'node', language: 'zh-CN', onLine: true, clipboard: { writeText: () => Promise.resolve() } },
  location: { href: 'file:///D:/test/jojo战棋-单文件版.html', protocol: 'file:', search: '', reload: noop },
  requestIdleCallback: cb => { cb({ timeRemaining: () => 10 }); return 1; },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
// 把 Node 自带的标准全局补进假 DOM（它们和浏览器同名同义）
for (const k of ['URLSearchParams', 'URL', 'TextEncoder', 'TextDecoder', 'structuredClone', 'queueMicrotask',
  'AbortController', 'AbortSignal', 'Blob', 'btoa', 'atob', 'crypto', 'Event', 'CustomEvent', 'EventTarget',
  'MessageChannel', 'MessagePort', 'fetch', 'Headers', 'Request', 'Response', 'FormData', 'performance']) {
  if (globalThis[k] !== undefined && sandbox[k] === undefined) sandbox[k] = globalThis[k];
}
sandbox.screen = { width: 1440, height: 900, availWidth: 1440, availHeight: 860 };
sandbox.history = { pushState: noop, replaceState: noop, back: noop, forward: noop, state: null };
sandbox.CSS = { escape: s => String(s).replace(/[^\w-]/g, c => '\\' + c), supports: () => true };
sandbox.customElements = { define: noop, get: () => undefined, whenDefined: () => Promise.resolve() };
sandbox.HTMLElement = class HTMLElement {}; sandbox.Element = class Element {}; sandbox.Node = class Node {};
sandbox.KeyboardEvent = class KeyboardEvent { constructor(t, o = {}) { Object.assign(this, o); this.type = t; } };
sandbox.MouseEvent = sandbox.PointerEvent = sandbox.KeyboardEvent;
sandbox.alert = noop; sandbox.confirm = () => true; sandbox.prompt = () => null;
sandbox.scrollTo = noop; sandbox.getSelection = () => ({ removeAllRanges: noop, addRange: noop, toString: () => '' });
sandbox.Notification = class { static requestPermission() { return Promise.resolve('denied'); } };
vm.createContext(sandbox);
try { vm.runInContext(bundle, sandbox, { filename: 'bundle.js' }); }
catch (e) { err = e; }

// 等异步初始化（字体、图片、boot() 是 async）跑完再看结果
await new Promise(r => setTimeout(r, 300));

console.log(`② 假 DOM 运行：${err || asyncErrors.length ? '❌ 报错' : '✓ 无异常'}`);
if (err) { console.log('   同步错误：' + err.message); console.log('   位置：' + String(err.stack || '').split('\n')[1]); }
asyncErrors.forEach(e => console.log('   异步错误：' + e));
const ready = sandbox.__jojoReady === true;
console.log(`   window.__jojoReady = ${ready}  ${ready ? '（游戏初始化完成 ✓）' : '（初始化未完成——可能只是假 DOM 不够真，也可能是真问题）'}`);

// 角色名单是否包含新角色（选人界面的 HTML 由 renderDraft 写进 DOM）
const allHtml = Object.values(document.__els).map(el => el.innerHTML || '').join('\n');
const roster = ['承太郎', 'DIO', '花京院', '阿布德尔', '波鲁纳雷夫', '乔瑟夫', '伊奇'];
const missing = roster.filter(name => !allHtml.includes(name));
console.log(`   选人界面角色：${missing.length ? '缺少 ' + missing.join('、') : roster.join('、') + ' 全部出现 ✓'}`);
console.log(`   结论：${ready && !err && !missing.length ? '单文件版可脱离服务器运行，且新角色已进入选人界面 ✓' : '仍需排查'}`);
process.exit(0);
if (sandbox.__jojoStage) console.log('   阶段：' + sandbox.__jojoStage);
// 报错时把出错那几行源码打出来，方便判断是打包问题还是假 DOM 不够
if (err || asyncErrors.length) {
  const line = Number(String((err && err.stack) || '').match(/bundle\.js:(\d+)/)?.[1] || 0);
  if (line) {
    const lines = bundle.split('\n');
    console.log('   出错位置附近的源码：');
    for (let i = Math.max(0, line - 3); i < Math.min(lines.length, line + 2); i++) console.log(`   ${i + 1}: ${lines[i].trim().slice(0, 150)}`);
  }
}
