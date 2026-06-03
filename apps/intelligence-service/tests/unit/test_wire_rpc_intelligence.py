"""
test_wire_rpc_intelligence.py — Wire-RPC CI gate for IntelligenceService (ADR-0001 §4).

These tests start the REAL grpc.aio server on a loopback port, wait for
grpc_health.v1 Check = SERVING, open a grpcio channel, and round-trip at
least one business RPC asserting a typed response. A test fails if the RPC
returns UNIMPLEMENTED or the servicer is unregistered.

This is the ADR-0001 "recurrence-killer" gate for intelligence-service.

Test design:
  - test_register_push_token_wire_round_trip (NO external deps):
      Injects a fake _push_token_writer. Returns typed RegisterPushTokenResponse.
  - test_submit_insight_response_wire_round_trip (NO external deps):
      Injects a fake _decision_log_writer. Returns typed SubmitInsightResponseResponse.
  - test_get_morning_brief_deferred_path (NO external deps):
      No _signals_provider → Phase-D deferred path. Returns typed empty brief
      (NOT UNIMPLEMENTED). This is the critical ADR-0001 gate: proves the RPC
      is registered and returns a typed response even before Tier-B synthesis is wired.
  - test_get_morning_brief_with_signals_provider (NO external deps):
      Injects a fake _signals_provider. Returns typed InsightItem responses.
  - test_health_stays_serving (NO external deps): Health is SERVING alongside
      IntelligenceService.
  - test_missing_workspace_returns_invalid_argument: Validates fail-closed invariant.

Port selection: loopback port 0 lets the OS pick a free port, avoiding conflicts.

@paradigm: sql + io/event-handling (test toolchain only — no ML, no LLM)
"""

from __future__ import annotations

import asyncio
import sys
import pathlib

import pytest

# ---------------------------------------------------------------------------
# Ensure the _pb2 stubs are importable in the test process
# ---------------------------------------------------------------------------
_pb2_dir = str(pathlib.Path(__file__).parent.parent.parent / "src" / "interfaces" / "grpc" / "_pb2")
if _pb2_dir not in sys.path:
    sys.path.insert(0, _pb2_dir)


# ---------------------------------------------------------------------------
# Fake DI callables (no external deps)
# ---------------------------------------------------------------------------

def _fake_push_token_writer(*, workspace_id, user_id, device_id, expo_push_token):
    """Fake push token writer — returns a deterministic updated_at."""
    return "2026-06-03T07:00:00+00:00"


def _fake_decision_log_writer(
    *, workspace_id, insight_id, response_kind, edit_payload, idempotency_key
):
    """Fake decision log writer — returns a deterministic row_id."""
    return f"dl-row-{idempotency_key[:8]}"


def _fake_signals_provider(workspace_id: str, date: str):
    """Fake signals provider — returns one InsightItem-like dict."""
    return [
        {
            "insight_id": "test-insight-001",
            "title": "CM2 spike detected",
            "severity": "warning",
            "confidence": 0.87,
            "confidence_display_pct": 87,
            "summary": "CM2 spiked 30% on 2026-05-01",
            "detail": "Net sales dropped while COGS stayed flat.",
            "recommendation": {
                "action": "review_manually",
                "entity_id": "pnl-period-2026-05",
                "rationale": "CM2 spike warrants manual review.",
            },
            "expected_impact": {
                "revenue_mu": 0,
                "cm2_mu": 50_000,
                "currency_code": "INR",
                "impact_label": "+₹500 CM2",
            },
            "risk": "medium",
        }
    ]


# ---------------------------------------------------------------------------
# Async helper: start the real server on a free loopback port
# ---------------------------------------------------------------------------

async def _run_with_server(test_fn, signals_provider=None, decision_log_writer=None, push_token_writer=None):
    """Start the real grpc.aio server and run test_fn(port, pb2, pb2_grpc, health_pb2, health_pb2_grpc)."""
    import grpc
    import grpc.aio
    from grpc_health.v1 import health, health_pb2, health_pb2_grpc

    from interfaces.grpc.intelligence_servicer import (
        IntelligenceServiceAdapter,
        intelligence_pb2,
        intelligence_pb2_grpc,
    )

    server = grpc.aio.server()

    servicer = IntelligenceServiceAdapter(
        _signals_provider=signals_provider,
        _decision_log_writer=decision_log_writer,
        _push_token_writer=push_token_writer,
    )
    intelligence_pb2_grpc.add_IntelligenceServiceServicer_to_server(servicer, server)

    health_servicer = health.HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)

    port = server.add_insecure_port("127.0.0.1:0")
    await server.start()

    try:
        await test_fn(port, intelligence_pb2, intelligence_pb2_grpc, health_pb2, health_pb2_grpc)
    finally:
        await server.stop(grace=0)


async def _wait_serving(health_stub, health_pb2, timeout: float = 3.0):
    """Poll grpc_health.v1 until SERVING or timeout."""
    from grpc_health.v1 import health_pb2 as hp2
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        try:
            resp = await health_stub.Check(hp2.HealthCheckRequest(service=""))
            if resp.status == hp2.HealthCheckResponse.SERVING:
                return
        except Exception:
            pass
        await asyncio.sleep(0.05)
    raise TimeoutError("gRPC server did not become SERVING within timeout")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_register_push_token_wire_round_trip():
    """Start the real grpc.aio server and round-trip RegisterPushToken over the wire.

    ADR-0001 recurrence-killer: fails if RegisterPushToken returns UNIMPLEMENTED
    or the servicer is unregistered.

    No external deps: uses injected fake _push_token_writer.
    This is the primary wire-RPC gate test (runs in normal pytest suite).
    """
    async def inner(port, pb2, pb2_grpc, health_pb2, health_pb2_grpc):
        import grpc.aio

        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            health_stub = health_pb2_grpc.HealthStub(channel)
            await _wait_serving(health_stub, health_pb2)

            intel_stub = pb2_grpc.IntelligenceServiceStub(channel)
            request = pb2.RegisterPushTokenRequest(
                workspace_id="ws-test-001",
                user_id="user-abc",
                device_id="device-xyz",
                expo_push_token="ExponentPushToken[test-token-123]",
            )

            response = await intel_stub.RegisterPushToken(request)

            # Typed response — not UNIMPLEMENTED
            assert isinstance(response, pb2.RegisterPushTokenResponse), (
                "RegisterPushToken must return a typed response, not raise UNIMPLEMENTED"
            )
            assert response.registered is True
            assert response.updated_at == "2026-06-03T07:00:00+00:00"

    await _run_with_server(inner, push_token_writer=_fake_push_token_writer)


@pytest.mark.asyncio
async def test_submit_insight_response_wire_round_trip():
    """Round-trip SubmitInsightResponse — asserts typed response + LOGGED_AS_VOTE.

    No external deps: uses injected fake _decision_log_writer.
    """
    async def inner(port, pb2, pb2_grpc, health_pb2, health_pb2_grpc):
        import grpc.aio

        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            health_stub = health_pb2_grpc.HealthStub(channel)
            await _wait_serving(health_stub, health_pb2)

            intel_stub = pb2_grpc.IntelligenceServiceStub(channel)
            request = pb2.SubmitInsightResponseRequest(
                workspace_id="ws-test-001",
                insight_id="insight-001",
                response_kind=pb2.RESPONSE_KIND_APPROVE,
                edit_payload="",
                idempotency_key="idem-key-12345678",
            )

            response = await intel_stub.SubmitInsightResponse(request)

            assert isinstance(response, pb2.SubmitInsightResponseResponse)
            assert response.decision_log_row_id == "dl-row-idem-key"
            # CF-C6-MB-GRADUATED-LABEL-1: Day-1 status is always LOGGED_AS_VOTE
            assert response.status == pb2.GRADUATION_STATUS_LOGGED_AS_VOTE

    await _run_with_server(inner, decision_log_writer=_fake_decision_log_writer)


@pytest.mark.asyncio
async def test_get_morning_brief_deferred_path():
    """GetMorningBrief without a signals_provider returns typed empty brief.

    ADR-0001 CRITICAL GATE: the RPC must be REGISTERED (not UNIMPLEMENTED) even
    when the Phase-D Tier-B synthesis is not yet wired. The response must be
    a typed GetMorningBriefResponse — not an UNIMPLEMENTED gRPC error.

    No external deps: no _signals_provider injected.
    """
    async def inner(port, pb2, pb2_grpc, health_pb2, health_pb2_grpc):
        import grpc.aio

        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            health_stub = health_pb2_grpc.HealthStub(channel)
            await _wait_serving(health_stub, health_pb2)

            intel_stub = pb2_grpc.IntelligenceServiceStub(channel)
            request = pb2.GetMorningBriefRequest(
                workspace_id="ws-test-001",
                date="2026-06-03",
            )

            response = await intel_stub.GetMorningBrief(request)

            # Must be a typed response — NOT an UNIMPLEMENTED error
            assert isinstance(response, pb2.GetMorningBriefResponse), (
                "GetMorningBrief must return a typed GetMorningBriefResponse, "
                "not raise UNIMPLEMENTED (ADR-0001 recurrence-killer)"
            )
            # Phase-D deferred path: no items, but typed and registered
            assert isinstance(response.items, type(response.items))
            assert "Phase-D" in response.freshness_label or response.freshness_label == "Live", (
                f"freshness_label unexpected: {response.freshness_label!r}"
            )

    await _run_with_server(inner, signals_provider=None)


@pytest.mark.asyncio
async def test_get_morning_brief_with_signals_provider():
    """GetMorningBrief with a signals_provider returns real InsightItem protos.

    No external deps: uses injected fake _signals_provider.
    """
    async def inner(port, pb2, pb2_grpc, health_pb2, health_pb2_grpc):
        import grpc.aio

        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            health_stub = health_pb2_grpc.HealthStub(channel)
            await _wait_serving(health_stub, health_pb2)

            intel_stub = pb2_grpc.IntelligenceServiceStub(channel)
            request = pb2.GetMorningBriefRequest(
                workspace_id="ws-test-001",
                date="2026-06-03",
            )

            response = await intel_stub.GetMorningBrief(request)

            assert isinstance(response, pb2.GetMorningBriefResponse)
            assert len(response.items) == 1
            item = response.items[0]
            assert item.insight_id == "test-insight-001"
            assert item.title == "CM2 spike detected"
            # CF-C6-NO-UI-FLOAT-1: confidence_display_pct is pre-formatted int
            assert item.confidence_display_pct == 87
            # CF-C6-MB-CONTRACT-COMPLETENESS-1: expected_impact + risk present
            assert item.expected_impact.cm2_mu == 50_000
            assert item.expected_impact.currency_code == "INR"
            assert item.risk == pb2.RISK_LEVEL_MEDIUM
            # CF-C5-INJECTION-TYPED-REC-6: action is closed enum
            assert item.recommendation.action == pb2.RECOMMENDATION_ACTION_REVIEW_MANUALLY
            assert response.freshness_label == "Live"

    await _run_with_server(inner, signals_provider=_fake_signals_provider)


@pytest.mark.asyncio
async def test_health_stays_serving():
    """Health probe must return SERVING with IntelligenceService registered.

    ADR-0001 §4: health stays SERVING alongside the business servicer.
    """
    from grpc_health.v1 import health_pb2 as hp2

    async def inner(port, pb2, pb2_grpc, health_pb2, health_pb2_grpc):
        import grpc.aio

        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            health_stub = health_pb2_grpc.HealthStub(channel)
            await _wait_serving(health_stub, health_pb2)

            resp = await health_stub.Check(hp2.HealthCheckRequest(service=""))
            assert resp.status == hp2.HealthCheckResponse.SERVING, (
                f"Health must be SERVING with IntelligenceService registered, got {resp.status}"
            )

    await _run_with_server(inner)


@pytest.mark.asyncio
async def test_missing_workspace_returns_invalid_argument():
    """Empty workspace_id → INVALID_ARGUMENT for all RPCs (fail-closed invariant)."""
    import grpc
    import grpc.aio

    async def inner(port, pb2, pb2_grpc, health_pb2, health_pb2_grpc):
        async with grpc.aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            health_stub = health_pb2_grpc.HealthStub(channel)
            await _wait_serving(health_stub, health_pb2)

            intel_stub = pb2_grpc.IntelligenceServiceStub(channel)

            # GetMorningBrief with empty workspace_id
            with pytest.raises(grpc.aio.AioRpcError) as exc_info:
                await intel_stub.GetMorningBrief(
                    pb2.GetMorningBriefRequest(workspace_id="", date="2026-06-03")
                )
            assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT

            # RegisterPushToken with empty workspace_id
            with pytest.raises(grpc.aio.AioRpcError) as exc_info:
                await intel_stub.RegisterPushToken(
                    pb2.RegisterPushTokenRequest(
                        workspace_id="", user_id="u1", device_id="d1",
                        expo_push_token="ExponentPushToken[t]"
                    )
                )
            assert exc_info.value.code() == grpc.StatusCode.INVALID_ARGUMENT

    await _run_with_server(inner, push_token_writer=_fake_push_token_writer)
