"""Open only the configured local folder; never execute a shell command string."""
import os
import subprocess
from pathlib import Path


def open_folder(folder):
    target=Path(folder).resolve()
    target.mkdir(parents=True, exist_ok=True)
    if os.name != 'nt':
        raise OSError('Windows 파일 탐색기를 사용할 수 없습니다.')
    explorer=Path(os.environ.get('WINDIR', r'C:\Windows'))/'explorer.exe'
    subprocess.Popen([str(explorer), str(target)], close_fds=True)
    return str(target)
