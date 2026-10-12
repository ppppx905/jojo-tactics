// Small editable SVG primitives. UI symbols never require raster downloads.
const paths = {
  move: '<path d="m4 7 5-4 5 4M9 3v13m-5-4 5 5 5-5"/><path d="m16 6 4 4-4 4"/>',
  attack: '<path d="m4 3 12 12m1 3 3 3M3 4l2 5 9 9 4-4-9-9ZM4 20l4-4m7-9 5-4-3 6m-4 8 4-4"/>',
  ora: '<path d="M5 12V8a2 2 0 0 1 4 0V5a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v5l-5 7H9l-6-7a2 2 0 0 1 2-2ZM9 8v5m4-6v6m4-4v5"/>',
  star: '<path d="m12 2 2.7 6.4L22 9l-5.5 4.8 1.7 7.2-6.2-3.8L5.8 21l1.7-7.2L2 9l7.3-.6Z"/>',
  time: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3M9 1h6m-3 20v2M1 12h2m18 0h2"/>',
  drain: '<path d="M12 2c-1 5-7 8-7 13a7 7 0 0 0 14 0c0-5-6-8-7-13ZM9 17c0 1 1 2 3 2"/>',
  // 飞刀（DIO 的投掷技）：一把短刃 + 两道速度线。
  // ⚠️ 没有图标时 icon() 会退回星形，会和「流星指刺」撞脸，所以新技能都该补一个。
  knife: '<path d="M14 3 5 12l-2 6 6-2 9-9Z"/><path d="m12 5 4 4M2 21l3-3"/><path d="M18 2h4M19 5h3M21 8h2"/>',
  vamp: '<path d="M3 4v10l5-3 4 9 4-9 5 3V4l-5 3-4-3-4 3Z"/><path d="m8 10 2 2m6-2-2 2"/>',
  burn: '<path d="M12 2c2 7 8 8 8 13a8 8 0 0 1-16 0c0-3 2-5 4-7v6c3-2 5-6 4-12ZM12 14c-5 4-3 7 0 7s5-3 0-7Z"/>',
  flame: '<path d="M3 20h18M5 17c-5-5 2-6 1-11 7 5 2 7 4 11m4 0c-5-7 3-9 2-15 9 7 2 9 4 15"/>',
  blaze: '<path d="M12 3c2 5 7 7 7 12a7 7 0 0 1-14 0c0-3 2-5 4-7v5c3-2 3-6 3-10Z"/><path d="M2 2l20 20m-12-5h4m-2-2v4"/>',
  emerald: '<path d="m12 2 8 7-8 13L4 9Zm0 0L8 9l4 13 4-13ZM4 9h16"/>',
  trauma: '<path d="m8 2 3 6-5 3 5 3-4 8m9-20 2 7-4 4 5 3-3 6M3 4l2 2m14 12 2 2"/>',
  splash: '<path d="m12 2 4 6-4 6-4-6ZM5 13l3 4-3 5-3-5Zm14-1 3 4-3 5-3-5Z"/>',
  mastery: '<path d="M12 2 8 10v4h8v-4Z"/><path d="M6 14h12M12 14v8M9 22h6"/><path d="M21 3v4m-2-2h4"/>',
  armor: '<path d="m12 2 9 4v6c0 5-6 9-9 10-3-1-9-5-9-10V6Z"/><path d="M12 6v6m-3-3 3 3 3-3"/>',
  blade: '<path d="M12 2 8 10v4h8v-4Z"/><path d="M6 14h12M12 14v8M9 22h6"/><path d="M2 7h3M1 12h3M2 17h3"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3M8 4l8-2"/>',
  stand: '<path d="m12 2 9 6v8l-9 6-9-6V8Zm-4 9 4 3 4-3m-4 3v5"/>',
  shield: '<path d="m12 2 9 4v6c0 5-6 9-9 10-3-1-9-5-9-10V6Zm-4 10 3 3 5-6"/>',
  heart: '<path d="M12 21 3 12C-2 5 7-1 12 6 17-1 26 5 21 12Z"/>',
  link: '<path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-2 2" transform="translate(2 0) scale(.84 1)"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5m0 4h.01"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2Z"/><path d="M20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2Z"/><path d="M11 3v18"/>',
  vine: '<path d="M12 22c0-5 4-6 4-10a4 4 0 0 0-8 0c0 4 4 5 4 10Z"/><path d="M8 8C5 8 4 10 4 12m12-4c3 0 4 2 4 4"/>',
  hamon: '<path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/><circle cx="12" cy="12" r="3.4"/>',
  nextline: '<path d="M4 5h16v10H9l-5 4Z"/><path d="M8 9h8M8 12h5"/>',
  settings: '<path d="M4 4v16m8-16v16m8-16v16M1 8h6m2 8h6m2-9h6"/>',
  sound: '<path d="m11 4-6 5H2v6h3l6 5Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="m11 4-6 5H2v6h3l6 5Zm5 5 6 6m0-6-6 6"/>',
  close: '<path d="m5 5 14 14M5 19 19 5"/>',
  chevron: '<path d="m8 4 8 8-8 8"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  log: '<path d="M5 2h12l3 3v17H5Zm4 5h5m-5 5h7m-7 5h7"/>',
  flag: '<path d="M5 22V3m0 1c5-5 9 5 15 0v10c-6 5-10-5-15 0"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v5m0 12v5M1 12h5m12 0h5"/>',
  check: '<path d="m4 12 5 6L21 5"/>',
  undo: '<path d="m8 4-6 6 6 6M2 10h12a7 7 0 0 1 7 7v3"/>',
  alert: '<path d="m12 2 10 19H2Zm0 6v5m0 4h.01"/>',
  // 霍尔·霍斯的两个技能（2026-10-03 用户拍板新增）：
  // ⚠️ 没有条目时 icon() 会退回星形——那样「瞄准」会和「流星指刺」撞脸、两个新技能还会互相撞，
  //    所以照 icons 的规矩：新技能都要补一个自己的图标。
  aim: '<circle cx="12" cy="12" r="8.4"/><path d="M12 1.6v4.2M12 18.2v4.2M1.6 12h4.2M18.2 12h4.2"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  emperor: '<path d="M3 8h13.5l4.5 2-4.5 2.2H12"/><circle cx="8.6" cy="14.2" r="3.3"/><path d="M7 17.1 4.6 22h4.3l1.9-4.3"/><path d="M20 5.4h1.6M20.4 2.8l1.4-.8"/>',
  // ★★ 暗枪（2026-10-05 用户拍板新增的第三个技能）：
  //   ⚠️ 没有条目时 icon() 会退回星形（`paths.star`）——那样它会和「流星指刺」撞脸，
  //      所以照 icons 的规矩补一个自己的：一支**短枪口 + 两点落位**（"埋两个位置"的意思）。
  darkgun: '<path d="M2.6 6.2h9.4l3.5 1.7-3.5 1.7H7.6"/><path d="M6.4 9.6 4.5 14h3.6l1.4-3.2"/><circle cx="16.4" cy="17.4" r="1.3" fill="currentColor" stroke="none"/><circle cx="20.8" cy="21" r="1.3" fill="currentColor" stroke="none"/><path d="M14.5 15.2l2.2 2.2M18.9 18.8l2.2 2.2"/>',
};
export function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.star}</svg>`;
}
