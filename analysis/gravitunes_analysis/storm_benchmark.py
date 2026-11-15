#!/usr/bin/env python3
"""Reproducibly compare image-derived storm segmentation and tracking variants.

All labels are image-derived pseudo-ground-truth, not meteorological ground truth.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from . import storms as preprocess


ROOT = preprocess.REPO_ROOT / "analysis" / "scripts" / "storm-watch"
DEFAULT_OUTPUT = ROOT / "benchmark-results.json"
DEFAULT_DIAGNOSTICS = ROOT / "diagnostics"
FOCUS_FRAME = 20
FOCUS_POSITION = (416, 334)
REFERENCE_CORE_SATURATION = 100
REFERENCE_CORE_STRENGTH = 160
REFERENCE_MOTION_GATE = 56
ANCHOR_OUTLINE_TOLERANCE = 12


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--diagnostics-dir", type=Path, default=DEFAULT_DIAGNOSTICS)
    parser.add_argument("--skip-diagnostics", action="store_true")
    parser.add_argument("--snapshots", type=Path, default=preprocess.SNAPSHOT_DIR)
    return parser.parse_args()


def scenario_args(snapshots: Path, **overrides: Any) -> argparse.Namespace:
    values = {
        "snapshots": snapshots,
        "output": preprocess.OUTPUT,
        "width": 900,
        "minimum_area": 800,
        "alpha_threshold": 16,
        "gap_radius": 1,
        "core_saturation": 100,
        "core_darkness": 75,
        "core_merge_distance": 36,
        "color_tolerance": 100,
        "maximum_motion": 56,
        "overlap_threshold": 0.1,
        "merge_overlap": 0.2,
        "flow_mask_weight": 0.46,
        "core_motion_weight": 0.26,
        "memory_frames": 2,
        "contour_epsilon": 1.25,
        "segmenter": "watershed",
        "tracker": "flow",
        "quiet": True,
    }
    values.update(overrides)
    return argparse.Namespace(**values)


def component_mask(component: dict[str, Any], width: int, height: int) -> np.ndarray:
    mask = np.zeros((height, width), dtype=np.uint8)
    for polygon in component["polygons"]:
        outer = np.asarray(polygon["outer"], dtype=np.int32)
        if len(outer) >= 3:
            cv2.fillPoly(mask, [outer], 1)
        for hole in polygon["holes"]:
            points = np.asarray(hole, dtype=np.int32)
            if len(points) >= 3:
                cv2.fillPoly(mask, [points], 0)
    return mask


def component_outline(component: dict[str, Any], width: int, height: int) -> np.ndarray:
    outline = np.zeros((height, width), dtype=np.uint8)
    for polygon in component["polygons"]:
        outer = np.asarray(polygon["outer"], dtype=np.int32)
        if len(outer) >= 3:
            cv2.fillPoly(outline, [outer], 1)
    return outline


def frame_rasters(frame: dict[str, Any], width: int, height: int) -> tuple[np.ndarray, list[np.ndarray]]:
    owner = np.zeros((height, width), dtype=np.int32)
    masks = []
    for index, component in enumerate(frame["components"], start=1):
        mask = component_mask(component, width, height)
        owner[mask > 0] = index
        masks.append(mask)
    return owner, masks


def flow_linked_peaks(
    previous: list[dict[str, Any]],
    current: list[dict[str, Any]],
    flow: np.ndarray,
    max_distance: float,
) -> list[tuple[int, int]]:
    candidates = []
    for first, source in enumerate(previous):
        dx, dy = preprocess.point_flow(flow, source["x"], source["y"])
        px, py = source["x"] + dx, source["y"] + dy
        for second, target in enumerate(current):
            if source["hue"] != target["hue"]:
                continue
            distance = math.hypot(px - target["x"], py - target["y"])
            if distance <= max_distance:
                candidates.append((distance, first, second))
    result = []
    used_first, used_second = set(), set()
    for _, first, second in sorted(candidates):
        if first in used_first or second in used_second:
            continue
        result.append((first, second))
        used_first.add(first)
        used_second.add(second)
    return result


def evaluate(result: dict[str, Any], options: argparse.Namespace) -> dict[str, Any]:
    width, height = result["width"], result["height"]
    peak_count = covered_peaks = 0
    distinct_pairs = false_merge_pairs = 0
    links = continuous_links = merge_links = continuous_merge_links = 0
    anchor_count = misplaced_anchors = 0
    uncovered_by_frame = []
    peak_records: list[list[dict[str, Any]]] = []
    frame_owners = []
    gray_frames = []
    flow_cache = []

    for index, frame in enumerate(result["frames"]):
        path = preprocess.image_path(options.snapshots, frame["time"])
        if getattr(options, "frame_cache", None):
            rgb, _, alpha_mask = options.frame_cache[frame["time"]]
        else:
            rgb, _, alpha_mask = preprocess.read_frame(
                path, width, options.alpha_threshold, options.gap_radius,
            )
        _, peaks = preprocess.core_features(
            rgb, alpha_mask, REFERENCE_CORE_SATURATION, REFERENCE_CORE_STRENGTH,
        )
        owner, _ = frame_rasters(frame, width, height)
        for component in frame["components"]:
            outline = component_outline(component, width, height)
            distance_to_outline = cv2.distanceTransform(
                (1 - outline).astype(np.uint8), cv2.DIST_L2, 5,
            )
            for anchor in component.get("lineageAnchors", []):
                x, y = round(anchor["x"]), round(anchor["y"])
                anchor_count += 1
                if not (0 <= x < width and 0 <= y < height
                    and distance_to_outline[y, x] <= ANCHOR_OUTLINE_TOLERANCE):
                    misplaced_anchors += 1
        records = []
        misses = 0
        for peak in peaks:
            x, y = int(round(peak["x"])), int(round(peak["y"]))
            x, y = np.clip(x, 0, width - 1), np.clip(y, 0, height - 1)
            component_index = int(owner[y, x]) - 1
            component = frame["components"][component_index] if component_index >= 0 else None
            if component is None:
                misses += 1
            else:
                covered_peaks += 1
            records.append({
                **peak,
                "owner": component_index,
                "id": component["id"] if component else None,
                "lineage": set(component["lineageIds"]) if component else set(),
                "merged": bool(component and len(component["lineageIds"]) > 1),
            })
        peak_count += len(peaks)
        uncovered_by_frame.append(misses)
        peak_records.append(records)
        frame_owners.append(owner)
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        gray[alpha_mask == 0] = 0
        gray_frames.append(gray)

        for first in range(len(records)):
            a = records[first]
            if a["owner"] < 0:
                continue
            for b in records[first + 1:]:
                if b["owner"] < 0:
                    continue
                distance = math.hypot(a["x"] - b["x"], a["y"] - b["y"])
                if distance < 32:
                    continue
                distinct_pairs += 1
                if a["owner"] == b["owner"]:
                    false_merge_pairs += 1

    for index in range(len(peak_records) - 1):
        flow = cv2.calcOpticalFlowFarneback(
            gray_frames[index], gray_frames[index + 1], None, 0.5, 3, 21, 3, 5, 1.2, 0,
        )
        flow_cache.append(flow)
        pairs = flow_linked_peaks(peak_records[index], peak_records[index + 1], flow, REFERENCE_MOTION_GATE)
        for first, second in pairs:
            source, target = peak_records[index][first], peak_records[index + 1][second]
            if source["owner"] < 0 or target["owner"] < 0:
                continue
            links += 1
            same_lineage = bool(source["lineage"] & target["lineage"])
            continuous_links += int(same_lineage)
            if source["merged"] or target["merged"]:
                merge_links += 1
                continuous_merge_links += int(same_lineage)

    core_coverage = covered_peaks / peak_count if peak_count else 0
    separation = 1 - false_merge_pairs / distinct_pairs if distinct_pairs else 1
    continuity = continuous_links / links if links else 0
    merge_continuity = continuous_merge_links / merge_links if merge_links else 0
    anchor_alignment = 1 - misplaced_anchors / anchor_count if anchor_count else 1
    false_split_rate = 1 - continuity
    false_merge_rate = false_merge_pairs / distinct_pairs if distinct_pairs else 0
    # Include spatially aligned core anchors so stale lineage markers penalize
    # the score; all values are tuning aids, not meteorological skill scores.
    score = 100 * (core_coverage + separation + continuity + anchor_alignment) / 4
    return {
        "score": round(score, 2),
        "corePeakCount": peak_count,
        "coreCoverage": round(core_coverage, 4),
        "coveredCorePeaks": covered_peaks,
        "distinctPeakPairs": distinct_pairs,
        "coreSeparation": round(separation, 4),
        "falseMergeRate": round(false_merge_rate, 4),
        "flowLinkedPeakPairs": links,
        "identityContinuity": round(continuity, 4),
        "falseSplitRate": round(false_split_rate, 4),
        "mergeInvolvingLinks": merge_links,
        "mergeIdentityContinuity": round(merge_continuity, 4),
        "lineageAnchorCount": anchor_count,
        "misplacedLineageAnchors": misplaced_anchors,
        "lineageAnchorAlignment": round(anchor_alignment, 4),
        "trackCount": result["summary"]["trackCount"],
        "componentCount": result["summary"]["componentCount"],
        "mergeEvents": result["summary"]["mergeEvents"],
        "uncoveredPeaksByFrame": uncovered_by_frame,
    }


def focus_id_for_result(result: dict[str, Any]) -> int | None:
    components = result["frames"][FOCUS_FRAME]["components"]
    if not components:
        return None
    x, y = FOCUS_POSITION
    nearest = min(
        components,
        key=lambda component: math.hypot(component["coreX"] - x, component["coreY"] - y),
    )
    return nearest["id"]


def diagnostic_montage(result: dict[str, Any], options: argparse.Namespace, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    width, height = result["width"], result["height"]
    focus_id = focus_id_for_result(result)
    first, last = 8, 31
    card_width, card_height = 600, 188
    columns = 2
    frame_ids = list(range(first, last))
    rows = math.ceil(len(frame_ids) / columns)
    canvas = np.full((rows * card_height, columns * card_width, 3), 15, dtype=np.uint8)
    for position, frame_index in enumerate(frame_ids):
        frame = result["frames"][frame_index]
        path = preprocess.image_path(options.snapshots, frame["time"])
        source = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if source is None:
            continue
        source = cv2.resize(source, (280, 140), interpolation=cv2.INTER_AREA)
        overlay = source.copy()
        focus = []
        for component in frame["components"]:
            family = focus_id is not None and focus_id in component["lineageIds"]
            color_hue = (component["id"] * 137) % 180
            color = cv2.cvtColor(np.uint8([[[color_hue, 220, 255]]]), cv2.COLOR_HSV2BGR)[0, 0].tolist()
            if family:
                focus.append(component)
                color = [40, 240, 255]
            for polygon in component["polygons"]:
                outer = np.asarray(polygon["outer"], dtype=np.float32)
                if len(outer) < 3:
                    continue
                scaled = np.round(outer * np.array([280 / width, 140 / height])).astype(np.int32)
                cv2.polylines(overlay, [scaled], True, color, 1 if not family else 2, cv2.LINE_AA)
        nearest = min(
            frame["components"],
            key=lambda component: math.hypot(component["coreX"] - FOCUS_POSITION[0], component["coreY"] - FOCUS_POSITION[1]),
            default=None,
        )
        title = f"{frame['time']} UTC  focus id={focus_id}  nearest={nearest['id'] if nearest else '-'}"
        card_x = (position % columns) * card_width
        card_y = (position // columns) * card_height
        cv2.putText(canvas, title, (card_x + 8, card_y + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.43, (230, 235, 245), 1, cv2.LINE_AA)
        cv2.putText(canvas, "snapshot", (card_x + 8, card_y + 37), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (180, 190, 205), 1, cv2.LINE_AA)
        cv2.putText(canvas, "tracked polygon overlay", (card_x + 300, card_y + 37), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (180, 190, 205), 1, cv2.LINE_AA)
        canvas[card_y + 42:card_y + 182, card_x + 8:card_x + 288] = source
        canvas[card_y + 42:card_y + 182, card_x + 300:card_x + 580] = overlay
    output = output_dir / "storm38-continuity.jpg"
    cv2.imwrite(str(output), canvas, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return output


def diagnostic_detail(result: dict[str, Any], options: argparse.Namespace, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    width, height = result["width"], result["height"]
    focus_id = focus_id_for_result(result)
    x0, y0, x1, y1 = 280, 240, 560, 420
    panel_width, panel_height = 576, 230
    indices = range(18, 31)
    columns = 2
    rows = math.ceil(len(indices) / columns)
    canvas = np.full((rows * panel_height, columns * panel_width, 3), 15, dtype=np.uint8)
    for position, frame_index in enumerate(indices):
        frame = result["frames"][frame_index]
        path = preprocess.image_path(options.snapshots, frame["time"])
        original = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if original is None:
            continue
        rgb = cv2.cvtColor(original[:, :, :3], cv2.COLOR_BGR2RGB)
        rgb = cv2.resize(rgb, (width, height), interpolation=cv2.INTER_AREA)
        source = cv2.cvtColor(rgb[y0:y1, x0:x1], cv2.COLOR_RGB2BGR)
        overlay = source.copy()
        for component in frame["components"]:
            if focus_id is None or focus_id not in component["lineageIds"]:
                continue
            layer = np.zeros_like(overlay)
            for polygon in component["polygons"]:
                for ring in [polygon["outer"], *(polygon["holes"] or [])]:
                    points = np.asarray(ring, dtype=np.int32)
                    if len(points) < 3:
                        continue
                    points -= np.array([x0, y0], dtype=np.int32)
                    cv2.fillPoly(layer, [points], (40, 240, 255))
            active = np.any(layer != 0, axis=2)
            overlay[active] = cv2.addWeighted(overlay, 0.35, layer, 0.65, 0)[active]
            for polygon in component["polygons"]:
                points = np.asarray(polygon["outer"], dtype=np.int32) - np.array([x0, y0], dtype=np.int32)
                cv2.polylines(overlay, [points], True, (40, 240, 255), 2, cv2.LINE_AA)
        card_x = (position % columns) * panel_width
        card_y = (position // columns) * panel_height
        cv2.putText(canvas, f"{frame['time']} UTC · selected Storm {focus_id}", (card_x + 8, card_y + 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, (230, 235, 245), 1, cv2.LINE_AA)
        cv2.putText(canvas, "snapshot crop", (card_x + 8, card_y + 39), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (180, 190, 205), 1, cv2.LINE_AA)
        cv2.putText(canvas, "lineage-highlighted polygons", (card_x + 292, card_y + 39), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (180, 190, 205), 1, cv2.LINE_AA)
        canvas[card_y + 48:card_y + 228, card_x + 8:card_x + 288] = source
        canvas[card_y + 48:card_y + 228, card_x + 292:card_x + 572] = overlay
    output = output_dir / "storm38-detail.jpg"
    cv2.imwrite(str(output), canvas, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return output


def main() -> None:
    cli = parse_args()
    print("Loading the 48 snapshots once for a reproducible in-memory benchmark cache…", flush=True)
    cache = {
        time: preprocess.read_frame(
            preprocess.image_path(cli.snapshots, time), 900, 16, 1,
        )
        for time in preprocess.snapshot_times(cli.snapshots)
    }
    scenarios = [
        ("connected + core-nearest baseline", {"segmenter": "connected", "tracker": "core-nearest"}),
        ("core watershed + optical flow · 800 px cutoff", {
            "segmenter": "watershed", "tracker": "flow", "minimum_area": 800,
        }),
        ("connected + optical flow · 200 px cutoff", {
            "segmenter": "connected", "tracker": "flow", "minimum_area": 200,
        }),
        ("core watershed + core-nearest · 200 px cutoff", {
            "segmenter": "watershed", "tracker": "core-nearest", "minimum_area": 200,
        }),
        ("core watershed + optical flow · 200 px cutoff", {
            "segmenter": "watershed", "tracker": "flow", "minimum_area": 200,
        }),
        ("core watershed + optical flow · 100 px cutoff", {
            "segmenter": "watershed", "tracker": "flow", "minimum_area": 100,
        }),
        ("core watershed + optical flow · 50 px cutoff", {
            "segmenter": "watershed", "tracker": "flow", "minimum_area": 50,
        }),
        ("tuned watershed + optical flow · stronger cores", {
            "segmenter": "watershed", "tracker": "flow", "minimum_area": 200,
            "core_saturation": 100, "core_darkness": 140, "maximum_motion": 64,
        }),
        ("tuned watershed + optical flow · stronger cores + UI motion", {
            "segmenter": "watershed", "tracker": "flow", "minimum_area": 200,
            "core_saturation": 100, "core_darkness": 140, "maximum_motion": 56,
            "overlap_threshold": 0.1,
        }),
        ("tuned watershed + optical flow · core weighted", {
            "segmenter": "watershed", "tracker": "flow", "minimum_area": 200,
            "flow_mask_weight": 0.25, "core_motion_weight": 0.47,
        }),
    ]
    results = []
    generated = []
    for name, changes in scenarios:
        options = scenario_args(cli.snapshots, **changes)
        options.frame_cache = cache
        print(f"\nBenchmarking: {name}", flush=True)
        result = preprocess.build(options)
        metrics = evaluate(result, options)
        results.append({"name": name, "settings": {
            "segmenter": options.segmenter, "tracker": options.tracker,
            "coreSaturation": options.core_saturation, "coreDarkness": options.core_darkness,
            "maximumMotion": options.maximum_motion, "minimumArea": options.minimum_area,
            "flowMaskWeight": options.flow_mask_weight, "coreMotionWeight": options.core_motion_weight,
        }, "metrics": metrics})
        generated.append((result, options))
        print(json.dumps(results[-1], indent=2), flush=True)

    best_index = max(range(len(results)), key=lambda index: results[index]["metrics"]["score"])
    deployment_index = next(
        index for index, result in enumerate(results)
        if result["name"] == "tuned watershed + optical flow · stronger cores + UI motion"
    )
    best_result, best_options = generated[deployment_index]
    best_result.pop("_continuity", None)
    generated_focus_id = focus_id_for_result(best_result)
    aligned_focus_id = preprocess.align_reference_identity(best_result, 38)
    preprocess.OUTPUT.write_text(
        json.dumps(best_result, separators=(",", ":"), ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    diagnostics = None
    detail = None
    if not cli.skip_diagnostics:
        diagnostics = diagnostic_montage(best_result, best_options, cli.diagnostics_dir)
        detail = diagnostic_detail(best_result, best_options, cli.diagnostics_dir)
    report = {
        "caveat": "Metrics use image-derived dark red/blue local maxima and optical-flow pseudo-links, not meteorological ground truth.",
        "pseudoGroundTruthSignal": {
            "coreSaturation": REFERENCE_CORE_SATURATION,
            "coreStrengthThreshold": REFERENCE_CORE_STRENGTH,
            "distinctPeakDistance": 32,
            "temporalFlowLinkGate": REFERENCE_MOTION_GATE,
        },
        "lineageAnchorOutlineTolerance": ANCHOR_OUTLINE_TOLERANCE,
        "compositeScoreComponents": [
            "coreCoverage", "coreSeparation", "identityContinuity", "lineageAnchorAlignment",
        ],
        "methods": results,
        "selectedMethod": results[deployment_index]["name"],
        "highestCompositeScoreMethod": results[best_index]["name"],
        "selectionNote": "Deployment uses the 200 px cutoff and stronger core threshold: it improves merge-linked continuity without the severe identity/polygon proliferation at 50 px. The 50 px setting wins the simple composite score but is intentionally not the deploy choice.",
        "preprocessedOutput": str(preprocess.OUTPUT.resolve().relative_to(preprocess.REPO_ROOT)),
        "diagnosticImage": str(diagnostics.resolve().relative_to(preprocess.REPO_ROOT)) if diagnostics else None,
        "storm38DetailImage": str(detail.resolve().relative_to(preprocess.REPO_ROOT)) if detail else None,
        "storm38LocationReference": {
            "frameIndex": FOCUS_FRAME, "time": best_result["frames"][FOCUS_FRAME]["time"],
            "analysisPosition": list(FOCUS_POSITION),
            "nearestTrackId": aligned_focus_id,
            "generatedIdBeforeLegacyAlignment": generated_focus_id,
            "description": "Track closest to the prior Storm 38 diagnostic position at 10:00 UTC; generated ID is remapped to 38 for direct comparison with the earlier tracker.",
        },
    }
    cli.output.parent.mkdir(parents=True, exist_ok=True)
    cli.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nSelected {report['selectedMethod']}; wrote {preprocess.OUTPUT} and {cli.output}")
    if diagnostics:
        print(f"Diagnostic montage: {diagnostics}")


if __name__ == "__main__":
    main()
