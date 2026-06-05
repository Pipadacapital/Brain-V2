"""
test_paradigm_gate.py — Tests for tools/ci/paradigm_gate.py (P1-E CI gate).

@paradigm: sql
Cost-routing: pure Python AST traversal, zero LLM tokens.

Verifies both positive and negative scenarios:
  POSITIVE: bare LLM call without @paradigm → gate fails (exit 1 behaviour)
  POSITIVE: properly decorated @paradigm("frontier_llm") call → gate passes
  POSITIVE: private method LLM call → gate passes (private methods excluded)
  NEGATIVE: gate runs cleanly on a clean codebase (no violations)
  NEGATIVE: gate does NOT pass on code with known violations
"""

from __future__ import annotations

import ast
import sys
import textwrap
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Import the gate module directly so we can test individual helpers
# ---------------------------------------------------------------------------

_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO))

from tools.ci.paradigm_gate import (
    _scan_file,
    _is_llm_sdk_import,
    _get_paradigm_tier,
    _call_looks_like_llm,
    _fn_has_llm_paradigm,
    main as _gate_main,
    Violation,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_src(src: str) -> ast.Module:
    return ast.parse(textwrap.dedent(src))


def _write_tmp(tmp_path: Path, name: str, src: str) -> Path:
    p = tmp_path / name
    p.write_text(textwrap.dedent(src))
    return p


# ---------------------------------------------------------------------------
# POSITIVE: _is_llm_sdk_import
# ---------------------------------------------------------------------------

class TestLlmSdkImportDetection:
    """Verify LLM SDK imports are correctly identified."""

    def test_anthropic_direct_import(self) -> None:
        src = "import anthropic"
        tree = _parse_src(src)
        node = tree.body[0]
        assert isinstance(node, ast.Import)
        aliases = _is_llm_sdk_import(node)
        assert "anthropic" in aliases

    def test_openai_direct_import(self) -> None:
        src = "import openai"
        tree = _parse_src(src)
        node = tree.body[0]
        aliases = _is_llm_sdk_import(node)
        assert "openai" in aliases

    def test_from_anthropic_import(self) -> None:
        src = "from anthropic import Anthropic"
        tree = _parse_src(src)
        node = tree.body[0]
        aliases = _is_llm_sdk_import(node)
        assert "Anthropic" in aliases

    def test_non_llm_import_not_detected(self) -> None:
        src = "import requests"
        tree = _parse_src(src)
        node = tree.body[0]
        aliases = _is_llm_sdk_import(node)
        assert aliases == []

    def test_aliased_import_detected(self) -> None:
        src = "import anthropic as ant"
        tree = _parse_src(src)
        node = tree.body[0]
        aliases = _is_llm_sdk_import(node)
        assert "ant" in aliases


# ---------------------------------------------------------------------------
# POSITIVE: _get_paradigm_tier
# ---------------------------------------------------------------------------

class TestGetParadigmTier:
    """Verify @paradigm tier extraction from decorator AST nodes."""

    def _decorator_from_src(self, src: str) -> ast.expr:
        tree = _parse_src(src)
        fn = tree.body[0]
        assert isinstance(fn, ast.FunctionDef)
        return fn.decorator_list[0]

    def test_frontier_llm_tier_extracted(self) -> None:
        src = """
        @paradigm("frontier_llm")
        def f(): pass
        """
        deco = self._decorator_from_src(src)
        assert _get_paradigm_tier(deco) == "frontier_llm"

    def test_small_llm_tier_extracted(self) -> None:
        src = """
        @paradigm("small_llm")
        def f(): pass
        """
        deco = self._decorator_from_src(src)
        assert _get_paradigm_tier(deco) == "small_llm"

    def test_sql_tier_extracted(self) -> None:
        src = """
        @paradigm("sql")
        def f(): pass
        """
        deco = self._decorator_from_src(src)
        assert _get_paradigm_tier(deco) == "sql"

    def test_non_paradigm_decorator_returns_none(self) -> None:
        src = """
        @property
        def f(self): pass
        """
        deco = self._decorator_from_src(src)
        assert _get_paradigm_tier(deco) is None


# ---------------------------------------------------------------------------
# POSITIVE: _fn_has_llm_paradigm
# ---------------------------------------------------------------------------

class TestFnHasLlmParadigm:
    """Verify function LLM paradigm detection."""

    def _fn_from_src(self, src: str) -> ast.FunctionDef:
        tree = _parse_src(src)
        return tree.body[0]

    def test_frontier_llm_detected(self) -> None:
        src = """
        @paradigm("frontier_llm")
        def f(): pass
        """
        fn = self._fn_from_src(src)
        assert _fn_has_llm_paradigm(fn) is True

    def test_small_llm_detected(self) -> None:
        src = """
        @paradigm("small_llm")
        def f(): pass
        """
        fn = self._fn_from_src(src)
        assert _fn_has_llm_paradigm(fn) is True

    def test_sql_not_llm(self) -> None:
        src = """
        @paradigm("sql")
        def f(): pass
        """
        fn = self._fn_from_src(src)
        assert _fn_has_llm_paradigm(fn) is False

    def test_no_decorator_not_llm(self) -> None:
        src = "def f(): pass"
        fn = self._fn_from_src(src)
        assert _fn_has_llm_paradigm(fn) is False


# ---------------------------------------------------------------------------
# POSITIVE: _scan_file — bare LLM call detected
# ---------------------------------------------------------------------------

class TestScanFileBareCall:
    """POSITIVE: bare LLM call without @paradigm → violation detected."""

    def test_bare_anthropic_call_fails(self, tmp_path: Path) -> None:
        src = """\
            import anthropic

            def synthesize_brief(data):
                client = anthropic.Anthropic()
                response = client.messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=2000,
                    messages=[{"role": "user", "content": str(data)}],
                )
                return response.content[0].text
        """
        f = _write_tmp(tmp_path, "bad.py", src)
        violations = _scan_file(f)
        assert len(violations) >= 1, (
            "Bare Anthropic call without @paradigm must produce at least 1 violation."
        )
        assert any("synthesize_brief" in v.fn_name for v in violations), (
            "Violation must name the function containing the bare LLM call."
        )

    def test_bare_openai_call_fails(self, tmp_path: Path) -> None:
        src = """\
            import openai

            def call_gpt(prompt):
                client = openai.OpenAI()
                resp = client.chat.completions.create(
                    model="gpt-4o",
                    messages=[{"role": "user", "content": prompt}],
                )
                return resp.choices[0].message.content
        """
        f = _write_tmp(tmp_path, "bad_openai.py", src)
        violations = _scan_file(f)
        assert len(violations) >= 1, (
            "Bare OpenAI call without @paradigm must produce a violation."
        )


# ---------------------------------------------------------------------------
# POSITIVE: _scan_file — @paradigm("frontier_llm") clears the violation
# ---------------------------------------------------------------------------

class TestScanFileWithParadigm:
    """POSITIVE: properly decorated @paradigm("frontier_llm") call passes the gate."""

    def test_frontier_llm_decorated_passes(self, tmp_path: Path) -> None:
        src = """\
            import anthropic

            def paradigm(tier):
                def decorator(fn):
                    return fn
                return decorator

            @paradigm("frontier_llm")
            def synthesize_brief(data):
                client = anthropic.Anthropic()
                response = client.messages.create(
                    model="claude-sonnet-4-6",
                    max_tokens=2000,
                    messages=[{"role": "user", "content": str(data)}],
                )
                return response.content[0].text
        """
        f = _write_tmp(tmp_path, "good.py", src)
        violations = _scan_file(f)
        assert len(violations) == 0, (
            f"@paradigm('frontier_llm') decorated function must produce 0 violations. "
            f"Got: {violations}"
        )

    def test_small_llm_decorated_passes(self, tmp_path: Path) -> None:
        src = """\
            import anthropic

            def paradigm(tier):
                def decorator(fn):
                    return fn
                return decorator

            @paradigm("small_llm")
            def classify_ticket(text):
                client = anthropic.Anthropic()
                return client.messages.create(model="claude-haiku-4-5", max_tokens=100,
                    messages=[{"role": "user", "content": text}])
        """
        f = _write_tmp(tmp_path, "good_small.py", src)
        violations = _scan_file(f)
        assert len(violations) == 0


# ---------------------------------------------------------------------------
# POSITIVE: private method exclusion
# ---------------------------------------------------------------------------

class TestScanFilePrivateExclusion:
    """POSITIVE: private method LLM calls are excluded (gateway pattern)."""

    def test_private_method_not_flagged(self, tmp_path: Path) -> None:
        src = """\
            import anthropic

            class GatewayClient:
                def _call_llm(self, model, messages):
                    # Private implementation helper — guarded at public boundary
                    client = anthropic.Anthropic()
                    return client.messages.create(model=model, messages=messages, max_tokens=2000)
        """
        f = _write_tmp(tmp_path, "gateway.py", src)
        violations = _scan_file(f)
        assert len(violations) == 0, (
            "Private methods (leading _) must not be flagged — "
            "they are guarded by the public method's @paradigm check."
        )


# ---------------------------------------------------------------------------
# NEGATIVE: files with no LLM imports produce no violations
# ---------------------------------------------------------------------------

class TestScanFileClean:
    """NEGATIVE: clean SQL-only files produce no violations."""

    def test_clean_sql_file_no_violations(self, tmp_path: Path) -> None:
        src = """\
            import psycopg

            def query_metrics(workspace_id, date):
                with psycopg.connect("...") as conn:
                    return conn.execute(
                        "SELECT sum(revenue_mu) FROM facts WHERE workspace_id = %s",
                        (workspace_id,)
                    ).fetchall()
        """
        f = _write_tmp(tmp_path, "clean.py", src)
        violations = _scan_file(f)
        assert violations == []

    def test_file_without_llm_import_skipped(self, tmp_path: Path) -> None:
        src = "x = 1 + 1"
        f = _write_tmp(tmp_path, "trivial.py", src)
        violations = _scan_file(f)
        assert violations == []


# ---------------------------------------------------------------------------
# INTEGRATION: main() on actual codebase
# ---------------------------------------------------------------------------

class TestParadigmGateMain:
    """Integration test: paradigm_gate main() runs clean on the actual codebase."""

    def test_main_passes_on_actual_codebase(self) -> None:
        """The paradigm gate must pass on the current Brain codebase.

        This is the acceptance criterion for P1-E Task 4:
          'a bare Sonnet call without @paradigm fails CI; transform mappers (P1-B)
           all carry @paradigm("sql")'
        The current codebase must have 0 violations.
        """
        result = _gate_main([])
        assert result == 0, (
            "paradigm_gate found violations in the actual Brain codebase. "
            "Every public function that calls an LLM SDK must carry "
            "@paradigm('small_llm') or @paradigm('frontier_llm'). "
            "Run: python tools/ci/paradigm_gate.py for details."
        )

    def test_main_fails_on_bare_call(self, tmp_path: Path) -> None:
        """paradigm_gate must fail (exit 1 → return 1) on a bare LLM call."""
        src = """\
            import anthropic

            def bad_function():
                client = anthropic.Anthropic()
                return client.messages.create(model="x", messages=[], max_tokens=10)
        """
        f = _write_tmp(tmp_path, "bad.py", src)
        result = _gate_main(["--roots", str(tmp_path)])
        assert result == 1, (
            "paradigm_gate must return 1 when a bare LLM call is detected."
        )

    def test_main_warn_only_returns_zero_even_with_violations(self, tmp_path: Path) -> None:
        """--warn-only mode returns 0 even with violations (debug mode)."""
        src = """\
            import anthropic

            def bad_function():
                client = anthropic.Anthropic()
                return client.messages.create(model="x", messages=[], max_tokens=10)
        """
        f = _write_tmp(tmp_path, "bad.py", src)
        result = _gate_main(["--warn-only", "--roots", str(tmp_path)])
        assert result == 0, "--warn-only must return 0 even with violations."
