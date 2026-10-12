/**
 * JOJO 星尘战棋 · 本地静态服务器（不缓存版）
 *
 * 为什么不用 `python -m http.server`：
 *   它只发送 Last-Modified、不发送 Cache-Control，浏览器会按"启发式缓存"把
 *   src/*.js 这类模块当成还没过期，于是改完代码后打开游戏还是旧版本，
 *   必须手动 Ctrl+F5 才看得到新的。这个服务器对每个响应都写明
 *   `Cache-Control: no-store`，浏览器每次都重新取，永远是最新版。
 *
 * 用法：node tools/serve.mjs [端口=8799] [--lan]
 *   默认只监听 127.0.0.1（本机访问，不对外开放）。
 *   加 --lan 则监听 0.0.0.0，**同一个 Wi-Fi 下的手机/平板就能用**
 *   `http://<电脑的局域网IP>:<端口>/` 打开游戏（首次会弹 Windows 防火墙提示，要选"允许"）。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const port = Number(args.find(arg => /^\d+$/.test(arg)) || 8799);
const lan = args.includes('--lan');
const host = lan ? '0.0.0.0' : '127.0.0.1';
/** 局域网 IPv4 地址（给手机用）：连网卡名字一起返回，好分辨真无线网卡和 VPN 虚拟网卡。 */
const lanAddresses = () => Object.entries(networkInterfaces())
  .flatMap(([name, list]) => (list || []).map(info => ({ name, ...info })))
  .filter(info => info.family === 'IPv4' && !info.internal)
  .map(info => ({ name: info.name, address: info.address }));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  // 音乐文件可能是 m4a/mp4（很多音乐 App 与视频站导出的都是这种容器）
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
};

const noCache = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

// --lan（局域网 / 给别人玩）模式下只放行游戏真正需要的文件：
// 首页、src/（模块与样式）、assets/（图片音乐字体）。
// 其余一律 403 —— 否则同一个网络里的任何人都能读到 design/（提示词与素材源图）、
// tests/、tools/，以及开发交接文档.md 这类内部笔记。
// 本机模式（默认）不受限制，方便自己调试。
const LAN_ALLOW = [/^\/index\.html$/, /^\/src\//, /^\/assets\//];

const server = createServer(async (req, res) => {
  // 浏览器提前断开（切换页面、按 Esc 等）不该让服务器崩掉
  req.on('error', () => {});
  res.on('error', () => {});
  try {
    const url = new URL(req.url, `http://${host}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    if (lan && !LAN_ALLOW.some(pattern => pattern.test(pathname))) throw new Error('forbidden');

    const file = path.resolve(root, `.${pathname}`);
    // 目录穿越防护：只允许访问项目目录内的文件
    if (file !== root && !file.startsWith(root + path.sep)) throw new Error('forbidden');

    const info = await stat(file);
    const target = info.isDirectory() ? path.join(file, 'index.html') : file;
    const body = await readFile(target);

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      ...noCache,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    try {
      res.writeHead(error.code === 'ENOENT' ? 404 : 403, { 'Content-Type': 'text/plain; charset=utf-8', ...noCache });
      res.end(error.code === 'ENOENT' ? '找不到这个文件' : '拒绝访问');
    } catch { /* 连接已经断了，忽略 */ }
  }
});

// 客户端握手异常、单次请求异常都只记录，不让服务器退出
server.on('clientError', (error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});
process.on('uncaughtException', error => {
  console.log('  （已忽略一次请求异常，服务器继续运行：' + error.message + '）');
});
process.on('unhandledRejection', () => {});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.log(`  端口 ${port} 已经有服务器在运行了（可能游戏已经开着）。`);
    console.log(`  本机直接打开：http://127.0.0.1:${port}/`);
    if (lan) {
      const addresses = lanAddresses();
      console.log('  局域网地址（手机用）：');
      for (const { name, address } of addresses) console.log(`    http://${address}:${port}/   [${name}]`);
      console.log('  ⚠️ 认准名字里带 WLAN / Wi-Fi / 无线 的那一条。');
    }
  } else {
    console.log('  服务器启动失败：' + error.message);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.log('');
  console.log('  JOJO 星尘战棋 · 本地服务器（已关闭浏览器缓存）');
  console.log(`  游戏地址：http://127.0.0.1:${port}/`);
  if (lan) {
    const addresses = lanAddresses();
    if (addresses.length) {
      console.log('  ────────────────────────────────────────────');
      console.log('  局域网地址（同一个 Wi-Fi 下的手机 / 平板用这个）：');
      for (const { name, address } of addresses) console.log(`    http://${address}:${port}/   [${name}]`);
      console.log('  ⚠️ 认准名字里带 WLAN / Wi-Fi / 无线 的那一条；');
      console.log('     VPN、Radmin、虚拟网卡的地址手机连不上。');
      console.log('  首次打开会弹 Windows 防火墙提示，选「允许访问」；');
      console.log('  校园网 / 公共 Wi-Fi 常开「客户端隔离」，手机可能连不上电脑，改用手机热点或别的方式。');
      console.log('  🔒 局域网模式只对外开放游戏本体（首页 / src / assets）；');
      console.log('     design、tests、tools 与开发交接文档等一律 403，别人看不到。');
    } else {
      console.log('  （没找到局域网地址，可能没连 Wi-Fi 或只有虚拟网卡）');
    }
  } else {
    console.log('  （只监听本机；要让手机也能玩，加参数 --lan 重启）');
  }
  console.log('  ────────────────────────────────────────────');
  console.log(`  游戏目录：${root}`);
  console.log('  关掉这个窗口 = 关闭游戏服务器。');
  console.log('');
});
