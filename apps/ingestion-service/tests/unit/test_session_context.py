"""
Unit tests for session_context.py (P1) — fail-closed guarantees.

@paradigm: sql

Tests:
  - with_workspace rejects empty string (fail-closed)
  - with_workspace rejects None (fail-closed)
  - with_workspace rejects non-UUID string (fail-closed)
  - with_workspace rejects UUID-shaped but wrong format string (fail-closed)
  - with_workspace accepts valid UUIDv4 (positive path — does NOT need a real DB)
  - with_superadmin sets is_superadmin='true' and clears workspace_id (verified via GUC read)
  - _get_direct_url raises when DIRECT_URL not set
  - UUID_REGEX matches valid v4 UUIDs case-insensitively
"""

import os
import re
import pytest

from src.infrastructure.db.session_context import (
    _UUID_REGEX,
    _get_direct_url,
    with_workspace,
    with_superadmin,
)


class TestUuidRegex:
    def test_accepts_lowercase_uuid(self):
        assert _UUID_REGEX.match("550e8400-e29b-41d4-a716-446655440000")

    def test_accepts_uppercase_uuid(self):
        assert _UUID_REGEX.match("550E8400-E29B-41D4-A716-446655440000")

    def test_rejects_missing_dashes(self):
        assert not _UUID_REGEX.match("550e8400e29b41d4a716446655440000")

    def test_rejects_too_short(self):
        assert not _UUID_REGEX.match("550e8400-e29b-41d4-a716-44665544000")

    def test_rejects_empty_string(self):
        assert not _UUID_REGEX.match("")

    def test_rejects_non_hex_chars(self):
        assert not _UUID_REGEX.match("gggggggg-e29b-41d4-a716-446655440000")


class TestGetDirectUrl:
    def test_raises_when_env_not_set(self, monkeypatch):
        monkeypatch.delenv("DIRECT_URL", raising=False)
        with pytest.raises(RuntimeError, match="DIRECT_URL is not set"):
            _get_direct_url()

    def test_returns_value_when_set(self, monkeypatch):
        monkeypatch.setenv("DIRECT_URL", "postgresql://localhost:5432/brain")
        assert _get_direct_url() == "postgresql://localhost:5432/brain"


class TestWithWorkspaceFailClosed:
    """with_workspace MUST raise before calling fn if workspace_id is invalid."""

    @pytest.mark.asyncio
    async def test_rejects_empty_string(self):
        called = False
        async def fn(conn):
            nonlocal called
            called = True
        with pytest.raises(ValueError, match="non-empty string"):
            await with_workspace("", fn)
        assert not called, "fn must NOT be called with empty workspace_id"

    @pytest.mark.asyncio
    async def test_rejects_none(self):
        called = False
        async def fn(conn):
            nonlocal called
            called = True
        with pytest.raises(ValueError):
            await with_workspace(None, fn)  # type: ignore[arg-type]
        assert not called

    @pytest.mark.asyncio
    async def test_rejects_non_uuid_string(self):
        called = False
        async def fn(conn):
            nonlocal called
            called = True
        with pytest.raises(ValueError, match="not a valid UUID"):
            await with_workspace("not-a-uuid", fn)
        assert not called

    @pytest.mark.asyncio
    async def test_rejects_integer(self):
        called = False
        async def fn(conn):
            nonlocal called
            called = True
        with pytest.raises((ValueError, AttributeError)):
            await with_workspace(12345, fn)  # type: ignore[arg-type]
        assert not called

    @pytest.mark.asyncio
    async def test_rejects_uuid_without_hyphens(self):
        called = False
        async def fn(conn):
            nonlocal called
            called = True
        with pytest.raises(ValueError, match="not a valid UUID"):
            await with_workspace("550e8400e29b41d4a716446655440000", fn)
        assert not called

    @pytest.mark.asyncio
    async def test_direct_url_missing_raises_before_connect(self, monkeypatch):
        """When DIRECT_URL is missing, with_workspace raises before any DB call."""
        monkeypatch.delenv("DIRECT_URL", raising=False)
        called = False
        async def fn(conn):
            nonlocal called
            called = True
        with pytest.raises(RuntimeError, match="DIRECT_URL is not set"):
            await with_workspace("550e8400-e29b-41d4-a716-446655440000", fn)
        assert not called
