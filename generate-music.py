"""Render High and Seek's original eight-part area score using only NumPy.

Every stereo PCM file shares a 24-bar, 96-beat timeline at 88 BPM, the same
harmonic changes, and a recurring five-note motif. Three eight-bar sections
develop each arrangement rather than copying one short phrase six times.
All instruments are synthesized locally; no recordings or external music.
Notes, reflections and tape modulation wrap around for gapless crossfades.
The midnight bed contains ONLY pads and bell keys; its separate rhythm stem
contains ONLY bass and restrained drums, so the terrace can drop the rhythm.
"""
from pathlib import Path
import hashlib
import json
import math
import wave
import numpy as np

RATE, BPM, BARS = 22050, 88, 24
BEATS = BARS * 4
FRAMES = round(BEATS * 60 / BPM * RATE)
LENGTH, TAU = FRAMES / RATE, math.tau
BEAT = LENGTH / BEATS
OUTPUT = Path(__file__).resolve().parent / 'dist' / 'assets' / 'music'
RNG = np.random.default_rng(5088)


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def time(duration):
    return np.arange(max(8, round(duration * RATE)), dtype=np.float64) / RATE


def taper(signal, release=.04):
    count = min(len(signal) // 3, max(3, round(release * RATE)))
    signal[-count:] *= np.linspace(1, 0, count) ** 2
    return signal


def rhodes(midi, duration=2.7):
    t = time(duration)
    phase = TAU * hz(midi) * t + .012 * np.sin(TAU * 4.7 * t)
    index = 1.25 * np.exp(-t / .115) + .15 * np.exp(-t / 1.8)
    tone = np.sin(phase + index * np.sin(2 * phase))
    tone += .065 * np.sin(2 * phase + .2) * np.exp(-t / .55)
    envelope = (1 - np.exp(-t / .009)) * np.exp(-t / 1.65)
    envelope *= .95 + .05 * np.sin(TAU * 4.2 * t + .4)
    return taper(tone * envelope, .08)


def bass(midi, duration=.6, upright=False):
    t = time(duration)
    phase = TAU * hz(midi) * t + .045 * (1 - np.exp(-t / .018))
    tone = np.sin(phase) + (.29 if upright else .12) * np.sin(2 * phase)
    tone += (.14 if upright else .055) * np.sin(3 * phase)
    envelope = (1 - np.exp(-t / .005)) * np.exp(-t / (.32 if upright else .4))
    if upright:
        noise = np.convolve(RNG.normal(0, 1, len(t)), np.ones(9) / 9, mode='same')
        tone += noise * .11 * np.exp(-t / .025)
    return taper(tone * envelope, .06)


def bell(midi, duration=1.2, warm=True):
    t = time(duration)
    phase = TAU * hz(midi) * t
    tone = np.sin(phase + .4 * np.exp(-t / .1) * np.sin(2 * phase))
    tone += (.06 if warm else .12) * np.sin(3 * phase) * np.exp(-t / .085)
    return taper(tone * (1 - np.exp(-t / .012)) * np.exp(-t / (.62 if warm else .29)), .06)


def marimba(midi, duration=.65):
    t = time(duration)
    phase = TAU * hz(midi) * t
    tone = np.sin(phase) * np.exp(-t / .22)
    tone += .2 * np.sin(phase * 4.01) * np.exp(-t / .038)
    tone += .035 * np.sin(phase * 9.15) * np.exp(-t / .018)
    return taper(tone * (1 - np.exp(-t / .003)), .035)


def pizzicato(midi, duration=.48):
    t = time(duration)
    phase = TAU * hz(midi) * t
    tone = np.sin(phase) * np.exp(-t / .2)
    tone += .28 * np.sin(phase * 2) * np.exp(-t / .105)
    tone += .12 * np.sin(phase * 3) * np.exp(-t / .065)
    return taper(tone * (1 - np.exp(-t / .004)))


def guitar(midi, duration=2.2):
    t = time(duration)
    phase = TAU * hz(midi) * t
    tone = np.zeros(len(t), dtype=np.float64)
    for partial in range(1, 8):
        tone += np.sin(phase * partial + .03 * partial) / partial ** 1.65 * np.exp(-t / (1.6 / partial ** .55))
    tone += .035 * np.sin(TAU * 185 * t) * np.exp(-t / .06)
    return taper(tone * (1 - np.exp(-t / .004)), .1)


def trumpet(midi, duration=.65):
    t = time(duration)
    phase = TAU * hz(midi) * t + .028 * np.sin(TAU * 5.15 * t) * (1 - np.exp(-t / .16))
    tone = np.sin(phase) + .45 * np.sin(2 * phase) + .18 * np.sin(3 * phase) + .055 * np.sin(4 * phase)
    tone = np.tanh(tone * 1.15) / 1.15
    envelope = (1 - np.exp(-t / .03)) * np.exp(-t / 1.3)
    envelope *= np.exp(-np.maximum(0, t - duration * .6) / .095)
    return taper(tone * envelope, .065)


def pad(midi, duration=3.7):
    t = time(duration)
    phase = TAU * hz(midi) * t
    tone = (np.sin(phase * .9991) + np.sin(phase) + np.sin(phase * 1.0009)) / 3 + .12 * np.sin(2 * phase)
    attack = np.minimum(1, t / .58)
    release = np.minimum(1, np.maximum(0, (duration - t) / .95))
    return tone * np.sin(attack * math.pi / 2) ** 2 * np.sin(release * math.pi / 2) ** 2


def kick():
    t = time(.3)
    phase = TAU * (43 * t + 2.5 * (1 - np.exp(-t / .035)))
    click = np.convolve(RNG.normal(0, 1, len(t)), np.ones(5) / 5, mode='same')
    return taper(np.sin(phase) * (1 - np.exp(-t / .0014)) * np.exp(-t / .075)
                 + click * np.exp(-t / .007) * .025)


def brush(duration=.14, hat=False):
    t = time(duration)
    noise = RNG.normal(0, 1, len(t))
    smooth = np.convolve(noise, np.ones(7) / 7, mode='same')
    bright = noise - np.convolve(noise, np.ones(17) / 17, mode='same')
    tone = .24 * bright + .76 * smooth
    if not hat:
        tone += .09 * np.sin(TAU * 170 * t)
    return taper(tone * (1 - np.exp(-t / .002)) * np.exp(-t / (.022 if hat else .044)))


def shaker():
    t = time(.085)
    noise = RNG.normal(0, 1, len(t))
    bright = noise - np.convolve(noise, np.ones(9) / 9, mode='same')
    return taper(bright * np.sin(np.minimum(1, t / .024) * math.pi / 2) ** 2 * np.exp(-t / .019), .025)


def rim():
    t = time(.075)
    return taper((np.sin(TAU * 690 * t) + .25 * np.sin(TAU * 1020 * t))
                 * np.exp(-t / .011) * (1 - np.exp(-t / .0015)))


class Mix:
    def __init__(self):
        self.samples = np.zeros((FRAMES, 2), dtype=np.float64)

    def add(self, sound, beat, gain, pan=0, delay=0):
        start = round((beat * BEAT + delay) * RATE) % FRAMES
        angle = (max(-1, min(1, pan)) + 1) * math.pi / 4
        stereo = sound[:, None] * np.array([math.cos(angle), math.sin(angle)]) * gain
        first = min(len(sound), FRAMES - start)
        self.samples[start:start + first] += stereo[:first]
        if first < len(sound):
            self.samples[:len(sound) - first] += stereo[first:]

    def chord(self, notes, beat, gain=.08, duration=2.7, instrument=rhodes, strum=.009):
        for index, note in enumerate(notes):
            spread = (index - (len(notes) - 1) / 2) / max(2.5, len(notes))
            self.add(instrument(note, duration), beat, gain, spread,
                     delay=index * strum + float(RNG.uniform(-.002, .002)))


# A: invitation. B: a gentler harmonic excursion. A': the expanded route home.
# Each entry carries a bass root, chord voicing, and a falling five-note motif.
CHORDS = {
    'Cmaj9': (36, [52, 55, 59, 62], [76, 74, 71, 67, 74]),
    'Am9': (33, [48, 52, 55, 59], [72, 71, 67, 64, 71]),
    'Dm9': (38, [53, 57, 60, 64], [77, 76, 72, 69, 76]),
    'G13': (31, [53, 57, 59, 64], [76, 74, 71, 69, 74]),
    'Fmaj9': (29, [52, 57, 60, 67], [76, 72, 69, 67, 72]),
    'Em7': (28, [50, 55, 59, 64], [74, 71, 67, 64, 71]),
    'Cmaj9/E': (28, [55, 59, 62, 64], [76, 74, 71, 67, 74]),
}
PROGRESSION = ['Cmaj9', 'Am9', 'Dm9', 'G13', 'Cmaj9', 'Fmaj9', 'Dm9', 'G13',
               'Fmaj9', 'Em7', 'Am9', 'Dm9', 'Fmaj9', 'Cmaj9/E', 'Dm9', 'G13',
               'Cmaj9', 'Am9', 'Fmaj9', 'G13', 'Em7', 'Am9', 'Dm9', 'G13']
SECTION_NAMES = ['Invitation', 'Night walk', 'Homeward reprise']


def bars():
    for bar, name in enumerate(PROGRESSION):
        root, chord, melody = CHORDS[name]
        yield bar, bar * 4, bar // 8, bar % 8, root, chord, melody


def motif(mix, bar, melody, gain, instrument=bell, octave=0, answer=False, sparse=False):
    rhythm, sequence = [.55, 1.25, 1.8, 2.75, 3.45], [0, 1, 2, 3, 4]
    if answer:
        rhythm, sequence = [.8, 1.6, 2.4, 3.15], [3, 2, 1, 2]
    if sparse:
        rhythm, sequence = [1.25, 2.75], [0, 2]
    for index, (offset, degree) in enumerate(zip(rhythm, sequence)):
        duration = .62 if instrument is trumpet else 1.45 if instrument in (guitar, rhodes, bell) else .6
        mix.add(instrument(melody[degree] + octave, duration), bar * 4 + offset,
                gain * [1, .8, .88, .75, .7][index], .26 if not answer else -.2)


def lounge_drums(mix, bar, strength, sparse=False):
    b = bar * 4
    positions = [(0, 1), (2.5, .72)] if sparse else [(0, 1), (1.75, .48), (2.5, .72)]
    if bar % 8 == 6:
        positions.append((3.65, .38))
    for offset, velocity in positions:
        mix.add(kick(), b + offset, .19 * strength * velocity, -.035)
    for offset in [1, 3]:
        mix.add(brush(), b + offset, .074 * strength, .1, delay=.009)
    for eighth in range(8):
        if sparse and eighth % 2 == 0:
            continue
        mix.add(brush(.085, hat=True), b + eighth / 2 + (.055 if eighth % 2 else 0),
                (.033 if eighth % 2 else .024) * strength, -.35 if eighth % 2 else .35)
    if bar % 8 == 7:
        for offset, gain in [(3.15, .025), (3.5, .032), (3.8, .017)]:
            mix.add(brush(.09), b + offset, gain * strength, -.15)


def lounge():
    mix = Mix()
    for bar, b, section, local, root, chord, melody in bars():
        voicing = chord if section != 1 else [chord[0], chord[2], chord[3], chord[1] + 12]
        mix.chord(voicing, b + .035, .087 if section != 1 else .073, 2.7)
        if local in (1, 3, 4, 6) or section == 2:
            mix.chord(voicing[1:], b + (2.65 if local % 2 else 2.4), .036, 1.15)
        pattern = [(0, root, 1), (1.5, root + 7, .58), (2.25, root, .82), (3.35, root + 12, .48)]
        if section == 1:
            pattern = [(0, root, .85), (2.5, root + 7, .65)]
        for offset, note, velocity in pattern:
            mix.add(bass(note, .65), b + offset, .19 * velocity, -.04)
        lounge_drums(mix, bar, .72 if section != 1 else .48, section == 1)
        if local in (0, 4) or section == 2 and local in (2, 6):
            motif(mix, bar, melody, .037, answer=local >= 4)
        elif local in (2, 6):
            motif(mix, bar, melody, .026, rhodes, octave=-12, sparse=True)
    return mix.samples


def snack():
    mix = Mix()
    for bar, b, section, local, root, chord, melody in bars():
        for offset, velocity in [(0, .85), (1.5, 1), (2.5, .65), (3.5, .8)]:
            if section == 1 and offset == 2.5:
                continue
            mix.chord(chord, b + offset, .061 * velocity, .55, pizzicato, .006)
        for offset, note, velocity in [(0, root, .95), (1.6, root + 7, .55), (2, root, .8), (3.6, root + 7, .5)]:
            mix.add(bass(note, .5, upright=True), b + offset, .17 * velocity, -.06)
        for eighth in range(8):
            mix.add(shaker(), b + eighth / 2 + .025 * (eighth % 2),
                    (.03 if eighth % 2 else .021) * (.7 if section == 1 else 1), .38)
        for offset in ([0, 2] if section != 1 else [0]):
            mix.add(kick(), b + offset, .075, -.06)
        for offset in ([1, 2.5, 3.5] if local % 2 else [1, 3]):
            mix.add(rim(), b + offset, .032, -.3)
        if local in (0, 2, 4, 6):
            motif(mix, bar, melody, .084 if section != 1 else .067, marimba, octave=-12, answer=local in (2, 6))
        if section == 2 and local in (3, 7):
            for i, note in enumerate(chord[1:]):
                mix.add(marimba(note + 12), b + 2.75 + i * .33, .055, -.3 + i * .3)
    return mix.samples


def upstairs():
    mix = Mix()
    for bar, b, section, local, root, chord, melody in bars():
        mix.chord(chord, b + .08, .061, 1.5)
        mix.chord(chord[1:], b + (2.55 if local % 2 else 2), .044, 1.1)
        notes = [root, root + 7, root + 12, CHORDS[PROGRESSION[(bar + 1) % BARS]][0] + 7]
        for beat, note in enumerate(notes):
            if section == 1 and beat in (1, 3):
                continue
            mix.add(bass(note, .52, upright=True), b + beat + .015, .185 * (1 if beat % 2 == 0 else .75), -.08)
        lounge_drums(mix, bar, .46, section == 1)
        for offset in [1, 3]:
            mix.add(rim(), b + offset + .02, .025, .3)
        if local in (0, 4) or section == 2 and local == 6:
            motif(mix, bar, melody, .055, trumpet, octave=-12, answer=local >= 4)
        if local in (2, 6) and section != 2:
            motif(mix, bar, melody, .034, rhodes, octave=-12, sparse=True)
        if local == 7:
            mix.add(trumpet(melody[2] - 12, 1.05), b + 2.3, .035, .25)
    return mix.samples


def midnight():
    mix = Mix()
    for bar, b, section, local, root, chord, melody in bars():
        voicing = chord if section != 1 else [chord[0], chord[2], chord[3], chord[1] + 12]
        mix.chord(voicing, b - .3, .04 if section != 1 else .034, 3.75, pad, .013)
        if local in (0, 4):
            motif(mix, bar, melody, .052 if section != 1 else .04, bell, answer=local == 4, sparse=section == 1)
        elif local in (2, 6):
            mix.add(bell(melody[2], 2.3), b + 2.5, .036, -.35)
        if section == 2 and local in (1, 5, 7):
            for i, note in enumerate([chord[2] + 12, chord[1] + 12]):
                mix.add(bell(note, 2), b + 1.25 + i * 1.5, .028, .4 - i * .7)
    return mix.samples


def midnight_rhythm():
    mix = Mix()
    for bar, b, section, local, root, chord, melody in bars():
        strength = [.85, .55, .95][section]
        for offset, note, velocity in [(0, root, 1), (2.5, root + 7, .52)]:
            mix.add(bass(note, 1.15), b + offset, .18 * strength * velocity, -.04)
        if section == 2 and local in (1, 5):
            mix.add(bass(root + 12, .5), b + 3.55, .065, -.04)
        mix.add(kick(), b, .105 * strength, 0)
        if local % 2 == 1:
            mix.add(kick(), b + 2.5, .055 * strength, 0)
        mix.add(brush(.18), b + 3, .035 * strength, .2)
        for offset in ([.55, 2.55] if section == 1 else [.55, 1.55, 2.55, 3.55]):
            mix.add(brush(.09, hat=True), b + offset, .019 * strength, -.35)
    return mix.samples


def tension():
    mix = Mix()
    for bar, b, section, local, root, chord, melody in bars():
        strength = .78 if section == 1 else 1
        for tick in range(8):
            if local in (3, 7) and tick >= 6:
                continue
            mix.add(brush(.07, hat=True), b + tick / 2 + (.045 if tick % 2 else 0),
                    (.022 if tick % 2 else .014) * strength, -.4 if tick % 2 else .4)
        for index, offset in enumerate([.75, 1.75, 3.25]):
            mix.add(bell(melody[index] + (0 if section != 2 else 12), .6, warm=False),
                    b + offset, (.038 if index < 2 else .028) * strength, -.22 + index * .22)
        if local % 2:
            mix.add(rim(), b + 2.65, .014, -.3)
    return mix.samples


def conversation():
    mix = Mix()
    for bar, b, section, local, root, chord, melody in bars():
        for offset in [0, 2]:
            mix.chord(chord, b + offset, .06 if offset == 0 else .044, 1.2)
        for beat, note in enumerate([root, root + 7, root + 12, root + 7]):
            mix.add(bass(note, .45), b + beat, .15 * (1 if beat % 2 == 0 else .7), -.035)
        lounge_drums(mix, bar, .36, True)
        mix.add(rim(), b + 1.02, .024, -.15)
        if local % 2 == 0:
            motif(mix, bar, melody, .058 if section != 1 else .045, marimba, octave=-12, answer=local >= 4)
        else:
            motif(mix, bar, melody, .036, bell, octave=-12, sparse=True)
    return mix.samples


def couch():
    mix = Mix()
    for bar, b, section, local, root, chord, melody in bars():
        mix.chord(chord, b + .04, .057, 3.2)
        mix.chord([root + 12, *chord], b + .12, .045, 2.5, guitar, .024)
        if local in (1, 3, 5, 7):
            mix.chord(chord[1:], b + 2.55, .029, 1.35, guitar, .018)
        for offset, note, velocity in [(0, root, 1), (2.25, root + 7, .6)]:
            mix.add(bass(note, .85), b + offset, .17 * velocity, -.05)
        lounge_drums(mix, bar, .43 if section != 1 else .29, True)
        if local in (0, 4):
            motif(mix, bar, melody, .047, guitar, octave=-12, answer=local == 4)
        elif local in (2, 6):
            motif(mix, bar, melody, .027, rhodes, sparse=True)
        if section == 2 and local in (1, 5):
            mix.add(bell(melody[2], 1.7), b + 3.1, .021, .32)
    return mix.samples


def finish(samples, target_rms, spacious=False):
    dry = samples.copy()
    reflections = [(.083, .10), (.147, .065), (.231, .035)]
    if spacious:
        reflections += [(.379, .11), (.61, .07), (.89, .045)]
    for delay, gain in reflections:
        samples += np.roll(dry[:, ::-1], round(delay * RATE), axis=0) * gain
    index = np.arange(FRAMES, dtype=np.float64)
    wobble = 4.5 * np.sin(TAU * 11 * index / FRAMES) + .6 * np.sin(TAU * 79 * index / FRAMES)
    warped = (index + wobble) % FRAMES
    low = np.floor(warped).astype(np.int64)
    fraction = (warped - low)[:, None]
    samples = samples[low] * (1 - fraction) + samples[(low + 1) % FRAMES] * fraction
    samples = np.tanh(samples * 1.2) / 1.2
    rms = math.sqrt(float(np.mean(samples ** 2)))
    samples *= target_rms / max(rms, 1e-9)
    peak = float(np.max(np.abs(samples)))
    if peak > .67:
        samples *= .67 / peak
    # A 1.45ms edge treatment preserves the wrapped tails while making the
    # exact PCM boundary continuous too. No fade to silence at loop boundaries.
    seam = 32
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
    bar_hashes = [hashlib.sha256(pcm[round(bar * FRAMES / BARS):round((bar + 1) * FRAMES / BARS)].tobytes()).hexdigest() for bar in range(BARS)]
    sections = [samples[round(i * FRAMES / 3):round((i + 1) * FRAMES / 3)] for i in range(3)]
    return {'file': output.name, 'frames': FRAMES, 'sample_rate': RATE, 'channels': 2,
            'duration': LENGTH, 'bytes': output.stat().st_size,
            'rms': round(math.sqrt(float(np.mean(samples ** 2))), 6),
            'peak': round(float(np.max(np.abs(samples))), 6),
            'seam_delta': int(np.max(np.abs(pcm[0].astype(int) - pcm[-1].astype(int)))),
            'clipped_samples': int(np.count_nonzero(np.abs(pcm.astype(np.int32)) >= 32767)),
            'section_rms': [round(math.sqrt(float(np.mean(part ** 2))), 6) for part in sections],
            'unique_bars': len(set(bar_hashes)), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}


def read_pcm(name):
    with wave.open(str(OUTPUT / f'{name}.wav'), 'rb') as wav:
        return np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').reshape(-1, 2).astype(np.float64) / 32767


def main():
    global RNG
    OUTPUT.mkdir(parents=True, exist_ok=True)
    settings = [('lounge', lounge, .095), ('snack', snack, .095),
                ('upstairs', upstairs, .095), ('midnight', midnight, .08),
                ('midnight-rhythm', midnight_rhythm, .054), ('tension', tension, .042),
                ('conversation', conversation, .088), ('couch', couch, .098)]
    results = []
    for index, (name, renderer, rms) in enumerate(settings):
        RNG = np.random.default_rng(5088 + index * 97)
        result = save(name, finish(renderer(), rms, spacious=name == 'midnight'))
        results.append(result)
        print(f"Rendered {name}: {result['duration']:.3f}s, RMS {result['rms']:.4f}, peak {result['peak']:.4f}", flush=True)
    combined = read_pcm('midnight') + read_pcm('midnight-rhythm')
    manifest = {'bpm': BPM, 'bars': BARS, 'beats': BEATS, 'original': True,
                'sections': SECTION_NAMES, 'progression': PROGRESSION,
                'arrangement': {
                    'lounge': 'Warm Rhodes, syncopated electric bass, brushed funk, bell motif.',
                    'snack': 'Pizzicato bossa chords, marimba replies, shaker and soft bass.',
                    'upstairs': 'Cocktail jazz: Rhodes comping, upright bass and muted trumpet.',
                    'midnight': 'Pad-and-bell bed only; no bass, percussion or drums.',
                    'midnight-rhythm': 'Complementary spacious bass and restrained drums only.',
                    'tension': 'Subtle bell ostinato and dry ticks over shared harmony.',
                    'conversation': 'Polite elevator-jazz interruption with marimba replies.',
                    'couch': 'Warm nylon-guitar and Rhodes reprise of the recurring motif.'},
                'midnight_combined_unity_peak': round(float(np.max(np.abs(combined))), 6),
                'midnight_combined_unity_rms': round(math.sqrt(float(np.mean(combined ** 2))), 6),
                'loops': results}
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest, indent=2))
    assert len({row['sha256'] for row in results}) == len(settings)
    assert all(row['frames'] == FRAMES and row['unique_bars'] == BARS for row in results)
    assert all(row['peak'] <= .671 and row['seam_delta'] <= 1 and not row['clipped_samples'] for row in results)
    assert manifest['midnight_combined_unity_peak'] < .9


if __name__ == '__main__':
    main()
