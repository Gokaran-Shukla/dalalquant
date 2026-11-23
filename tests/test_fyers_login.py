"""Fyers login endpoints explain setup problems instead of returning a bare 500."""
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bridge"))
fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

import bridge as B  # noqa: E402


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setitem(B.CFG, "fyers", {"client_id": "", "secret_key": "", "redirect_uri": "http://127.0.0.1:8765/callback/fyers"})
    return TestClient(B.app)


def test_missing_library_page(client, monkeypatch):
    monkeypatch.setitem(sys.modules, "fyers_apiv3", None)  # import fails
    r = client.get("/login/fyers", follow_redirects=False)
    assert r.status_code == 500 and "pip install fyers-apiv3" in r.text


def _stub(monkeypatch):
    m = types.ModuleType("fyers_apiv3")
    m.fyersModel = types.SimpleNamespace(SessionModel=lambda **k: types.SimpleNamespace(generate_authcode=lambda: "https://fyers.example/auth"))
    monkeypatch.setitem(sys.modules, "fyers_apiv3", m)


def test_missing_keys_page(client, monkeypatch):
    _stub(monkeypatch)
    r = client.get("/login/fyers", follow_redirects=False)
    assert r.status_code == 400 and "client_id, secret_key" in r.text and "/callback/fyers" in r.text


def test_redirects_when_configured(client, monkeypatch):
    _stub(monkeypatch)
    B.CFG["fyers"].update(client_id="ABC123-100", secret_key="s3cret")
    r = client.get("/login/fyers", follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "https://fyers.example/auth"


def test_callback_without_code_explains(client):
    r = client.get("/callback/fyers?s=error&message=invalid+redirect")
    assert r.status_code == 400 and "invalid redirect" in r.text
