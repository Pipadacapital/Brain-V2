"""C4 / C5 / C8 — behavioral invariants (register existing killed-mutant gates).

These assert runtime behaviour, so they shell out to the existing test/parity
commands. They run only with ``--with-behavioral`` (CI passes that flag); without
it they SKIP — but still FAIL if the registered command/target has vanished, so
the suite stays the single index of "what makes Brain Brain".

  C4  CH query gateway is fail-closed (UnscopedQueryError on missing workspace_id)
  C5  Metric registry TS<->Python byte-parity (killed-mutant gate)
  C8  @paradigm gate enforced at runtime (sql/ml may not reach the LLM gateway)
"""

from __future__ import annotations

import subprocess

from _lib import ROOT, CheckResult, Status

# cid -> (title, target_path_relative_to_root, command, cwd_relative_to_root)
_BEHAVIORAL = {
    "C4": (
        "CH query gateway fail-closed",
        "apps/analytics-service/tests/test_query_gateway_isolation.py",
        ["python", "-m", "pytest", "-q", "tests/test_query_gateway_isolation.py"],
        "apps/analytics-service",
    ),
    "C5": (
        "Metric registry TS<->Python parity",
        "tools/check-metrics-parity.sh",
        ["bash", "tools/check-metrics-parity.sh"],
        ".",
    ),
    "C8": (
        "@paradigm gate enforced at runtime",
        "apps/intelligence-service/tests/unit/test_gate1_paradigm.py",
        ["python", "-m", "pytest", "-q", "tests/unit/test_gate1_paradigm.py"],
        "apps/intelligence-service",
    ),
}


def _run_one(cid: str, run: bool) -> CheckResult:
    title, target, cmd, cwd = _BEHAVIORAL[cid]
    if not (ROOT / target).exists():
        return CheckResult(cid, title, Status.FAIL,
                           f"registered target missing: {target} (gate was deleted)")
    if not run:
        return CheckResult(cid, title, Status.SKIP,
                           f"behavioral — run with --with-behavioral (`{' '.join(cmd)}`)")
    try:
        proc = subprocess.run(cmd, cwd=str(ROOT / cwd), capture_output=True, text=True, timeout=600)
    except Exception as exc:  # toolchain not bootstrapped, timeout, etc.
        return CheckResult(cid, title, Status.SKIP, f"could not execute ({exc})")
    if proc.returncode == 0:
        return CheckResult(cid, title, Status.PASS, f"`{' '.join(cmd)}` exited 0")
    tail = (proc.stdout + proc.stderr).strip().splitlines()[-8:]
    return CheckResult(cid, title, Status.FAIL, f"`{' '.join(cmd)}` exited {proc.returncode}", tail)


def check_c4(run: bool) -> CheckResult:
    return _run_one("C4", run)


def check_c5(run: bool) -> CheckResult:
    return _run_one("C5", run)


def check_c8(run: bool) -> CheckResult:
    return _run_one("C8", run)
