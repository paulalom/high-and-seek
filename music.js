/* Original adaptive lounge music. Four synchronized loops share the game's audio context. */
(() => {
  'use strict';
  const TRACKS = ['lounge', 'tension', 'conversation', 'couch'];
  const MODES = new Set(['lounge', 'upstairs', 'conversation', 'couch', 'silent']);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

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
      const result = { lounge: 0, tension: 0, conversation: 0, couch: 0 };
      if (snapshot.mode === 'lounge') result.lounge = 1;
      else if (snapshot.mode === 'upstairs') { result.lounge = .92; result.tension = .15 + snapshot.threat * .58; }
      else if (snapshot.mode === 'conversation') { result.lounge = .08; result.conversation = .68; }
      else if (snapshot.mode === 'couch') result.couch = .95;
      return result;
    }
    function automate(parameter, target, now, seconds) {
      if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
      else { parameter.cancelScheduledValues(now); parameter.setValueAtTime(parameter.value, now); }
      parameter.linearRampToValueAtTime(target, now + seconds);
    }
    function applyMix() {
      if (!playing) return;
      const desired = levels(), now = context.currentTime;
      for (const track of playing.tracks) {
        const target = desired[track.id];
        if (Math.abs(track.target - target) < .002) continue;
        automate(track.gain.gain, target, now, .55); track.target = target;
      }
      const master = .45 * (snapshot.duck ? .58 : 1);
      if (playing.masterTarget !== master) {
        automate(playing.master.gain, master, now, .25); playing.masterTarget = master;
      }
    }
    function startGraph() {
      if (!canPlay() || !buffers || playing) return false;
      const current = { tracks: [], master: null, masterTarget: -1, when: context.currentTime + .025, offset: savedPhase % loopDuration };
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
      if (typeof fetch !== 'function' || typeof context.decodeAudioData !== 'function') { error = 'Music decoding is unavailable.'; return; }
      const token = ++generation, owner = context;
      const abort = typeof AbortController === 'function' ? new AbortController() : null;
      controller = abort; loads++;
      loading = Promise.all(TRACKS.map(async id => {
        const response = await fetch(assetURL(id), abort ? { signal: abort.signal } : undefined);
        if (!response.ok) throw new Error('Music asset could not load.');
        const data = await response.arrayBuffer();
        if (token !== generation || owner !== context || disposed || !enabled) return null;
        const buffer = await owner.decodeAudioData(data);
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
        targets: playing ? levels() : { lounge: 0, tension: 0, conversation: 0, couch: 0 },
        masterGain: playing?.masterTarget || 0, phase: phase(), duration, loads, starts, error, disposed,
        cachedBuffers: buffers ? TRACKS.length : 0,
        cachedBytes: buffers ? TRACKS.reduce((sum, id) => sum + (buffers[id].length || 0) * (buffers[id].numberOfChannels || 1) * 4, 0) : 0
      };
    }
    return { setContext, setEnabled, update, stop, dispose, getDebug };
  }
  window.HSMusic = { create };
})();
