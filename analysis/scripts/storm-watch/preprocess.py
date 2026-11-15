#!/usr/bin/env python3
"""Rebuild app/modes/storm-watch/data/4285/storms.json. The code lives in gravitunes_analysis.storms."""

import sys

from gravitunes_analysis.storms import *  # noqa: F401,F403  (compare.py imports this module)
from gravitunes_analysis.storms import OUTPUT, main

if __name__ == "__main__":
    if "--output" not in sys.argv and "--mode" not in sys.argv:
        sys.argv += ["--output", str(OUTPUT)]
    main()
