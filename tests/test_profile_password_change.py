"""POST /profile/me 同级的自助改密:错密码 401 / 改密后旧会话全吊销 / 新旧密码登录。"""
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.database import Base, get_db
from src.main import app

OLD = "Pa$$word1!"
NEW = "NeW#passw0rd"


def _make_client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TS = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def override():
        db = TS()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    return TestClient(app), TS


def _login(client, email, password=OLD):
    return client.post(
        "/api/v1/auth/login",
        json={
            "email": email, "password": password, "device_id": "d1",
            "client_type": "app", "device_name": "pytest", "platform": "test",
        },
    )


def _register_and_login(client, email, password=OLD):
    r = client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def test_change_password_requires_current_password():
    client, _ = _make_client()
    try:
        token = _register_and_login(client, "pw1@t.com")["access_token"]
        hdr = {"Authorization": f"Bearer {token}"}
        r = client.post(
            "/api/v1/profile/password", headers=hdr,
            json={"current_password": "wrong-pass", "new_password": NEW},
        )
        assert r.status_code == 401, r.text
        # 旧密码仍然可用 —— 失败不应产生半生效状态
        assert _login(client, "pw1@t.com").status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_change_password_revokes_all_sessions_and_switches_credentials():
    client, _ = _make_client()
    try:
        first = _register_and_login(client, "pw2@t.com")
        # 第二台设备的会话，改密后必须一起失效
        second = _login(client, "pw2@t.com")
        assert second.status_code == 200, second.text
        second_body = second.json()

        hdr = {"Authorization": f"Bearer {first['access_token']}"}
        r = client.post(
            "/api/v1/profile/password", headers=hdr,
            json={"current_password": OLD, "new_password": NEW},
        )
        assert r.status_code == 200, r.text
        assert r.json()["revoked_sessions"] >= 2

        for session in (first, second_body):
            rr = client.post(
                "/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]}
            )
            assert rr.status_code == 401, rr.text

        assert _login(client, "pw2@t.com", OLD).status_code in (401, 400, 404)
        assert _login(client, "pw2@t.com", NEW).status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_change_password_rejects_short_new_password():
    client, _ = _make_client()
    try:
        token = _register_and_login(client, "pw3@t.com")["access_token"]
        hdr = {"Authorization": f"Bearer {token}"}
        r = client.post(
            "/api/v1/profile/password", headers=hdr,
            json={"current_password": OLD, "new_password": "123"},
        )
        assert r.status_code == 422
        assert _login(client, "pw3@t.com").status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_change_password_requires_auth():
    client, _ = _make_client()
    try:
        r = client.post(
            "/api/v1/profile/password",
            json={"current_password": OLD, "new_password": NEW},
        )
        assert r.status_code in (401, 403)
    finally:
        app.dependency_overrides.clear()
