# Plugin-side Diff Proposal — verify-the-verifier-mutation-on-gate

> Sibling to `2026-05-26__verify-the-verifier-mutation-on-gate.md`. The durable rule is in-repo and binding for Brain agents the moment these plugin diffs land. Founder applies on the plugin side; not auto-applied by claude-code (plugin edits affect all projects using the plugin).
>
> Plugin root: `~/.claude/plugins/marketplaces/brain-engineering-os-marketplace/`

---

## Diff 1 — `agents/backend-developer.md` (Vikram)

**Add to DoD section** (insert after the existing "tests verify behavior, not snapshot" line):

```markdown
- **High-stakes gate verification (DURABLE RULE 2026-05-26):**
  For every high-stakes gate (RLS isolation, PII fail-closed, numeric parity, HMAC/auth verification,
  fail-closed predicates) the Stage-3 build introduces or modifies, the test suite must include:
  (1) a **real-path test** that exercises the gate via the production entrypoint with the real
  collaborator (real registry/manifest/policy) plus a negative control, and (2) a **captured killed
  mutant** proving the gate can FAIL (mutant: gate removed / predicate inverted / encoding swapped),
  reverting to byte-identical. The killed-mutant must invoke the production code path — no replicas,
  no `createCaller`-style fixtures that skip middleware/serializers. Per sub-rule, the rule extends
  to every security control in the change, not only the named VETO gates.
  See `.engineering-os/durable-rules/2026-05-26__verify-the-verifier-mutation-on-gate.md`.
```

---

## Diff 2 — `agents/qa-agent.md` (Tanvi)

**Add to VETO section** (insert as a new VETO trigger):

```markdown
- **Missing real-path + killed-mutant on a high-stakes gate (DURABLE RULE 2026-05-26).** Tanvi VETOs
  any PR where a high-stakes gate (RLS, PII, numeric parity, HMAC/auth, fail-closed predicates) is
  introduced or modified WITHOUT (1) a real-path integration test plus negative control and (2) a
  captured killed-mutant output verbatim in the QA review. A gate-manufacturing double, a test that
  asserts against a replica, or a test that uses a `createCaller`/middleware-skip fixture is treated
  as structurally inert (same disposition as no test at all). Stage-6 final review re-mutates on
  disk to confirm; if Tanvi's QA review does not carry the captured killed-mutant output, the PR
  cannot advance to Stage 6.
```

---

## Diff 3 — `agents/architect.md` (Aryan)

**Add to plan-template guidance**:

```markdown
- **High-stakes gate inventory (DURABLE RULE 2026-05-26).** The Stage-2 plan must include a
  "High-stakes Gate Inventory" table for every gate introduced or modified in the slice:
    | Gate | Real-path test | Kill-test (captured mutant) | Production path covered |
  Listing the gate without its kill-test or its real-path test is a Stage-2 deliverable failure.
  Cross-language metric gates additionally require a worked formula anchor pinned identically in
  both languages, distinguishing the right formula from a plausible-wrong one.
  See `.engineering-os/durable-rules/2026-05-26__verify-the-verifier-mutation-on-gate.md`.
```

---

## Diff 4 — `templates/architecture-plan.md`

**Add new section** (between "Acceptance bar" and "Verify-before-report"):

```markdown
## High-stakes Gate Inventory  (per DURABLE RULE 2026-05-26)

| # | Gate | Kind | Real-path test | Kill-test (captured mutant) | Cross-language anchor (if applicable) |
|---|------|------|----------------|------------------------------|----------------------------------------|
|   |      |      |                |                              |                                        |

> Kind = RLS-isolation / PII-fail-closed / numeric-parity / HMAC-auth / fail-closed-predicate.
> Kill-test = path to the test + the mutation it kills (one-liner).
> If the gate has NO entry here, Stage 3 has nothing to build the verifier against — fix the plan first.
```

---

## Diff 5 — `templates/qa-review.md`

**Add new field** (between findings table and the wire-smoke section):

```markdown
## Captured Killed-Mutant Output  (per DURABLE RULE 2026-05-26)

For each high-stakes gate listed in the architecture plan's Gate Inventory:

| Gate | Mutant applied | Test that turned RED | Captured output |
|------|----------------|----------------------|------------------|
|      |                |                      | <pre>$ … </pre>  |

> If any high-stakes gate from the plan has no captured RED output here, QA review FAILS with a
> VETO finding.
```

---

## Diff 6 — `skills/verification-before-completion/SKILL.md` (if present)

**Add a new section** (after the existing "verify before reporting completion" body):

```markdown
## The verify-the-verifier triad (DURABLE RULE 2026-05-26)

A test that calls the production function under test, with the production collaborator,
plus a negative control, plus a captured killed-mutant — this is the only configuration
that proves a gate is non-vacuous. Each of the three is necessary; none is sufficient alone:

1. **Real path** — the test invokes the function the production caller invokes. Not a
   hand-built double that manufactures the gate's trigger condition. Not a replica.
2. **Negative control** — proves the gate does NOT false-positive on known-good input.
3. **Killed mutant** — captured output proving the test goes RED when the gate is mutated
   (removed / inverted / encoding swapped). Mutant reverts byte-identical.

For framework-internal closures (errorFormatter, serializer, middleware), the killed-mutant
must come from a real-HTTP/integration fixture, never a unit double of the closure.
```

---

## Diff 7 — `docs/feature-tiering.md` (high-stakes lane section)

**Add a cross-ref bullet**:

```markdown
- **High-stakes gates are subject to DURABLE RULE 2026-05-26 (verify-the-verifier-mutation-on-gate).**
  Every gate must carry a real-path test + captured killed mutant; Tanvi VETOs missing ones.
  See `.engineering-os/durable-rules/2026-05-26__verify-the-verifier-mutation-on-gate.md`.
```

---

## How to apply

For each diff above, open the named file in the plugin and paste/integrate the block. The rule binds Brain agents the moment all 7 diffs land. Apply them in any order — they're independent.

If a diff doesn't fit cleanly (the section it expects isn't present in the agent file), file the actual diff content under a `Notes` section near the existing DoD/VETO/plan-template guidance and link back to this proposal.
