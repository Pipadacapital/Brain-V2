# infra/k8s — Helm / ArgoCD manifests (Phase 2+)

Per the Brain architecture spec, Kubernetes manifests live here for the Phase-2 split onto
EKS + Karpenter + ArgoCD. **Phase 0–1 deploys on Fargate via `infra/cdk/`** (3 backend
deployables + web + mobile), so this directory is a placeholder until the service split
(see `docs/architecture-compliance.md`).

Planned layout:

```
infra/k8s/
├── charts/      # one Helm chart per service (7 services)
├── argocd/      # ApplicationSet + per-env app manifests
└── base/        # shared kustomize base (probes, HPA, PDB, NetworkPolicy)
```

Invariants every chart must encode: `/healthz` + `/readyz` probes, workspace_id NetworkPolicy
isolation, Karpenter provisioner labels, single-writer-per-store (no service mounts another's DB secret).
