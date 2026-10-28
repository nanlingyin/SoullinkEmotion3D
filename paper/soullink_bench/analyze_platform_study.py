"""Reproducible analysis of the supervisor-platform, between-participant study."""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import posixpath
import re
import statistics
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

LABELS = ("neutral", "joy", "sadness", "anger", "fear", "surprise", "calm")
METHODS = ("full", "nnls_ema")
METHOD_NAMES = {"full": "Full", "nnls_ema": "Static QP + EMA"}
METRICS = ("recognition", "state_recognition", "transition_start", "transition_end",
           "transition_joint", "naturalness", "transition_smoothness", "change_clarity")


def blank(value):
    return value is None or value == ""


def read_workbook(path):
    """Read cell values from the original XLSX without rewriting that export."""
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(path) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            tree = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            strings = ["".join(t.text or "" for t in item.iter(f"{{{ns['s']}}}t"))
                       for item in tree.findall("s:si", ns)]
        rels = {r.attrib["Id"]: r.attrib["Target"] for r in
                ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        result = {}
        for sheet in ET.fromstring(archive.read("xl/workbook.xml")).find("s:sheets", ns):
            rid = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            target = rels[rid]
            member = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
            grid = []
            for row in ET.fromstring(archive.read(member)).findall("s:sheetData/s:row", ns):
                cells = {}
                for cell in row.findall("s:c", ns):
                    kind = cell.attrib.get("t")
                    value_node = cell.find("s:v", ns)
                    value = value_node.text if value_node is not None else None
                    if kind == "s" and value is not None:
                        value = strings[int(value)]
                    elif kind == "inlineStr":
                        value = "".join(t.text or "" for t in cell.findall(".//s:t", ns))
                    elif value is not None and kind not in ("str", "e"):
                        try:
                            value = float(value)
                            value = int(value) if value.is_integer() else value
                        except ValueError:
                            pass
                    cells[re.sub(r"\d+$", "", cell.attrib["r"])] = value
                if any(not blank(v) for v in cells.values()):
                    grid.append(cells)
            if grid:
                headers = grid[0]
                result[sheet.attrib["name"]] = [
                    {label: row.get(col) for col, label in headers.items() if not blank(label)}
                    for row in grid[1:]]
        return result


def validate_provenance(source, provenance):
    digest = hashlib.sha256(Path(source).read_bytes()).hexdigest()
    if provenance.get("source_sha256") != digest:
        raise ValueError("Source workbook differs from the provenance record")
    if provenance.get("data_kind") != "human_observation" or not provenance.get("author_confirmation_original_zh"):
        raise ValueError("Explicit study-origin confirmation is required for this import")
    return digest


def error_type(prediction, target):
    if prediction == target:
        return "correct"
    if prediction == "uncertain":
        return "uncertain"
    if {prediction, target} == {"calm", "neutral"}:
        return "calm_neutral_confusion"
    return "other_confusion"


def normalize(workbook, provenance):
    plan = {r["stimulus_id"]: r for r in workbook["题库"]}
    if len(plan) != len(workbook["题库"]):
        raise ValueError("Duplicate stimulus reference")
    records, seen, participant_conditions = [], set(), defaultdict(set)
    for raw in workbook["Responses"]:
        pid, trial, sid = raw["id"], raw["trial_id"], raw["clip_id"]
        if trial in seen:
            raise ValueError(f"Duplicate trial: {trial}")
        seen.add(trial)
        if sid not in plan:
            raise ValueError(f"Missing stimulus reference: {sid}")
        ref = plan[sid]
        for field in ("task_type", "target_label", "start_target_label", "duration_s", "change_duration_s", "batch_id", "template_id"):
            if not (blank(raw.get(field)) and blank(ref.get(field))) and raw.get(field) != ref.get(field):
                raise ValueError(f"Reference mismatch: {trial} / {field}")
        for source_field, plan_field in (("start_window_start_s", "reference_start_start_s"),
                                       ("start_window_end_s", "reference_start_end_s"),
                                       ("end_window_start_s", "reference_end_start_s"),
                                       ("end_window_end_s", "reference_end_end_s")):
            if not (blank(raw.get(source_field)) and blank(ref.get(plan_field))) and raw.get(source_field) != ref.get(plan_field):
                raise ValueError(f"Window mismatch: {trial} / {source_field}")
        method = str(raw["algorithm"]).lower()
        if method not in METHODS:
            raise ValueError(f"Unsupported method: {raw['algorithm']}")
        transition = raw["task_type"] == "transition"
        if raw["task_type"] not in ("state", "transition"):
            raise ValueError(f"Unknown task: {trial}")
        fields = ["prediction"] + (["start_prediction"] if transition else [])
        if any(raw[f] not in LABELS + ("uncertain",) for f in fields):
            raise ValueError(f"Invalid emotion response: {trial}")
        for field in ("naturalness", "transition_smoothness", "change_clarity"):
            value = raw.get(field)
            applicable = transition or field == "naturalness"
            if not applicable and not blank(value):
                raise ValueError(f"State trial has a transition rating: {trial}")
            if applicable and not blank(value) and value != "uncertain":
                if not isinstance(value, (int, float)) or value not in range(1, 8):
                    raise ValueError(f"Invalid seven-point rating: {trial} / {field}")
        start = int(raw["start_prediction"] == raw["start_target_label"]) if transition else None
        end = int(raw["prediction"] == raw["target_label"])
        joint = int(start and end) if transition else end
        for field, expected in (("start_correct", start), ("end_correct", end), ("trial_correct", joint)):
            if not (blank(raw.get(field)) and expected is None) and raw.get(field) != expected:
                raise ValueError(f"Exported score mismatch: {trial} / {field}")
        for prefix in ("end", "start") if transition else ("end",):
            pred = raw["prediction"] if prefix == "end" else raw["start_prediction"]
            target = raw["target_label"] if prefix == "end" else raw["start_target_label"]
            if raw[prefix + "_error_type"] != error_type(pred, target):
                raise ValueError(f"Exported error classification mismatch: {trial}")
        participant_conditions[pid].add((method, raw["model_id"]))
        record = {
            "participant_id": pid, "trial_id": trial, "stimulus_id": sid,
            "method": method, "model_id": raw["model_id"], "task_type": raw["task_type"],
            "start_target_label": raw["start_target_label"] if transition else None,
            "target_label": raw["target_label"],
            "start_prediction": raw["start_prediction"] if transition else None,
            "prediction": raw["prediction"],
            "naturalness": raw["naturalness"],
            "transition_smoothness": raw["transition_smoothness"] if transition else None,
            "change_clarity": raw["change_clarity"] if transition else None,
            "start_correct": start, "end_correct": end, "trial_correct": joint,
            "categorical_judgments": 2 if transition else 1,
            "categorical_correct": end + (start or 0),
            "duration_s": raw["duration_s"], "change_duration_s": raw["change_duration_s"],
            "start_window_start_s": raw["start_window_start_s"] if transition else None,
            "start_window_end_s": raw["start_window_end_s"] if transition else None,
            "end_window_start_s": raw["end_window_start_s"], "end_window_end_s": raw["end_window_end_s"],
            "batch_id": raw["batch_id"], "template_id": raw["template_id"],
            "source_dataset_kind": raw.get("dataset_kind"),
            "data_kind": provenance["data_kind"], "provenance_status": "author_confirmed_platform_observations",
        }
        records.append(record)
    if any(len(v) != 1 for v in participant_conditions.values()):
        raise ValueError("This analyzer requires one method/model condition per participant")
    if len({(r["participant_id"], r["stimulus_id"]) for r in records}) != len(records):
        raise ValueError("A participant has duplicate base-stimulus responses")
    return records, plan


def components(records):
    num, den = np.zeros((len(records), len(METRICS))), np.zeros((len(records), len(METRICS)))
    for i, row in enumerate(records):
        tr = row["task_type"] == "transition"
        num[i, 0], den[i, 0] = row["categorical_correct"], row["categorical_judgments"]
        if not tr:
            num[i, 1], den[i, 1] = row["end_correct"], 1
        else:
            num[i, 2:5] = [row["start_correct"], row["end_correct"], row["trial_correct"]]
            den[i, 2:5] = 1
        for j, field in enumerate(("naturalness", "transition_smoothness", "change_clarity"), 5):
            if isinstance(row[field], (int, float)):
                num[i, j], den[i, j] = row[field], 1
    return num, den


def summarize(records):
    num, den = components(records)
    result = {"participants": len({r["participant_id"] for r in records}), "responses": len(records),
              "state_responses": sum(r["task_type"] == "state" for r in records),
              "transition_responses": sum(r["task_type"] == "transition" for r in records)}
    for j, metric in enumerate(METRICS):
        n = float(den[:, j].sum())
        value = float(num[:, j].sum() / n) if n else None
        entry = {"numerator": float(num[:, j].sum()), "denominator": int(n), "estimate": value}
        if j >= 5:
            values = [r[metric] for r in records if isinstance(r[metric], (int, float))]
            entry.update(sd=statistics.stdev(values) if len(values) > 1 else None,
                         median=statistics.median(values) if values else None)
        result[metric] = entry
    return result


def validate_export_summaries(workbook, records):
    by_person, by_stimulus = defaultdict(list), defaultdict(list)
    for row in records:
        by_person[row["participant_id"]].append(row)
        by_stimulus[row["stimulus_id"]].append(row)
    def check(actual, expected, context):
        if expected is None and blank(actual):
            return
        if not isinstance(actual, (int, float)) or expected is None or abs(actual - expected) > 1e-12:
            raise ValueError(f"Source summary mismatch: {context}")
    for source in workbook.get("Participant Summary", []):
        rr = by_person[source["participant_id"]]
        s = summarize(rr)
        values = {"trials": len(rr), "state_trials": s["state_responses"],
                  "transition_trials": s["transition_responses"],
                  "categorical_judgments": s["recognition"]["denominator"],
                  "correct_judgments": s["recognition"]["numerator"],
                  "categorical_accuracy": s["recognition"]["estimate"],
                  "transition_start_accuracy": s["transition_start"]["estimate"],
                  "end_accuracy": sum(r["end_correct"] for r in rr) / len(rr)}
        for field, expected in values.items():
            check(source.get(field), expected, f"{source['participant_id']} / {field}")
        if {r["method"] for r in rr} != {str(source["algorithm"]).lower()} or {r["model_id"] for r in rr} != {source["model_id"]}:
            raise ValueError("Participant-summary condition mismatch")
    for source in workbook.get("Item Coverage", []):
        rr = by_stimulus[source["clip_id"]]
        if not rr:
            raise ValueError("An item summary has no response records")
        s = summarize(rr)
        correct_trials = sum(r["trial_correct"] for r in rr)
        confusion_count = sum(error_type(pred, target) == "calm_neutral_confusion"
                              for r in rr for target, pred in
                              [(r["target_label"], r["prediction"])] +
                              ([(r["start_target_label"], r["start_prediction"])] if r["task_type"] == "transition" else []))
        values = {"exposure_count": len(rr), "correct_trials": correct_trials,
                  "trial_accuracy": correct_trials / len(rr),
                  "categorical_judgments": s["recognition"]["denominator"],
                  "correct_judgments": s["recognition"]["numerator"],
                  "categorical_accuracy": s["recognition"]["estimate"],
                  "calm_neutral_errors": confusion_count}
        for field, expected in values.items():
            check(source.get(field), expected, f"{source['clip_id']} / {field}")


def crossed_bootstrap(records, draws=10000, seed=20261028):
    """Resample people within method/model strata, and shared base stimuli independently."""
    participants = sorted({r["participant_id"] for r in records})
    stimuli = sorted({r["stimulus_id"] for r in records})
    pmap, smap = {p: i for i, p in enumerate(participants)}, {s: i for i, s in enumerate(stimuli)}
    pi = np.array([pmap[r["participant_id"]] for r in records])
    si = np.array([smap[r["stimulus_id"]] for r in records])
    strata = defaultdict(set)
    for r in records:
        strata[r["method"], r["model_id"]].add(pmap[r["participant_id"]])
    num, den = components(records)
    masks = {m: np.array([r["method"] == m for r in records], dtype=float)[:, None] for m in METHODS}
    rng = np.random.default_rng(seed)
    crossed, participant_only = [], []
    for first in range(0, draws, 200):
        batch = min(200, draws - first)
        person_weights = np.zeros((batch, len(participants)), dtype=float)
        for indices in strata.values():
            idx = sorted(indices)
            person_weights[:, idx] = rng.multinomial(len(idx), np.full(len(idx), 1 / len(idx)), size=batch)
        stimulus_weights = rng.multinomial(len(stimuli), np.full(len(stimuli), 1 / len(stimuli)), size=batch)
        pw = person_weights[:, pi]
        for weights, output in ((pw, participant_only), (pw * stimulus_weights[:, si], crossed)):
            estimates = {}
            for method in METHODS:
                totals = weights @ (den * masks[method])
                estimates[method] = np.divide(weights @ (num * masks[method]), totals,
                                             out=np.full_like(totals, np.nan), where=totals > 0)
            output.append(estimates["full"] - estimates["nnls_ema"])
    result = {}
    for name, batches in (("crossed_participant_stimulus", crossed), ("participant_only", participant_only)):
        samples = np.vstack(batches)
        result[name] = {metric: {"ci95_low": float(np.nanpercentile(samples[:, j], 2.5)),
                                 "ci95_high": float(np.nanpercentile(samples[:, j], 97.5)),
                                 "finite_draws": int(np.isfinite(samples[:, j]).sum())}
                        for j, metric in enumerate(METRICS)}
    result.update(draws=draws, seed=seed, interval="percentile",
                  model_scope="Eight observed model IDs held fixed; people stratified by method/model.",
                  analysis_status="Crossed participant--stimulus bootstrap for the block-randomized between-participant design.")
    return result


def write_csv(path, records):
    if not records:
        return
    with Path(path).open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(records)


def grouped_summaries(records, fields):
    groups = defaultdict(list)
    for row in records:
        groups[tuple(row.get(f) for f in fields)].append(row)
    result = []
    for key, rr in sorted(groups.items(), key=lambda item: str(item[0])):
        summary = summarize(rr)
        flat = dict(zip(fields, key))
        flat.update({k: v for k, v in summary.items() if not isinstance(v, dict)})
        for metric in METRICS:
            flat[metric] = summary[metric]["estimate"]
            flat[metric + "_n"] = summary[metric]["denominator"]
            if "sd" in summary[metric]:
                flat[metric + "_sd"] = summary[metric]["sd"]
        result.append(flat)
    return result


def build_figures(records, analysis, paper):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10.5,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "pdf.fonttype": 42, "ps.fonttype": 42})
    colors = {"full": "#237b76", "nnls_ema": "#7955a0"}
    figures = paper / "figures"
    figures.mkdir(parents=True, exist_ok=True)
    def save(fig, name):
        fig.savefig(figures / f"{name}.pdf", bbox_inches="tight")
        fig.savefig(figures / f"{name}.png", dpi=220, bbox_inches="tight")
        plt.close(fig)

    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.15), gridspec_kw={"width_ratios": [1.3, 1]}, layout="constrained")
    for k, method in enumerate(METHODS):
        summary = analysis["by_method"][method]
        x = np.arange(4) + (k - .5) * .34
        axes[0].bar(x, [100 * summary[m]["estimate"] for m in METRICS[1:5]], width=.32,
                    color=colors[method], label=METHOD_NAMES[method])
        axes[1].bar(np.arange(3) + (k - .5) * .34,
                    [summary[m]["estimate"] for m in METRICS[5:]], width=.32,
                    yerr=[summary[m]["sd"] for m in METRICS[5:]], capsize=2,
                    error_kw={"linewidth": .8}, color=colors[method])
    axes[0].set(ylim=(0, 100), ylabel="Target-label agreement (%)", xticks=np.arange(4),
                xticklabels=["State", "Transition\nstart", "Transition\nend", "Both\nendpoints"])
    axes[1].set(ylim=(1, 7), ylabel="Rating (1-7)", xticks=np.arange(3),
                xticklabels=["Naturalness", "Transition\nsmoothness", "Change\nclarity"])
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper center", bbox_to_anchor=(.5, 1.08),
               ncol=2, frameon=False, fontsize=10)
    for ax in axes:
        ax.grid(axis="y", color="#dddddd", linewidth=.5)
        ax.set_axisbelow(True)
    save(fig, "perceptual_outcomes")

    fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.1), layout="constrained")
    models = sorted({r["model_id"] for r in records})
    for method in METHODS:
        summaries = [summarize([r for r in records if r["method"] == method and r["model_id"] == model]) for model in models]
        axes[0].plot(range(len(models)), [100 * s["recognition"]["estimate"] for s in summaries],
                     marker="o" if method == "full" else "s", color=colors[method], label=METHOD_NAMES[method], linewidth=1)
        axes[1].plot(range(len(models)), [s["naturalness"]["estimate"] for s in summaries],
                     marker="o" if method == "full" else "s", color=colors[method], linewidth=1)
    for ax in axes:
        ax.set_xticks(range(len(models)), [m.replace("l2d_", "L2D ").replace("vrm_", "VRM ") for m in models], rotation=45, ha="right")
        ax.grid(axis="y", color="#dddddd", linewidth=.5)
    axes[0].set(ylabel="Pooled target-label agreement (%)", ylim=(0, 100))
    axes[1].set(ylabel="Mean naturalness (1-7)", ylim=(1, 7))
    axes[0].legend(frameon=False, fontsize=10, loc="lower left")
    save(fig, "perceptual_models")

    fig, axes = plt.subplots(2, 1, figsize=(7.2, 7.25), layout="constrained")
    for ax, method in zip(axes, METHODS):
        matrix = np.zeros((7, 8), dtype=int)
        for r in records:
            if r["method"] != method:
                continue
            for target, prediction in [(r["target_label"], r["prediction"])] + ([(r["start_target_label"], r["start_prediction"])] if r["task_type"] == "transition" else []):
                matrix[LABELS.index(target), (LABELS + ("uncertain",)).index(prediction)] += 1
        rates = matrix / matrix.sum(axis=1, keepdims=True)
        ax.imshow(rates, vmin=0, vmax=1, cmap="Blues", aspect="auto")
        ax.set(title=METHOD_NAMES[method], ylabel="Intended emotion")
        ax.set_xticks(range(8), list(LABELS) + ["uncertain"], fontsize=9.5)
        ax.set_yticks(range(7), [f"{label} (n={n})" for label, n in zip(LABELS, matrix.sum(axis=1))], fontsize=9.5)
        ax.set_xlabel("Observed emotion")
        for i in range(7):
            for j in range(8):
                if matrix[i, j]:
                    ax.text(j, i, f"{100 * rates[i, j]:.1f}%", ha="center", va="center", fontsize=9.5,
                            color="white" if rates[i, j] > .55 else "#222222")
    save(fig, "perceptual_confusion")


def tex_escape(value):
    return str(value).replace("_", r"\_")


def neutral_calm_confusions(records):
    counts = Counter()
    for row in records:
        observations = [(row["target_label"], row["prediction"])]
        if row["task_type"] == "transition":
            observations.append((row["start_target_label"], row["start_prediction"]))
        for target, prediction in observations:
            counts[row["method"], target, prediction] += 1
    result = {}
    for method in METHODS:
        result[method] = {}
        for target, opposite in (("neutral", "calm"), ("calm", "neutral")):
            total = sum(n for (m, t, _), n in counts.items() if m == method and t == target)
            swaps = counts[method, target, opposite]
            result[method][target] = {"total": total, "swaps": swaps, "rate": swaps / total if total else None}
        total = sum(v["total"] for v in result[method].values())
        swaps = sum(v["swaps"] for v in result[method].values())
        result[method]["combined"] = {"total": total, "swaps": swaps, "rate": swaps / total if total else None}
    return result


def build_tex(analysis, paper):
    full, base = (analysis["by_method"][m] for m in METHODS)
    intervals = analysis["bootstrap"]["crossed_participant_stimulus"]
    descriptions = {"recognition": "All endpoint judgments", "state_recognition": "State recognition",
                    "transition_start": "Transition start", "transition_end": "Transition end",
                    "transition_joint": "Both transition endpoints", "naturalness": "Naturalness (1--7)",
                    "transition_smoothness": "Transition smoothness (1--7)", "change_clarity": "Change clarity (1--7)"}
    lines = []
    for metric in METRICS:
        f, b, ci = full[metric], base[metric], intervals[metric]
        categorical = metric in METRICS[:5]
        factor, precision = (100, 2) if categorical else (1, 3)
        fv = f"{100 * f['estimate']:.2f}\\%" if categorical else f"{f['estimate']:.2f} $\\pm$ {f['sd']:.2f}"
        bv = f"{100 * b['estimate']:.2f}\\%" if categorical else f"{b['estimate']:.2f} $\\pm$ {b['sd']:.2f}"
        delta = factor * (f["estimate"] - b["estimate"])
        low, high = factor * ci["ci95_low"], factor * ci["ci95_high"]
        lines.append(f"{descriptions[metric]} & {fv} & {bv} & {delta:+.{precision}f} {{[}}{low:.{precision}f}, {high:.{precision}f}{{]}}\\\\")
    caption = (f"Perceptual outcomes at the matched 150 ms reference response. Participants: {full['participants']:,} / {base['participants']:,}; "
               f"responses: {full['responses']:,} / {base['responses']:,} (Full / comparator). Percentages pool applicable categorical judgments. "
               r"Rating entries show response-level mean \ensuremath{\pm} SD. Differences are Full minus Static QP + EMA, in percentage points for recognition and scale points for ratings. "
               f"Brackets give marginal 95\\% crossed participant--stimulus bootstrap intervals ({analysis['bootstrap']['draws']:,} draws).")
    table = (r"\begin{table}[htbp]\centering\small" + "\n" + r"\caption{" + caption + r"}\label{tab:human_outcomes}" + "\n" +
             r"\setlength{\tabcolsep}{4pt}" + "\n" +
             r"\begin{tabularx}{\linewidth}{>{\raggedright\arraybackslash}Xrrr}" + "\n" +
             r"\toprule Outcome & Full & Static QP + EMA & Difference [95\% interval]\\\midrule" + "\n" +
             "\n".join(lines) + "\n" + r"\bottomrule\end{tabularx}" + "\n" +
             r"\par\smallskip\footnotesize " +
             f"State responses: {full['state_responses']:,} / {base['state_responses']:,}; transition responses: {full['transition_responses']:,} / {base['transition_responses']:,}; " +
             f"all endpoint judgments: {full['recognition']['denominator']:,} / {base['recognition']['denominator']:,} (Full / comparator)." + "\n" + r"\end{table}" + "\n")
    (paper / "generated/human_study_table.tex").write_text(table, encoding="utf-8")
    pair = analysis["neutral_calm_confusion"]
    values = {
        "DRAWS": f"{analysis['bootstrap']['draws']:,}", "SEED": str(analysis["bootstrap"]["seed"]),
        "FULL_CORRECT": f"{int(full['recognition']['numerator']):,}",
        "BASE_CORRECT": f"{int(base['recognition']['numerator']):,}",
        "FULL_JUDGMENTS": f"{full['recognition']['denominator']:,}",
        "BASE_JUDGMENTS": f"{base['recognition']['denominator']:,}",
        "FULL_AGREEMENT": f"{100 * full['recognition']['estimate']:.2f}",
        "BASE_AGREEMENT": f"{100 * base['recognition']['estimate']:.2f}",
        "FULL_JOINT": f"{100 * full['transition_joint']['estimate']:.2f}",
        "BASE_JOINT": f"{100 * base['transition_joint']['estimate']:.2f}",
        "FULL_NATURAL": f"{full['naturalness']['estimate']:.2f}",
        "BASE_NATURAL": f"{base['naturalness']['estimate']:.2f}",
        "PAIR_RELATIVE_REDUCTION": f"{100 * (1 - pair['full']['combined']['rate'] / pair['nnls_ema']['combined']['rate']):.1f}",
    }
    for stem, metric, factor, precision in (("AGREEMENT", "recognition", 100, 2),
                                             ("JOINT", "transition_joint", 100, 2),
                                             ("NATURAL", "naturalness", 1, 3),
                                             ("SMOOTH", "transition_smoothness", 1, 3),
                                             ("CLARITY", "change_clarity", 1, 3)):
        values[stem + "_DELTA"] = f"{factor * (full[metric]['estimate'] - base[metric]['estimate']):.{precision}f}"
        values[stem + "_LOW"] = f"{factor * intervals[metric]['ci95_low']:.{precision}f}"
        values[stem + "_HIGH"] = f"{factor * intervals[metric]['ci95_high']:.{precision}f}"
    for prefix, method in (("FULL", "full"), ("BASE", "nnls_ema")):
        for label in ("neutral", "calm"):
            values[prefix + "_" + label.upper() + "_SWAP"] = f"{100 * pair[method][label]['rate']:.1f}"
        combined = pair[method]["combined"]
        values[prefix + "_PAIR_SWAP"] = f"{100 * combined['rate']:.2f}"
        values[prefix + "_PAIR_ERRORS"] = str(combined["swaps"])
        values[prefix + "_PAIR_TOTAL"] = str(combined["total"])
    text = (paper / "sections/perceptual_results_template.tex").read_text(encoding="utf-8")
    for key, value in values.items():
        text = text.replace("@@" + key + "@@", value)
    if "@@" in text:
        raise ValueError("Unresolved manuscript result token")
    (paper / "generated/human_study_results.tex").write_text(
        r"\input{sections/perceptual_protocol}" + "\n" + text, encoding="utf-8")


def run(source, provenance_path, out, paper, draws=10000, seed=20261028):
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    digest = validate_provenance(source, provenance)
    workbook = read_workbook(source)
    records, plan = normalize(workbook, provenance)
    validate_export_summaries(workbook, records)
    out.mkdir(parents=True, exist_ok=True)
    summaries = {method: summarize([r for r in records if r["method"] == method]) for method in METHODS}
    analysis = {"data_kind": "human_observation", "source_sha256": digest,
                "provenance_basis": provenance["provenance_basis"],
                "source_legacy_dataset_kinds": dict(Counter(r["source_dataset_kind"] for r in records)),
                "overall": summarize(records), "by_method": summaries,
                "model_ids": sorted({r["model_id"] for r in records}), "base_stimuli": len(plan),
                "input_checks": {"reference_rows": len(plan), "unique_trials": len({r['trial_id'] for r in records}),
                                 "source_scores_recomputed": True, "between_participant_design": True},
                "bootstrap": crossed_bootstrap(records, draws, seed)}
    by_person = defaultdict(list)
    cell_people = defaultdict(set)
    errors = Counter()
    for r in records:
        by_person[r["participant_id"]].append(r)
        cell_people[r["method"], r["model_id"]].add(r["participant_id"])
        for target, pred in [(r["target_label"], r["prediction"])] + ([(r["start_target_label"], r["start_prediction"])] if r["task_type"] == "transition" else []):
            if pred != target:
                errors[error_type(pred, target)] += 1
    analysis["design"] = {"trials_per_participant": sorted({len(v) for v in by_person.values()}),
                          "cell_participants": [len(v) for v in cell_people.values()],
                          "live2d_codes": sum(m.startswith("l2d_") for m in analysis["model_ids"]),
                          "vrm_codes": sum(m.startswith("vrm_") for m in analysis["model_ids"])}
    analysis["endpoint_error_counts"] = dict(errors)
    analysis["neutral_calm_confusion"] = neutral_calm_confusions(records)
    analysis["study_protocol"] = provenance.get("study_protocol", {})
    (out / "analysis.json").write_text(json.dumps(analysis, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    write_csv(out / "normalized_responses.csv", records)
    write_csv(out / "publication_responses.csv", [
        {key: value for key, value in row.items() if key not in {"source_dataset_kind", "provenance_status"}}
        for row in records])
    write_csv(out / "participant_summary.csv", grouped_summaries(records, ("participant_id", "method", "model_id")))
    write_csv(out / "method_summary.csv", grouped_summaries(records, ("method",)))
    write_csv(out / "model_method_summary.csv", grouped_summaries(records, ("model_id", "method")))
    write_csv(out / "emotion_summary.csv", grouped_summaries(records, ("method", "task_type", "target_label")))
    write_csv(out / "transition_summary.csv", grouped_summaries([r for r in records if r["task_type"] == "transition"], ("method", "start_target_label", "target_label")))
    counts = Counter()
    for r in records:
        for target, pred in [(r["target_label"], r["prediction"])] + ([(r["start_target_label"], r["start_prediction"])] if r["task_type"] == "transition" else []):
            counts[r["method"], target, pred] += 1
    write_csv(out / "confusion_counts.csv", [{"method": m, "target_label": t, "prediction": p, "judgments": n}
                                           for (m, t, p), n in sorted(counts.items())])
    build_figures(records, analysis, paper)
    build_tex(analysis, paper)
    return analysis


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--paper-dir", type=Path, required=True)
    parser.add_argument("--draws", type=int, default=10000)
    parser.add_argument("--seed", type=int, default=20261028)
    args = parser.parse_args()
    result = run(args.source, args.provenance, args.out, args.paper_dir, args.draws, args.seed)
    print(json.dumps({"participants": result["overall"]["participants"], "responses": result["overall"]["responses"],
                      "recognition": {m: result["by_method"][m]["recognition"] for m in METHODS},
                      "crossed_intervals": result["bootstrap"]["crossed_participant_stimulus"]}, indent=2))


if __name__ == "__main__":
    main()
