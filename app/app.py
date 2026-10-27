import copy
import json
import logging
import os
import re
import secrets
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit, quote

import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

from domain import normalize_isbn, parse_results
from settings import Settings
from storage import Store, StoreError, now
from desktop import open_folder as launch_folder

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('BOOK_SCANNER_DATA', ROOT / 'data'))
settings = Settings(DATA)
store = Store(settings.workbook, settings.retention)
state_lock = threading.RLock()
session_token = secrets.token_urlsafe(32)
cache = {}
cache_lock = threading.Lock()
logging.getLogger('httpx').setLevel(logging.WARNING)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Book(Model):
    id: str = Field(default='', max_length=40)
    isbn: str = Field(default='', max_length=40)
    raw_input: str = Field(default='', max_length=80)
    response_isbn: str = Field(default='', max_length=1000)
    title: str = Field(min_length=1, max_length=1000)
    author: str = Field(default='', max_length=1000)
    publisher: str = Field(default='', max_length=500)
    year: str = Field(default='', max_length=100)
    quantity: int = Field(default=1, ge=1, le=100000, strict=True)
    location: str = Field(default='', max_length=500)
    memo: str = Field(default='', max_length=2000)
    source: str = Field(default='수동입력', max_length=50)
    lookup_status: str = Field(default='수동등록', max_length=50)
    control_no: str = Field(default='', max_length=100)
    nl_id: str = Field(default='', max_length=100)
    call_no: str = Field(default='', max_length=200)
    kdc_code: str = Field(default='', max_length=100)
    kdc_name: str = Field(default='', max_length=100)
    detail_link: str = Field(default='', max_length=2000)
    created_at: str = Field(default='', max_length=50)
    updated_at: str = Field(default='', max_length=50)
    looked_up_at: str = Field(default='', max_length=50)

    @field_validator('*', mode='before')
    @classmethod
    def clean(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if re.search(r'[\x00-\x08\x0B\x0C\x0E-\x1F]', value):
                raise ValueError('입력에 지원하지 않는 제어문자가 있습니다.')
        return value

    @field_validator('isbn')
    @classmethod
    def isbn_valid(cls, value):
        return normalize_isbn(value, allow_empty=True)


class Operation(Model):
    op_id: uuid.UUID
    revision: str = Field(max_length=100)


class Save(Operation):
    book: Book
    duplicate: str = 'cancel'

    @field_validator('duplicate')
    @classmethod
    def choice(cls, value):
        if value not in ('cancel','increment','separate'):
            raise ValueError('중복 처리 방식이 잘못되었습니다.')
        return value


class Delete(Operation):
    id: str = Field(max_length=40)


class Restore(Operation):
    name: str = Field(max_length=100)


class Config(Model):
    key: str | None = Field(default=None, max_length=500)
    workbook: str | None = Field(default=None, max_length=1000)
    retention: int = Field(default=20, ge=1, le=200, strict=True)


@app.middleware('http')
async def local_only(request: Request, call_next):
    host = request.headers.get('host','').split(':')[0]
    origin = request.headers.get('origin')
    if host not in ('127.0.0.1','localhost','testserver'):
        return JSONResponse({'detail':'로컬 주소로만 접속할 수 있습니다.'}, 403)
    if origin and (urlsplit(origin).hostname not in ('127.0.0.1','localhost') or urlsplit(origin).netloc != request.headers.get('host')):
        return JSONResponse({'detail':'다른 사이트의 요청을 허용하지 않습니다.'}, 403)
    if request.url.path.startswith('/api/') and request.method != 'GET':
        if request.headers.get('x-session-token') != session_token:
            return JSONResponse({'detail':'화면을 새로고침하고 다시 시도하세요.'}, 403)
        try:
            if int(request.headers.get('content-length',0)) > 64000:
                return JSONResponse({'detail':'요청이 너무 큽니다.'}, 413)
        except ValueError:
            return JSONResponse({'detail':'잘못된 요청입니다.'}, 400)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
    response.headers['Permissions-Policy'] = 'camera=(self), microphone=()'
    return response


@app.exception_handler(StoreError)
async def store_error(request, exc):
    return JSONResponse({'detail': str(exc), 'details': exc.details}, status_code=exc.code)


@app.get('/')
def index():
    return FileResponse(ROOT / 'static' / 'index.html')


@app.get('/api/state')
def state():
    with state_lock:
        return {'settings':settings.public(), 'token':session_token, **store.snapshot()}


@app.get('/api/bootstrap')
def bootstrap():
    return {'settings': settings.public(), 'token': session_token}


@app.get('/api/books')
def books():
    with state_lock:
        return store.snapshot()


@app.post('/api/settings')
def configure(data: Config):
    global store
    with state_lock:
        path = settings.workbook
        if data.workbook is not None:
            path = Path(data.workbook).expanduser()
            if not path.is_absolute() or path.suffix.lower() != '.xlsx':
                raise HTTPException(400, 'Excel 파일의 절대 경로(.xlsx)를 입력하세요.')
            if path.is_dir():
                raise HTTPException(400, '파일명을 포함한 경로를 입력하세요.')
            if path.exists():
                Store(path).read().close()
        try:
            settings.save(key=data.key, workbook=path, retention=data.retention)
        except (OSError, RuntimeError):
            raise HTTPException(500, '설정 저장에 실패했습니다. 폴더 권한을 확인하세요.')
        store = Store(path, data.retention)
        cache.clear()
        return settings.public()


class Lookup(Model):
    isbn: str = Field(max_length=80)
    page: int = Field(default=1, ge=1, le=50)
    refresh: bool = False


@app.post('/api/lookup')
def lookup(data: Lookup):
    try:
        isbn = normalize_isbn(data.isbn)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    key = settings.key()
    if not key:
        raise HTTPException(400, '설정에서 국립중앙도서관 API 키를 입력하세요. 수동 등록은 바로 사용할 수 있습니다.')
    cache_id = (isbn, data.page)
    with cache_lock:
        cached = cache.get(cache_id)
        if cached and not data.refresh and time.monotonic() - cached[0] < 3600:
            return {**copy.deepcopy(cached[1]), 'cached': True}
    params = {'key':key, 'apiType':'json', 'detailSearch':'true', 'isbnOp':'isbn', 'isbnCode':isbn,
              'pageNum':data.page, 'pageSize':10, 'category':'도서', 'systemType':'오프라인자료'}
    payload = None
    for attempt in range(2):
        try:
            # Never return or log the request URL: its query contains the private key.
            with httpx.Client(timeout=10, follow_redirects=False) as client:
                reply = client.get('https://www.nl.go.kr/NL/search/openApi/search.do', params=params)
                reply.raise_for_status()
                payload = reply.json()
            break
        except (httpx.HTTPError, ValueError):
            if attempt == 1:
                raise HTTPException(502, '도서관에 연결하지 못했습니다. 인터넷 연결을 확인하거나 수동 등록하세요.')
    try:
        result = parse_results(payload, isbn)
    except ValueError as exc:
        raise HTTPException(502, str(exc))
    timestamp = now()
    for item in result['items']:
        item['looked_up_at'] = timestamp
    result.update(isbn=isbn, page=data.page, has_more=data.page * 10 < min(result['total'],500), cached=False)
    with cache_lock:
        if len(cache) >= 300:
            cache.clear()
        cache[cache_id] = (time.monotonic(), copy.deepcopy(result))
    return result


@app.post('/api/books')
def save(data: Save):
    with state_lock:
        return store.mutate('save', str(data.op_id), data.revision, {'book':data.book.model_dump(), 'duplicate':data.duplicate})


@app.post('/api/delete')
def delete(data: Delete):
    with state_lock:
        return store.mutate('delete', str(data.op_id), data.revision, {'id':data.id})


@app.get('/api/backups')
def backups():
    with state_lock:
        return {'items':store.backups()}


@app.post('/api/restore')
def restore(data: Restore):
    with state_lock:
        return store.mutate('restore', str(data.op_id), data.revision, {'name':data.name})


@app.post('/api/open-folder')
def open_folder():
    with state_lock:
        try:
            path = launch_folder(store.path.parent)
        except OSError:
            raise HTTPException(500, '현재 서버의 Windows 실행 권한으로 탐색기를 열지 못했습니다. 책장_실행.cmd로 앱을 실행하거나 표시된 경로를 파일 탐색기에 붙여넣으세요.')
        return {'ok':True, 'path':path}


@app.get('/api/workbook-download')
def download_workbook():
    with state_lock, store.lock:
        if not store.path.exists():
            raise HTTPException(404, '아직 저장된 Excel 파일이 없습니다. 도서를 먼저 등록하세요.')
        try:
            content=store.path.read_bytes()
        except OSError:
            raise HTTPException(423, 'Excel 파일을 읽을 수 없습니다. 파일 상태를 확인하세요.')
        return Response(content, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        headers={'Content-Disposition':"attachment; filename*=UTF-8''"+quote(store.path.name)})


@app.post('/api/shutdown')
def shutdown():
    callback = getattr(app.state, 'shutdown', None)
    if callback is None:
        raise HTTPException(503, '실행 창에서 Ctrl+C로 종료하세요.')
    threading.Timer(0.5, callback).start()
    return {'ok': True}


app.mount('/static', StaticFiles(directory=ROOT / 'static'), name='static')
