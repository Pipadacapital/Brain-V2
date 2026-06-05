/**
 * Domain layer — MIN-label union-find (connected components) for identity stitching.
 *
 * @paradigm sql (deterministic graph algorithm; NO ML, NO LLM, NO network)
 *
 * P1-C / R10: deterministic cross-vendor identity with a stable surrogate
 * `identity_cluster_id` (UUID). This is the brain-native RudderStack ID-Stitcher
 * pattern — pure in-memory union-find over a workspace's edges, then written to
 * identity_cluster_registry by the infrastructure layer.
 *
 * Key invariants:
 *   - MIN-label: each component's representative is the lexicographically smallest
 *     customer_ref node. This is an internal detail; `cluster_id` (stable UUID) is
 *     what downstream consumers see.
 *   - Older-cluster-wins on merge: when two clusters merge, the cluster with the
 *     older `created_at` (or, if tied, the one with the smaller cluster_id) keeps
 *     its UUID. The absorbed cluster's facts are re-stamped to the survivor's UUID.
 *   - k≥5 guard: any cluster with fewer than 5 distinct customer_refs is suppressed
 *     from export (identity graph export, not internal silver fact stamping).
 *
 * No I/O here — pure in-memory algorithms. Infrastructure adapters call these.
 */

// ---------------------------------------------------------------------------
// Union-Find data structure (path-compressed, union-by-rank)
// ---------------------------------------------------------------------------

/**
 * A compact union-find / disjoint-set for string node IDs.
 * Uses path compression + union by rank for near-O(α) operations.
 */
export class UnionFind {
  private readonly parent = new Map<string, string>()
  private readonly rank = new Map<string, number>()

  /** Ensure a node is registered. No-op if already present. */
  add(node: string): void {
    if (!this.parent.has(node)) {
      this.parent.set(node, node)
      this.rank.set(node, 0)
    }
  }

  /** Find the representative (root) of a node's component with path compression. */
  find(node: string): string {
    if (!this.parent.has(node)) {
      this.add(node)
    }
    let root = node
    // Traverse to root.
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!
    }
    // Path compression.
    let current = node
    while (current !== root) {
      const next = this.parent.get(current)!
      this.parent.set(current, root)
      current = next
    }
    return root
  }

  /** Union two nodes' components. Returns the new root. */
  union(a: string, b: string): string {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return ra

    // Union by rank.
    const rankA = this.rank.get(ra) ?? 0
    const rankB = this.rank.get(rb) ?? 0

    if (rankA < rankB) {
      this.parent.set(ra, rb)
      return rb
    } else if (rankA > rankB) {
      this.parent.set(rb, ra)
      return ra
    } else {
      // Equal rank: use lexicographically smaller as root (MIN-label convention).
      if (ra <= rb) {
        this.parent.set(rb, ra)
        this.rank.set(ra, rankA + 1)
        return ra
      } else {
        this.parent.set(ra, rb)
        this.rank.set(rb, rankB + 1)
        return rb
      }
    }
  }

  /** Returns true if a and b are in the same component. */
  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b)
  }

  /** Get all nodes registered in this union-find. */
  nodes(): string[] {
    return Array.from(this.parent.keys())
  }
}

// ---------------------------------------------------------------------------
// Component snapshot — what the union-find emits per component
// ---------------------------------------------------------------------------

export interface Component {
  /** The lexicographically smallest node in the component. Internal only. */
  minLabel: string
  /** All customer_ref nodes in this component. */
  members: string[]
  /** Number of distinct members. Used for the k≥5 guard. */
  size: number
}

/**
 * Build all connected components from a union-find over a set of nodes.
 * Returns one Component per distinct root.
 */
export function buildComponents(uf: UnionFind): Component[] {
  const groups = new Map<string, string[]>()

  for (const node of uf.nodes()) {
    const root = uf.find(node)
    const group = groups.get(root)
    if (group) {
      group.push(node)
    } else {
      groups.set(root, [node])
    }
  }

  const components: Component[] = []
  for (const [_root, members] of groups) {
    members.sort() // sort lexicographically so minLabel is always members[0]
    components.push({
      minLabel: members[0]!, // smallest lexicographically = MIN-label
      members,
      size: members.length,
    })
  }

  // Validate: the minLabel must equal the root from the UF (for correctness).
  // In our UF, the root after union-by-rank may not be the lexicographic minimum,
  // but minLabel is always recomputed from sorted members.
  return components
}

// ---------------------------------------------------------------------------
// Edge input type
// ---------------------------------------------------------------------------

export interface IdentityEdge {
  nodeA: string // customer_ref of first co-occurrence (normalized: nodeA <= nodeB)
  nodeB: string // customer_ref of second co-occurrence
}

/**
 * Build connected components from a list of edges.
 * Adds isolated nodes implicitly for any node that appears in an edge.
 */
export function buildComponentsFromEdges(edges: IdentityEdge[]): Component[] {
  const uf = new UnionFind()

  for (const { nodeA, nodeB } of edges) {
    uf.add(nodeA)
    uf.add(nodeB)
    uf.union(nodeA, nodeB)
  }

  return buildComponents(uf)
}

// ---------------------------------------------------------------------------
// Cluster registry entry — the output record written to identity_cluster_registry
// ---------------------------------------------------------------------------

export interface ClusterRegistryEntry {
  /** Workspace scope. */
  workspaceId: string
  /** Internal MIN-label — never exposed downstream. */
  minLabel: string
  /** Stable opaque UUID. Older cluster wins on merge. */
  clusterId: string
  /** Number of distinct customer_refs in this cluster. */
  customerCount: number
}

// ---------------------------------------------------------------------------
// Older-cluster-wins merge resolution
// ---------------------------------------------------------------------------

/**
 * Resolve which cluster_id survives a merge of two clusters.
 * "Older" = smaller createdAt timestamp. Tie-break: smaller cluster_id (UUID string).
 *
 * The absorbed cluster's facts must be re-stamped to the survivor's cluster_id
 * by the infrastructure layer (not here — this is pure domain logic).
 */
export function resolveWinningClusterId(
  clusterA: { clusterId: string; createdAt: Date },
  clusterB: { clusterId: string; createdAt: Date },
): string {
  if (clusterA.createdAt < clusterB.createdAt) return clusterA.clusterId
  if (clusterB.createdAt < clusterA.createdAt) return clusterB.clusterId
  // Same timestamp: lexicographically smaller cluster_id wins.
  return clusterA.clusterId <= clusterB.clusterId ? clusterA.clusterId : clusterB.clusterId
}

// ---------------------------------------------------------------------------
// k≥5 export guard
// ---------------------------------------------------------------------------

/**
 * Returns true if the cluster is eligible for export.
 * Clusters with fewer than 5 distinct customer_refs are suppressed to prevent
 * cross-vendor identity inference on small workspaces (DPDP k-anonymity gate).
 *
 * This guard applies to EXPORT (identity graph export, MCP tools, API responses).
 * Silver fact stamping (identity_cluster_id on the fact row) is NOT suppressed —
 * internal analytics still join on the cluster for all sizes.
 */
export const IDENTITY_EXPORT_K_MIN = 5

export function isClusterExportEligible(cluster: { size: number } | { customerCount: number }): boolean {
  const size = 'size' in cluster ? cluster.size : cluster.customerCount
  return size >= IDENTITY_EXPORT_K_MIN
}

/**
 * Filter a list of cluster registry entries to only export-eligible ones.
 * Entries with customerCount < 5 are excluded.
 */
export function filterExportEligibleClusters(
  clusters: ClusterRegistryEntry[],
): ClusterRegistryEntry[] {
  return clusters.filter((c) => isClusterExportEligible(c))
}
