"""Beats and the drop of the trailer's track, with librosa, written to src/beats-track.json.

Usage: py -3.12 scripts/beats.py assets/track.mp3

- beats: every beat time (s), from librosa's tracker on the percussive part.
- tempo: BPM.
- drop: the beat where the energy jumps the most (low-end RMS over the next 2 s against the 2 s before), searched after
  12 s, so it is the big change rather than the intro's first hit.
- downbeats: every 4th beat counted from the drop (the drop is a downbeat).
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np

path = sys.argv[1] if len(sys.argv) > 1 else "assets/track.mp3"
y, sr = librosa.load(path, sr=22050, mono=True)
duration = len(y) / sr
y_h, y_p = librosa.effects.hpss(y)
tempo, frames = librosa.beat.beat_track(y=y_p, sr=sr, units="frames", tightness=120)
beats = librosa.frames_to_time(frames, sr=sr).tolist()
tempo = float(np.atleast_1d(tempo)[0])

# The drop: the biggest rise in low-frequency energy, measured at each beat after 12 s.
S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
low = S[freqs < 200].sum(axis=0)
full = S.sum(axis=0)
times = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=512)
energy = 0.6 * low / (low.max() + 1e-9) + 0.4 * full / (full.max() + 1e-9)


def mean_between(a, b):
    m = (times >= a) & (times < b)
    return float(energy[m].mean()) if m.any() else 0.0


best, drop = -1e9, None
for t in beats:
    if t < 12 or t > duration - 6:
        continue
    jump = mean_between(t, t + 2) - mean_between(t - 2, t)
    if jump > best:
        best, drop = jump, t
if drop is None:
    drop = beats[len(beats) // 2]

i0 = beats.index(drop)
downbeats = [b for i, b in enumerate(beats) if (i - i0) % 4 == 0]
out = {"track": path, "duration": round(duration, 3), "tempo": round(tempo, 2), "beats": [round(b, 4) for b in beats],
       "drop": round(drop, 4), "dropJump": round(best, 4), "downbeats": [round(b, 4) for b in downbeats]}
Path("src/beats-track.json").write_text(json.dumps(out, indent=1))
print(f"{len(beats)} beats at {tempo:.1f} BPM, drop at {drop:.2f} s (jump {best:.3f}), duration {duration:.1f} s")
