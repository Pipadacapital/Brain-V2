#!/usr/bin/env bash
set -euo pipefail

# check-metrics-parity.sh — CI stub for TS↔Python metric registry parity.
#
# TODO: implement TS↔Python metric parity check.
# When implemented, this script should:
#   1. Parse metric names + types from packages/lib-metrics/ (TS side).
#   2. Parse metric names + types from pylibs/brain_metrics/ (Python side).
#   3. Assert both sides define the same set of metrics with matching types.
#   4. Exit non-zero (fail CI) if any metric is defined on one side but not the other,
#      or if types mismatch.
#
# Wired as turbo root task check:metrics-parity with inputs:
#   packages/lib-metrics/**, pylibs/brain_metrics/**, tools/check-metrics-parity.sh
# So turbo will re-run this when either side changes.
#
# See docs/conventions/observability.md for the metric-parity convention.

exit 0
