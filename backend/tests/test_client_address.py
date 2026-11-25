"""The rate limits count each visitor on their own (P0-5): behind the
host's proxies the connection comes from a proxy everyone shares, so the
visitor's address is read from X-Forwarded-For - from the right, where a
visitor cannot write, never the left, where they can. (Public resolver
addresses stand in for visitors: the documentation ranges are not public.)"""
import pytest
from starlette.requests import Request

import server


def _request(forwarded=None, peer="10.0.0.5"):
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded is not None else []
    return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


@pytest.mark.parametrize("forwarded, expected", [
    ("8.8.4.4", "8.8.4.4"),                        # one proxy: the visitor
    ("8.8.4.4, 10.1.2.3", "8.8.4.4"),              # past a proxy inside the host
    ("1.0.0.1, 8.8.4.4, 10.1.2.3", "8.8.4.4"),  # the left part is the visitor's own text
    ("forged, 8.8.4.4", "8.8.4.4"),
    ("2001:4860::8888, 100.64.0.9", "2001:4860::8888"),    # IPv6; a shared-carrier proxy skipped
])
def test_the_visitor_is_read_from_the_right(forwarded, expected):
    assert server.client_address(_request(forwarded)) == expected


@pytest.mark.parametrize("forwarded", [None, "", "10.1.2.3", "garbage"])
def test_without_a_public_address_the_connection_counts(forwarded):
    assert server.client_address(_request(forwarded)) == "10.0.0.5"


def test_each_visitor_has_their_own_login_limit_and_cannot_forge_another(client):
    server.limiter.reset()
    wrong = {"email": "nobody@example.com", "password": "Wrong-password-1"}
    first = {"X-Forwarded-For": "8.8.4.4, 10.1.2.3"}
    try:
        # 10 tries a minute (routers/auth.py), then a wait.
        codes = [client.post("/api/auth/login", json=wrong, headers=first).status_code for _ in range(11)]
        assert codes[:10] == [401] * 10 and codes[10] == 429
        # Another visitor behind the same proxy still gets in to try.
        assert client.post("/api/auth/login", json=wrong, headers={"X-Forwarded-For": "9.9.9.9, 10.1.2.3"}).status_code == 401
        # Writing another address at the left changes nothing.
        forged = {"X-Forwarded-For": "1.1.1.1, 8.8.4.4, 10.1.2.3"}
        assert client.post("/api/auth/login", json=wrong, headers=forged).status_code == 429
    finally:
        server.limiter.reset()
