/* Original cartoon chatter: voiced syllables and vowel formants, no recordings. */
(() => {
  'use strict';

  const VOICES = {
    filmBuff: { pitch: 132, pace: .92, formant: .94, range: 3.4, breath: .017, wave: 'sawtooth' },
    snackExpert: { pitch: 184, pace: 1.08, formant: 1.04, range: 4.8, breath: .022, wave: 'sawtooth' },
    partyStory: { pitch: 246, pace: 1.02, formant: 1.12, range: 7.1, breath: .032, wave: 'sawtooth' },
    houseGuest: { pitch: 106, pace: .82, formant: .85, range: 2.6, breath: .018, wave: 'sawtooth' },
    creativeFriend: { pitch: 168, pace: 1.19, formant: 1.01, range: 6.2, breath: .025, wave: 'sawtooth' },
    hallwayChat: { pitch: 211, pace: 1.05, formant: 1.08, range: 4.0, breath: .02, wave: 'sawtooth' }
  };
  const VOWELS = [[760, 1220, 2800], [470, 1820, 2700], [300, 2300, 3000], [430, 810, 2650], [340, 720, 2200], [660, 1720, 2550]];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function hash(text) {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return value >>> 0;
  }
  function randomFrom(seed) {
    let value = seed || 1;
    return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
  }

  function create() {
    let context = null, enabled = false, phrase = null, noise = null, phrases = 0, mashReactions = 0;

    function release(current) {
      if (!current || current.released) return;
      current.released = true;
      for (const node of current.nodes) { try { node.disconnect(); } catch { /* Already disconnected. */ } }
      current.nodes.length = 0;
      if (phrase === current) phrase = null;
    }
    function stop() {
      const current = phrase;
      if (!current) return;
      const now = context?.currentTime || 0;
      try { current.master.gain.cancelScheduledValues(now); current.master.gain.setValueAtTime(0, now); } catch { /* Context may have closed. */ }
      for (const source of current.sources) {
        source.onended = null;
        try { source.stop(now); } catch { /* A naturally finished source is harmless. */ }
      }
      release(current);
    }
    function setContext(next) {
      if (next === context) return;
      stop(); context = next || null; noise = null;
    }
    function setEnabled(value) { enabled = !!value; if (!enabled) stop(); return enabled; }
    function noiseBuffer() {
      if (noise) return noise;
      const length = Math.max(1, Math.floor(context.sampleRate * .31));
      noise = context.createBuffer(1, length, context.sampleRate);
      const data = noise.getChannelData(0), next = randomFrom(1239847);
      let previous = 0;
      for (let i = 0; i < length; i++) { const white = next() * 2 - 1; data[i] = white - previous * .6; previous = white; }
      return noise;
    }
    function speak(guestId, line, lineIndex = 0) {
      stop();
      if (!enabled || !context || context.state === 'closed' || context.state === 'suspended') return false;
      const profileId = Object.prototype.hasOwnProperty.call(VOICES, guestId) ? guestId : 'filmBuff';
      const voice = VOICES[profileId], text = String(line || ''), next = randomFrom(hash(`${profileId}|${lineIndex}|${text}`));
      let current;
      try {
        current = { nodes: [], sources: [], released: false, guestId, profileId, pitch: voice.pitch, scheduledUntil: 0, master: null, voiced: null, body: null, lastMashAt: -Infinity };
        phrase = current;
        const add = node => { current.nodes.push(node); return node; };
        const source = node => { add(node); current.sources.push(node); return node; };
        const master = current.master = add(context.createGain());
        master.gain.setValueAtTime(.48, context.currentTime);
        const soften = add(context.createBiquadFilter()); soften.type = 'lowpass'; soften.frequency.setValueAtTime(4300, context.currentTime); soften.Q.setValueAtTime(.55, context.currentTime);
        soften.connect(master); master.connect(context.destination);
        const envelope = add(context.createGain()); envelope.gain.setValueAtTime(0, context.currentTime); envelope.connect(soften);
        const voiced = current.voiced = source(context.createOscillator()); voiced.type = voice.wave;
        const body = current.body = source(context.createOscillator()); body.type = 'sine';
        const bodyGain = add(context.createGain()); bodyGain.gain.setValueAtTime(.045, context.currentTime); body.connect(bodyGain); bodyGain.connect(envelope);
        const formants = [];
        for (let i = 0; i < 3; i++) {
          const filter = add(context.createBiquadFilter()); filter.type = 'bandpass'; filter.Q.setValueAtTime([5, 7, 10][i], context.currentTime);
          const resonance = add(context.createGain()); resonance.gain.setValueAtTime([1.4, 2, 1.6][i], context.currentTime);
          voiced.connect(filter); filter.connect(resonance); resonance.connect(envelope); formants.push(filter);
        }
        const consonants = source(context.createBufferSource()); consonants.buffer = noiseBuffer(); consonants.loop = true;
        const consonantFilter = add(context.createBiquadFilter()); consonantFilter.type = 'bandpass'; consonantFilter.frequency.setValueAtTime(1900 * voice.formant, context.currentTime); consonantFilter.Q.setValueAtTime(.65, context.currentTime);
        const consonantEnvelope = add(context.createGain()); consonantEnvelope.gain.setValueAtTime(0, context.currentTime);
        consonants.connect(consonantFilter); consonantFilter.connect(consonantEnvelope); consonantEnvelope.connect(soften);

        const count = 9 + Math.floor(next() * 3), syllables = [];
        let total = 0;
        for (let i = 0; i < count; i++) {
          const duration = .115 + next() * .075, gap = .025 + next() * .04 + (i % 4 === 3 ? .09 : 0);
          syllables.push({ duration, gap }); total += duration + gap;
        }
        const duration = clamp((1.82 + next() * .36) / voice.pace, 1.65, 2.62), scale = duration / total;
        const start = context.currentTime + .018, questioning = /\?\s*$/.test(text);
        let at = start;
        for (let i = 0; i < count; i++) {
          const length = syllables[i].duration * scale, end = at + length;
          const vowel = VOWELS[Math.floor(next() * VOWELS.length)], turn = VOWELS[Math.floor(next() * VOWELS.length)];
          const contour = Math.sin(i / Math.max(1, count - 1) * Math.PI) * 1.4 + (next() * 2 - 1) * voice.range;
          const terminal = i === count - 1 ? questioning ? 3.8 : -2.3 : 0;
          const pitch = voice.pitch * Math.pow(2, (contour + terminal) / 12);
          voiced.frequency.setValueAtTime(pitch * (.94 + next() * .08), at);
          voiced.frequency.exponentialRampToValueAtTime(pitch, at + length * .42);
          voiced.frequency.exponentialRampToValueAtTime(pitch * (i % 3 === 0 ? 1.07 : .96), end);
          body.frequency.setValueAtTime(pitch, at); body.frequency.exponentialRampToValueAtTime(pitch * .98, end);
          for (let f = 0; f < 3; f++) {
            formants[f].frequency.setValueAtTime(vowel[f] * voice.formant, at);
            formants[f].frequency.linearRampToValueAtTime((vowel[f] * .55 + turn[f] * .45) * voice.formant, end - .008);
          }
          const peak = .36 + next() * .12;
          envelope.gain.setValueAtTime(0, at);
          envelope.gain.linearRampToValueAtTime(peak, at + Math.min(.024, length * .2));
          envelope.gain.setValueAtTime(peak * .8, end - Math.min(.035, length * .3));
          envelope.gain.linearRampToValueAtTime(0, end);
          const consonant = next() > .27 ? voice.breath * (.6 + next() * .6) : .002;
          consonantEnvelope.gain.setValueAtTime(0, at);
          consonantEnvelope.gain.linearRampToValueAtTime(consonant, at + .007);
          consonantEnvelope.gain.linearRampToValueAtTime(0, at + Math.min(.052, length * .5));
          at = end + syllables[i].gap * scale;
        }
        const finish = start + duration + .025;
        current.scheduledUntil = finish;
        let ended = 0;
        for (const oscillator of current.sources) {
          oscillator.onended = () => { ended++; if (ended === current.sources.length) release(current); };
          oscillator.start(start); oscillator.stop(finish);
        }
        phrases++;
        return true;
      } catch {
        stop(); release(current); return false;
      }
    }
    function mash(progress) {
      const current = phrase, now = context?.currentTime || 0;
      if (!enabled || !current || current.released || current.scheduledUntil <= now || context.state !== 'running') return false;
      // Reuse the speaking voice: rapid taps bend its pitch instead of stacking
      // a separate reaction sound (and a new graph) on every keypress.
      if (now - current.lastMashAt < .055) return false;
      current.lastMashAt = now;
      const urgency = clamp(Number(progress) || 0, 0, 1), cents = 65 + urgency * 115;
      for (const oscillator of [current.voiced, current.body]) {
        oscillator.detune.cancelScheduledValues(now);
        oscillator.detune.setValueAtTime(cents, now);
        oscillator.detune.linearRampToValueAtTime(0, now + .115);
      }
      mashReactions++;
      return true;
    }
    function dispose() { stop(); enabled = false; context = null; noise = null; }
    function getDebug() {
      return { enabled, hasContext: !!context, active: !!phrase, guestId: phrase?.guestId ?? null, profileId: phrase?.profileId ?? null, pitch: phrase?.pitch ?? null, scheduledUntil: phrase?.scheduledUntil ?? 0, activeNodes: phrase?.nodes.length || 0, phrases, mashReactions };
    }
    return { setContext, setEnabled, speak, mash, stop, dispose, getDebug };
  }
  window.HSChatter = { create };
})();
