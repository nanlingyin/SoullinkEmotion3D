# SoulLink paper: anonymous perceptual-study data

Associated manuscript: **SoulLink: Capability-Aware Continuous Affective Animation for 2D and 3D Avatars**. This directory releases the anonymized response data and analysis used in the accompanying manuscript; it does not indicate journal acceptance.

## Files

- [data/perceptual_responses.csv](data/perceptual_responses.csv): 3,860 trial responses from 386 participants, ten distinct stimuli per participant.
- [data/stimulus_pool.csv](data/stimulus_pool.csv): 500 authored state/transition tasks with intended emotion labels and evaluation windows. These are task definitions, not rendered videos.
- [results/analysis.json](results/analysis.json): reference recognition, ratings, neutral/calm confusion and bootstrap results.
- [reproduce_public_study.py](reproduce_public_study.py) and `soullink_bench/`: executable validation and analysis.

## Study design and fields

The study used a 2-method by 8-avatar block-randomized between-participant design. Each participant evaluated one method and one avatar. `method` is `full` (Full) or `nnls_ema` (Static QP + EMA). `model_id` values are anonymous L2D A-D and VRM A-D condition codes; they should not be inferred to identify particular third-party character assets.

`participant_id`, `trial_id` and `stimulus_id` are pseudonymous analysis identifiers. `task_type` is `state` or `transition`. `target_label` and `prediction` refer to the final/state emotion; `start_target_label` and `start_prediction` apply to transitions. Emotion labels are `neutral`, `joy`, `sadness`, `anger`, `fear`, `surprise`, and `calm`; recognition responses may also be `uncertain`.

`naturalness`, `transition_smoothness` and `change_clarity` use seven-point scales; transition-specific measures are blank for state tasks. Correctness/count fields are derived from the labels. Duration/window fields are in seconds. `batch_id` and `template_id` identify stimulus construction groups, and `data_kind=human_observation` identifies response records. Blank cells indicate non-applicable/missing values. CSV files use UTF-8 with a byte-order mark.

The release contains no names, email addresses, account credentials, original platform workbook, or third-party character binaries.

## Reproduce

Use Python 3.10 or newer. From this directory:

```sh
python -m pip install -r requirements.txt
python reproduce_public_study.py --responses data/perceptual_responses.csv --reference results/analysis.json --out reproduced_analysis.json
```

The default run recomputes descriptive statistics and 10,000 crossed participant-stimulus bootstrap draws with seed 20261028, then checks them against the reference results. Participants are resampled within method/avatar strata; stimulus IDs are independently resampled. Participants are not paired across methods. No platform login, API key or model asset is required.

This release focuses on the perceptual statistics. It does not provide the missing technical crosswalk from all eight anonymous study conditions to actuator profiles. Three diagnostic profiles used elsewhere in the manuscript must not be substituted for those eight profiles. Controlled allocation code and additional research materials accompany the submission separately.

The pre-existing TypeScript application is distinct from the paper's Python allocation reference; adding this dataset does not integrate the paper's full optimization method into the production application.
