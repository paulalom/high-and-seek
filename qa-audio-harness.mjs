// A deterministic Web Audio clock/graph used only by the audio QA suites.
export class FakeAudioParam {
  constructor(context, name, value = 0) { this.context = context; this.name = name; this.value = value; this.events = []; }
  record(type, value, time, extra) { this.value = value; this.events.push({ type, value, time, extra }); return this; }
  setValueAtTime(value, time) { return this.record('set', value, time); }
  linearRampToValueAtTime(value, time) { return this.record('linear', value, time); }
  exponentialRampToValueAtTime(value, time) { return this.record('exponential', value, time); }
  setTargetAtTime(value, time, constant) { return this.record('target', value, time, constant); }
  cancelScheduledValues(time) { this.events.push({ type: 'cancel', time }); return this; }
  cancelAndHoldAtTime(time) { this.events.push({ type: 'hold', time }); return this; }
}

class FakeAudioNode {
  constructor(context, kind) {
    this.context = context; this.kind = kind; this.connections = []; this.disconnections = 0;
    this.listeners = new Map(); this.started = null; this.stopped = null; this.ended = false;
    this.frequency = new FakeAudioParam(context, 'frequency', 440);
    this.detune = new FakeAudioParam(context, 'detune'); this.gain = new FakeAudioParam(context, 'gain', 1);
    this.Q = new FakeAudioParam(context, 'Q', 1); this.playbackRate = new FakeAudioParam(context, 'playbackRate', 1);
    this.pan = new FakeAudioParam(context, 'pan'); this.type = ''; context.nodes.push(this);
  }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.connections.length = 0; this.disconnections++; }
  start(time = this.context.currentTime, offset = 0) { this.started = time; this.offset = offset; this.context.sources.push(this); }
  stop(time = this.context.currentTime) { this.stopped = Math.min(this.stopped ?? Infinity, time); }
  addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
  finish() { if (this.ended) return; this.ended = true; this.onended?.(); for (const listener of this.listeners.get('ended') || []) listener(); }
}

export class FakeAudioContext {
  constructor({ state = 'running', resumeError = false } = {}) {
    this.currentTime = 0; this.state = state; this.resumeError = resumeError; this.sampleRate = 44100;
    this.nodes = []; this.sources = []; this.buffers = []; this.resumeCalls = 0; this.closeCalls = 0; this.decodeCalls = 0;
    this.destination = { kind: 'destination' };
  }
  createOscillator() { return new FakeAudioNode(this, 'oscillator'); }
  createGain() { return new FakeAudioNode(this, 'gain'); }
  createBiquadFilter() { return new FakeAudioNode(this, 'filter'); }
  createBufferSource() { return new FakeAudioNode(this, 'bufferSource'); }
  createStereoPanner() { return new FakeAudioNode(this, 'panner'); }
  createWaveShaper() { return new FakeAudioNode(this, 'waveShaper'); }
  createDynamicsCompressor() { return new FakeAudioNode(this, 'compressor'); }
  createBuffer(channels, length, sampleRate) {
    const arrays = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: channel => arrays[channel] };
    this.buffers.push(buffer); return buffer;
  }
  decodeAudioData(bytes) {
    this.decodeCalls++;
    const view = new DataView(bytes);
    if (bytes.byteLength < 44 || view.getUint32(0, false) !== 0x52494646) return Promise.reject(new Error('Invalid PCM WAV fixture'));
    const channels = view.getUint16(22, true), sampleRate = view.getUint32(24, true), bits = view.getUint16(34, true);
    let cursor = 12, dataSize = 0;
    while (cursor + 8 <= bytes.byteLength) { const size = view.getUint32(cursor + 4, true); if (view.getUint32(cursor, false) === 0x64617461) { dataSize = size; break; } cursor += 8 + size + (size % 2); }
    return Promise.resolve(this.createBuffer(channels, dataSize / channels / (bits / 8), sampleRate));
  }
  resume() { this.resumeCalls++; if (this.resumeError) return Promise.reject(new Error('Audio resume blocked')); this.state = 'running'; return Promise.resolve(); }
  close() { this.closeCalls++; this.state = 'closed'; return Promise.resolve(); }
  advance(seconds) {
    this.currentTime += seconds;
    // onended may stop additional nodes, so drain the same clock boundary.
    for (let round = 0; round < 4; round++) for (const source of [...this.sources]) if (!source.ended && source.stopped !== null && source.stopped <= this.currentTime + 1e-7) source.finish();
  }
  activeSources() { return this.sources.filter(source => !source.ended && source.started <= this.currentTime && (source.stopped === null || source.stopped > this.currentTime)); }
  pendingSources() { return this.sources.filter(source => !source.ended && (source.stopped === null || source.stopped > this.currentTime)); }
}
