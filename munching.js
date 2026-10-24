/* Original cartoon crunches and a satisfied nasal "mmm", generated locally. */
(() => {
  'use strict';

  function create() {
    let context = null, enabled = false, disposed = false, current = null, noise = null, bursts = 0;

    function release(burst) {
      if (!burst || burst.released) return;
      burst.released = true;
      for (const node of burst.nodes) { try { node.disconnect(); } catch { /* Already disconnected. */ } }
      burst.nodes.length = 0;
      if (current === burst) current = null;
    }
    function stop() {
      const burst = current;
      if (!burst) return;
      const now = context?.currentTime || 0;
      try { burst.master.gain.cancelScheduledValues(now); burst.master.gain.setValueAtTime(0, now); } catch { /* A closed context is already silent. */ }
      for (const source of burst.sources) {
        source.onended = null;
        try { source.stop(now); } catch { /* Natural completion needs no further stop. */ }
      }
      release(burst);
    }
    function setContext(next) {
      if (disposed || next === context) return;
      stop(); context = next || null; noise = null;
    }
    function setEnabled(value) {
      if (disposed) return false;
      enabled = !!value;
      if (!enabled) stop();
      return enabled;
    }
    function crunchBuffer() {
      if (noise) return noise;
      const length = Math.max(1, Math.ceil(context.sampleRate * .76));
      noise = context.createBuffer(1, length, context.sampleRate);
      const samples = noise.getChannelData(0);
      let seed = 981307, previous = 0;
      for (let i = 0; i < length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const white = seed / 4294967296 * 2 - 1;
        // Tiny alternating grains give the noise a dry, crumbly bite.
        samples[i] = (white - previous * .35) * (.65 + .35 * Math.sin(i * .24) ** 2);
        previous = white;
      }
      return noise;
    }
    function play() {
      if (disposed || !enabled || !context || context.state !== 'running') return false;
      // A single finite graph prevents repeated simulation events from piling up.
      if (current && current.until > context.currentTime) return false;
      if (current) stop();
      let burst;
      try {
        const start = context.currentTime + .012, finish = start + .74;
        burst = { nodes: [], sources: [], master: null, until: finish, released: false };
        current = burst;
        const add = node => { burst.nodes.push(node); return node; };
        const source = node => { add(node); burst.sources.push(node); return node; };
        const master = burst.master = add(context.createGain());
        master.gain.setValueAtTime(.58, start); master.connect(context.destination);

        const crumbs = source(context.createBufferSource()); crumbs.buffer = crunchBuffer();
        const crisp = add(context.createBiquadFilter()); crisp.type = 'highpass'; crisp.frequency.setValueAtTime(750, start); crisp.Q.setValueAtTime(.6, start);
        const soften = add(context.createBiquadFilter()); soften.type = 'lowpass'; soften.frequency.setValueAtTime(4700, start); soften.Q.setValueAtTime(.65, start);
        const crunch = add(context.createGain()); crunch.gain.setValueAtTime(0, start);
        crumbs.connect(crisp); crisp.connect(soften); soften.connect(crunch); crunch.connect(master);
        for (const [offset, peak, duration] of [[.025, .33, .095], [.19, .29, .105], [.355, .25, .1]]) {
          const at = start + offset;
          crunch.gain.setValueAtTime(0, at);
          crunch.gain.linearRampToValueAtTime(peak, at + .004);
          crunch.gain.exponentialRampToValueAtTime(.025, at + duration * .5);
          crunch.gain.linearRampToValueAtTime(0, at + duration);
        }

        const pitch = [143, 151, 147, 139][bursts % 4];
        const voice = source(context.createOscillator()); voice.type = 'sawtooth';
        voice.frequency.setValueAtTime(pitch * .96, start);
        voice.frequency.linearRampToValueAtTime(pitch * 1.07, start + .47);
        voice.frequency.exponentialRampToValueAtTime(pitch * .89, start + .72);
        const hum = add(context.createGain()); hum.gain.setValueAtTime(0, start);
        hum.gain.setValueAtTime(0, start + .325);
        hum.gain.linearRampToValueAtTime(.26, start + .39);
        hum.gain.linearRampToValueAtTime(.19, start + .53);
        hum.gain.linearRampToValueAtTime(.28, start + .6);
        hum.gain.linearRampToValueAtTime(0, start + .73);
        hum.connect(master);
        for (const [frequency, q, gain] of [[260, 2.1, 1.5], [780, 4.5, .8]]) {
          const nasal = add(context.createBiquadFilter()); nasal.type = 'bandpass'; nasal.frequency.setValueAtTime(frequency, start); nasal.Q.setValueAtTime(q, start);
          const resonance = add(context.createGain()); resonance.gain.setValueAtTime(gain, start);
          voice.connect(nasal); nasal.connect(resonance); resonance.connect(hum);
        }
        const body = source(context.createOscillator()); body.type = 'sine';
        body.frequency.setValueAtTime(pitch, start); body.frequency.exponentialRampToValueAtTime(pitch * .89, start + .72);
        const bodyGain = add(context.createGain()); bodyGain.gain.setValueAtTime(.32, start); body.connect(bodyGain); bodyGain.connect(hum);

        let ended = 0;
        for (const node of burst.sources) {
          node.onended = () => { ended++; if (ended === burst.sources.length) release(burst); };
          node.start(start); node.stop(finish);
        }
        bursts++;
        return true;
      } catch {
        stop(); release(burst); return false;
      }
    }
    function dispose() { stop(); disposed = true; enabled = false; context = null; noise = null; }

    return { setContext, setEnabled, play, stop, dispose };
  }
  window.HSMunching = { create };
})();
