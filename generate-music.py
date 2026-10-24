"""Render the game's original, phase-matched lounge score using NumPy.

No recordings, network access, audio encoders, or external synthesizers are used.
Each PCM loop contains four bars at 88 BPM. Note tails, room echoes, and tape
wobble wrap periodically so the files can loop without a cut at the bar line.
"""
from pathlib import Path
import hashlib
import json
import math
import wave

import numpy as np


RATE = 22050
BPM = 88
FRAMES = round(16 * 60 / BPM * RATE)
LENGTH = FRAMES / RATE
BEAT = LENGTH / 16
TAU = math.tau
OUTPUT = Path(__file__).resolve().parent / "dist" / "assets" / "music"
RNG = np.random.default_rng(5088)


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def time(duration):
    return np.arange(max(8, round(duration * RATE)), dtype=np.float64) / RATE


def taper(signal, release=.022):
    """Remove discontinuities at the end of a finite instrument's decay."""
    count = min(len(signal) // 3, max(3, round(release * RATE)))
    result = signal.copy()
    result[-count:] *= np.linspace(1, 0, count) ** 2
    return result


def rhodes(midi, duration=2.7, soft=False):
    t = time(duration)
    f = hz(midi)
    # The rapidly decaying tine harmonic becomes a rounded fundamental.
    phase = TAU * f * t + .012 * np.sin(TAU * 4.7 * t)
    index = (1.4 if soft else 2.1) * np.exp(-t / .115) + .18 * np.exp(-t / 1.8)
    tone = np.sin(phase + index * np.sin(2 * phase))
    tone += .075 * np.sin(2 * phase + .2) * np.exp(-t / .55)
    envelope = (1 - np.exp(-t / .008)) * np.exp(-t / (1.5 if soft else 1.15))
    envelope *= .94 + .06 * np.sin(TAU * 4.2 * t + .4)
    return taper(tone * envelope, .06)


def bass(midi, duration=.46):
    t = time(duration)
    f = hz(midi)
    phase = TAU * f * t + .045 * (1 - np.exp(-t / .018))
    tone = np.sin(phase) + .12 * np.sin(2 * phase) + .065 * np.sin(3 * phase)
    envelope = (1 - np.exp(-t / .005)) * np.exp(-t / .28)
    return taper(tone * envelope, .04)


def bell(midi, duration=.7, warm=False):
    t = time(duration)
    phase = TAU * hz(midi) * t
    tone = np.sin(phase + .45 * np.exp(-t / .07) * np.sin(2 * phase))
    tone += (.08 if warm else .14) * np.sin(3 * phase) * np.exp(-t / .055)
    envelope = (1 - np.exp(-t / .009)) * np.exp(-t / (.38 if warm else .22))
    return taper(tone * envelope)


def kick():
    t = time(.29)
    # Integrated pitch envelope, plus only a very small soft beater sound.
    phase = TAU * (43 * t + 2.5 * (1 - np.exp(-t / .035)))
    envelope = (1 - np.exp(-t / .0014)) * np.exp(-t / .075)
    click = np.convolve(RNG.normal(0, 1, len(t)), np.ones(5) / 5, mode="same")
    return taper(np.sin(phase) * envelope + click * np.exp(-t / .007) * .035)


def brush(duration=.14, hat=False):
    t = time(duration)
    noise = RNG.normal(0, 1, len(t))
    smooth = np.convolve(noise, np.ones(7) / 7, mode="same")
    # A rounded high-pass-like brush texture, quieter than a full drum snare.
    bright = noise - np.convolve(noise, np.ones(17) / 17, mode="same")
    tone = .28 * bright + .72 * smooth
    envelope = (1 - np.exp(-t / .0018)) * np.exp(-t / (.022 if hat else .044))
    if not hat:
        tone += .11 * np.sin(TAU * 170 * t)
    return taper(tone * envelope)


def rim():
    t = time(.07)
    return taper((np.sin(TAU * 690 * t) + .33 * np.sin(TAU * 1020 * t))
                 * np.exp(-t / .011) * (1 - np.exp(-t / .001)))


class Mix:
    def __init__(self):
        self.samples = np.zeros((FRAMES, 2), dtype=np.float64)

    def add(self, sound, beat, gain, pan=0, delay=0):
        start = round((beat * BEAT + delay) * RATE) % FRAMES
        angle = (max(-1, min(1, pan)) + 1) * math.pi / 4
        stereo = sound[:, None] * np.array([math.cos(angle), math.sin(angle)]) * gain
        # Every note and its tail wrap into the start of the next loop.
        indices = (start + np.arange(len(sound))) % FRAMES
        np.add.at(self.samples, indices, stereo)

    def chord(self, notes, beat, gain=.105, duration=2.7, soft=False):
        for index, note in enumerate(notes):
            spread = (index - (len(notes) - 1) / 2) / max(2.5, len(notes))
            self.add(rhodes(note, duration, soft), beat, gain, spread,
                     delay=index * .009 + float(RNG.uniform(-.003, .003)))


LOUNGE_CHORDS = [[50, 53, 57, 60, 64], [53, 57, 59, 64],
                 [52, 55, 59, 62], [55, 59, 60, 64]]  # Dm9 G13 Cmaj9 Am9
COUCH_CHORDS = [[48, 52, 55, 59, 62], [52, 55, 59, 60],
                [53, 57, 60, 64], [53, 57, 59, 64]]   # Cmaj9 Am9 Dm9 G13
TALK_CHORDS = [[52, 55, 59, 62], [54, 57, 60, 64],
               [53, 57, 60, 64], [53, 57, 59, 64]]    # Cmaj9 D9 Dm9 G13


def drums(mix, strength=1, polite=False):
    for bar in range(4):
        b = bar * 4
        for beat, velocity in [(0, 1), (1.75, .55), (2.5, .75)]:
            if polite and beat == 1.75:
                continue
            mix.add(kick(), b + beat, .19 * velocity * strength, -.035,
                    delay=float(RNG.uniform(-.004, .004)))
        for beat in [1, 3]:
            mix.add(brush(), b + beat, .080 * strength, .08,
                    delay=float(RNG.uniform(.004, .011)))
            if polite:
                mix.add(rim(), b + beat, .026 * strength, -.1, delay=.012)
        for eighth in range(8):
            # Off-beats land slightly late; they do not all have equal volume.
            beat = eighth / 2 + (.055 if eighth % 2 else 0)
            gain = (.042 if eighth % 2 else .028) * strength
            mix.add(brush(.08, hat=True), b + beat, gain,
                    -.35 if eighth % 2 else .35, delay=float(RNG.uniform(-.005, .005)))


def bassline(mix, roots, gain=.22, bounce=False):
    for bar, root in enumerate(roots):
        pattern = [(0, root, .60, 1), (1.5, root + 7, .35, .62),
                   (2.25, root, .55, .85), (3.35, root + 12, .27, .53)]
        if bounce:
            pattern = [(0, root, .45, .86), (1, root + 7, .3, .62),
                       (2, root + 12, .35, .68), (3, root + 7, .3, .57)]
        for beat, note, duration, velocity in pattern:
            mix.add(bass(note, duration), bar * 4 + beat, gain * velocity,
                    -.035, delay=float(RNG.uniform(-.005, .005)))


def lounge():
    mix = Mix()
    for bar, chord in enumerate(LOUNGE_CHORDS):
        mix.chord(chord, bar * 4 + .03, .092, soft=True)
        mix.chord(chord[1:], bar * 4 + 2.65, .042, 1.05, soft=True)
    bassline(mix, [38, 31, 36, 33], .21)
    drums(mix, .78)
    # A small original response phrase leaves most of the loop unoccupied.
    for beat, note, velocity in [(2.75, 69, .041), (3.5, 67, .034),
                                 (7.25, 64, .04), (10.75, 67, .041),
                                 (11.5, 62, .033), (14.75, 64, .036)]:
        mix.add(bell(note, .9, warm=True), beat, velocity, .3)
    return mix.samples


def tension():
    mix = Mix()
    # This stem adds anticipation over the same four-bar harmony; no bass or kick.
    notes = [[69, 72, 76], [71, 74, 76], [67, 71, 74], [69, 72, 76]]
    for bar in range(4):
        for tick in range(8):
            beat = bar * 4 + tick / 2 + (.045 if tick % 2 else 0)
            mix.add(brush(.07, hat=True), beat, .038 if tick % 2 else .025,
                    -.45 if tick % 2 else .45)
            if tick % 2:
                mix.add(rim(), beat, .02, .3 if bar % 2 else -.3)
        for index, beat in enumerate([.75, 1.75, 3.25]):
            note = notes[bar][index]
            mix.add(bell(note, .6), bar * 4 + beat, .082 if index < 2 else .064,
                    -.25 + index * .25)
    return mix.samples


def conversation():
    mix = Mix()
    for bar, chord in enumerate(TALK_CHORDS):
        mix.chord(chord, bar * 4, .075, 1.35, soft=True)
        mix.chord(chord, bar * 4 + 2, .052, 1.0, soft=True)
    bassline(mix, [36, 38, 38, 31], .17, bounce=True)
    drums(mix, .52, polite=True)
    # Cheerfully insistent elevator motif; repeated phrasing with a tiny detour.
    melody = [(0.5, 67), (1.25, 69), (1.75, 71), (2.5, 69), (3.25, 67),
              (4.5, 66), (5.25, 69), (6.5, 76), (7.25, 74),
              (8.5, 69), (9.25, 72), (10.5, 76), (11.25, 72),
              (12.5, 71), (13.25, 69), (14.5, 67), (15.25, 62)]
    for index, (beat, note) in enumerate(melody):
        mix.add(bell(note, .62, warm=True), beat, .060 if index % 3 else .070, .25)
    return mix.samples


def couch():
    mix = Mix()
    for bar, chord in enumerate(COUCH_CHORDS):
        mix.chord(chord, bar * 4 + .04, .095, 3.0, soft=True)
        if bar in [1, 3]:
            mix.chord(chord[1:], bar * 4 + 2.5, .035, 1.3, soft=True)
    bassline(mix, [36, 33, 38, 31], .19)
    drums(mix, .59)
    # A falling answer phrase sounds like finally putting your feet up.
    melody = [(1.5, 76), (2.5, 74), (3.25, 71), (5.5, 72),
              (6.5, 71), (7.25, 67), (10.5, 69), (11.25, 65),
              (13.5, 67), (14.5, 64)]
    for beat, note in melody:
        mix.add(rhodes(note, 1.3, soft=True), beat, .044, .2)
    return mix.samples


def finish(samples, target_rms):
    # Subtle, periodic two-channel room reflections keep the close, soft palette.
    dry = samples.copy()
    for delay, gain in [(.083, .11), (.147, .07), (.231, .038)]:
        reflected = np.roll(dry[:, ::-1], round(delay * RATE), axis=0)
        samples += reflected * gain
    # A slow periodic variable delay mimics tape wow without breaking the seam.
    index = np.arange(FRAMES, dtype=np.float64)
    wobble = 5.2 * np.sin(TAU * 2 * index / FRAMES) + .7 * np.sin(TAU * 19 * index / FRAMES)
    warped = (index + wobble) % FRAMES
    low = np.floor(warped).astype(np.int64)
    fraction = (warped - low)[:, None]
    samples = samples[low] * (1 - fraction) + samples[(low + 1) % FRAMES] * fraction
    # Mild saturation rounds piano transients, rather than hard-clipping peaks.
    samples = np.tanh(samples * 1.35) / 1.35
    rms = math.sqrt(float(np.mean(samples ** 2)))
    samples *= target_rms / max(rms, 1e-9)
    peak = float(np.max(np.abs(samples)))
    if peak > .67:
        samples *= .67 / peak
    # This half-millisecond periodic crossfade removes a possible quantizer seam
    # while leaving the natural sustained tail present at the loop boundary.
    seam = min(48, FRAMES // 100)
    boundary = (samples[0] + samples[-1]) * .5
    fade = np.linspace(0, 1, seam)[:, None]
    samples[:seam] = boundary + (samples[:seam] - boundary) * fade
    samples[-seam:] = boundary + (samples[-seam:] - boundary) * fade[::-1]
    return np.clip(samples, -.999, .999)


def save(name, samples):
    pcm = np.rint(samples * 32767).astype('<i2')
    output = OUTPUT / f'{name}.wav'
    with wave.open(str(output), 'wb') as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(pcm.tobytes())
    return {
        'file': output.name, 'frames': FRAMES, 'sample_rate': RATE,
        'duration': LENGTH, 'bytes': output.stat().st_size,
        'rms': round(math.sqrt(float(np.mean(samples ** 2))), 6),
        'peak': round(float(np.max(np.abs(samples))), 6),
        'seam_delta': int(np.max(np.abs(pcm[0].astype(int) - pcm[-1].astype(int)))),
        'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    }


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    settings = [('lounge', lounge, .105), ('tension', tension, .065),
                ('conversation', conversation, .098), ('couch', couch, .105)]
    results = [save(name, finish(renderer(), rms)) for name, renderer, rms in settings]
    print(json.dumps({'bpm': BPM, 'bars': 4, 'beats': 16, 'original': True, 'loops': results}, indent=2))
    assert len({row['sha256'] for row in results}) == 4
    assert sum(row['bytes'] for row in results) < 4_000_000
    assert all(row['peak'] <= .671 and row['seam_delta'] <= 1 for row in results)


if __name__ == '__main__':
    main()
