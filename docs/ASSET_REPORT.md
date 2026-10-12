# 本轮美术素材记录

生成模型为 **gpt-image-2**，生成尺寸均为 **1536×1024**，质量 **high**。UI/SVG 图标、地砖、高亮、文字、速度线与反馈动画由代码实现。

| 素材 | 原图／编辑结果 | 最终运行时文件 | 完整提示词 |
|---|---|---|---|
| 八个棋盘立姿 | `assets/src/standees-v3.png`，后做纯蓝背景修正 `assets/src/standees-v3-blue.png` | `assets/out/standees/{jotaro,star_platinum,dio,the_world,kakyoin,hierophant,avdol,magicians_red}.webp`，每张 192×288，透明背景 | [生成提示词](prompts/standees.txt)、[最终背景编辑提示词](prompts/standees-background.txt) |
| 四个技能插画 | `assets/src/cutins-v1.png` | `assets/out/cutins/{jotaro,dio,kakyoin,avdol}.webp`，去边裁切约 762×506 | [完整提示词](prompts/cutins.txt) |
| 四个角色肖像 | 沿用项目已有 `assets/src/portraits-v2.png` | `assets/out/portraits/{jotaro,dio,kakyoin,avdol}.webp`，768×512 | 本轮未重新生成 |
| 波鲁纳雷夫立姿（新增，第五名角色） | 单人生成 `assets/src/polnareff-v1.png`（1024×1536, high），再以承太郎立绘为风格参考做两次对齐：`polnareff-v2.png`（风格）、`polnareff-v3.png`（比例，最终采用） | `assets/out/standees/polnareff.webp`，192×288，透明背景 | [生成提示词](prompts/standees-polnareff.txt)、[风格对齐](prompts/standees-polnareff-style.txt)、[比例修正](prompts/standees-polnareff-v3.txt) |
| 波鲁纳雷夫肖像（新增，第五名角色） | 生成 `assets/src/portraits-polnareff-v1.png`（1536×1024, high） | `assets/out/portraits/polnareff.webp`，768×512（母版的 1/2 缩图），不透明、深紫底 | [完整提示词](prompts/portraits-polnareff.txt) |
| 银色战车立姿（新增，波鲁纳雷夫的替身） | 以 `assets/out/standees/star_platinum.webp` 为画风参考生成 `assets/src/silver-chariot-v1.png`，该次输出为白底，故追加一次纯蓝背景修正得到 `assets/src/silver-chariot-v2.png`（最终采用） | `assets/out/standees/silver_chariot.webp`，192×288，透明背景 | [完整提示词](prompts/standees-silver_chariot.txt) |
| 波鲁纳雷夫技能插画（新增） | 单幅生成 `assets/src/cutins-polnareff-v1.png`（1536×1024） | `assets/out/cutins/polnareff.webp`，762×506，与既有四张同规格 | [完整提示词](prompts/cutins-polnareff.txt) |
| 乔瑟夫立姿（新增，第六名角色 · **单单位：只有本体**） | 以 `assets/out/standees/jotaro.webp` 为画风参考生成 `assets/src/joseph-v1.png`，该次输出为白底，故追加一次纯蓝背景修正得到 `assets/src/joseph-v2.png`（最终采用） | `assets/out/standees/joseph.webp`，192×288，透明背景；**没有替身立绘**（`CHARACTER_ART.joseph.stand = null`） | [完整提示词](prompts/standees-joseph.txt) |
| 乔瑟夫肖像（新增） | 生成 `assets/src/portraits-joseph-v1.png`（1536×1024，以承太郎肖像为参考） | `assets/out/portraits/joseph.webp`，768×512 | [完整提示词](prompts/portraits-joseph.txt) |
| 乔瑟夫技能插画（新增，波纹疾走） | 单幅生成 `assets/src/cutins-joseph-v1.png`（1536×1024） | `assets/out/cutins/joseph.webp`，762×506 | [完整提示词](prompts/cutins-joseph.txt) |

对比预览页：`design/review/portraits-preview.html`（新肖像与既有四张并排）。

处理脚本：`node tools/prepare_standee.mjs <原图> <输出.webp>`（纯蓝底抠图 → 裁边 → 贴底居中缩放）、`node tools/prepare_cutin.mjs <原图> <输出.webp>`（3:2 插画 → 762×506 WebP，规格与 `tools/prepare_art.py` 切出的四张一致）。

**波鲁纳雷夫已接入玩法**：`FIGHTERS.polnareff` 数值、`mastery`／`armor`／`blade` 三个技能、`CHARACTER_ART` 登记与选人界面席位都已就位，回归测试见 `tests/polnareff.test.js`。棋子立绘与替身立绘、肖像、技能插画四类素材齐全，不再有占位图形。

八人立姿初次输出没有遵守纯色背景要求，因此只做了一次背景编辑，保留主体与四列两行布局，再用蓝幕切图去底。透明边缘及人物身份已在 [contact sheet](../assets/out/standees/contact.png) 检查。生成的四格插画没有 UI 字样，切掉分格边缘后由程序单独调用。

复现裁切：

```sh
python3 tools/prepare_art.py
```

实际生成请求的最终完整文本保存在上表链接的 UTF-8 文件中。原图不覆盖，运行时只下载处理后的 WebP 与已有小型地形 PNG；无需下载大尺寸源图。
