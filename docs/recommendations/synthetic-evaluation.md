# Synthetic evaluation preparation

These checks exercise mechanics only; they do not establish recommendation
quality or authorize live serving or learned-model promotion.

## Ranking benchmark

Run `node scripts/benchmark-recommendations.ts 10000` with Node 22.20 or newer
supporting TypeScript type stripping. The script creates synthetic courses and
a cold-start survey in memory, then prints a JSON timing and count. On the
development machine, one run ranked 10,000 courses in approximately 1.4 seconds.
This is not a production latency guarantee: hardware, tags, profiles and
candidate counts change the result, and the algorithm remains quadratic.

## Offline data preparation prototype

Run `python ml/synthetic_dataset.py` and `python -m unittest discover -s ml -p "test_*.py"`.
On the current Windows checkout a portable Python 3.12.10 is available under
the ignored `node_modules/python312` directory; use its `python.exe` if Python
is not on PATH. This local runtime is not part of the repository and will be
removed by a clean dependency reinstall.
The standard-library prototype generates its own synthetic events, validates
impression/feedback associations, and demonstrates a stable user holdout and
time cutoff. It rejects ambiguous repeated feedback and never treats an
unlabeled impression as a negative. Feature snapshots, when supplied, are
validated and read from the impression rather than the later feedback event.
No file or real export is read or written.

Install the pinned prototype dependencies with `python -m pip install -r
ml/requirements-synthetic.txt`. Run `python ml/synthetic_training.py` to train
a logistic-regression pipeline on features prepared from synthetic impression
and feedback events and print versioned smoke metadata. The generated train and
test users are disjoint and event timestamps are on opposite sides of the cutoff;
this is not a verified real-export split. No model is saved. The unittest
command above also covers the training prototype.

`ml/synthetic_metrics.py` implements per-request NDCG and hit-rate mechanics for
explicit binary labels, with deterministic tie-breaking and hand-calculated
tests. Requests with no positive labels produce null metrics. These functions
are not an experiment runner and do not correct exposure bias; no synthetic
metric is evidence of recommendation quality.

These prototypes are **not** a production training pipeline or experiment runner. They do not define
the team's event-export schema, deduplication policy, labels, feature set,
exposure-bias correction, production model, or deployment thresholds. Alan and Ryan's
agreed dataset and evaluation contracts, Maria's export and access, and Ryan's
data-sufficiency review remain prerequisites for the respective issue #11
handoffs and real-data evaluation. The synthetic split and labels are examples,
not decisions for production. Deletion behavior and serving integration remain
unimplemented.
