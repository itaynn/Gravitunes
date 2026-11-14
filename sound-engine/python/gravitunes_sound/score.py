import json
import os

from ._plain import plain
from .schema import check, validate

_ADSR = ("attack", "decay", "sustain", "release")


class Score:
    def __init__(self, title=None, tuning=None, scale=None, tempo=None, value_range=None, **extra):
        self.title = title
        self.tuning = tuning
        self.scale = scale
        self.tempo = tempo
        self.value_range = value_range
        self._voices = {}
        self._events = []
        self._extra = extra

    # ---- building
    def voice(self, name, **kw):
        d = dict(kw)
        env = dict(d.pop("envelope", None) or {})
        for k in _ADSR:
            if k in d:
                env[k] = d.pop(k)
        if env:
            d["envelope"] = env
        self._voices[str(name)] = plain(d, "voice %r" % name)
        return self

    def _add(self, ev):
        idx = len(self._events)
        label = "event #%d (%s)" % (idx, ev.get("type", "note"))
        ev = {k: v for k, v in ev.items() if v is not None}
        self._events.append(plain(ev, label))
        return self

    def note(self, t=0.0, **kw):
        return self._add(dict(kw, t=t))

    def set(self, t, id, **params):
        return self._add(dict(params, type="set", t=t, id=id))

    def stop(self, t, id):
        return self._add({"type": "stop", "t": t, "id": id})

    def notes(self, iterable):
        for ev in iterable:
            self._add(dict(ev))
        return self

    # ---- output
    def to_dict(self, validate_=True):
        d = {"version": 1}
        if self.title is not None:
            d["title"] = self.title
        if self.tempo is not None:
            d["tempo"] = self.tempo
        if self.tuning is not None:
            d["tuning"] = self.tuning
        if self.scale is not None:
            d["scale"] = self.scale
        if self.value_range is not None:
            d["valueRange"] = self.value_range
        d.update(self._extra)
        if self._voices:
            d["voices"] = self._voices
        d["events"] = sorted(self._events, key=lambda e: e.get("t", 0))  # stable
        d = plain(d, "score")
        if validate_:
            check(d)
        return d

    def validate(self):
        return validate(self.to_dict(validate_=False))

    def save(self, path):
        d = self.to_dict()
        parent = os.path.dirname(os.path.abspath(path))
        os.makedirs(parent, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(d, f, indent=2)
            f.write("\n")
        return path

    def preview(self, port=8000, open_browser=True):
        from .server import preview
        return preview(self, port=port, open_browser=open_browser)
