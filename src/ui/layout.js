import { CANVAS_W, CANVAS_H } from '../core/hex.js';

/** Fit the actual grid cell, never guessed viewport chrome or fixed side widths. */
export function watchBoardScale(onChange) {
  const well = document.getElementById('boardWell');
  const canvas = document.getElementById('board');
  let last = '', frame = 0;
  const run = () => {
    frame = 0;
    if (!well.clientWidth) return;
    const compact = window.matchMedia('(max-width: 1100px)').matches;
    const width = compact ? Math.max(580, well.clientWidth) : well.clientWidth;
    const scale = compact ? width / CANVAS_W : Math.min(width / CANVAS_W, well.clientHeight / CANVAS_H);
    if (!(scale > 0)) return;
    const key = `${scale.toFixed(5)}|${window.devicePixelRatio}`;
    if (last === key) return;
    last = key;
    canvas.style.width = `${CANVAS_W * scale}px`;
    canvas.style.height = `${CANVAS_H * scale}px`;
    canvas.dataset.scale = scale.toFixed(6);
    onChange?.(scale);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(run); };
  const observer = new ResizeObserver(schedule);
  observer.observe(well);
  window.addEventListener('resize', schedule);
  run();
  return { refresh: schedule, dispose() { observer.disconnect(); window.removeEventListener('resize', schedule); cancelAnimationFrame(frame); } };
}
