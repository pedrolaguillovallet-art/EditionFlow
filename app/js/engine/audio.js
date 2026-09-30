// Voiceover playback, procedural ambience beds and cue SFX, all on one WebAudio clock.

const dbToGain = (db) => Math.pow(10, (Number(db) || -30) / 20);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.muted = false;
    this.voiceGain = 1;
    this.active = [];
    this.noise = null;
  }

  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  /** Route output to a MediaStream (for export) instead of the speakers. */
  captureStream() {
    const ctx = this.ensure();
    const dest = ctx.createMediaStreamDestination();
    this.master.disconnect();
    this.master.connect(dest);
    this.master.gain.value = 1;
    return dest.stream;
  }

  async loadVoiceover(url) {
    this.buffer = null;
    this._peaks = null;
    if (!url) return null;
    const ctx = this.ensure();
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se pudo cargar la voz en off');
    this.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    return this.buffer;
  }

  get voiceDuration() {
    return this.buffer?.duration || 0;
  }

  peaks(buckets) {
    if (!this.buffer) return null;
    if (this._peaks?.length === buckets) return this._peaks;
    const data = this.buffer.getChannelData(0);
    const out = new Float32Array(buckets);
    const size = Math.max(1, Math.floor(data.length / buckets));
    for (let b = 0; b < buckets; b++) {
      let max = 0;
      const start = b * size;
      for (let i = start; i < start + size && i < data.length; i += 16) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      out[b] = max;
    }
    this._peaks = out;
    return out;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 1;
  }

  noiseBuffer() {
    if (this.noise) return this.noise;
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  /** Start everything from timeline position `offset`. Returns ctx time that maps to `offset`. */
  start(offset, rate, timeline, { voice = true } = {}) {
    const ctx = this.ensure();
    this.stop();
    const t0 = ctx.currentTime + 0.05;
    if (voice && this.buffer && offset < this.buffer.duration) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = this.voiceGain;
      src.connect(g).connect(this.master);
      src.start(t0, offset);
      this.active.push(src);
    }
    for (const a of timeline.ambience || []) {
      if (a.end <= offset) continue;
      const from = t0 + Math.max(0, a.start - offset) / rate;
      const to = t0 + (a.end - offset) / rate;
      this.ambience(a, from, to);
    }
    for (const c of timeline.cues || []) {
      if (!c.sfx || c.sfx === 'none' || c.t < offset) continue;
      this.sfx(c.sfx, t0 + (c.t - offset) / rate, c.db);
    }
    return t0;
  }

  stop() {
    for (const n of this.active) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    this.active = [];
  }

  /** Play a short grain of the voiceover (scrubbing with sound). */
  scrub(offset) {
    if (!this.buffer || this.muted || offset < 0 || offset >= this.buffer.duration) return;
    const ctx = this.ensure();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.09);
    src.connect(g).connect(this.master);
    src.start(ctx.currentTime, offset, 0.1);
  }

  envelope(gainNode, from, to, level) {
    const fade = Math.min(0.6, (to - from) / 3);
    const g = gainNode.gain;
    g.setValueAtTime(0, from);
    g.linearRampToValueAtTime(level, from + fade);
    g.setValueAtTime(level, Math.max(from + fade, to - fade));
    g.linearRampToValueAtTime(0, to);
  }

  ambience(a, from, to) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.connect(this.master);
    this.envelope(out, from, to, dbToGain(a.db ?? -30));
    const sources = [];
    const lfo = (freq, depth, param) => {
      const o = ctx.createOscillator();
      const gg = ctx.createGain();
      o.frequency.value = freq;
      gg.gain.value = depth;
      o.connect(gg).connect(param);
      sources.push(o);
    };
    const noise = () => {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuffer();
      s.loop = true;
      sources.push(s);
      return s;
    };
    switch (a.type) {
      case 'wind': {
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 420;
        f.Q.value = 0.7;
        lfo(0.13, 260, f.frequency);
        noise().connect(f).connect(out);
        break;
      }
      case 'crowd': {
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 900;
        f.Q.value = 1.3;
        const am = ctx.createGain();
        am.gain.value = 0.7;
        lfo(3.1, 0.3, am.gain);
        noise().connect(f).connect(am).connect(out);
        break;
      }
      case 'rain': {
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 2200;
        noise().connect(f).connect(out);
        break;
      }
      case 'hum': {
        for (const [freq, lvl] of [[55, 0.6], [110, 0.3], [165, 0.1]]) {
          const o = ctx.createOscillator();
          o.frequency.value = freq;
          const gg = ctx.createGain();
          gg.gain.value = lvl;
          o.connect(gg).connect(out);
          sources.push(o);
        }
        break;
      }
      default: {
        // pad: soft minor chord through a slowly moving low-pass
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 700;
        lfo(0.07, 300, f.frequency);
        f.connect(out);
        for (const [freq, det] of [[110, -6], [130.81, 5], [164.81, -3], [220, 4]]) {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = freq;
          o.detune.value = det;
          const gg = ctx.createGain();
          gg.gain.value = 0.22;
          o.connect(gg).connect(f);
          sources.push(o);
        }
      }
    }
    for (const s of sources) {
      s.start(from);
      s.stop(to + 0.05);
      this.active.push(s);
    }
  }

  sfx(type, at, db = -12) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = dbToGain(db ?? -12);
    out.connect(this.master);
    const env = (node, a, peak, len) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, a);
      g.gain.exponentialRampToValueAtTime(peak, a + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, a + len);
      node.connect(g).connect(out);
      return g;
    };
    const osc = (wave, f1, f2, len) => {
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.setValueAtTime(f1, at);
      o.frequency.exponentialRampToValueAtTime(f2, at + len);
      env(o, at, 1, len);
      o.start(at);
      o.stop(at + len + 0.05);
      this.active.push(o);
    };
    const noiseBurst = (filterType, freq, len, sweepTo) => {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuffer();
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.setValueAtTime(freq, at);
      if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + len);
      s.connect(f);
      if (sweepTo) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.8, at + len * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, at + len);
        f.connect(g).connect(out);
      } else env(f, at, 0.8, len);
      s.start(at);
      s.stop(at + len + 0.05);
      this.active.push(s);
    };
    switch (type) {
      case 'blip': osc('square', 880, 1320, 0.09); break;
      case 'tick': noiseBurst('highpass', 3000, 0.03); break;
      case 'hit': osc('sine', 140, 38, 0.35); noiseBurst('lowpass', 900, 0.15); break;
      case 'whoosh': noiseBurst('bandpass', 300, 0.55, 3200); break;
      case 'rise': osc('sawtooth', 180, 900, 0.8); break;
      default: osc('triangle', 660, 660, 0.12);
    }
  }
}
