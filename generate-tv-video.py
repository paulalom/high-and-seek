"""Generate the original Munchie TV cartoon using Pillow and Windows H.264.

No downloads or third-party encoders are required. Run with the bundled Python.
The Media Foundation sink writer accepts raw frames and produces a silent MP4.
"""
from __future__ import annotations

import ctypes as C
import json
import math
from pathlib import Path
import random
import struct
import uuid

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT, FPS, SECONDS, SCALE = 320, 180, 24, 10, 2
OUTPUT = Path(__file__).resolve().parent / "dist" / "assets" / "lounge-tv.mp4"


class GUID(C.Structure):
    _fields_ = [("data1", C.c_uint32), ("data2", C.c_uint16),
                ("data3", C.c_uint16), ("data4", C.c_ubyte * 8)]

    @classmethod
    def parse(cls, text):
        return cls.from_buffer_copy(uuid.UUID(text).bytes_le)


def checked(result, operation):
    if result < 0:
        raise RuntimeError(f"{operation}: HRESULT 0x{result & 0xffffffff:08x}")


def call(pointer, slot, arg_types, *args):
    table = C.cast(pointer, C.POINTER(C.POINTER(C.c_void_p))).contents
    function = C.WINFUNCTYPE(C.c_long, C.c_void_p, *arg_types)(table[slot])
    result = function(pointer, *args)
    checked(result, f"COM method {slot}")
    return result


def release(pointer):
    if pointer:
        table = C.cast(pointer, C.POINTER(C.POINTER(C.c_void_p))).contents
        C.WINFUNCTYPE(C.c_ulong, C.c_void_p)(table[2])(pointer)


ATTR = {
    "major": "48eba18e-f8c9-4687-bf11-0a74c9f96a8f",
    "subtype": "f7e34c9a-42e8-4714-b74b-cb29d72c35e5",
    "bitrate": "20332624-fb0d-4d9e-bd0d-cbf6786c102e",
    "interlace": "e2724bb8-e676-4806-b4b2-a8d6efb44ccd",
    "size": "1652c33d-d6b2-4012-b834-72030849a37d",
    "rate": "c459a2e8-3d2c-4e44-b132-fee5156c7bb0",
    "aspect": "c6376a1e-8d0a-4027-be45-6d9a0ad39bb6",
    "stride": "644b4e48-1e02-4516-b0eb-c01ca9d49ac6",
}


def set_guid(pointer, key, value):
    call(pointer, 24, [C.POINTER(GUID), C.POINTER(GUID)],
         C.byref(GUID.parse(ATTR[key])), C.byref(GUID.parse(value)))


def set_number(pointer, key, value, wide=False):
    kind = C.c_uint64 if wide else C.c_uint32
    call(pointer, 22 if wide else 21, [C.POINTER(GUID), kind],
         C.byref(GUID.parse(ATTR[key])), value)


class Encoder:
    def __init__(self, output):
        self.ole = C.OleDLL("ole32")
        self.platform = C.WinDLL("mfplat")
        self.writer_dll = C.WinDLL("mfreadwrite")
        self.writer = C.c_void_p()
        self.output_type = C.c_void_p()
        self.input_type = C.c_void_p()
        checked(self.ole.CoInitializeEx(None, 0), "CoInitializeEx")
        checked(self.platform.MFStartup(0x20070, 0), "MFStartup")
        self.platform.MFCreateMediaType.argtypes = [C.POINTER(C.c_void_p)]
        self.writer_dll.MFCreateSinkWriterFromURL.argtypes = [C.c_wchar_p, C.c_void_p, C.c_void_p, C.POINTER(C.c_void_p)]
        checked(self.writer_dll.MFCreateSinkWriterFromURL(str(output), None, None, C.byref(self.writer)), "CreateSinkWriter")
        checked(self.platform.MFCreateMediaType(C.byref(self.output_type)), "Create output type")
        set_guid(self.output_type, "major", "73646976-0000-0010-8000-00aa00389b71")
        set_guid(self.output_type, "subtype", "34363248-0000-0010-8000-00aa00389b71")
        set_number(self.output_type, "bitrate", 480000)
        set_number(self.output_type, "interlace", 2)
        for key, first, second in [("size", WIDTH, HEIGHT), ("rate", FPS, 1), ("aspect", 1, 1)]:
            set_number(self.output_type, key, (first << 32) | second, True)
        self.stream = C.c_uint32()
        call(self.writer, 3, [C.c_void_p, C.POINTER(C.c_uint32)], self.output_type, C.byref(self.stream))
        checked(self.platform.MFCreateMediaType(C.byref(self.input_type)), "Create input type")
        set_guid(self.input_type, "major", "73646976-0000-0010-8000-00aa00389b71")
        set_guid(self.input_type, "subtype", "00000016-0000-0010-8000-00aa00389b71")
        set_number(self.input_type, "interlace", 2)
        set_number(self.input_type, "stride", WIDTH * 4)
        for key, first, second in [("size", WIDTH, HEIGHT), ("rate", FPS, 1), ("aspect", 1, 1)]:
            set_number(self.input_type, key, (first << 32) | second, True)
        call(self.writer, 4, [C.c_uint32, C.c_void_p, C.c_void_p], self.stream, self.input_type, None)
        call(self.writer, 5, [])

    def frame(self, image, number):
        raw = image.convert("RGB").tobytes("raw", "BGRX")
        sample, buffer, address = C.c_void_p(), C.c_void_p(), C.c_void_p()
        try:
            checked(self.platform.MFCreateMemoryBuffer(len(raw), C.byref(buffer)), "Create buffer")
            call(buffer, 3, [C.POINTER(C.c_void_p), C.c_void_p, C.c_void_p], C.byref(address), None, None)
            C.memmove(address, raw, len(raw))
            call(buffer, 4, [])
            call(buffer, 6, [C.c_uint32], len(raw))
            checked(self.platform.MFCreateSample(C.byref(sample)), "Create sample")
            call(sample, 42, [C.c_void_p], buffer)
            start = number * 10000000 // FPS
            end = (number + 1) * 10000000 // FPS
            call(sample, 36, [C.c_int64], start)
            call(sample, 38, [C.c_int64], end - start)
            call(self.writer, 6, [C.c_uint32, C.c_void_p], self.stream, sample)
        finally:
            release(sample)
            release(buffer)

    def finish(self):
        try:
            call(self.writer, 11, [])
        finally:
            release(self.input_type)
            release(self.output_type)
            release(self.writer)
            self.platform.MFShutdown()
            self.ole.CoUninitialize()


FONT_PATH = Path("C:/Windows/Fonts/arialbd.ttf")
FONTS = {size: ImageFont.truetype(str(FONT_PATH), size * SCALE) for size in (8, 9, 12, 15)}
RNG = random.Random(420)
STARS = [(RNG.randint(7, 313), RNG.randint(40, 144), RNG.random() * math.tau) for _ in range(37)]


def box(values):
    return tuple(round(value * SCALE) for value in values)


def text_center(draw, words, y, size, color):
    font = FONTS[size]
    width = draw.textlength(words, font=font)
    draw.text(((WIDTH * SCALE - width) / 2, y * SCALE), words, font=font, fill=color, stroke_width=0)


def draw_burger(canvas, t):
    cx, cy = 160, 89 + math.sin(t * math.tau / SECONDS) * 3
    d = ImageDraw.Draw(canvas)
    d.ellipse(box((cx - 76, cy - 17, cx + 76, cy + 17)), outline="#9b84c6", width=5)
    d.ellipse(box((cx - 42, cy - 8, cx + 42, cy + 30)), fill="#201b31")
    d.pieslice(box((cx - 39, cy - 33, cx + 39, cy + 25)), 180, 360, fill="#f4b45f", outline="#302038", width=5)
    d.rounded_rectangle(box((cx - 40, cy - 3, cx + 40, cy + 8)), radius=8, fill="#d4753f", outline="#302038", width=4)
    d.polygon([box(p) for p in [(cx - 37, cy + 4), (cx - 18, cy + 15), (cx, cy + 6), (cx + 16, cy + 16), (cx + 37, cy + 5)]], fill="#ffe879")
    d.line([box(p) for p in [(cx - 37, cy + 13), (cx - 24, cy + 10), (cx - 12, cy + 15), (cx, cy + 11), (cx + 14, cy + 15), (cx + 37, cy + 12)]], fill="#a8d483", width=8)
    d.rounded_rectangle(box((cx - 37, cy + 18, cx + 37, cy + 28)), radius=10, fill="#df9451", outline="#302038", width=4)
    for dx, dy, angle in [(-22, -18, 25), (-8, -25, -15), (10, -21, 30), (25, -13, -20), (0, -12, 20)]:
        x, y = cx + dx, cy + dy
        d.line(box((x - 2, y, x + 2, y - 1)), fill="#ffe7b8", width=4)
    # The planet's front ring passes in front of the burger.
    d.arc(box((cx - 76, cy - 17, cx + 76, cy + 17)), 0, 180, fill="#d1b9eb", width=5)
    # Simple face; a periodic blink keeps the loop alive.
    blink = int(t * FPS) % (FPS * 5) < 3
    for x in (cx - 12, cx + 12):
        if blink:
            d.line(box((x - 3, cy - 9, x + 3, cy - 9)), fill="#302038", width=4)
        else:
            d.ellipse(box((x - 2, cy - 12, x + 2, cy - 7)), fill="#302038")
    d.arc(box((cx - 6, cy - 10, cx + 6, cy + 1)), 0, 180, fill="#302038", width=3)


def frame(t):
    image = Image.new("RGB", (WIDTH * SCALE, HEIGHT * SCALE), "#242137")
    d = ImageDraw.Draw(image)
    phase = t * math.tau / SECONDS
    for x, y, offset in STARS:
        value = int(130 + 65 * math.sin(phase * 2 + offset))
        d.ellipse(box((x, y, x + 1.2, y + 1.2)), fill=(value, value, min(255, value + 28)))
    d.rounded_rectangle(box((9, 7, 126, 31)), radius=9, fill="#e8d891")
    d.text(box((17, 10)), "MUNCHIE TV", font=FONTS[15], fill="#332d41")
    d.rounded_rectangle(box((260, 10, 310, 29)), radius=7, outline="#b1a5ce", width=2)
    d.text(box((268, 14)), "LIVE-ish", font=FONTS[8], fill="#d5c8eb")
    # A donut moon and its jaunty little orbit.
    dx, dy = 48 + 5 * math.sin(phase), 84 + 11 * math.cos(phase)
    d.ellipse(box((dx - 20, dy - 20, dx + 20, dy + 20)), fill="#efb88b", outline="#302038", width=4)
    d.ellipse(box((dx - 16, dy - 16, dx + 16, dy + 16)), fill="#d896b5")
    d.ellipse(box((dx - 6, dy - 6, dx + 6, dy + 6)), fill="#242137", outline="#302038", width=3)
    for ox, oy, color in [(-9, -7, "#fff0aa"), (9, -8, "#b8d4a3"), (10, 8, "#fff0aa"), (-8, 10, "#a7bedd")]:
        d.line(box((dx + ox - 2, dy + oy, dx + ox + 2, dy + oy + 2)), fill=color, width=3)
    draw_burger(image, t)
    # Pizza rocket: the flame, body and pepperoni all move as one cartoon.
    px, py = 272 + 9 * math.sin(phase + 1), 87 + 13 * math.cos(phase + 1)
    d.polygon([box(p) for p in [(px - 7, py + 21), (px, py + 36 + 3 * math.sin(phase * 10)), (px + 7, py + 21)]], fill="#e99168")
    d.polygon([box(p) for p in [(px, py - 25), (px - 22, py + 20), (px + 22, py + 20)]], fill="#f1d282", outline="#302038", width=4)
    d.line(box((px - 22, py + 20, px + 22, py + 20)), fill="#d79958", width=12)
    for ox, oy in [(-5, 0), (8, 9), (-10, 12)]:
        d.ellipse(box((px + ox - 4, py + oy - 4, px + ox + 4, py + oy + 4)), fill="#b96b63")
    caption = ["SNACKS. IN. SPAAACE.", "NOW WITH EXTRA CHEESE", "ONE SMALL BITE...", "ONE GIANT MUNCH."][min(3, int(t / 2.5))]
    d.rounded_rectangle(box((13, 144, 307, 174)), radius=10, fill="#393247", outline="#8d7d9d", width=2)
    text_center(d, caption, 151, 12, "#f2dfa2")
    # Subtle CRT scanlines are part of the animated TV art.
    for y in range(2, HEIGHT, 4):
        d.line(box((0, y, WIDTH, y)), fill="#242137", width=1)
    return image.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)


def inspect_mp4(path):
    data = path.read_bytes()
    def atoms(start, end):
        cursor = start
        while cursor + 8 <= end:
            size, name = struct.unpack_from(">I4s", data, cursor)
            if size < 8 or cursor + size > end:
                break
            yield name, cursor + 8, cursor + size
            cursor += size
    metadata = {"path": str(path), "bytes": len(data), "codec": "H.264 / AVC", "fps": FPS, "width": WIDTH, "height": HEIGHT, "audio": False}
    for name, start, end in atoms(0, len(data)):
        if name == b"moov":
            for child, a, b in atoms(start, end):
                if child == b"mvhd":
                    timescale, duration = struct.unpack_from(">II", data, a + 12)
                    metadata["duration"] = duration / timescale
    assert b"avc1" in data and b"mdat" in data and b"moov" in data
    assert abs(metadata.get("duration", 0) - SECONDS) < .001 and len(data) < 1000000
    return metadata


if __name__ == "__main__":
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    encoder = Encoder(OUTPUT)
    try:
        for index in range(FPS * SECONDS):
            encoder.frame(frame(index / FPS), index)
    finally:
        encoder.finish()
    print(json.dumps(inspect_mp4(OUTPUT), indent=2))
