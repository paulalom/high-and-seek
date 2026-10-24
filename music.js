/* Original area score. Phase-matched arrangements share the game's audio clock. */
(() => {
  'use strict';
  const TRACKS = ['lounge', 'snack', 'upstairs', 'midnight', 'midnight-rhythm', 'tension', 'conversation', 'couch'];
  const MODES = new Set(['lounge', 'snack', 'upstairs', 'midnight', 'terrace', 'conversation', 'couch', 'silent']);
  const emptyMix = () => Object.fromEntries(TRACKS.map(id => [id, 0]));
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function decodePCM(context, bytes) {
    // These original assets are PCM WAVs. Preserve their 22.05 kHz samples;
    // decodeAudioData would upsample every cached loop to the output device rate.
    const view = new DataView(bytes);
    if (bytes.byteLength < 44 || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) throw new Error('Invalid music WAV.');
    let format, data;
    for (let offset = 12; offset + 8 <= bytes.byteLength;) {
      const id = view.getUint32(offset, false), size = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + size > bytes.byteLength) throw new Error('Truncated music WAV.');
      if (id === 0x666d7420 && size >= 16) format = start;
      if (id === 0x64617461) data = { start, size };
      offset = start + size + (size % 2);
    }
    if (!format || !data || view.getUint16(format, true) !== 1 || view.getUint16(format + 14, true) !== 16) throw new Error('Music requires sixteen-bit PCM.');
    const channels = view.getUint16(format + 2, true), rate = view.getUint32(format + 4, true);
    if (channels !== 2 || rate !== 22050 || data.size % (channels * 2) || data.size < channels * 2 || data.size > rate * channels * 2 * 90) throw new Error('Invalid music format.');
    const frames = data.size / (channels * 2), buffer = context.createBuffer(channels, frames, rate);
    for (let channel = 0; channel < channels; channel++) {
      const samples = buffer.getChannelData(channel);
      for (let frame = 0; frame < frames; frame++) samples[frame] = view.getInt16(data.start + (frame * channels + channel) * 2, true) / 32768;
    }
    return buffer;
  }

  function create() {
    let context = null, enabled = false, disposed = false, permitted = false;
    let snapshot = { mode: 'silent', threat: 0, duck: false };
    let buffers = null, loading = null, controller = null, generation = 0, error = null;
    let playing = null, savedPhase = 0, loopDuration = 0, loads = 0, starts = 0;

    function phase() {
      if (!playing || !loopDuration) return savedPhase;
      return (playing.offset + Math.max(0, context.currentTime - playing.when)) % loopDuration;
    }
    function stopGraph() {
      const current = playing;
      if (!current) return;
      savedPhase = phase(); playing = null;
      for (const track of current.tracks) {
        track.source.onended = null;
        try { track.source.stop(context.currentTime); } catch { /* It may already have stopped. */ }
        try { track.source.disconnect(); } catch { /* Closed contexts need no further cleanup. */ }
        try { track.gain.disconnect(); } catch { /* Already disconnected. */ }
      }
      try { current.master.disconnect(); } catch { /* Already disconnected. */ }
      current.tracks.length = 0;
    }
    function cancelLoading() {
      generation++;
      try { controller?.abort(); } catch { /* Aborting is best effort. */ }
      controller = null; loading = null;
    }
    function stop() { permitted = false; stopGraph(); }
    function setContext(next) {
      if (disposed || next === context) return;
      stopGraph(); cancelLoading();
      context = next || null; permitted = false; buffers = null; loopDuration = 0; savedPhase = 0; error = null;
    }
    function setEnabled(value) {
      if (disposed) return false;
      const next = !!value;
      if (next && !enabled) error = null;
      enabled = next;
      if (!enabled) { stop(); cancelLoading(); }
      return enabled;
    }
    function canPlay() {
      return !disposed && enabled && permitted && context && context.state === 'running' && snapshot.mode !== 'silent';
    }
    function levels() {
      const result = emptyMix();
      if (snapshot.mode === 'lounge') result.lounge = 1;
      else if (snapshot.mode === 'snack') result.snack = 1;
      else if (snapshot.mode === 'upstairs') { result.upstairs = 1; result.tension = snapshot.threat * .58; }
      else if (snapshot.mode === 'midnight' || snapshot.mode === 'terrace') {
        result.midnight = 1;
        result['midnight-rhythm'] = snapshot.mode === 'midnight' ? 1 : 0;
      }
      else if (snapshot.mode === 'conversation') result.conversation = .68;
      else if (snapshot.mode === 'couch') result.couch = .95;
      return result;
    }
    function automate(parameter, target, now, seconds, previous) {
      // Track the ramp ourselves for browsers without cancelAndHoldAtTime.
      const progress = previous ? clamp((now - previous.start) / (previous.end - previous.start), 0, 1) : 1;
      const held = previous ? previous.from + (previous.to - previous.from) * progress : parameter.value;
      if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
      else { parameter.cancelScheduledValues(now); parameter.setValueAtTime(held, now); }
      parameter.linearRampToValueAtTime(target, now + seconds);
      return { from: held, to: target, start: now, end: now + seconds };
    }
    function applyMix() {
      if (!playing) return;
      const desired = levels(), now = context.currentTime;
      const changedArea = playing.mode !== snapshot.mode;
      const terraceCrossing = (playing.mode === 'midnight' && snapshot.mode === 'terrace') || (playing.mode === 'terrace' && snapshot.mode === 'midnight');
      for (const track of playing.tracks) {
        const target = desired[track.id];
        if (Math.abs(track.target - target) < .002) continue;
        const seconds = terraceCrossing && track.id === 'midnight-rhythm' ? 3.2 : changedArea ? 2 : .55;
        track.ramp = automate(track.gain.gain, target, now, seconds, track.ramp); track.target = target;
      }
      playing.mode = snapshot.mode;
      const master = .45 * (snapshot.duck ? .58 : 1);
      if (playing.masterTarget !== master) {
        playing.masterRamp = automate(playing.master.gain, master, now, .25, playing.masterRamp); playing.masterTarget = master;
      }
    }
    function startGraph() {
      if (!canPlay() || !buffers || playing) return false;
      const current = { tracks: [], master: null, masterTarget: -1, mode: 'silent', when: context.currentTime + .025, offset: savedPhase % loopDuration };
      try {
        current.master = context.createGain();
        current.master.gain.setValueAtTime(0, context.currentTime);
        current.master.connect(context.destination);
        playing = current;
        for (const id of TRACKS) {
          const gain = context.createGain(), source = context.createBufferSource();
          current.tracks.push({ id, source, gain, target: -1 });
          gain.gain.setValueAtTime(0, context.currentTime);
          source.buffer = buffers[id]; source.loop = true; source.loopStart = 0; source.loopEnd = loopDuration;
          source.connect(gain); gain.connect(current.master);
          source.start(current.when, current.offset);
        }
        applyMix(); starts++;
        return true;
      } catch {
        error = 'Music playback is unavailable.'; stopGraph();
        return false;
      }
    }
    function assetURL(id) {
      // Resolve against the page, including previews served beneath a subdirectory.
      const path = `assets/music/${id}.wav`;
      return typeof document !== 'undefined' && document.baseURI ? new URL(path, document.baseURI).href : path;
    }
    function ensureLoaded() {
      if (!canPlay() || buffers || loading || error) return;
      if (typeof fetch !== 'function' || typeof context.createBuffer !== 'function') { error = 'Music decoding is unavailable.'; return; }
      const token = ++generation, owner = context;
      const abort = typeof AbortController === 'function' ? new AbortController() : null;
      controller = abort; loads++;
      loading = Promise.all(TRACKS.map(async id => {
        const response = await fetch(assetURL(id), abort ? { signal: abort.signal } : undefined);
        if (!response.ok) throw new Error('Music asset could not load.');
        const data = await response.arrayBuffer();
        if (token !== generation || owner !== context || disposed || !enabled) return null;
        const buffer = decodePCM(owner, data);
        if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= .05) throw new Error('Music asset could not decode.');
        return [id, buffer];
      })).then(decoded => {
        if (token !== generation || owner !== context || disposed || !enabled) return;
        if (decoded.some(item => !item)) return;
        buffers = Object.fromEntries(decoded);
        loopDuration = Math.min(...TRACKS.map(id => buffers[id].duration));
        loading = null; controller = null; error = null;
        startGraph();
      }).catch(() => {
        if (token !== generation || owner !== context || disposed) return;
        loading = null; controller = null; error = 'Music is unavailable. Toggle sound to retry.';
        try { abort?.abort(); } catch { /* Other requests may already have completed. */ }
      });
    }
    function update(next = {}) {
      if (disposed) return false;
      next = next || {};
      snapshot = {
        mode: MODES.has(next.mode) ? next.mode : 'silent',
        threat: Math.round(clamp(Number(next.threat) || 0, 0, 1) * 20) / 20,
        duck: !!next.duck
      };
      permitted = snapshot.mode !== 'silent';
      if (!canPlay()) { stopGraph(); return false; }
      if (error) return false;
      if (!buffers) { ensureLoaded(); return false; }
      if (!playing) startGraph();
      else applyMix();
      return !!playing;
    }
    function dispose() {
      if (disposed) return;
      stop(); cancelLoading(); buffers = null; context = null; loopDuration = 0; savedPhase = 0;
      enabled = false; disposed = true; error = null;
    }
    function getDebug() {
      const duration = loopDuration;
      return {
        enabled, mode: snapshot.mode, ready: !!buffers, loading: !!loading, playing: !!playing,
        activeSources: playing?.tracks.length || 0, activeNodes: playing ? playing.tracks.length * 2 + 1 : 0,
        targets: playing ? levels() : emptyMix(),
        masterGain: playing?.masterTarget || 0, phase: phase(), duration, loads, starts, error, disposed,
        cachedBuffers: buffers ? TRACKS.length : 0,
        cachedBytes: buffers ? TRACKS.reduce((sum, id) => sum + (buffers[id].length || 0) * (buffers[id].numberOfChannels || 1) * 4, 0) : 0
      };
    }
    return { setContext, setEnabled, update, stop, dispose, getDebug };
  }
  window.HSMusic = { create };
})();
