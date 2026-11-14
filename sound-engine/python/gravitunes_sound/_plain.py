"""Convert numpy-like values to plain JSON types without importing numpy."""
import math


def plain(v, where="value"):
    """Recursively convert to JSON-safe python. Raises ValueError on NaN/inf."""
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, int):
        return int(v)
    if isinstance(v, float):
        if not math.isfinite(v):
            raise ValueError("%s is %r; NaN/inf are not allowed. Filter or replace it before adding the event." % (where, v))
        return float(v)
    if isinstance(v, dict):
        return {str(k): plain(x, "%s.%s" % (where, k)) for k, x in v.items()}
    if isinstance(v, (list, tuple, set, frozenset)):
        return [plain(x, "%s[%d]" % (where, i)) for i, x in enumerate(v)]
    if hasattr(v, "tolist"):  # numpy arrays and scalars
        return plain(v.tolist(), where)
    if hasattr(v, "item"):
        return plain(v.item(), where)
    raise TypeError("%s has unsupported type %s; use numbers, strings, lists or dicts." % (where, type(v).__name__))
