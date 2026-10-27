import base64
import ctypes
import json
import os
import threading
from pathlib import Path


class Blob(ctypes.Structure):
    _fields_ = [('size', ctypes.c_ulong), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def crypt(value: bytes, decrypt=False) -> bytes:
    if os.name != 'nt':
        raise RuntimeError('이 앱의 키 보관 기능은 Windows용입니다. 다른 환경에서는 NL_API_KEY를 사용하세요.')
    buf = ctypes.create_string_buffer(value)
    src = Blob(len(value), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    dst = Blob()
    dll = ctypes.windll.crypt32
    if decrypt:
        ok = dll.CryptUnprotectData(ctypes.byref(src), None, None, None, None, 1, ctypes.byref(dst))
    else:
        ok = dll.CryptProtectData(ctypes.byref(src), 'Book scanner', None, None, None, 1, ctypes.byref(dst))
    if not ok:
        raise OSError('Windows 사용자 키 암호화에 실패했습니다.')
    try:
        return ctypes.string_at(dst.data, dst.size)
    finally:
        ctypes.windll.kernel32.LocalFree(dst.data)


class Settings:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)
        self.file = root / 'settings.json'
        self.lock = threading.RLock()
        self.value = json.loads(self.file.read_text('utf-8')) if self.file.exists() else {}

    def key(self):
        if os.environ.get('NL_API_KEY'):
            return os.environ['NL_API_KEY']
        secret = self.value.get('key_encrypted')
        if not secret:
            return ''
        try:
            return crypt(base64.b64decode(secret), decrypt=True).decode()
        except Exception:
            return ''

    @property
    def workbook(self):
        return Path(self.value.get('workbook') or self.root / '소장도서.xlsx').resolve()

    @property
    def retention(self):
        return int(self.value.get('retention', 20))

    def save(self, *, key=None, workbook=None, retention=None):
        with self.lock:
            updated = dict(self.value)
            if key is not None:
                updated['key_encrypted'] = base64.b64encode(crypt(key.encode())).decode() if key else ''
            if workbook is not None:
                updated['workbook'] = str(workbook)
            if retention is not None:
                updated['retention'] = retention
            temp = self.file.with_suffix('.tmp')
            temp.write_text(json.dumps(updated, ensure_ascii=False, indent=2), encoding='utf-8')
            os.replace(temp, self.file)
            self.value = updated

    def public(self):
        return {'key_configured': bool(self.key()), 'key_from_env': bool(os.environ.get('NL_API_KEY')),
                'workbook': str(self.workbook), 'retention': self.retention}
