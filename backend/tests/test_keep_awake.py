"""The free server sleeps after a quarter of an hour without visitors, and
its background jobs (the morning push, reminders, alerts, the monthly
backup) sleep with it. An outside timer keeps it awake by checking
/api/health - with GET or with HEAD, as many such timers do (P0-4)."""


def test_the_health_check_answers_get_and_head(client):
    assert client.get("/api/health").json() == {"status": "healthy"}
    head = client.head("/api/health")
    assert head.status_code == 200 and head.content == b""
