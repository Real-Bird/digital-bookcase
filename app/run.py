import argparse
import os
import socket
import threading
import webbrowser
from pathlib import Path

import uvicorn


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    os.chdir(root)
    data = Path(os.environ.get('BOOK_SCANNER_DATA', root / 'data'))
    data.mkdir(parents=True, exist_ok=True)
    # Hold a kernel lock, not a stale PID file. Prevent competing Excel writers.
    lock = open(data / '.server.lock', 'a+b')
    if lock.tell() == 0:
        lock.write(b'0')
        lock.flush()
    lock.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        print('이미 실행 중입니다. 기존 브라우저 창을 사용하세요.')
        if not args.no_browser:
            webbrowser.open(f'http://127.0.0.1:{args.port}')
        return
    with socket.socket() as probe:
        try:
            probe.bind(('127.0.0.1', args.port))
        except OSError:
            print(f'{args.port} 포트를 사용할 수 없습니다. --port 옵션으로 다른 포트를 선택하세요.')
            return
    if not args.no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(f'http://127.0.0.1:{args.port}')).start()
    print(f'책장 | http://127.0.0.1:{args.port} | 종료: Ctrl+C')
    try:
        from app import app
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=args.port, access_log=False, log_level='warning'))
        app.state.shutdown = lambda: setattr(server, 'should_exit', True)
        server.run()
    finally:
        lock.close()


if __name__ == '__main__':
    main()
