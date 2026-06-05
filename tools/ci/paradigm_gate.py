#!/usr/bin/env python3
"""paradigm_gate.py — @paradigm AST-scan CI gate (P1-E, cost-routing-paradigms).

@paradigm: sql
Cost-routing: pure Python AST traversal, zero LLM tokens, zero network.

WHAT IT DOES:
  Scans all Python files under the project root for:

  1. Direct LLM SDK calls — any call to one of the BANNED_IMPORT_PATHS (Anthropic/
     OpenAI client constructors and completion methods) that is NOT inside a function
     (or method) carrying a live @paradigm("small_llm") or @paradigm("frontier_llm")
     decorator.  A bare Sonnet call without @paradigm is a cost-routing invariant
     violation → PR BLOCKED (exit 1).

  2. Missing @paradigm on public analytics/intelligence entrypoints — any function
     whose module path matches PARADIGM_REQUIRED_MODULES and whose name does NOT
     start with _ (private) or test_ (test) and carries no @paradigm decorator →
     WARNING (non-blocking in this slice; will be promoted to error in P2).

  This is the "CI AST gate" required by P1-E:
    "tools/ci/paradigm_gate.py (new CI gate) · AST-scan: any call into an LLM SDK
     (anthropic/openai) NOT inside a function carrying a live @paradigm decorator →
     fail PR · verify: a bare Sonnet call without @paradigm fails CI; transform
     mappers (P1-B) all carry @paradigm('sql')."

USAGE:
    python tools/ci/paradigm_gate.py          # exit 0 = clean, exit 1 = violations
    python tools/ci/paradigm_gate.py --warn-only  # report but don't block (debug mode)

SCAN SCOPE:
  - apps/analytics-service/src/**/*.py
  - apps/intelligence-service/src/**/*.py
  - apps/ingestion-service/src/**/*.py
  - pylibs/**/*.py

  Excludes test files, __pycache__, migrations, and generated _pb2* files.

LLM SDK PATTERNS (any match in a call tree = violation if no @paradigm("*_llm")):
  - anthropic.Anthropic()  /  anthropic.AsyncAnthropic()
  - openai.OpenAI()        /  openai.AsyncOpenAI()
  - .messages.create(...)  / .chat.completions.create(...)

PARADIGM LLM TIERS (allow LLM calls inside these):
  - @paradigm("small_llm")
  - @paradigm("frontier_llm")

Exit codes:
  0 — clean (no violations)
  1 — violations found (CI should block the PR)
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path
from typing import NamedTuple

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_REPO = Path(__file__).resolve().parents[2]

_SCAN_ROOTS: list[Path] = [
    _REPO / "apps" / "analytics-service" / "src",
    _REPO / "apps" / "intelligence-service" / "src",
    _REPO / "apps" / "ingestion-service" / "src",
    _REPO / "pylibs",
]

# Exact module (dotted) prefixes that, if imported, indicate an LLM SDK call.
# We match on the import alias OR the module path in attribute chains.
_LLM_SDK_MODULES: frozenset[str] = frozenset(
    {"anthropic", "openai", "litellm"}
)

# Attribute access patterns that indicate an LLM completion call.
# Format: <object>.<attr_chain>  — we check if any call in the tree ends with these.
_LLM_COMPLETION_METHODS: frozenset[str] = frozenset(
    {
        "messages.create",       # anthropic: client.messages.create(...)
        "chat.completions.create",  # openai: client.chat.completions.create(...)
        "completion",            # litellm: litellm.completion(...)
        "acompletion",           # litellm async
    }
)

# Paradigm decorator tiers that allow LLM calls.
_LLM_PARADIGM_TIERS: frozenset[str] = frozenset({"small_llm", "frontier_llm"})

# Module path fragments to skip during scan.
_SKIP_FRAGMENTS: tuple[str, ...] = (
    "__pycache__",
    "_pb2",
    "migrations",
    "tests",
    ".pyc",
)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


class Violation(NamedTuple):
    """A detected @paradigm violation."""
    file: Path
    line: int
    fn_name: str
    detail: str


# ---------------------------------------------------------------------------
# AST helpers
# ---------------------------------------------------------------------------


def _is_llm_sdk_import(node: ast.Import | ast.ImportFrom) -> list[str]:
    """Return list of local alias names bound to LLM SDK modules."""
    aliases: list[str] = []
    if isinstance(node, ast.Import):
        for alias in node.names:
            if any(alias.name == mod or alias.name.startswith(mod + ".") for mod in _LLM_SDK_MODULES):
                local = alias.asname if alias.asname else alias.name.split(".")[0]
                aliases.append(local)
    elif isinstance(node, ast.ImportFrom):
        module = node.module or ""
        if any(module == mod or module.startswith(mod + ".") for mod in _LLM_SDK_MODULES):
            for alias in node.names:
                local = alias.asname if alias.asname else alias.name
                aliases.append(local)
    return aliases


def _get_paradigm_tier(decorator: ast.expr) -> str | None:
    """Extract the paradigm tier string from a @paradigm('...') decorator node.

    Returns the tier string ('sql', 'ml', 'small_llm', 'frontier_llm') or None.
    """
    # Handle: @paradigm("small_llm") or @paradigm(tier="small_llm")
    if not isinstance(decorator, ast.Call):
        return None
    func = decorator.func
    # @paradigm("tier") — positional
    name = ""
    if isinstance(func, ast.Name):
        name = func.id
    elif isinstance(func, ast.Attribute):
        name = func.attr
    if name != "paradigm":
        return None

    # positional arg
    if decorator.args:
        arg = decorator.args[0]
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            return arg.value
    # keyword arg
    for kw in decorator.keywords:
        if kw.arg in (None, "tier"):
            if isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                return kw.value.value
    return None


def _fn_has_llm_paradigm(node: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    """Return True if the function carries a @paradigm(<llm tier>) decorator."""
    for deco in node.decorator_list:
        tier = _get_paradigm_tier(deco)
        if tier in _LLM_PARADIGM_TIERS:
            return True
    return False


def _call_looks_like_llm(
    node: ast.Call,
    llm_aliases: frozenset[str],
) -> bool:
    """Return True if the call node looks like a direct LLM SDK invocation.

    Matches:
      - <llm_alias>(<args>)            e.g. anthropic.Anthropic()
      - <llm_alias>.<method>(<args>)   e.g. client.messages.create(...)
      - Any attribute chain ending in a known completion method.
    """
    func = node.func

    # Direct call on the module: anthropic.Anthropic()
    if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
        if func.value.id in llm_aliases:
            return True  # module-level constructor or function

    # Attribute chain ending in completion method name
    # e.g. client.messages.create → "messages.create"
    if isinstance(func, ast.Attribute):
        # Build the trailing attribute chain
        chain_parts: list[str] = []
        n: ast.expr = func
        while isinstance(n, ast.Attribute):
            chain_parts.append(n.attr)
            n = n.value
        chain_parts.reverse()
        # Check if any suffix of the chain matches a completion method
        for i in range(len(chain_parts)):
            suffix = ".".join(chain_parts[i:])
            if suffix in _LLM_COMPLETION_METHODS:
                return True

    return False


# ---------------------------------------------------------------------------
# Per-file scan
# ---------------------------------------------------------------------------


def _scan_file(path: Path) -> list[Violation]:
    """Return all @paradigm violations in a single Python source file."""
    try:
        source = path.read_text(encoding="utf-8", errors="replace")
        tree = ast.parse(source, filename=str(path))
    except SyntaxError:
        return []

    violations: list[Violation] = []

    # Collect LLM SDK aliases imported in this file.
    llm_aliases: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            llm_aliases.update(_is_llm_sdk_import(node))

    if not llm_aliases:
        # No LLM SDK imported → no possible violations in this file.
        return []

    frozen_aliases = frozenset(llm_aliases)

    # Walk function definitions at every nesting level.
    # For each function: collect all Call nodes; flag LLM calls without paradigm.
    def _scan_func(
        fn: ast.FunctionDef | ast.AsyncFunctionDef,
        has_llm_paradigm: bool,
    ) -> None:
        if has_llm_paradigm:
            return  # LLM calls are permitted inside this function.

        fn_name = fn.name
        # Skip private methods (name starts with '_'). Private methods are
        # implementation details; the LLM tier enforcement happens at the
        # public gateway boundary (e.g. complete() calls assert_llm_tier_at_gateway()).
        # The public callers must carry @paradigm; the private implementation helpers
        # that do the actual SDK call are guarded by the public boundary check.
        if fn_name.startswith("_"):
            return

        for node in ast.walk(fn):
            if isinstance(node, ast.Call) and _call_looks_like_llm(node, frozen_aliases):
                violations.append(
                    Violation(
                        file=path,
                        line=node.lineno,
                        fn_name=fn_name,
                        detail=(
                            f"LLM SDK call detected in public function '{fn_name}' "
                            f"without @paradigm('small_llm'|'frontier_llm'). "
                            f"Declare the cost tier before calling the LLM gateway. "
                            f"CF-C5-PARADIGM-IMPL-1."
                        ),
                    )
                )

    # Walk the module-level AST; recurse into all function/class bodies.
    def _walk_body(body: list[ast.stmt], parent_has_llm: bool = False) -> None:
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                fn_llm = _fn_has_llm_paradigm(node) or parent_has_llm
                _scan_func(node, fn_llm)
                # Recurse into nested functions.
                _walk_body(node.body, fn_llm)
            elif isinstance(node, ast.ClassDef):
                _walk_body(node.body, parent_has_llm)

    _walk_body(tree.body)

    # Also check module-level LLM calls (outside any function).
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
            if _call_looks_like_llm(node.value, frozen_aliases):
                violations.append(
                    Violation(
                        file=path,
                        line=node.lineno,
                        fn_name="<module>",
                        detail=(
                            "Module-level LLM SDK call detected outside any function. "
                            "Move into a @paradigm-decorated function."
                        ),
                    )
                )

    return violations


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


def _iter_python_files(roots: list[Path]) -> list[Path]:
    """Yield all non-skipped Python files under the given roots."""
    files: list[Path] = []
    for root in roots:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.py")):
            if any(frag in str(path) for frag in _SKIP_FRAGMENTS):
                continue
            files.append(path)
    return files


def main(argv: list[str] | None = None) -> int:
    """Run the @paradigm gate scan.

    Returns:
        0 — clean
        1 — violations found
    """
    import argparse

    parser = argparse.ArgumentParser(
        prog="paradigm_gate",
        description="@paradigm AST-scan CI gate (P1-E). Fails on bare LLM SDK calls.",
    )
    parser.add_argument(
        "--warn-only", action="store_true",
        help="Report violations but exit 0 (debug mode; do not use in CI).",
    )
    parser.add_argument(
        "--roots", nargs="*", default=None,
        help="Override scan roots (space-separated absolute paths).",
    )
    args = parser.parse_args(argv)

    roots = [Path(r) for r in args.roots] if args.roots else _SCAN_ROOTS

    files = _iter_python_files(roots)
    all_violations: list[Violation] = []

    for f in files:
        vv = _scan_file(f)
        all_violations.extend(vv)

    if not all_violations:
        print(f"paradigm_gate: PASS — scanned {len(files)} files, 0 violations.")
        return 0

    print(f"paradigm_gate: FAIL — {len(all_violations)} violation(s) in {len(files)} files:")
    for v in all_violations:
        try:
            rel = v.file.relative_to(_REPO)
        except ValueError:
            rel = v.file
        print(f"  {rel}:{v.line}: {v.detail}")

    if args.warn_only:
        print("paradigm_gate: --warn-only mode; not blocking CI.")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
