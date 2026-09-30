// Playback clock for the editor preview. The audio context is the master clock while
// playing so picture and voiceover never drift.

export class Player {
  constructor({ renderer, audio, canvas, getTimeline, getDuration }) {
    this.renderer = renderer;
    this.audio = audio;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getTimeline = getTimeline;
    this.getDuration = getDuration;
    this.time = 0;
    this.playing = false;
    this.rate = 1;
    this.loop = false;
    this.range = null; // [a, b] loops inside when set and loop is on
    this.subtitles = false;
    this.listeners = new Set();
    this.raf = 0;
    this.lastInfo = null;
    this._frame = this._frame.bind(this);
  }

  onTime(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  render() {
    this.lastInfo = this.renderer.renderTo(this.ctx, this.time, { subtitles: this.subtitles });
    for (const fn of this.listeners) fn(this.time, this.lastInfo);
  }

  play() {
    if (this.playing) return;
    const dur = this.getDuration();
    const [a, b] = this.loop && this.range ? this.range : [0, dur];
    if (this.time >= b - 0.02 || this.time < a) this.time = a;
    this._startClock();
    this.playing = true;
    this.raf = requestAnimationFrame(this._frame);
  }

  _startClock() {
    this.anchorTime = this.time;
    this.anchorCtx = this.audio.start(this.time, this.rate, this.getTimeline());
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.audio.stop();
    this.render();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(t, { scrub = false } = {}) {
    const dur = this.getDuration();
    this.time = Math.max(0, Math.min(dur, t));
    if (this.playing) this._startClock();
    else if (scrub) this.audio.scrub(this.time);
    this.render();
  }

  setRate(r) {
    this.rate = r;
    if (this.playing) this._startClock();
  }

  step(frames, fps = 30) {
    this.seek(Math.round((this.time + frames / fps) * fps) / fps);
  }

  _frame() {
    if (!this.playing) return;
    const ctx = this.audio.ctx;
    this.time = this.anchorTime + Math.max(0, ctx.currentTime - this.anchorCtx) * this.rate;
    const dur = this.getDuration();
    const [a, b] = this.range && this.loop ? this.range : [0, dur];
    if (this.time >= b) {
      if (this.loop) {
        this.time = a;
        this._startClock();
      } else {
        this.time = b;
        this.playing = false;
        this.audio.stop();
        this.render();
        return;
      }
    }
    this.render();
    this.raf = requestAnimationFrame(this._frame);
  }

  destroy() {
    this.pause();
    this.listeners.clear();
  }
}
