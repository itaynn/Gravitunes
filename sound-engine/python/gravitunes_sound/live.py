"""Live client: stream events to the browser via the relay (python -m gravitunes_sound serve)."""
import json

from ._plain import plain

_conn = None
_url = None
_HINT = 'live mode needs websockets: pip install -e "sound-engine/python[live]"'


def connect(url="ws://localhost:8765"):
    global _conn, _url
    try:
        from websockets.sync.client import connect as ws_connect
    except ImportError as e:
        raise ImportError(_HINT) from e
    close()
    _conn = ws_connect(url)
    _url = url
    return _conn


def close():
    global _conn
    if _conn is not None:
        try:
            _conn.close()
        finally:
            _conn = None


def _send(msg):
    if _conn is None:
        connect()
    _conn.send(json.dumps(plain(msg, "live message")))


def play(**event):
    event.setdefault("type", "note")
    _send(event)


def set(id, **params):
    _send(dict(params, type="set", id=id))


def stop(id):
    _send({"type": "stop", "id": id})


def score(s):
    d = s.to_dict() if hasattr(s, "to_dict") else s
    _send({"score": d})


def stop_all():
    _send({"cmd": "stopAll"})
