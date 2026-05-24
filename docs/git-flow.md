# Brain — Git Flow

> The branching + promotion model for the Brain product repo. Adopted by the Founder (2026-05-24).
> Every change rides the same path: **feature → development → release (staging) → master (production)**.

## Long-lived branches

| Branch | Role | Deploys to |
|--------|------|-----------|
| `master` | Production. Always releasable. Protected — changes only via PR from `release`. | **Production** (on merge) |
| `release` | Release candidate / staging. Integration of what's being shipped next. | **Staging** (on merge/push) |
| `development` | Mainline integration. Where completed feature work lands first. | — (CI checks only) |
| `feature/<name>` | Short-lived work branches, one per unit of work. Branched from `development`. | — (CI checks only) |

## The flow

```
feature/<req-id>  ──PR──▶  development  ──merge──▶  release  ──PR──▶  master
   (build here)            (integrate)          (deploy→staging)   (deploy→production)
```

1. **Branch.** Cut `feature/<name>` **from `development`**:
   `git switch development && git pull && git switch -c feature/<name>`
2. **Build + review.** Do the work on the feature branch. The Engineering OS pipeline (Stages 1–6) runs here. The Founder reviews/commits product code per the no-commit rule.
3. **Merge to `development`.** Open a PR `feature/<name> → development`; merge once green. Delete the feature branch.
4. **Promote to `release`.** Merge `development → release`. This deploys to the **staging** environment for end-to-end testing.
5. **Test on staging.** Validate on the staging env built from `release`.
6. **Promote to `master`.** Once staging is signed off, open a **PR `release → master`**. On merge, the change deploys to **production**.

## Conventions

- **Feature branch naming:** `feature/<req-id>` where `<req-id>` is the Engineering OS requirement id (e.g. `feature/chore-scaffold-monorepo`). For non-requirement work: `feature/<short-kebab-slug>`.
- **Commit discipline (unchanged):** agents stage product code with explicit paths; the **Founder commits product code**. Agents may commit `.engineering-os/` as `chore(eos):`. Never `git add -A`.
- **Direction is one-way:** work flows feature → development → release → master. Hotfixes (if ever needed) branch from `master`, then back-merge to `release` + `development`.
- **PRs gate the two protected hops:** `feature → development` and `release → master` go through pull requests. `development → release` is a promotion merge.

## Deployment triggers — INTENDED (not yet wired)

The branch→environment mapping above is the **intended CI/CD contract**. The actual automation
(release push → staging deploy; master merge → production deploy) is **future Platform/DevOps work
(Jatin)** — no CI/CD pipeline exists in the repo yet (it was a non-goal of the initial scaffold).
When Jatin wires GitHub Actions → ECR → ArgoCD (+ EAS for mobile), the deploy hooks MUST follow
this contract: `release` ⇒ staging, `master` ⇒ production, with canary + 48h monitor + auto-rollback
on the production hop.
