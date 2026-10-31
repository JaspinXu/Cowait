import os, pty, sys, time, select, fcntl, termios, struct, pyte
COLS, ROWS = 96, 30
screen = pyte.Screen(COLS, ROWS); stream = pyte.ByteStream(screen)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))
    os.execvpe('node', ['node', 'dist/cli.js', 'demo', '--fast'], dict(os.environ, LANG='en_US.UTF-8', TERM='xterm-256color'))
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
def pump(sec):
    end = time.time() + sec
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.03)
        if r:
            try: stream.feed(os.read(fd, 65536))
            except OSError: return
def note_line():
    for y in range(ROWS):
        l = ''.join(screen.buffer[y][x].data for x in range(COLS))
        if 'Tell Claude' in l: return l.strip()
pump(4.6)
os.write(fd, b'y'); pump(1.0)
os.write(fd, b'n'); pump(0.4)
log = []
for ch in sys.argv[1]:
    os.write(fd, ch.encode()); pump(0.07)
    log.append((ch, note_line()))
print(note_line())
for ch, l in log:
    print(repr(ch), '->', l[:70] if l else None)
os.kill(pid, 9)
