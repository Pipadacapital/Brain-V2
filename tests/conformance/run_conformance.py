#!/usr/bin/env python3
"""Brain design-conformance runner (LLD §7).

Asserts the C1–C14 architectural invariants against on-disk truth and emits one
``[STATUS] Cn  <invariant>`` line per check. A single blocking FAIL = "not as per
design", with the file:line that drifted. Pure-stdlib, deterministic.

Usage:
    python tests/conformance/run_conformance.py                 # static checks
    python tests/conformance/run_conformance.py --with-behavioral  # + run C4/C5/C8
    python tests/conformance/run_conformance.py --json          # machine-readable

Exit code: 0 if no blocking FAIL, else 1. WARN (advisory) and SKIP never fail CI.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _lib import CheckResult, Status  # noqa: E402
import check_money_types, check_clickhouse, check_rls, check_decision_log  # noqa: E402
import check_memory, check_llm_gateway, check_pagination, check_layering  # noqa: E402
import behavioral  # noqa: E402

# Advisory checks WARN instead of failing the gate. (C12 graduated to BLOCKING in
# A4 once per-service roles + grants + the deny-matrix proof landed.)
_ADVISORY: set[str] = set()

_GREEN, _RED, _YELLOW, _GREY, _RESET = "\033[32m", "\033[31m", "\033[33m", "\033[90m", "\033[0m"
_COLOR = {Status.PASS: _GREEN, Status.FAIL: _RED, Status.WARN: _YELLOW, Status.SKIP: _GREY}


def _registry(run_behavioral: bool) -> list[CheckResult]:
    return [
        check_money_types.check_c1(),
        check_clickhouse.check_c2(),
        check_rls.check_c3(),
        behavioral.check_c4(run_behavioral),
        behavioral.check_c5(run_behavioral),
        check_decision_log.check_c6(),
        check_decision_log.check_c7(),
        behavioral.check_c8(run_behavioral),
        check_llm_gateway.check_c9(),
        check_pagination.check_c10(),
        check_layering.check_c11(),
        check_rls.check_c12(),
        check_memory.check_c13(),
        check_memory.check_c14(),
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description="Brain design-conformance suite (C1–C14)")
    ap.add_argument("--with-behavioral", action="store_true", help="execute C4/C5/C8 commands")
    ap.add_argument("--json", action="store_true", help="emit JSON")
    ap.add_argument("--no-color", action="store_true")
    args = ap.parse_args()

    results = _registry(args.with_behavioral)

    if args.json:
        print(json.dumps([r.__dict__ | {"status": r.status.value} for r in results], indent=2))
    else:
        print("Brain design-conformance (C1–C14) — invariant assertions vs on-disk truth\n")
        for r in results:
            tag = f"[{r.status.value}]"
            if not args.no_color:
                tag = f"{_COLOR[r.status]}{tag}{_RESET}"
            print(f"  {tag:<7} {r.cid:<4} {r.title}")
            if r.status != Status.PASS and r.detail:
                print(f"           ↳ {r.detail}")
            for ev in r.evidence[:12]:
                print(f"             • {ev}")

    counts = {s: sum(1 for r in results if r.status is s) for s in Status}
    blocking_fail = [r for r in results if r.status is Status.FAIL and r.cid not in _ADVISORY]

    if not args.json:
        print(
            f"\n  PASS {counts[Status.PASS]}  FAIL {counts[Status.FAIL]}  "
            f"WARN {counts[Status.WARN]}  SKIP {counts[Status.SKIP]}"
        )
        print("  RESULT:", "DRIFT — not as per design" if blocking_fail else "conformant ✔")
    return 1 if blocking_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
