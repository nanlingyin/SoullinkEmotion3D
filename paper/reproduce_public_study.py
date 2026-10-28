"""Reproduce the perceptual statistics directly from the released anonymous CSV."""
from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path

from soullink_bench.analyze_platform_study import (
    LABELS, METHODS, crossed_bootstrap, neutral_calm_confusions, summarize,
)

NUMERIC = {
    "naturalness", "transition_smoothness", "change_clarity", "start_correct",
    "end_correct", "trial_correct", "categorical_judgments", "categorical_correct",
    "duration_s", "change_duration_s", "start_window_start_s", "start_window_end_s",
    "end_window_start_s", "end_window_end_s",
}


def load_responses(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        records = []
        for raw in csv.DictReader(stream):
            row = {key: (None if value == "" else value) for key, value in raw.items()}
            for key in NUMERIC:
                value = row.get(key)
                if value is not None and value != "uncertain":
                    number = float(value)
                    if not math.isfinite(number):
                        raise ValueError(f"Non-finite value in {row['trial_id']}: {key}")
                    row[key] = int(number) if number.is_integer() else number
            if row["method"] not in METHODS or row["task_type"] not in ("state", "transition"):
                raise ValueError(f"Unknown condition in {row['trial_id']}")
            transition = row["task_type"] == "transition"
            for target, prediction in [("target_label", "prediction")] + (
                    [("start_target_label", "start_prediction")] if transition else []):
                if row[target] not in LABELS or row[prediction] not in LABELS + ("uncertain",):
                    raise ValueError(f"Invalid emotion label in {row['trial_id']}")
            start = int(row["start_prediction"] == row["start_target_label"]) if transition else None
            end = int(row["prediction"] == row["target_label"])
            expected = {"start_correct": start, "end_correct": end,
                        "trial_correct": int(start and end) if transition else end,
                        "categorical_judgments": 2 if transition else 1,
                        "categorical_correct": end + (start or 0)}
            if any(row.get(key) != value for key, value in expected.items()):
                raise ValueError(f"Recognition score mismatch in {row['trial_id']}")
            for field in ("naturalness", "transition_smoothness", "change_clarity"):
                value = row[field]
                if value not in (None, "uncertain") and value not in range(1, 8):
                    raise ValueError(f"Invalid rating in {row['trial_id']}: {field}")
                if not transition and field != "naturalness" and value is not None:
                    raise ValueError(f"Transition rating on a state trial: {row['trial_id']}")
            records.append(row)
    if not records or len({r["trial_id"] for r in records}) != len(records):
        raise ValueError("Empty responses or duplicate trial identifiers")
    if len({(r["participant_id"], r["stimulus_id"]) for r in records}) != len(records):
        raise ValueError("Repeated stimulus within a participant")
    conditions = defaultdict(set)
    for row in records:
        conditions[row["participant_id"]].add((row["method"], row["model_id"]))
    if any(len(value) != 1 for value in conditions.values()):
        raise ValueError("Participant appears in multiple between-participant conditions")
    return records


def compare_reference(actual, reference, path="results"):
    if isinstance(actual, dict):
        for key, value in actual.items():
            compare_reference(value, reference[key], path + "/" + key)
    elif isinstance(actual, list):
        if len(actual) != len(reference):
            raise ValueError(f"Reference length differs at {path}")
        for index, value in enumerate(actual):
            compare_reference(value, reference[index], path + f"/{index}")
    elif isinstance(actual, (int, float)) and not isinstance(actual, bool):
        if not math.isclose(actual, reference, rel_tol=1e-12, abs_tol=1e-12):
            raise ValueError(f"Reference value differs at {path}")
    elif actual != reference:
        raise ValueError(f"Reference value differs at {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--responses", type=Path, required=True)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--draws", type=int, default=10000)
    parser.add_argument("--seed", type=int, default=20261028)
    args = parser.parse_args()
    if args.draws < 1:
        parser.error("--draws must be positive")
    records = load_responses(args.responses)
    result = {"overall": summarize(records),
              "by_method": {m: summarize([r for r in records if r["method"] == m]) for m in METHODS},
              "neutral_calm_confusion": neutral_calm_confusions(records),
              "bootstrap": crossed_bootstrap(records, args.draws, args.seed)}
    if args.reference:
        compare_reference(result, json.loads(args.reference.read_text(encoding="utf-8")))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"participants": result["overall"]["participants"],
                      "responses": len(records), "bootstrap_draws": args.draws,
                      "reference_matches": bool(args.reference), "output": str(args.out)}))


if __name__ == "__main__":
    main()
