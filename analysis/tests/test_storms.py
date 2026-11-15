"""Storm segmentation/tracking on synthetic RGBA frames (no dataset needed)."""

import cv2
import numpy as np

from gravitunes_analysis import storms
from gravitunes_analysis.flow import farneback_gray

W, H = 300, 150


def frame(centres):
    rgba = np.zeros((H, W, 4), np.uint8)
    for x, y in centres:
        cv2.circle(rgba, (x, y), 18, (255, 120, 120, 200), -1)   # light rain halo (RGB order)
        cv2.circle(rgba, (x, y), 7, (120, 0, 0, 255), -1)        # dark saturated red core
    rgb = rgba[:, :, :3].copy()
    alpha = rgba[:, :, 3].copy()
    return rgb, alpha, np.uint8(alpha >= 16)


def run(path_a, path_b):
    cache = {f"00:{i:02d}": frame([a, b]) for i, (a, b) in enumerate(zip(path_a, path_b))}
    params = storms.default_params(width=W, minimum_area=50, frame_cache=cache, quiet=True)
    return storms.build(params)


def test_two_storms_keep_their_ids_while_moving():
    a = [(60 + 6 * i, 50) for i in range(5)]
    b = [(220 - 6 * i, 110) for i in range(5)]
    result = run(a, b)
    assert [len(f["components"]) for f in result["frames"]] == [2] * 5
    first = {c["id"]: c["coreX"] for c in result["frames"][0]["components"]}
    last = {c["id"]: c["coreX"] for c in result["frames"][-1]["components"]}
    assert set(first) == set(last)
    moved = sorted(last[i] - first[i] for i in first)
    assert moved[0] < -15 and moved[1] > 15          # one went west, one east
    assert result["summary"]["trackCount"] == 2
    assert result["frames"][0]["components"][0]["polygons"]


def test_merge_is_recorded():
    a = [(100 + 12 * i, 75) for i in range(6)]
    b = [(200 - 12 * i, 75) for i in range(6)]
    result = run(a, b)
    assert len(result["frames"][0]["components"]) == 2
    assert len(result["frames"][-1]["components"]) == 1
    assert result["summary"]["trackCount"] >= 2


def test_farneback_gray_sees_shift():
    img = np.zeros((80, 160), np.uint8)
    cv2.circle(img, (60, 40), 12, 200, -1)
    img = cv2.GaussianBlur(img, (0, 0), 3)
    moved = np.roll(img, 4, axis=1)
    flow = farneback_gray(img, moved)
    assert 2.5 < flow[40, 60, 0] < 5.5 and abs(flow[40, 60, 1]) < 1


def test_snapshot_times(tmp_path):
    for t in ("01:30", "00:00"):
        (tmp_path / f"imergert_alpha.2026-11-07T{t}:00Z.png").write_bytes(b"")
    assert storms.snapshot_times(tmp_path) == ["00:00", "01:30"]
    assert storms.image_path(tmp_path, "01:30").name.endswith("T01:30:00Z.png")
