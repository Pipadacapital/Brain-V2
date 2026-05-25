"""
bootstrap/__init__.py — intelligence-service startup sequence.

Called once at process startup (before serving any request).
CF-C5-RESIDENCY-1 / C5-SEC-005: assert_india_residency() MUST be called here
so the residency check is actually armed — defining it without calling it is not
enforcement (Shreya C5-SEC-005 finding).
"""

from application.gateway.client import assert_india_residency


def run_startup_assertions() -> None:
    """Execute all startup assertions for the intelligence-service.

    Raises on any violation — fail-closed by design. This function is called
    by the service entrypoint (Jatin Track J) before any request is served.

    Assertions:
        1. India residency (CF-C5-RESIDENCY-1): POSTGRES_REGION must be
           'ap-south-1' if set. Unset is accepted in the 5a build scope
           (tripwire HELD for 5b frontier model per arch plan §13).
    """
    assert_india_residency()
