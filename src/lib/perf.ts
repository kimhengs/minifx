// Tiny in-app profiler: startup time, render time, scrub latency, fps.
const t0 = performance.timeOrigin;

export const perf = {
  marks: new Map<string, number>(),
  renderMs: 0,
  scrubLatencyMs: 0,
  fps: 0,
  mark(name: string): void {
    this.marks.set(name, performance.now());
  },
  startupMs(): number {
    const ready = this.marks.get("ready");
    return ready ? Math.round(ready) : 0;
  },
  origin(): number {
    return t0;
  },
};
