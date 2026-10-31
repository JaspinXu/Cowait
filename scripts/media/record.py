"""Linux only (needs pty). pip install pyte pillow; fonts: DejaVu Sans Mono, Noto Sans CJK, Noto Color Emoji.
Usage: python scripts/media/record.py <out-dir> <en_US.UTF-8|zh_CN.UTF-8>  (run `npm run build` first)
"""
"""Record `cowait demo` in a real pty: README screenshots (PNG) + an animated GIF."""
import os, pty, sys, time, select, fcntl, termios, struct, hashlib
import pyte
from PIL import Image, ImageDraw, ImageFont

COLS, ROWS = 96, 30
OUT, LANG = sys.argv[1], sys.argv[2]
ZH = LANG.startswith('zh')
os.makedirs(OUT, exist_ok=True)

screen = pyte.Screen(COLS, ROWS)
stream = pyte.ByteStream(screen)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
    env = dict(os.environ, LANG=LANG, LC_ALL=LANG, TERM='xterm-256color', FORCE_COLOR='3')
    os.execvpe('node', ['node', 'dist/cli.js', 'demo', '--fast'], env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))

S = 2  # supersample
CW, CH = 10 * S, 22 * S
PAD, BAR = 18 * S, 34 * S
mono = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 16 * S)
monob = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf', 16 * S)
cjk = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 16 * S)
cjkb = ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 16 * S)
emoji_font = ImageFont.truetype('/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf', 109, layout_engine=ImageFont.Layout.BASIC)
_emoji_cache = {}

def emoji_img(ch, size):
    key = (ch, size)
    if key not in _emoji_cache:
        im = Image.new('RGBA', (136, 128), (0, 0, 0, 0))
        ImageDraw.Draw(im).text((0, 0), ch, font=emoji_font, embedded_color=True)
        bbox = im.getbbox() or (0, 0, 1, 1)
        im = im.crop(bbox).resize((size, size), Image.LANCZOS)
        _emoji_cache[key] = im
    return _emoji_cache[key]

PAL = {
    'default': (214, 219, 228), 'black': (60, 64, 72), 'red': (244, 112, 112), 'green': (120, 214, 135),
    'brown': (232, 196, 100), 'yellow': (232, 196, 100), 'blue': (110, 160, 245), 'magenta': (205, 135, 235),
    'cyan': (95, 205, 225), 'white': (235, 235, 235), 'brightblack': (124, 130, 142),
}
BG = (22, 24, 31)

def col(c, d):
    if c == 'default':
        return d
    if c in PAL:
        return PAL[c]
    try:
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        return d

def is_emoji(c):
    o = ord(c[0])
    return o >= 0x1F000 or c in '⏳⚡'

def is_wide(c):
    o = ord(c[0])
    return o >= 0x2E80 or is_emoji(c) or c in '⚡'

def render():
    W, H = COLS * CW + PAD * 2, ROWS * CH + PAD * 2 + BAR
    img = Image.new('RGB', (W, H), (13, 14, 18))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, W - 1, H - 1], radius=14 * S, fill=BG)
    d.rounded_rectangle([0, 0, W - 1, BAR + 10 * S], radius=14 * S, fill=(34, 37, 46))
    d.rectangle([0, BAR, W - 1, BAR + 10 * S], fill=BG)
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        x = PAD + i * 22 * S
        d.ellipse([x, 12 * S, x + 12 * S, 24 * S], fill=c)
    d.text((W // 2 - 60 * S, 9 * S), 'cowait', font=mono, fill=(150, 156, 168))
    for y in range(ROWS):
        line = screen.buffer[y]
        for x in range(COLS):
            ch = line[x]
            if ch.data == '':
                continue
            fg, bg = col(ch.fg, PAL['default']), col(ch.bg, BG)
            if ch.reverse:
                fg, bg = BG, (fg if ch.fg != 'default' else PAL['default'])
            wide = is_wide(ch.data)
            w = CW * (2 if wide else 1)
            px, py = PAD + x * CW, BAR + PAD + y * CH
            if bg != BG:
                d.rectangle([px, py, px + w, py + CH], fill=bg)
            if not ch.data.strip():
                continue
            if is_emoji(ch.data):
                e = emoji_img(ch.data, 17 * S)
                img.paste(e, (px + 1 * S, py + 3 * S), e)
            elif wide:
                d.text((px, py), ch.data, font=cjkb if ch.bold else cjk, fill=fg)
            else:
                d.text((px, py + 2 * S), ch.data, font=monob if ch.bold else mono, fill=fg)
    return img.resize((W // S, H // S), Image.LANCZOS)

frames = []  # (image, hash)

def grab():
    im = render()
    h = hashlib.md5(im.tobytes()).hexdigest()
    if frames and frames[-1][1] == h:
        frames[-1][2] += 1
    else:
        frames.append([im, h, 1])

def pump(sec, record=True, step=0.25):
    end = time.time() + sec
    nxt = time.time()
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.03)
        if r:
            try:
                stream.feed(os.read(fd, 65536))
            except OSError:
                return
        if record and time.time() >= nxt:
            grab()
            nxt += step

def key(s, wait=0.5, record=True):
    os.write(fd, s.encode('utf-8'))
    pump(wait, record)

def typing(text, per=0.07):
    for ch in text:
        os.write(fd, ch.encode('utf-8'))
        pump(per, True, per)

def screen_text():
    return chr(10).join(''.join(screen.buffer[y][x].data for x in range(COLS)) for y in range(ROWS))

def wait_for(words, timeout=12):
    end = time.time() + timeout
    while time.time() < end and not any(w in screen_text() for w in words):
        pump(0.2)

def png(name):
    render().save(os.path.join(OUT, name + '.png'), optimize=True)

note = '这里返回 201 会打断前端，保持 200' if ZH else 'returning 201 breaks the frontend, keep 200'
pump(4.6)                      # Claude reads, edits: first card appears
png('review')
key('y', 1.0)                  # approve
key('n', 0.4)
typing(note)
pump(0.6)
png('note')
key('\r', 1.2)
wait_for(['finished', '完成了'])  # turn finishes -> alert
pump(0.6)
png('alert')
key('x', 0.5)
key('\t', 0.8)                 # play
key('n', 0.9)
key('1', 0.6)
key('2', 0.7)
png('battle')
key('e', 1.2)
key('\t', 0.8)                 # learn
key(' ', 1.4)
png('learn')
key('2', 0.8)
key('q', 0.4, False)
os.kill(pid, 9)

# GIF: hold each distinct frame for as long as it stayed on screen.
imgs = [f[0].convert('P', palette=Image.ADAPTIVE, colors=128) for f in frames]
durs = [max(80, int(f[2] * 250)) for f in frames]
durs[-1] = 2500
imgs[0].save(os.path.join(OUT, 'demo.gif'), save_all=True, append_images=imgs[1:], duration=durs, loop=0, optimize=True, disposal=1)
print(len(frames), 'frames')
