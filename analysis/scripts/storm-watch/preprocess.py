#!/usr/bin/env python3
"""Build compact, polygon-only storm tracks from the bundled IMERG snapshots."""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[2]
SNAPSHOT_DIR = REPO_ROOT / "data" / "nasa-svs" / "4285"
OUTPUT = REPO_ROOT / "app" / "modes" / "storm-watch" / "data" / "preprocessed-tracks.json"
TIMES = [f"{hour:02d}:{minute:02d}" for hour in range(24) for minute in (0, 30)]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshots", type=Path, default=SNAPSHOT_DIR)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--width", type=int, default=900, help="analysis width; height follows image aspect ratio")
    parser.add_argument("--minimum-area", type=int, default=200, help="minimum grouped mask area in analysis pixels")
    parser.add_argument("--alpha-threshold", type=int, default=16)
    parser.add_argument("--gap-radius", type=int, default=1, help="binary mask closing radius in analysis pixels")
    parser.add_argument("--core-saturation", type=int, default=100)
    parser.add_argument("--core-darkness", type=int, default=140, help="minimum 0-255 dark-core strength")
    parser.add_argument("--core-merge-distance", type=float, default=36)
    parser.add_argument("--color-tolerance", type=float, default=100)
    parser.add_argument("--maximum-motion", type=float, default=56, help="core-motion association gate in analysis pixels")
    parser.add_argument("--overlap-threshold", type=float, default=0.1)
    parser.add_argument("--merge-overlap", type=float, default=0.2)
    parser.add_argument("--flow-mask-weight", type=float, default=0.46)
    parser.add_argument("--core-motion-weight", type=float, default=0.26)
    parser.add_argument("--memory-frames", type=int, default=2)
    parser.add_argument("--contour-epsilon", type=float, default=1.25)
    parser.add_argument("--segmenter", choices=("watershed", "connected"), default="watershed")
    parser.add_argument("--tracker", choices=("flow", "core-nearest"), default="flow")
    return parser.parse_args()


def image_path(directory: Path, time: str) -> Path:
    return directory / f"imergert_alpha.2026-11-07T{time}:00Z.png"


def read_frame(path: Path, width: int, alpha_threshold: int, gap_radius: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    source = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if source is None or source.ndim != 3 or source.shape[2] != 4:
        raise ValueError(f"Expected an RGBA PNG snapshot at {path}")
    height = round(source.shape[0] * width / source.shape[1])
    resized = cv2.resize(source, (width, height), interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(resized[:, :, :3], cv2.COLOR_BGR2RGB)
    alpha = resized[:, :, 3]
    mask = np.uint8(alpha >= alpha_threshold)
    if gap_radius:
        size = gap_radius * 2 + 1
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    return rgb, alpha, mask


def hue_type(hue: int) -> str | None:
    if hue <= 12 or hue >= 168:
        return "red"
    if 92 <= hue <= 140:
        return "blue"
    return None


def core_features(rgb: np.ndarray, mask: np.ndarray, min_saturation: int, min_darkness: int) -> tuple[np.ndarray, list[dict[str, Any]]]:
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    hue, saturation, value = cv2.split(hsv)
    color_mask = (mask > 0) & (saturation >= min_saturation) & (value <= 210)
    red = (hue <= 12) | (hue >= 168)
    blue = (hue >= 92) & (hue <= 140)
    darkness = np.uint8(saturation.astype(np.float32) * (255 - value.astype(np.float32)) / 255)
    strength = np.uint8(color_mask & (red | blue)) * darkness
    neighborhood = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))
    local_maximum = cv2.dilate(strength, neighborhood)
    peak_mask = np.uint8((strength >= min_darkness) & (strength == local_maximum))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(peak_mask, 8)
    cores = []
    for label in range(1, count):
        x, y, w, h = (int(stats[label, i]) for i in range(4))
        local = labels[y:y + h, x:x + w] == label
        local_y, local_x = np.where(local)
        ys, xs = local_y + y, local_x + x
        weight = np.maximum(1, strength[ys, xs]).astype(np.float64)
        h = int(np.median(hue[ys, xs]))
        cores.append({
            "x": float(np.average(xs, weights=weight)),
            "y": float(np.average(ys, weights=weight)),
            "strength": float(np.max(strength[ys, xs])),
            "hue": hue_type(h),
        })
    return np.uint8(strength >= min_darkness), cores


def color_distance(first: np.ndarray, second: np.ndarray) -> float:
    return float(np.linalg.norm(first.astype(np.float32) - second.astype(np.float32)))


def find_components(
    rgb: np.ndarray,
    mask: np.ndarray,
    min_area: int,
    core_saturation: int,
    core_darkness: int,
    core_merge_distance: float,
    color_tolerance: float,
    segmenter: str,
) -> list[dict[str, Any]]:
    height, width = mask.shape
    _, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    core_mask, core_points = core_features(rgb, mask, core_saturation, core_darkness)
    labels_with_cores = set()
    for point in core_points:
        px = int(np.clip(round(point["x"]), 0, width - 1))
        py = int(np.clip(round(point["y"]), 0, height - 1))
        label = int(labels[py, px])
        if label:
            labels_with_cores.add(label)
    features: list[dict[str, Any]] = []
    for label in range(1, len(stats)):
        area = int(stats[label, cv2.CC_STAT_AREA])
        non_core_floor = max(20, min_area // 2)
        if area < non_core_floor and label not in labels_with_cores:
            continue
        x, y, w, h = (int(stats[label, i]) for i in range(4))
        roi = labels[y:y + h, x:x + w] == label
        local_y, local_x = np.where(roi)
        if not len(local_x):
            continue
        peaks = [
            {**point, "x": point["x"] - x, "y": point["y"] - y}
            for point in core_points
            if 0 <= round(point["x"]) - x < w and 0 <= round(point["y"]) - y < h
            and roi[int(round(point["y"])) - y, int(round(point["x"])) - x]
        ]
        if not peaks:
            peaks = [{"x": float(np.mean(np.where(roi)[1])), "y": float(np.mean(np.where(roi)[0])),
                      "strength": 0.0, "hue": None}]
        # A local-maximum detector can leave several adjacent peaks on a broad
        # plateau; collapse only same-color maxima inside a small neighborhood.
        selected_peaks = []
        for peak in sorted(peaks, key=lambda item: item["strength"], reverse=True):
            near = next((prior for prior in selected_peaks
                         if prior["hue"] == peak["hue"]
                         and math.hypot(prior["x"] - peak["x"], prior["y"] - peak["y"]) < core_merge_distance), None)
            if near is None:
                selected_peaks.append(peak)
        if segmenter == "watershed" and len(selected_peaks) > 1:
            markers = np.ones(roi.shape, dtype=np.int32)
            markers[roi] = 0
            for seed_index, peak in enumerate(selected_peaks, start=2):
                px = int(np.clip(round(peak["x"]), 0, w - 1))
                py = int(np.clip(round(peak["y"]), 0, h - 1))
                markers[py, px] = seed_index
            cv2.watershed(rgb[y:y + h, x:x + w].copy(), markers)
            seed_image = np.ones(roi.shape, dtype=np.uint8)
            for seed_index, peak in enumerate(selected_peaks, start=2):
                seed_image[int(np.clip(round(peak["y"]), 0, h - 1)),
                           int(np.clip(round(peak["x"]), 0, w - 1))] = 0
            _, nearest_seed = cv2.distanceTransformWithLabels(
                seed_image, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_CCOMP,
            )
            seed_label_to_index = {}
            for seed_index, peak in enumerate(selected_peaks, start=2):
                local_y = int(np.clip(round(peak["y"]), 0, h - 1))
                local_x = int(np.clip(round(peak["x"]), 0, w - 1))
                seed_label_to_index[int(nearest_seed[local_y, local_x])] = seed_index
            watershed_labels = np.zeros(roi.shape, dtype=np.int32)
            for seed_label, seed_index in seed_label_to_index.items():
                watershed_labels[nearest_seed == seed_label] = markers[markers == seed_index][0] if np.any(markers == seed_index) else seed_index
            watershed_labels[markers > 1] = markers[markers > 1]
            for seed_index, peak in enumerate(selected_peaks, start=2):
                piece = np.uint8(roi & (watershed_labels == seed_index))
                if not piece.any():
                    continue
                component_mask = np.zeros((height, width), dtype=np.uint8)
                component_mask[y:y + h, x:x + w] = piece
                ys, xs = np.where(component_mask)
                features.append({
                    "mask": component_mask,
                    "area": int(piece.sum()),
                    "bbox": (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())),
                    "cores": [{**peak, "x": peak["x"] + x, "y": peak["y"] + y}],
                })
        else:
            component_mask = np.uint8(labels == label)
            features.append({
                "mask": component_mask,
                "area": area,
                "bbox": (x, y, x + w - 1, y + h - 1),
                "cores": [{**peak, "x": peak["x"] + x, "y": peak["y"] + y} for peak in selected_peaks],
            })

    # If connected-component mode retains multiple cores in one mask, benchmark
    # them as one segment; watershed mode makes their separation explicit.
    for feature in features:
        x0, y0, x1, y1 = feature["bbox"]
        local_mask = feature["mask"][y0:y1 + 1, x0:x1 + 1] > 0
        local_y, local_x = np.where(local_mask)
        ys, xs = local_y + y0, local_x + x0
        feature["center"] = (float(xs.mean()), float(ys.mean()))
        feature["mean"] = np.mean(rgb[ys, xs], axis=0)

    parent = list(range(len(features)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(first: int, second: int) -> None:
        a, b = find(first), find(second)
        if a != b:
            parent[b] = a

    # Attach nearby non-core precipitation fragments to a core-bearing region
    # only when their mask boundaries and colors provide supporting evidence.
    for first in range(len(features)):
        a = features[first]
        ax0, ay0, ax1, ay1 = a["bbox"]
        for second in range(first + 1, len(features)):
            b = features[second]
            bx0, by0, bx1, by1 = b["bbox"]
            gap_x = max(0, bx0 - ax1 - 1, ax0 - bx1 - 1)
            gap_y = max(0, by0 - ay1 - 1, ay0 - by1 - 1)
            if math.hypot(gap_x, gap_y) > core_merge_distance:
                continue
            difference = color_distance(a["mean"], b["mean"])
            both_have_cores = bool(a["cores"]) and bool(b["cores"])
            same_core_peak = both_have_cores and any(
                math.hypot(core_a["x"] - core_b["x"], core_a["y"] - core_b["y"]) <= 8
                and (core_a["hue"] == core_b["hue"] or difference <= color_tolerance)
                for core_a in a["cores"] for core_b in b["cores"]
            )
            fragment_attachment = (not both_have_cores) and gap_x <= 12 and gap_y <= 12 and difference <= color_tolerance
            if same_core_peak or fragment_attachment:
                union(first, second)

    groups: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for index, feature in enumerate(features):
        groups[find(index)].append(feature)

    grouped = []
    for members in groups.values():
        area = sum(member["area"] for member in members)
        if area < min_area:
            continue
        component_mask = np.zeros((height, width), dtype=np.uint8)
        for member in members:
            component_mask |= member["mask"]
        points = [point for member in members for point in member["cores"]]
        if not points:
            points = [{
                "x": member["center"][0],
                "y": member["center"][1],
                "strength": 0.0,
                "hue": None,
            } for member in members]
        x0 = min(member["bbox"][0] for member in members)
        y0 = min(member["bbox"][1] for member in members)
        x1 = max(member["bbox"][2] for member in members)
        y1 = max(member["bbox"][3] for member in members)
        grouped.append({
            "area": area,
            "core_points": points,
            "mean_color": np.average(
                np.array([member["mean"] for member in members]),
                axis=0,
                weights=np.array([member["area"] for member in members]),
            ),
            "bbox": (x0, y0, x1, y1),
            "mask": component_mask,
        })
    return grouped


def polygon_contours(mask: np.ndarray, epsilon: float) -> list[dict[str, Any]]:
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return []
    hierarchy = hierarchy[0]
    result = []
    for index, contour in enumerate(contours):
        if hierarchy[index][3] != -1:
            continue
        outer = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
        if len(outer) < 3:
            continue
        holes = []
        child = hierarchy[index][2]
        while child != -1:
            hole = cv2.approxPolyDP(contours[child], epsilon, True).reshape(-1, 2)
            if len(hole) >= 3:
                holes.append(hole.astype(int).tolist())
            child = hierarchy[child][0]
        result.append({"outer": outer.astype(int).tolist(), "holes": holes})
    return result


def point_flow(flow: np.ndarray, x: float, y: float) -> tuple[float, float]:
    height, width = flow.shape[:2]
    xi = int(np.clip(round(x), 0, width - 1))
    yi = int(np.clip(round(y), 0, height - 1))
    dx, dy = map(float, flow[yi, xi])
    return float(np.clip(dx, -80, 80)), float(np.clip(dy, -80, 80))


def warp_mask(
    mask: np.ndarray,
    flow: np.ndarray,
    bbox: tuple[int, int, int, int],
) -> tuple[np.ndarray, tuple[int, int, int, int] | None]:
    x0, y0, x1, y1 = bbox
    local_y, local_x = np.where(mask[y0:y1 + 1, x0:x1 + 1] > 0)
    ys, xs = local_y + y0, local_x + x0
    warped = np.zeros_like(mask)
    if len(xs):
        dx = flow[ys, xs, 0]
        dy = flow[ys, xs, 1]
        nx = np.rint(xs + np.clip(dx, -80, 80)).astype(np.int32)
        ny = np.rint(ys + np.clip(dy, -80, 80)).astype(np.int32)
        valid = (nx >= 0) & (nx < mask.shape[1]) & (ny >= 0) & (ny < mask.shape[0])
        warped[ny[valid], nx[valid]] = 1
        x_min, x_max = int(nx[valid].min()), int(nx[valid].max())
        y_min, y_max = int(ny[valid].min()), int(ny[valid].max())
        bounds = (
            max(0, x_min - 1), max(0, y_min - 1),
            min(mask.shape[1] - 1, x_max + 1), min(mask.shape[0] - 1, y_max + 1),
        )
        return cv2.dilate(warped, np.ones((3, 3), np.uint8), iterations=1), bounds
    return warped, None


def nearest_core(component: dict[str, Any], x: float, y: float) -> tuple[dict[str, Any], float]:
    points = component["core_points"]
    point = min(points, key=lambda value: math.hypot(value["x"] - x, value["y"] - y))
    return point, math.hypot(point["x"] - x, point["y"] - y)


def association_candidates(
    sources: list[dict[str, Any]],
    targets: list[dict[str, Any]],
    flow: np.ndarray,
    max_motion: float,
    minimum_overlap: float,
    flow_mask_weight: float,
    core_motion_weight: float,
) -> list[dict[str, Any]]:
    candidates = []
    for source_index, source in enumerate(sources):
        source["pred_mask"], source["pred_bbox"] = warp_mask(source["mask"], flow, source["bbox"])
        source["pred_cores"] = []
        for anchor in source["anchors"]:
            dx, dy = point_flow(flow, anchor["x"], anchor["y"])
            source["pred_cores"].append({
                **anchor,
                "x": anchor["x"] + dx,
                "y": anchor["y"] + dy,
                "old_x": anchor["x"],
                "old_y": anchor["y"],
            })
        if not source["pred_cores"]:
            dx, dy = point_flow(flow, source["x"], source["y"])
            source["pred_cores"] = [{
                "id": source["id"], "x": source["x"] + dx, "y": source["y"] + dy,
                "old_x": source["x"], "old_y": source["y"], "vx": dx, "vy": dy,
            }]
        pred_points = source["pred_cores"]
        mask_area = int(source["pred_mask"].sum())
        for target_index, target in enumerate(targets):
            pred_bbox = source["pred_bbox"]
            target_bbox = target["bbox"]
            if pred_bbox is None:
                intersection = 0
            else:
                x0 = max(pred_bbox[0], target_bbox[0])
                y0 = max(pred_bbox[1], target_bbox[1])
                x1 = min(pred_bbox[2] + 1, target_bbox[2] + 1)
                y1 = min(pred_bbox[3] + 1, target_bbox[3] + 1)
                intersection = 0 if x0 >= x1 or y0 >= y1 else int(np.count_nonzero(
                    source["pred_mask"][y0:y1, x0:x1] & target["mask"][y0:y1, x0:x1],
                ))
            overlap = intersection / max(1, min(mask_area, target["area"]))
            iou = intersection / max(1, mask_area + target["area"] - intersection)
            core_pairs = [
                (math.hypot(core["x"] - point["x"], core["y"] - point["y"]), core, point)
                for core in pred_points for point in target["core_points"]
            ]
            distance, predicted_core, matched_core = min(core_pairs, key=lambda item: item[0])
            gate = max_motion * (1.45 if source["missed"] else 1.0)
            if overlap < minimum_overlap and distance > gate:
                continue
            area_similarity = math.exp(-abs(math.log(max(1, target["area"]) / max(1, mask_area))))
            motion_similarity = math.exp(-distance / max(1, gate))
            color_similarity = math.exp(-color_distance(source["mean_color"], target["mean_color"]) / 200)
            remaining_weight = max(0, 0.72 - flow_mask_weight - core_motion_weight)
            confidence = (
                flow_mask_weight * iou
                + 0.2 * overlap
                + core_motion_weight * motion_similarity
                + remaining_weight * area_similarity
                + 0.03 * color_similarity
            )
            candidates.append({
                "source": source_index,
                "target": target_index,
                "overlap": overlap,
                "iou": iou,
                "distance": distance,
                "confidence": confidence,
                "predicted_core": predicted_core,
                "matched_core": matched_core,
            })
    return sorted(candidates, key=lambda candidate: candidate["confidence"], reverse=True)


def assign_tracks(
    sources: list[dict[str, Any]],
    targets: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    next_id: int,
    registry: dict[int, dict[str, Any]],
    frame_index: int,
    merge_overlap: float,
    max_motion: float,
) -> tuple[int, list[int]]:
    by_source: dict[int, list[dict[str, Any]]] = defaultdict(list)
    by_target: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        by_source[candidate["source"]].append(candidate)
        by_target[candidate["target"]].append(candidate)

    primary_by_target: dict[int, dict[str, Any]] = {}
    matched_sources: set[int] = set()
    matched_targets: set[int] = set()
    for candidate in candidates:
        if candidate["source"] in matched_sources or candidate["target"] in matched_targets:
            continue
        primary_by_target[candidate["target"]] = candidate
        matched_sources.add(candidate["source"])
        matched_targets.add(candidate["target"])

    split_choices: dict[int, tuple[int, dict[str, Any]]] = {}
    split_options = []
    for source_index, options in by_source.items():
        children = [item for item in options if item["overlap"] >= max(0.06, merge_overlap * 0.35)]
        if len(children) < 2:
            continue
        source = sources[source_index]
        for candidate in children:
            for anchor in source["pred_cores"]:
                point = min(targets[candidate["target"]]["core_points"],
                            key=lambda p: math.hypot(p["x"] - anchor["x"], p["y"] - anchor["y"]))
                distance = math.hypot(point["x"] - anchor["x"], point["y"] - anchor["y"])
                split_options.append((distance, candidate["target"], source_index, anchor["id"]))
    used_split_targets: set[int] = set()
    used_split_ids: set[int] = set()
    for distance, target_index, source_index, anchor_id in sorted(split_options):
        if target_index in used_split_targets or anchor_id in used_split_ids:
            continue
        if distance > max_motion * 2:
            continue
        split_choices[target_index] = (source_index, {"id": anchor_id})
        used_split_targets.add(target_index)
        used_split_ids.add(anchor_id)

    used_ids: set[int] = set()
    merges_for_frame: list[int] = []
    for target_index, target in enumerate(targets):
        primary = primary_by_target.get(target_index)
        merge_candidates = []
        for candidate in by_target[target_index]:
            if candidate is primary or candidate["overlap"] < merge_overlap:
                continue
            source_index = candidate["source"]
            best_for_source = by_source[source_index][0]
            if best_for_source["target"] == target_index:
                merge_candidates.append(candidate)
        source_indices = ([primary["source"]] if primary else []) + [
            item["source"] for item in merge_candidates
            if not primary or item["source"] != primary["source"]
        ]
        source_indices = list(dict.fromkeys(source_indices))
        preferred = split_choices.get(target_index)
        if preferred and preferred[0] not in source_indices:
            source_indices.append(preferred[0])
        lineage_ids = []
        anchor_pool = []
        for source_index in source_indices:
            source = sources[source_index]
            lineage_ids.extend(source["lineage_ids"])
            anchor_pool.extend({**anchor, "missed": source["missed"]} for anchor in source["pred_cores"])
        lineage_ids = list(dict.fromkeys(lineage_ids))
        unique_anchors: dict[int, dict[str, Any]] = {}
        for anchor in anchor_pool:
            current = unique_anchors.get(anchor["id"])
            if current is None:
                unique_anchors[anchor["id"]] = anchor
                continue
            new_distance = min(
                math.hypot(anchor["x"] - point["x"], anchor["y"] - point["y"])
                for point in target["core_points"]
            )
            old_distance = min(
                math.hypot(current["x"] - point["x"], current["y"] - point["y"])
                for point in target["core_points"]
            )
            if new_distance < old_distance:
                unique_anchors[anchor["id"]] = anchor
        anchor_pool = list(unique_anchors.values())
        if not source_indices:
            lineage_ids = []

        track_id = preferred[1]["id"] if preferred else (sources[primary["source"]]["id"] if primary else None)
        if track_id in used_ids:
            track_id = next((value for value in lineage_ids if value not in used_ids), None)
        if track_id is None:
            parent_id = sources[primary["source"]]["id"] if primary else None
            track_id = next_id
            next_id += 1
            registry[track_id] = {"id": track_id, "parentId": parent_id, "firstFrame": frame_index, "lastFrame": frame_index}
            lineage_ids.append(track_id)
        if track_id not in registry:
            registry[track_id] = {"id": track_id, "parentId": None, "firstFrame": frame_index, "lastFrame": frame_index}
        used_ids.add(track_id)
        lineage_ids = list(dict.fromkeys([*lineage_ids, track_id]))
        if len(source_indices) > 1:
            merges_for_frame.append(track_id)

        # Propagate every lineage anchor through flow, then snap distinct anchors
        # to distinct dark red/blue cores when those cores remain visible.
        anchors = []
        available_points = list(target["core_points"])
        for anchor in anchor_pool:
            if available_points:
                point = min(available_points, key=lambda item: math.hypot(item["x"] - anchor["x"], item["y"] - anchor["y"]))
                distance = math.hypot(point["x"] - anchor["x"], point["y"] - anchor["y"])
                motion_gate = max_motion * (1.45 if anchor["missed"] else 1.0)
                if distance <= motion_gate:
                    available_points.remove(point)
                    vx, vy = point["x"] - anchor["old_x"], point["y"] - anchor["old_y"]
                    anchors.append({"id": anchor["id"], "x": point["x"], "y": point["y"], "vx": vx, "vy": vy})
                    continue
            anchor_x, anchor_y = round(anchor["x"]), round(anchor["y"])
            if (0 <= anchor_x < target["mask"].shape[1]
                and 0 <= anchor_y < target["mask"].shape[0]
                and target["mask"][anchor_y, anchor_x]):
                anchors.append({
                    "id": anchor["id"], "x": anchor["x"], "y": anchor["y"],
                    "vx": anchor.get("vx", 0), "vy": anchor.get("vy", 0),
                })
        if not any(anchor["id"] == track_id for anchor in anchors):
            core = target["core_points"][0]
            anchors.append({"id": track_id, "x": core["x"], "y": core["y"], "vx": 0, "vy": 0})

        target.update({
            "id": track_id,
            "lineage_ids": lineage_ids,
            "anchors": anchors,
            "parent_id": registry[track_id].get("parentId"),
            "missed": 0,
        })
        registry[track_id]["lastFrame"] = frame_index
        registry[track_id]["mergedInto"] = None
        for value in lineage_ids:
            if value in registry:
                registry[value]["lastFrame"] = frame_index
        for candidate in merge_candidates:
            source_index = candidate["source"]
            if primary is None or source_index != primary["source"]:
                registry[sources[source_index]["id"]]["mergedInto"] = track_id
    return next_id, merges_for_frame


def serialize_component(component: dict[str, Any], epsilon: float) -> dict[str, Any]:
    return {
        "id": component["id"],
        "parentId": component.get("parent_id"),
        "lineageIds": component["lineage_ids"],
        "lineageAnchors": [
            {"id": anchor["id"], "x": round(anchor["x"], 1), "y": round(anchor["y"], 1)}
            for anchor in component["anchors"]
        ],
        "coreX": round(component["core_points"][0]["x"], 1),
        "coreY": round(component["core_points"][0]["y"], 1),
        "area": component["area"],
        "meanColor": [round(float(value), 1) for value in component["mean_color"]],
        "polygons": polygon_contours(component["mask"], epsilon),
    }


def align_reference_identity(
    result: dict[str, Any],
    desired_id: int = 38,
    frame_index: int = 20,
    position: tuple[int, int] = (416, 334),
) -> int | None:
    components = result["frames"][frame_index]["components"]
    if not components:
        return None
    x, y = position
    focus = min(components, key=lambda item: math.hypot(item["coreX"] - x, item["coreY"] - y))
    source_id = focus["id"]
    if source_id == desired_id:
        return source_id
    occupied = any(track["id"] == desired_id for track in result["tracks"])
    mapping = {source_id: desired_id}
    if occupied:
        mapping[desired_id] = source_id

    def mapped(value: int | None) -> int | None:
        return mapping.get(value, value)

    for track in result["tracks"]:
        track["id"] = mapped(track["id"])
        track["parentId"] = mapped(track.get("parentId"))
        track["mergedInto"] = mapped(track.get("mergedInto"))
    result["tracks"].sort(key=lambda track: track["id"])
    for frame in result["frames"]:
        frame["merges"] = [mapped(value) for value in frame["merges"]]
        for component in [*frame["components"], *frame["missingSources"]]:
            component["id"] = mapped(component["id"])
            component["parentId"] = mapped(component.get("parentId"))
            component["lineageIds"] = [mapped(value) for value in component["lineageIds"]]
            for anchor in component["lineageAnchors"]:
                anchor["id"] = mapped(anchor["id"])
    return source_id


def build(args: argparse.Namespace) -> dict[str, Any]:
    height = round(1800 * args.width / 3600)
    frames: list[dict[str, Any]] = []
    previous_gray = None
    previous_components: list[dict[str, Any]] = []
    lost: list[dict[str, Any]] = []
    registry: dict[int, dict[str, Any]] = {}
    next_id = 1
    total_components = 0
    total_merges = 0
    continuity: list[dict[str, Any]] = []

    for frame_index, time in enumerate(TIMES):
        path = image_path(args.snapshots, time)
        frame_cache = getattr(args, "frame_cache", None)
        if frame_cache and time in frame_cache:
            rgb, alpha, mask = frame_cache[time]
        else:
            rgb, alpha, mask = read_frame(path, args.width, args.alpha_threshold, args.gap_radius)
        components = find_components(
            rgb, mask, args.minimum_area, args.core_saturation, args.core_darkness,
            args.core_merge_distance, args.color_tolerance, args.segmenter,
        )
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        gray[mask == 0] = 0

        if frame_index == 0:
            components.sort(key=lambda item: (min(p["y"] for p in item["core_points"]), min(p["x"] for p in item["core_points"])))
            for component in components:
                component["id"] = next_id
                component["lineage_ids"] = [next_id]
                core = component["core_points"][0]
                component["anchors"] = [{"id": next_id, "x": core["x"], "y": core["y"], "vx": 0.0, "vy": 0.0}]
                component["parent_id"] = None
                component["missed"] = 0
                registry[next_id] = {"id": next_id, "parentId": None, "firstFrame": 0, "lastFrame": 0, "mergedInto": None}
                next_id += 1
            frame_merges = []
            missing_sources = []
        else:
            flow = cv2.calcOpticalFlowFarneback(
                previous_gray, gray, None, pyr_scale=0.5, levels=3, winsize=21,
                iterations=3, poly_n=5, poly_sigma=1.2, flags=0,
            )
            if args.tracker == "core-nearest":
                flow.fill(0)
            sources = previous_components + lost
            for component in components:
                if not component["core_points"]:
                    component["core_points"] = [{"x": component["bbox"][0], "y": component["bbox"][1], "strength": 0, "hue": None}]
            candidates = association_candidates(
                sources, components, flow, args.maximum_motion, args.overlap_threshold,
                args.flow_mask_weight, args.core_motion_weight,
            )
            next_id, frame_merges = assign_tracks(
                sources, components, candidates, next_id, registry, frame_index,
                args.merge_overlap, args.maximum_motion,
            )

            assigned_sources = set()
            assigned_targets = set()
            for item in candidates:
                if item["confidence"] >= 0.24 and item["overlap"] >= args.merge_overlap:
                    assigned_sources.add(item["source"])
                    assigned_targets.add(item["target"])
            missing_sources = []
            for source_index, source in enumerate(sources):
                matched = any(
                    candidate["source"] == source_index
                    and candidate["target"] in assigned_targets
                    and candidate["overlap"] >= args.merge_overlap
                    for candidate in candidates
                )
                if matched:
                    continue
                missed = source["missed"] + 1
                if missed > args.memory_frames:
                    continue
                ghost = dict(source)
                ghost["mask"] = source["pred_mask"]
                if source["pred_bbox"] is not None:
                    ghost["bbox"] = source["pred_bbox"]
                ghost["area"] = int(ghost["mask"].sum())
                ghost["missed"] = missed
                ghost["anchors"] = [
                    {
                        "id": core["id"],
                        "x": core["x"],
                        "y": core["y"],
                        "vx": core["x"] - core["old_x"],
                        "vy": core["y"] - core["old_y"],
                    }
                    for core in source["pred_cores"]
                ]
                ghost["pred_cores"] = None
                lost_next_candidate = ghost
                missing_sources.append(lost_next_candidate)
            lost = missing_sources

            for component in components:
                anchor = min(component["anchors"], key=lambda item: (item["id"] != component["id"], item["id"]))
                continuity.append({
                    "frame": frame_index, "id": component["id"], "x": round(anchor["x"], 1),
                    "y": round(anchor["y"], 1), "area": component["area"],
                    "lineageIds": component["lineage_ids"],
                })

        frame_data = {
            "time": time,
            "components": [serialize_component(component, args.contour_epsilon) for component in components],
            "missingSources": [serialize_component(component, args.contour_epsilon) | {"missed": component["missed"]} for component in missing_sources],
            "merges": frame_merges,
        }
        frames.append(frame_data)
        total_components += len(components)
        total_merges += len(frame_merges)
        previous_gray = gray
        previous_components = components
        if not getattr(args, "quiet", False):
            print(f"[{frame_index + 1:02d}/{len(TIMES)}] {time} UTC: {len(components)} tracked polygons", flush=True)

    return {
        "version": 1,
        "width": args.width,
        "height": height,
        "source": "NASA IMERG alpha snapshots · 2026-11-07 · 30-minute cadence",
        "settings": {
            "minimumArea": args.minimum_area,
            "alphaThreshold": args.alpha_threshold,
            "gapRadius": args.gap_radius,
            "coreSaturation": args.core_saturation,
            "coreDarkness": args.core_darkness,
            "coreMergeDistance": args.core_merge_distance,
            "colorTolerance": args.color_tolerance,
            "maximumMotion": args.maximum_motion,
            "overlapThreshold": args.overlap_threshold,
            "mergeOverlap": args.merge_overlap,
            "flowMaskWeight": args.flow_mask_weight,
            "coreMotionWeight": args.core_motion_weight,
            "memoryFrames": args.memory_frames,
            "segmenter": args.segmenter,
            "tracker": args.tracker,
        },
        "frames": frames,
        "tracks": sorted(registry.values(), key=lambda item: item["id"]),
        "summary": {
            "trackCount": len(registry),
            "componentCount": total_components,
            "mergeEvents": total_merges,
        },
        "_continuity": continuity,
    }


def main() -> None:
    args = parse_args()
    if args.width < 100 or args.minimum_area < 1:
        raise SystemExit("--width must be at least 100 and --minimum-area must be positive")
    tracks = build(args)
    tracks.pop("_continuity", None)
    generated_focus_id = align_reference_identity(tracks)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(tracks, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"Wrote {args.output} · {tracks['summary']['trackCount']} identities, "
        f"{tracks['summary']['componentCount']} frame polygons, {tracks['summary']['mergeEvents']} merge events. "
        f"Storm 38 reference ID mapped from {generated_focus_id}."
    )


if __name__ == "__main__":
    main()
