"""
Root conftest.py for apps/ingestion-service.

Adds src/ to sys.path so that `from src.domain.framework ...` imports work
without installing the package.  This is the LOCAL-harness-only test setup;
no live Supabase, no live Kafka, no live vendor APIs.
"""
import sys
import os

# Prepend the src directory to sys.path
_src_path = os.path.join(os.path.dirname(__file__), "src")
if _src_path not in sys.path:
    sys.path.insert(0, _src_path)
