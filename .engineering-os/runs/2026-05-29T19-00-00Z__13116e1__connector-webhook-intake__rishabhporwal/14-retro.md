# 14 — Retro: connector-webhook-intake (Stage 6, Rohan)

**Outcome:** PASS → APPROVE → Founder gate SIGNED (delegated). Commit pending Founder "commit it".
**Shape:** single high-stakes vertical slice (generic `POST /webhooks/:vendor` → gRPC → verify-first Python intake), `sql`/₹0, all live HELD-Stage-8.

---

## What went well

1. **Verify-first/default-deny is genuinely test-anchored.** All four load-bearing CRITICAL mutations went RED under MY independent re-mutation, reverted byte-clean (md5 identical). The kill-test discipline that the durable verify-the-verifier rule mandates is real here, not theatre.
2. **The generalization was a refactor-in-place, not a rewrite, done at zero cost.** Because Stage-3 was uncommitted, the Founder's "100+ sources" directive reshaped the dispatch (Shopify = a registered value, not the shape) without weakening a single invariant. Shreya's full re-review confirmed NO invariant weakened; the 2nd-test-vendor matrix mechanically proves genericity (zero servicer/route/proto edits to onboard a vendor). The registry is the textbook integration-extensible-schema posture (string discriminator + generic identity map).
3. **The unknown/spoofed vendor became the FIRST reject branch** — the generalization *strengthened* default-deny rather than adding a fall-open surface.
4. **Clean dependency lineage** — consumed exactly the seam `chore-app-hmac-secret-custody` left (`app_secret_provider.py:37-49` literally documents this feature as the future consumer). The two slices compose as designed.

---

## What bounced and why (BOUNCE-1 — the verify-the-verifier durable rule firing correctly)

**BOUNCE-1 (Stage 5, Tanvi):** Mutation 3 (bare `except Exception:` REJECT → `pass`) SURVIVED — the kill test went GREEN with the mutation applied. Root cause: a belt-and-suspenders `if secret is None: return REJECTED` guard immediately below the try block absorbed the fall-through, making the mutation-3 kill test **vacuous** (it passed whether or not the `except` clause did its job).

**Fix (Maya, Option A):** removed the structurally-unreachable belt-guard and moved `secret: str` declaration inside the `try`. Now a fall-through leaves `secret` unbound → `UnboundLocalError` propagates → mutation goes RED. No security regression (the bare `except Exception` is exhaustive; the belt-guard was provably dead code).

**My S6 re-verification:** I applied mutation 3 myself on disk → 2 failed (UnboundLocalError) → RED → reverted clean. The fix holds under my hand, not just Tanvi's.

### Is this a new rule-candidate? NO.

This is the **already-adopted** durable rule `2026-05-26__verify-the-verifier-mutation-on-gate` firing exactly as intended (Tanvi caught a vacuous gate-double; the dead-code-absorbing-the-mutation sub-pattern is precisely what the rule targets). The auto-candidate rule (≥3 distinct prior runs of a *new* root cause) does not apply — the root cause is the same family, and a standing rule already exists and is enforced. **No new `rule-proposals/` entry written; no `/adopt-rule` ask appended.** The correct disposition is: the rule worked. I note for the rule's running ledger that this is another occurrence of the "belt-and-suspenders guard makes the gate-mutation vacuous" sub-pattern (cf. `feat-credential-custody-aws-sm` where the vacuous test was the gate-mutation test itself) — a useful corroboration, not a new proposal.

### One process observation (non-rule)

The vacuous mutation 3 shipped past Stage 3 AND Stage 4 (Shreya's first review cited the belt-guard *as* the VERIFY-FIRST-1 evidence) and was only caught at Stage 5 by on-disk re-mutation. The lesson is the rule's existing sub-rule 7 ("re-mutate on disk; a code-read of the guard is not proof") — Shreya read the guard and trusted it; Tanvi mutated and caught it. The rule is correctly calibrated; this is evidence FOR keeping disk re-mutation at every gate that claims a kill, which the rule already mandates.

---

## What I'd watch next

- **Vendor #2 onboarding** will exercise the intake-path genericity that this slice's 2nd-vendor matrix only proves at the servicer layer (`webhook_intake.py` still hard-wires `ShopifyAdapter` for normalize/manifest). The `vendor` param + Kafka topic + `RawEvent.vendor` are already generic; the normalize/manifest lookup-from-spec is the documented vendor-#2 task. Flag it so vendor #2 doesn't silently fall back to Shopify's adapter.
- **MED-2 dead `shop_resolver.py`** should be deleted in Stage-8 commit prep — leaving a stale module that queries the dropped `connector_shop_map` muddies the single-resolver story even though it is unreachable.
- **Stage-8 ceremony is the real risk surface**, not the code: live ingress/WAF/TLS, the compromised `shpss_…` rotation, the real identity-map seed, the grpcio floor raise, and the festival-safe window. The code is correct; the cutover is where care is owed.

---

## Scorecard

| Dimension | Result |
|-----------|--------|
| Re-mutation (4 CRIT, on disk) | RED×4, reverted byte-clean |
| Suites (mine) | 329 Python + 42 gateway green |
| Plan-binding | no drift |
| Over-engineering | CLEAN |
| Single-Primitive | CLEAN |
| Paradigm | sql / ₹0 |
| Four-tenancy | PRESENT |
| Hard-rule deviation | NONE → delegated sign exercisable |
| New durable-rule proposed | NO (existing rule fired correctly) |
