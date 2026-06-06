# CD pipeline bring-up

**Status:** authored + INERT. `.github/workflows/cd.yml` exists and is structurally
correct, but it is a no-op until the repo variable `CD_ENABLED=true` is set —
because it needs AWS infra that is not provisioned yet. This doc is the checklist
to make it live. (Addresses the audit P1 "no CD pipeline / rollback aspirational".)

## What the workflow does (once enabled)
1. **preflight** — gates on `CD_ENABLED` + required vars; otherwise skips cleanly.
2. **build-push** — builds the 5 service images (web, api-gateway, ingestion,
   analytics, intelligence) and pushes them to ECR tagged by commit SHA + `latest`,
   authenticating to AWS via **GitHub OIDC** (no long-lived keys). This part is real.
3. **deploy** — gated behind the `production` GitHub Environment (manual approval).
   Currently a **documented placeholder** that fails on purpose, so a deploy is
   never silently reported as done. Wire it to the real target (below).

## Prerequisites to enable (in order)
1. **ECR repositories** — one per service: `brain-web`, `brain-api-gateway`,
   `brain-ingestion-service`, `brain-analytics-service`, `brain-intelligence-service`
   (ap-south-1, scan-on-push, lifecycle policy to expire untagged). Add these to
   `infra/cdk/` (no ECR stack exists today).
2. **GitHub OIDC deploy role** — an IAM role with a trust policy for
   `token.actions.githubusercontent.com` scoped to this repo + the `master` ref,
   granting ECR push + the deploy action (EKS/ECS). Add to `infra/cdk/`.
3. **Deploy target** — `infra/k8s/` is currently `.gitkeep` placeholders. Stand up
   ONE of:
   - **GitOps (intended):** an EKS cluster + ArgoCD watching a k8s manifests repo;
     the deploy step bumps the image tag there and ArgoCD syncs. Auto-rollback:
     ArgoCD reverts to the previous healthy ReplicaSet on a failed health check.
   - **EKS direct:** `kubectl set image` against the cluster (rollback =
     `kubectl rollout undo`).
   - **ECS Fargate:** `aws ecs update-service --force-new-deployment` (rollback =
     re-deploy the prior task-definition revision).
4. **Repo variables** (Settings → Variables): `CD_ENABLED=true`,
   `AWS_DEPLOY_ROLE_ARN`, `ECR_REGISTRY` (e.g. `<acct>.dkr.ecr.ap-south-1.amazonaws.com`),
   optional `AWS_REGION` (default `ap-south-1`).
5. **`production` environment** — add required reviewers (the manual deploy gate)
   and any environment secrets.

## Rollback
- **GitOps/EKS:** `kubectl rollout undo deploy/<svc>` or revert the manifests
  commit → ArgoCD re-syncs the previous image.
- **ECS:** redeploy the previous task-definition revision.
- Image tags are immutable-by-SHA, so any prior commit's images are always
  re-deployable.

## Verification (do this when enabling — it could not be validated at authoring time)
- Confirm `build-push` pushes all 5 images to ECR on a `master` push.
- Confirm the `production` approval gate blocks `deploy` until approved.
- Do a deploy + a deliberate rollback in staging before trusting prod.
