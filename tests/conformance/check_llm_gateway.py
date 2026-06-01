"""C9 — LLM access is LiteLLM-gateway-only (no direct vendor SDK).

Invariant: no source file imports the Anthropic / OpenAI vendor SDK directly. All
LLM traffic routes through the LiteLLM gateway (policy tiers small_llm/frontier_llm)
so model choice, caching, budgets and residency stay centrally enforced.
"""

from __future__ import annotations

import re

from _lib import CheckResult, Status, iter_lines, rel
from _lib import ROOT

_DIRECT_SDK = re.compile(
    r"^\s*(from\s+anthropic\b|import\s+anthropic\b|from\s+openai\b|import\s+openai\b)"
    r"|new\s+Anthropic\s*\(|new\s+OpenAI\s*\(",
)
_ALLOW = ("litellm", "gateway")  # gateway adapter wrappers are the one allowed seam


def check_c9() -> CheckResult:
    paths = [ROOT / "apps", ROOT / "pylibs"]
    violations: list[str] = []
    for path, lineno, line in iter_lines(paths, (".py", ".ts")):
        if not _DIRECT_SDK.search(line):
            continue
        low = line.lower()
        if any(a in low for a in _ALLOW):
            continue
        violations.append(f"{rel(path)}:{lineno}: {line.strip()}")
    if violations:
        return CheckResult("C9", "LLM access is LiteLLM-only", Status.FAIL,
                           f"{len(violations)} direct vendor-SDK import(s) outside the gateway", violations)
    return CheckResult("C9", "LLM access is LiteLLM-only", Status.PASS,
                       "no direct anthropic/openai SDK imports outside the gateway")
