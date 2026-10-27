import sys
from pathlib import Path
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import app as module
from desktop import open_folder
from storage import Store


def test_explorer_launch_uses_arguments_not_shell(tmp_path):
    path=tmp_path/'도서 목록'
    with patch('desktop.subprocess.Popen') as launch:
        assert open_folder(path)==str(path.resolve())
    arguments=launch.call_args.args[0]
    assert Path(arguments[0]).name=='explorer.exe'
    assert arguments[1]==str(path.resolve())
    assert 'shell' not in launch.call_args.kwargs


def test_launch_error_and_download_integrity(tmp_path,monkeypatch):
    store=Store(tmp_path/'소장도서.xlsx')
    store.write(store.empty(),'new')
    monkeypatch.setattr(module,'store',store)
    headers={'x-session-token':module.session_token}
    with TestClient(module.app) as client:
        with patch('app.launch_folder',side_effect=PermissionError):
            denied=client.post('/api/open-folder',json={},headers=headers)
            assert denied.status_code==500
            assert '책장_실행.cmd' in denied.json()['detail']
        with patch('app.launch_folder',return_value=str(tmp_path)):
            accepted=client.post('/api/open-folder',json={},headers=headers)
            assert accepted.json()['path']==str(tmp_path)
        download=client.get('/api/workbook-download')
        assert download.status_code==200 and download.content==store.path.read_bytes()
        assert 'attachment' in download.headers['content-disposition']
        assert download.headers['cache-control']=='no-store'
        assert client.get('/api/workbook-download',headers={'host':'evil.example'}).status_code==403


def test_download_absent_file(tmp_path,monkeypatch):
    monkeypatch.setattr(module,'store',Store(tmp_path/'not-created.xlsx'))
    with TestClient(module.app) as client:
        assert client.get('/api/workbook-download').status_code==404
