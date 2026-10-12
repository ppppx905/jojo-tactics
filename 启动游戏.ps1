# JOJO 星尘战棋 · 一键启动
# 作用：先看你需要的本地服务器是否已在运行；没有再起一个，然后打开浏览器。
# 关闭这个黑色窗口 = 关闭游戏服务器。
# 注意：本文件必须保存为「UTF-8 带 BOM」。若用编辑器另存为无 BOM，Windows PowerShell 会把中文读成乱码并报语法错误。

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
# 端口换成 8799：浏览器是按「网址」记缓存的，换端口等于全新网址，
# 之前版本留在浏览器里的旧页面/旧代码一条都用不上，打开必定是最新版。
$port = 8799
$url  = "http://127.0.0.1:$port/"

Set-Location $root
$Host.UI.RawUI.WindowTitle = 'JOJO 星尘战棋 · 本地服务器（关掉本窗口即关闭游戏）'

Write-Host ''
Write-Host '  JOJO 星尘战棋' -ForegroundColor Yellow
Write-Host "  游戏目录：$root"
Write-Host ''

# 1) 服务器已经在跑吗？
$already = $false
try {
  $r = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing
  if ($r.StatusCode -eq 200) { $already = $true }
} catch { }

# 2) 打开浏览器（浏览器启动要一两秒，服务器会在这之前就绪）
Write-Host "  正在打开浏览器：$url" -ForegroundColor Cyan
Start-Process $url

if ($already) {
  Write-Host '  服务器本来就在运行，这个窗口 5 秒后自动关闭。' -ForegroundColor Green
  Write-Host ''
  Start-Sleep -Seconds 5
  exit
}

# 3) 起服务器（本窗口会一直开着）
Write-Host '  服务器启动中……游戏页面稍等 1~2 秒会自己加载。' -ForegroundColor Green
Write-Host '  ────────────────────────────────────────────'
Write-Host '  玩完之后：直接关掉这个窗口就行。' -ForegroundColor Gray
Write-Host ''

$node = Get-Command node -ErrorAction SilentlyContinue
$serveScript = Join-Path $root 'tools/serve.mjs'

if ($node -and (Test-Path $serveScript)) {
  # 首选 Node 服务器：它对每个响应都写明「不许缓存」，
  # 所以改完代码再打开（或刷新）一定是最新版，不会像 Python 那样拿到缓存里的旧文件。
  Write-Host '  使用 Node 服务器（已关闭浏览器缓存，永远加载最新版）' -ForegroundColor Green
  & $node.Source $serveScript $port
} else {
  $py = $null
  foreach ($c in @('py', 'python', 'python3')) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if ($cmd) { $py = @($cmd.Source); break }
  }
  if (-not $py) {
    Write-Host '  没找到 Node，也没找到 Python，无法启动服务器。' -ForegroundColor Red
    Read-Host '  按回车关闭'
    exit 1
  }
  Write-Host '  没找到 Node，改用 Python 自带的服务器。' -ForegroundColor Yellow
  Write-Host '  它不带缓存控制：打开游戏后如果看到旧版，请按 Ctrl+F5 强制刷新。' -ForegroundColor Yellow
  if ($py[0] -like '*py.exe') {
    & $py[0] -3.13 -m http.server $port --bind 127.0.0.1
  } else {
    & $py[0] -m http.server $port --bind 127.0.0.1
  }
}

Write-Host ''
Write-Host '  服务器已停止。' -ForegroundColor Yellow
Read-Host '  按回车关闭窗口'
