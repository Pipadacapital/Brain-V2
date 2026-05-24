# parity — golden-fixture harness engine for TS↔Python parity gate.
# @paradigm: sql (exact-integer comparator, zero LLM, zero live DB read)
# CF-C2-GOLDEN-1, CF-C2-RECON-TAXONOMY-1
from brain_metrics.parity.harness import run_harness
from brain_metrics.parity.taxonomy import (
    HarnessReport,
    MismatchCategory,
    MismatchRecord,
    classify_mismatch,
)

__all__ = [
    "run_harness",
    "HarnessReport",
    "MismatchCategory",
    "MismatchRecord",
    "classify_mismatch",
]
