# Convention: RegionAdapter Interface

Every region-varying concern goes behind the RegionAdapter interface.
**No region-specific fork of any code** (Appendix D blocker).

## Current state
India is the only region. UAE/GCC/EU are Phase 4 (Appendix B).
There is no `workspace.home_region` field yet.

## Interface homes
- **Python (primary):** `pylibs/brain_regional/` — RTO, COD, GST slabs, pincode
  reliability, data residency routing. The India adapter is the only implementation now.
- **TypeScript (config/routing):** `packages/config/` — region-aware routing config
  for the Node side (api-gateway fan-out, notifications routing).

## What goes behind the interface
- RTO prediction coefficients (pincode-level, state-level)
- COD risk thresholds
- GST slab lookups
- Data residency region (`ap-south-1` for India, future `me-south-1` for UAE)
- Telecom compliance rules (DLT/NCPR/DND, 9am–9pm sending window) — home: `apps/lifecycle-service`

## What does NOT go behind the interface
- Business logic that is India-universal (e.g., all orders have a `pincode` field —
  that is a schema decision, not a region-adapter decision).

## Extending to a new region (future)
1. Create `pylibs/brain_regional/brain_regional/adapters/<region>/`.
2. Implement the `RegionAdapter` protocol.
3. Register in the adapter factory (keyed by `workspace.home_region`).
4. No changes needed to the metric engine, frontend, intelligence, or notifications —
   that is the promise this seam preserves.

## Zero forks at scaffold time
There is no code to fork. The seam is documented here so the first person to add
region-specific logic puts it in the right place.
