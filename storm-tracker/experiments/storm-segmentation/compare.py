#!/usr/bin/env python3
"""Compare storm segmentation methods on the bundled IMERG snapshots."""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np

TRACKER_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(TRACKER_DIR))
import preprocess  # noqa: E402

DEFAULT_SNAPSHOTS = TRACKER_DIR / "data" / "snapshots"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "artifacts"
METHODS = ("connected", "watershed", "kmeans")
PANEL_TIMES = ("00:00", "06:00", "12:00", "18:00", "23:30")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshots", type=Path, default=DEFAULT_SNAPSHOTS)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--width", type=int, default=900)
    parser.add_argument("--minimum-area", type=int, default=200)
    parser.add_argument("--alpha-threshold", type=int, default=16)
    parser.add_argument("--core-saturation", type=int, default=100)
    parser.add_argument("--core-darkness", type=int, default=75)
    parser.add_argument("--core-merge-distance", type=float, default=36)
    parser.add_argument("--maximum-motion", type=float, default=56)
    parser.add_argument("--large-cluster-area", type=int, default=5000)
    return parser.parse_args()


def _component(mask: np.ndarray, cores: list[dict[str, Any]], rgb: np.ndarray) -> dict[str, Any]:
    ys, xs = np.where(mask > 0)
    if not len(xs):
        raise ValueError("Cannot create a component from an empty mask")
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    local_cores = [dict(core) for core in cores]
    if not local_cores:
        local_cores = [{
            "x": float(xs.mean()), "y": float(ys.mean()),
            "strength": 0.0, "hue": None,
        }]
    return {
        "mask": np.uint8(mask > 0),
        "area": int(len(xs)),
        "bbox": (x0, y0, x1, y1),
        "center": (float(xs.mean()), float(ys.mean())),
        "core_points": local_cores,
        "mean_color": np.mean(rgb[mask > 0], axis=0).astype(np.float32),
    }


def _core_groups(
    points: list[dict[str, Any]], merge_distance: float,
) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    for point in sorted(points, key=lambda item: item["strength"], reverse=True):
        match = next((
            group for group in groups
            if group["hue"] == point["hue"]
            and math.hypot(group["x"] - point["x"], group["y"] - point["y"]) < merge_distance
        ), None)
        if match is None:
            groups.append(dict(point))
    return groups


def _connected_components(
    rgb: np.ndarray, mask: np.ndarray, points: list[dict[str, Any]], minimum_area: int,
) -> list[dict[str, Any]]:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    result = []
    for label in range(1, count):
        if int(stats[label, cv2.CC_STAT_AREA]) < minimum_area:
            continue
        region = np.uint8(labels == label)
        cores = [point for point in points
                 if region[int(round(point["y"])), int(round(point["x"]))] > 0]
        result.append(_component(region, cores, rgb))
    return result


def _kmeans_components(
    rgb: np.ndarray,
    mask: np.ndarray,
    points: list[dict[str, Any]],
    minimum_area: int,
    merge_distance: float,
) -> list[dict[str, Any]]:
    """Split multi-core blobs with OpenCV k-means over spatial/color features."""
    base = _connected_components(rgb, mask, points, minimum_area)
    result: list[dict[str, Any]] = []
    for blob in base:
        cores = _core_groups(blob["core_points"], merge_distance)
        if len(cores) < 2:
            result.append(blob)
            continue

        ys, xs = np.where(blob["mask"] > 0)
        spatial = np.column_stack((xs / 40.0, ys / 40.0)).astype(np.float32)
        colors = rgb[ys, xs].astype(np.float32) / 64.0
        features = np.column_stack((spatial, colors)).astype(np.float32)
        seed_xy = np.array([[p["x"], p["y"]] for p in cores], dtype=np.float32)
        initial = np.argmin(
            (xs[:, None] - seed_xy[None, :, 0]) ** 2
            + (ys[:, None] - seed_xy[None, :, 1]) ** 2,
            axis=1,
        ).astype(np.int32)

        stride = max(1, math.ceil(len(features) / 15000))
        training = features[::stride]
        labels = initial[::stride].reshape(-1, 1)
        if len(np.unique(labels)) != len(cores):
            result.append(blob)
            continue
        cv2.setRNGSeed(41)
        _, _, centers = cv2.kmeans(
            training, len(cores), labels.copy(),
            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 25, 0.15),
            1, cv2.KMEANS_USE_INITIAL_LABELS,
        )

        distances = np.sum((features[:, None, :] - centers[None, :, :]) ** 2, axis=2)
        assignments = np.argmin(distances, axis=1)
        for cluster in range(len(centers)):
            selected = assignments == cluster
            if int(np.count_nonzero(selected)) < minimum_area:
                continue
            child_mask = np.zeros_like(mask)
            child_mask[ys[selected], xs[selected]] = 1
            child_cores = [
                point for point in blob["core_points"]
                if int(np.argmin(np.sum((centers - np.array([
                    point["x"] / 40.0, point["y"] / 40.0,
                    * (rgb[int(round(point["y"])), int(round(point["x"]))].astype(np.float32) / 64.0),
                ], dtype=np.float32)) ** 2, axis=1))) == cluster
            ]
            result.append(_component(child_mask, child_cores, rgb))
    return result


def segment(
    method: str,
    rgb: np.ndarray,
    mask: np.ndarray,
    minimum_area: int,
    core_saturation: int,
    core_darkness: int,
    core_merge_distance: float,
) -> list[dict[str, Any]]:
    _, points = preprocess.core_features(rgb, mask, core_saturation, core_darkness)
    if method == "connected":
        return _connected_components(rgb, mask, points, minimum_area)
    if method == "watershed":
        grouped = preprocess.find_components(
            rgb, mask, minimum_area, core_saturation, core_darkness,
            core_merge_distance, 100, "watershed",
        )
        return [_component(item["mask"], item["core_points"], rgb) for item in grouped]
    return _kmeans_components(rgb, mask, points, minimum_area, core_merge_distance)


def _overlap(
    first: np.ndarray,
    first_bbox: tuple[int, int, int, int] | None,
    first_area: int,
    second: np.ndarray,
    second_bbox: tuple[int, int, int, int],
    second_area: int,
) -> tuple[float, float]:
    if first_bbox is None:
        intersection = 0
    else:
        x0, y0 = max(first_bbox[0], second_bbox[0]), max(first_bbox[1], second_bbox[1])
        x1, y1 = min(first_bbox[2] + 1, second_bbox[2] + 1), min(first_bbox[3] + 1, second_bbox[3] + 1)
        intersection = 0 if x0 >= x1 or y0 >= y1 else int(np.count_nonzero(
            (first[y0:y1, x0:x1] > 0) & (second[y0:y1, x0:x1] > 0),
        ))
    return (
        intersection / max(1, min(first_area, second_area)),
        intersection / max(1, first_area + second_area - intersection),
    )


def _track_frame(
    previous: list[dict[str, Any]],
    current: list[dict[str, Any]],
    flow: np.ndarray | None,
    next_id: int,
    maximum_motion: float,
) -> tuple[int, list[dict[str, Any]], dict[str, int]]:
    if flow is None:
        for item in current:
            item["id"] = next_id
            item["lineage"] = {next_id}
            next_id += 1
        return next_id, [], {"matches": 0, "merges": 0, "splits": 0}

    candidates = []
    for source_index, source in enumerate(previous):
        warped, warped_bbox = preprocess.warp_mask(source["mask"], flow, source["bbox"])
        warped_area = int(warped.sum())
        sx, sy = source["center"]
        dx, dy = preprocess.point_flow(flow, sx, sy)
        predicted = (sx + dx, sy + dy)
        for target_index, target in enumerate(current):
            overlap, iou = _overlap(
                warped, warped_bbox, warped_area,
                target["mask"], target["bbox"], target["area"],
            )
            distance = math.hypot(predicted[0] - target["center"][0], predicted[1] - target["center"][1])
            if overlap < 0.05 and distance > maximum_motion:
                continue
            score = 0.60 * iou + 0.20 * overlap + 0.20 * math.exp(-distance / max(1, maximum_motion))
            candidates.append((score, source_index, target_index, overlap))

    candidates.sort(reverse=True)
    accepted = []
    used_sources: set[int] = set()
    used_targets: set[int] = set()
    for score, source_index, target_index, overlap in candidates:
        if score < 0.12 or source_index in used_sources or target_index in used_targets:
            continue
        accepted.append((source_index, target_index, score, overlap))
        used_sources.add(source_index)
        used_targets.add(target_index)

    source_targets: dict[int, set[int]] = {}
    target_sources: dict[int, set[int]] = {}
    for _, source_index, target_index, overlap in candidates:
        if overlap >= 0.15:
            source_targets.setdefault(source_index, set()).add(target_index)
            target_sources.setdefault(target_index, set()).add(source_index)

    source_for_target = {target: source for source, target, _, _ in accepted}
    for target_index, target in enumerate(current):
        source_index = source_for_target.get(target_index)
        if source_index is None:
            target["id"] = next_id
            target["lineage"] = {next_id}
            next_id += 1
        else:
            target["id"] = previous[source_index]["id"]
            inherited = set()
            for prior in target_sources.get(target_index, {source_index}):
                inherited.update(previous[prior]["lineage"])
            target["lineage"] = inherited or {target["id"]}

    merges = sum(len(sources) > 1 for sources in target_sources.values())
    splits = sum(len(targets) > 1 for targets in source_targets.values())
    return next_id, accepted, {
        "matches": len(accepted), "merges": merges, "splits": splits,
    }


def _core_links(
    previous: list[dict[str, Any]],
    current: list[dict[str, Any]],
    flow: np.ndarray,
    maximum_motion: float,
) -> tuple[int, int]:
    candidates = []
    for first_index, first in enumerate(previous):
        dx, dy = preprocess.point_flow(flow, first["x"], first["y"])
        for second_index, second in enumerate(current):
            if first["hue"] != second["hue"]:
                continue
            distance = math.hypot(first["x"] + dx - second["x"], first["y"] + dy - second["y"])
            if distance <= maximum_motion:
                candidates.append((distance, first_index, second_index))
    used_first: set[int] = set()
    used_second: set[int] = set()
    links = continuous = 0
    for _, first_index, second_index in sorted(candidates):
        if first_index in used_first or second_index in used_second:
            continue
        first, second = previous[first_index], current[second_index]
        if first["owner"] is None or second["owner"] is None:
            continue
        links += 1
        continuous += bool(first["lineage"] & second["lineage"])
        used_first.add(first_index)
        used_second.add(second_index)
    return links, continuous


def _color(track_id: int) -> tuple[int, int, int]:
    hue = (track_id * 47 + 13) % 180
    pixel = np.uint8([[[hue, 210, 245]]])
    return tuple(int(channel) for channel in cv2.cvtColor(pixel, cv2.COLOR_HSV2BGR)[0, 0])


def _summary(
    name: str,
    rows: list[dict[str, Any]],
    peak_count: int,
    covered_peaks: int,
    distant_pairs: int,
    merged_pairs: int,
    flow_links: int,
    continuous_links: int,
    track_count: int,
) -> dict[str, Any]:
    separation = 1 - merged_pairs / distant_pairs if distant_pairs else 1.0
    continuity = continuous_links / flow_links if flow_links else 0.0
    large_regions = sum(row["large_regions"] for row in rows)
    large_multi_core_regions = sum(row["large_multi_core_regions"] for row in rows)
    component_matches = sum(row["matches"] for row in rows[1:])
    eligible_matches = sum(
        min(previous["segments"], current["segments"])
        for previous, current in zip(rows, rows[1:])
    )
    component_match_rate = component_matches / eligible_matches if eligible_matches else 0
    scored_frames = len(rows)
    score = 100 * (0.7 * separation + 0.3 * component_match_rate)
    return {
        "method": name,
        "score": round(score, 2),
        "core_coverage": round(covered_peaks / peak_count, 4) if peak_count else 0,
        "distant_core_separation": round(separation, 4),
        "distant_core_pairs": distant_pairs,
        "merged_distant_core_pairs": merged_pairs,
        "flow_link_continuity": round(continuity, 4),
        "flow_link_count": flow_links,
        "continuous_flow_links": continuous_links,
        "component_match_rate": round(component_match_rate, 4),
        "component_matches": component_matches,
        "eligible_component_matches": eligible_matches,
        "large_regions_above_area_threshold": large_regions,
        "large_multi_core_regions": large_multi_core_regions,
        "median_segments_per_frame": round(float(np.median([r["segments"] for r in rows])), 1),
        "max_cluster_area": max((row["largest_area"] for row in rows), default=0),
        "track_count": track_count,
        "scored_frames": scored_frames,
        "score_definition": "70% distant-core separation + 30% component match rate",
    }


def _render(
    frames: list[dict[str, Any]],
    summaries: dict[str, dict[str, Any]],
    output: Path,
) -> None:
    panel_width, image_height, header = 270, 135, 50
    canvas = np.full((len(METHODS) * (image_height + header), len(PANEL_TIMES) * panel_width, 3), 248, np.uint8)
    frame_by_time = {frame["time"]: frame for frame in frames}
    for row_index, method in enumerate(METHODS):
        summary = summaries[method]
        ybase = row_index * (image_height + header)
        cv2.putText(
            canvas,
            f'{method.upper()}  score {summary["score"]:.1f}  sep {summary["distant_core_separation"]:.2f}  match {summary["component_match_rate"]:.2f}',
            (8, ybase + 19), cv2.FONT_HERSHEY_SIMPLEX, 0.46, (25, 25, 25), 1, cv2.LINE_AA,
        )
        for column, time in enumerate(PANEL_TIMES):
            frame = frame_by_time[time]
            image = frame["rgb"].copy()
            overlay = image.copy()
            for component in frame["methods"][method]:
                color = _color(component["id"])
                overlay[component["mask"] > 0] = color
            image = cv2.addWeighted(image, 0.58, overlay, 0.42, 0)
            for component in frame["methods"][method]:
                contours, _ = cv2.findContours(component["mask"], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                cv2.drawContours(image, contours, -1, _color(component["id"]), 1, cv2.LINE_AA)
                x, y = map(int, component["center"])
                cv2.putText(image, str(component["id"]), (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (0, 0, 0), 2, cv2.LINE_AA)
                cv2.putText(image, str(component["id"]), (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 255), 1, cv2.LINE_AA)
            image = cv2.resize(image, (panel_width, image_height), interpolation=cv2.INTER_AREA)
            xbase = column * panel_width
            canvas[ybase + header:ybase + header + image_height, xbase:xbase + panel_width] = image
            cv2.putText(
                canvas, time, (xbase + 6, ybase + header - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (30, 30, 30), 1, cv2.LINE_AA,
            )
    if not cv2.imwrite(str(output), canvas):
        raise OSError(f"Could not write comparison image: {output}")


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.width < 100 or args.minimum_area < 1:
        raise ValueError("--width must be at least 100 and --minimum-area must be positive")
    paths = sorted(args.snapshots.glob("imergert_alpha.*.png"))
    if not paths:
        raise FileNotFoundError(f"No IMERG PNG snapshots found in {args.snapshots}")

    method_rows: dict[str, list[dict[str, Any]]] = {name: [] for name in METHODS}
    method_summaries: dict[str, dict[str, Any]] = {}
    all_render_frames = []
    for method in METHODS:
        previous_gray = None
        previous_components: list[dict[str, Any]] = []
        previous_cores: list[dict[str, Any]] = []
        next_id = 1
        totals = dict(peak_count=0, covered_peaks=0, distant_pairs=0, merged_pairs=0, flow_links=0, continuous_links=0)

        for frame_index, path in enumerate(paths):
            rgb, _, mask = preprocess.read_frame(path, args.width, args.alpha_threshold, 1)
            _, peaks = preprocess.core_features(rgb, mask, args.core_saturation, args.core_darkness)
            components = segment(
                method, rgb, mask, args.minimum_area, args.core_saturation,
                args.core_darkness, args.core_merge_distance,
            )
            gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
            gray[mask == 0] = 0
            flow = None if previous_gray is None else cv2.calcOpticalFlowFarneback(
                previous_gray, gray, None, 0.5, 3, 21, 3, 5, 1.2, 0,
            )
            next_id, associations, transition = _track_frame(
                previous_components, components, flow, next_id, args.maximum_motion,
            )

            owners = np.full(mask.shape, -1, dtype=np.int32)
            for component_index, component in enumerate(components):
                owners[component["mask"] > 0] = component_index
            for peak in peaks:
                x = int(np.clip(round(peak["x"]), 0, mask.shape[1] - 1))
                y = int(np.clip(round(peak["y"]), 0, mask.shape[0] - 1))
                peak["owner"] = int(owners[y, x])
                peak["lineage"] = (
                    set(components[peak["owner"]]["lineage"])
                    if peak["owner"] >= 0 else set()
                )
            for first_index, first in enumerate(peaks):
                if first["owner"] < 0:
                    continue
                for second in peaks[first_index + 1:]:
                    if second["owner"] < 0 or first["hue"] != second["hue"]:
                        continue
                    if math.hypot(first["x"] - second["x"], first["y"] - second["y"]) < 32:
                        continue
                    totals["distant_pairs"] += 1
                    totals["merged_pairs"] += int(first["owner"] == second["owner"])
            totals["peak_count"] += len(peaks)
            totals["covered_peaks"] += sum(peak["owner"] >= 0 for peak in peaks)

            if flow is not None:
                links, continuous = _core_links(previous_cores, peaks, flow, args.maximum_motion)
                totals["flow_links"] += links
                totals["continuous_links"] += continuous
            row = {
                "time": path.name.split("T")[-1][:5],
                "segments": len(components),
                "largest_area": max((item["area"] for item in components), default=0),
                "large_regions": sum(item["area"] >= args.large_cluster_area for item in components),
                "large_multi_core_regions": sum(
                    item["area"] >= args.large_cluster_area and len(item["core_points"]) >= 2
                    for item in components
                ),
                "matches": transition["matches"],
                "merge_events": transition["merges"],
                "split_events": transition["splits"],
                "new_tracks": sum(not any(target == index for _, target, _, _ in associations)
                                  for index in range(len(components))),
                "active_track_ids": len({item["id"] for item in components}),
            }
            method_rows[method].append(row)
            for component in components:
                component["time"] = row["time"]
            if method == METHODS[0]:
                render_frame = {
                    "time": row["time"], "rgb": rgb,
                    "methods": {method: components},
                }
                all_render_frames.append(render_frame)
            else:
                render_frame = all_render_frames[frame_index]
                render_frame["methods"][method] = components

            previous_gray = gray
            previous_components = components
            previous_cores = peaks

        method_summaries[method] = _summary(
            method, method_rows[method], totals["peak_count"], totals["covered_peaks"],
            totals["distant_pairs"], totals["merged_pairs"], totals["flow_links"],
            totals["continuous_links"], next_id - 1,
        )

    best = max(METHODS, key=lambda name: method_summaries[name]["score"])
    report = {
        "source": "NASA IMERG alpha snapshots, 2026-11-07, 30-minute cadence",
        "caveat": "Metrics are image-derived proxies, not meteorological ground truth. Local color peaks and optical flow can miss or confuse storm cores.",
        "settings": {
            "snapshot_count": len(paths), "analysis_width": args.width,
            "minimum_area": args.minimum_area, "core_saturation": args.core_saturation,
            "core_darkness": args.core_darkness, "core_merge_distance": args.core_merge_distance,
            "maximum_motion": args.maximum_motion, "large_cluster_area": args.large_cluster_area,
        },
        "selection": {
            "method": best,
            "reason": "Highest separation-prioritized score: distant-core separation has 70% weight and component match rate has 30%.",
        },
        "methods": [method_summaries[name] for name in METHODS],
        "timeseries": method_rows,
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "comparison.json").write_text(json.dumps(report, indent=2) + "\n")
    with (args.output_dir / "timeseries.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=["method", *method_rows[METHODS[0]][0].keys()],
        )
        writer.writeheader()
        for method in METHODS:
            writer.writerows({"method": method, **row} for row in method_rows[method])
    _render(all_render_frames, method_summaries, args.output_dir / "comparison.png")
    print(json.dumps(report["selection"] | {"methods": method_summaries}, indent=2))
    return report


def main() -> None:
    run(parse_args())


if __name__ == "__main__":
    main()
