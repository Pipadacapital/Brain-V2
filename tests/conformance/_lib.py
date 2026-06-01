"""Shared helpers for the Brain design-conformance suite.

Pure-stdlib, deterministic (@paradigm: sql — zero LLM, zero network). Every check
asserts an architectural INVARIANT against on-disk truth and is meant to run as a
required CI gate. A check must be non-vacuous: it fails if the invariant is removed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class Status(str, Enum):
    PASS = "PASS"   # invariant holds
    FAIL = "FAIL"   # invariant violated (blocking)
    WARN = "WARN"   # advisory invariant violated (non-blocking)
    SKIP = "SKIP"   # behavioral check not executed this run


@dataclass
class CheckResult:
    cid: str
    title: str
    status: Status
    detail: str = ""
    evidence: list[str] = field(default_factory=list)


def repo_root() -> Path:
    p = Path(__file__).resolve()
    for parent in [p, *p.parents]:
        if (parent / "pnpm-workspace.yaml").exists():
            return parent
    raise RuntimeError("repo root (pnpm-workspace.yaml) not found")


ROOT = repo_root()

_LINE_COMMENT = re.compile(r"--[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)


def strip_sql_comments(text: str) -> str:
    return _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", text))


def globs(*patterns: str, exclude_prefixes: tuple[str, ...] = ()) -> list[Path]:
    out: list[Path] = []
    for g in patterns:
        for p in sorted(ROOT.glob(g)):
            if exclude_prefixes and p.name.startswith(exclude_prefixes):
                continue
            out.append(p)
    return out


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def extract_create_tables(sql: str) -> list[tuple[str, str]]:
    """Return [(table_name_lower, body)] for each CREATE TABLE, paren-balanced.

    Handles nested parens (GENERATED AS (...), CHECK (...)). Schema prefix stripped.
    """
    sql = strip_sql_comments(sql)
    blocks: list[tuple[str, str]] = []
    for m in re.finditer(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w.\"]+)", sql, re.I
    ):
        name = m.group(1).strip('"').split(".")[-1].lower()
        i = sql.find("(", m.end())
        if i == -1:
            continue
        depth, j = 0, i
        while j < len(sql):
            c = sql[j]
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        blocks.append((name, sql[i + 1 : j]))
    return blocks


def iter_lines(paths: list[Path], suffixes: tuple[str, ...]) -> list[tuple[Path, int, str]]:
    """Yield (path, 1-based-lineno, line) for source files under paths (dirs or files)."""
    out: list[tuple[Path, int, str]] = []
    files: list[Path] = []
    for p in paths:
        if p.is_dir():
            for sfx in suffixes:
                files.extend(p.rglob(f"*{sfx}"))
        elif p.suffix in suffixes:
            files.append(p)
    for f in sorted(set(files)):
        if "node_modules" in f.parts or "__pycache__" in f.parts or "/gen/" in str(f):
            continue
        try:
            for n, line in enumerate(read(f).splitlines(), start=1):
                out.append((f, n, line))
        except Exception:
            continue
    return out
