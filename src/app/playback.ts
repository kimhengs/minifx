import { activeComp, useProject } from "../store/projectStore";
import { useUi } from "../store/uiStore";

let raf = 0;
let last = 0;
let rate = 1;
let head = 0;

function tick(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  const s = useProject.getState();
  const comp = activeComp(s.project);
  if (!comp) return stop();
  const [a, b] = comp.workArea;
  head += dt * rate;
  if (rate > 0 && head >= b) {
    if (useUi.getState().loop) head = a;
    else {
      head = b - 1 / comp.fps;
      s.setTime(head);
      return stop();
    }
  }
  if (rate < 0 && head <= a) {
    if (useUi.getState().loop) head = b - 1 / comp.fps;
    else {
      head = a;
      s.setTime(head);
      return stop();
    }
  }
  s.setTime(head);
  raf = requestAnimationFrame(tick);
}

export function play(r = 1): void {
  const s = useProject.getState();
  const comp = activeComp(s.project);
  if (!comp) return;
  rate = r;
  head = s.currentTime;
  const [a, b] = comp.workArea;
  if (head < a || head >= b - 1 / comp.fps) head = r > 0 ? a : b - 1 / comp.fps;
  last = performance.now();
  cancelAnimationFrame(raf);
  useUi.getState().set({ playing: true });
  raf = requestAnimationFrame(tick);
}

export function stop(): void {
  cancelAnimationFrame(raf);
  raf = 0;
  rate = 1;
  if (useUi.getState().playing) useUi.getState().set({ playing: false });
}

export function togglePlay(): void {
  if (useUi.getState().playing) stop();
  else play(1);
}

/** J / K / L shuttle: repeated presses double the speed, up to 8x. */
export function shuttle(dir: -1 | 0 | 1): void {
  if (dir === 0) return stop();
  const playing = useUi.getState().playing;
  if (playing && Math.sign(rate) === dir) {
    rate = Math.max(-8, Math.min(8, rate * 2));
    return;
  }
  play(dir);
}

export function stepFrames(n: number): void {
  stop();
  const s = useProject.getState();
  const comp = activeComp(s.project);
  if (!comp) return;
  s.setTime(s.currentTime + n / comp.fps);
}

export function currentRate(): number {
  return useUi.getState().playing ? rate : 0;
}
