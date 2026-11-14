"""Tiny stdlib JSON-Schema validator covering the keywords used by score.schema.json."""
import json
import math
import os
import re

_HERE = os.path.dirname(os.path.abspath(__file__))
_CANDIDATES = [
    os.path.join(_HERE, "..", "..", "schema", "score.schema.json"),  # repo checkout
    os.path.join(_HERE, "data", "score.schema.json"),                # packaged copy
]
_cache = None


class ValidationError(ValueError):
    def __init__(self, errors):
        self.errors = list(errors)
        super().__init__("invalid score:\n  - " + "\n  - ".join(self.errors))


def schema_path():
    for p in _CANDIDATES:
        if os.path.isfile(p):
            return os.path.normpath(p)
    raise FileNotFoundError("score.schema.json not found; looked in: " + ", ".join(_CANDIDATES))


def load_schema():
    global _cache
    if _cache is None:
        with open(schema_path(), encoding="utf-8") as f:
            _cache = json.load(f)
    return _cache


def _is_type(v, t):
    if t == "object":
        return isinstance(v, dict)
    if t == "array":
        return isinstance(v, list)
    if t == "string":
        return isinstance(v, str)
    if t == "boolean":
        return isinstance(v, bool)
    if t == "null":
        return v is None
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if t == "integer":
        return (isinstance(v, int) and not isinstance(v, bool)) or (
            isinstance(v, float) and math.isfinite(v) and v == int(v))
    return False


def _resolve(ref, root):
    if not ref.startswith("#/"):
        raise ValueError("unsupported $ref " + ref)
    node = root
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def _p(path):
    return path or "$"


def _check(v, s, root, path, errs):
    if "$ref" in s:
        _check(v, _resolve(s["$ref"], root), root, path, errs)
    if "type" in s:
        types = s["type"] if isinstance(s["type"], list) else [s["type"]]
        if not any(_is_type(v, t) for t in types):
            errs.append("%s: expected %s but got %s (%r); change the value to the right type"
                        % (_p(path), " or ".join(types), type(v).__name__, v))
            return
    if "const" in s and (v != s["const"] or isinstance(v, bool) != isinstance(s["const"], bool)):
        errs.append("%s: must equal %r (got %r)" % (_p(path), s["const"], v))
    if "enum" in s and v not in s["enum"]:
        errs.append("%s: must be one of %s (got %r)" % (_p(path), s["enum"], v))
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if "minimum" in s and v < s["minimum"]:
            errs.append("%s: %r is below the minimum %r; use a value >= %r" % (_p(path), v, s["minimum"], s["minimum"]))
        if "maximum" in s and v > s["maximum"]:
            errs.append("%s: %r is above the maximum %r; use a value <= %r" % (_p(path), v, s["maximum"], s["maximum"]))
        if "exclusiveMinimum" in s and v <= s["exclusiveMinimum"]:
            errs.append("%s: %r must be greater than %r" % (_p(path), v, s["exclusiveMinimum"]))
    if isinstance(v, str):
        if "minLength" in s and len(v) < s["minLength"]:
            errs.append("%s: string is too short (min length %d)" % (_p(path), s["minLength"]))
        if "pattern" in s and not re.search(s["pattern"], v):
            errs.append("%s: %r does not match pattern %s" % (_p(path), v, s["pattern"]))
    if isinstance(v, list):
        if "minItems" in s and len(v) < s["minItems"]:
            errs.append("%s: needs at least %d item(s), has %d" % (_p(path), s["minItems"], len(v)))
        if "maxItems" in s and len(v) > s["maxItems"]:
            errs.append("%s: allows at most %d item(s), has %d" % (_p(path), s["maxItems"], len(v)))
        if "items" in s:
            for i, item in enumerate(v):
                _check(item, s["items"], root, "%s[%d]" % (path, i), errs)
    if isinstance(v, dict):
        for r in s.get("required", []):
            if r not in v:
                errs.append("%s: missing required property %r; add it" % (_p(path), r))
        props = s.get("properties", {})
        for k, val in v.items():
            sub = "%s.%s" % (path, k) if path else k
            if k in props:
                _check(val, props[k], root, sub, errs)
            elif s.get("additionalProperties") is False:
                errs.append("%s: unknown property %r (allowed: %s); remove or rename it"
                            % (_p(path), k, ", ".join(sorted(props))))
            elif isinstance(s.get("additionalProperties"), dict):
                _check(val, s["additionalProperties"], root, sub, errs)
    if "oneOf" in s:
        results = []
        for sub in s["oneOf"]:
            e = []
            _check(v, sub, root, path, e)
            results.append(e)
        ok = sum(1 for e in results if not e)
        if ok != 1:
            detail = "; ".join(results[0][:1] if len(results) == 1 else
                               ["option %d: %s" % (i + 1, e[0]) for i, e in enumerate(results) if e][:3])
            errs.append("%s: must match exactly one allowed form (matched %d). %s" % (_p(path), ok, detail))
    if "anyOf" in s:
        if not any(not _sub_errs(v, sub, root, path) for sub in s["anyOf"]):
            errs.append("%s: %s" % (_p(path), _anyof_hint(s["anyOf"])))
    for sub in s.get("allOf", []):
        _check(v, sub, root, path, errs)
    if "if" in s:
        if not _sub_errs(v, s["if"], root, path):
            if "then" in s:
                _check(v, s["then"], root, path, errs)
        elif "else" in s:
            _check(v, s["else"], root, path, errs)


def _sub_errs(v, s, root, path):
    e = []
    _check(v, s, root, path, e)
    return e


def _anyof_hint(options):
    req = [o["required"][0] for o in options if "required" in o and o["required"]]
    if req:
        return "must have at least one of: %s" % ", ".join(req)
    return "must match at least one allowed form"


def validate(instance, schema=None):
    """Return list of error strings (empty if valid)."""
    schema = schema or load_schema()
    errs = []
    _check(instance, schema, schema, "", errs)
    return errs


def check(instance, schema=None):
    errs = validate(instance, schema)
    if errs:
        raise ValidationError(errs)
    return instance
