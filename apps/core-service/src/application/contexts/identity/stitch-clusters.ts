/**
 * Application use-case — identity cluster stitching (P1-C).
 *
 * @paradigm sql (deterministic graph algorithm + SQL; NO ML, NO LLM)
 *
 * Feature flag: IDENTITY_STITCHER (default OFF).
 *
 * Reads identity_cluster_edges for a workspace, runs the MIN-label union-find,
 * and upserts identity_cluster_registry rows. Older-cluster-wins on merge.
 * Stamps identity_cluster_id onto customer_pii rows.
 *
 * This is the scheduled "SQL MIN-label connected-components" job described in
 * docs/data-warehouse-architecture-proposal.md §4.1 and §G4.
 *
 * Owner: @vikram (core-service TS identity context).
 */

import type { PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import { withSuperadmin } from '../../../infrastructure/db/workspace-context.js'
import {
  buildComponentsFromEdges,
  resolveWinningClusterId,
  type IdentityEdge,
} from '../../../domain/identity/union-find.js'

// ---------------------------------------------------------------------------
// Feature flag guard
// ---------------------------------------------------------------------------

function assertIdentityStitcherEnabled(): void {
  if (process.env.IDENTITY_STITCHER !== 'true') {
    throw new Error(
      '[stitch-clusters] IDENTITY_STITCHER feature flag is OFF. ' +
        'Set IDENTITY_STITCHER=true to enable identity stitching. ' +
        'Flag must be OFF by default (B6 principle).',
    )
  }
}

// ---------------------------------------------------------------------------
// Command types
// ---------------------------------------------------------------------------

export interface StitchClustersCommand {
  workspaceId: string
  /** If true, runs without checking the feature flag (for testing). */
  _bypassFlagForTest?: boolean
}

export interface StitchClustersResult {
  workspaceId: string
  componentsProcessed: number
  clustersCreated: number
  clustersMerged: number
  customerPiiStamped: number
}

// ---------------------------------------------------------------------------
// Read edges from DB
// ---------------------------------------------------------------------------

async function readEdges(tx: PoolClient, workspaceId: string): Promise<IdentityEdge[]> {
  const result = await tx.query<{ node_a: string; node_b: string }>(
    `SELECT node_a, node_b
       FROM identity_cluster_edges
       WHERE workspace_id = $1`,
    [workspaceId],
  )
  return result.rows.map((r) => ({ nodeA: r.node_a, nodeB: r.node_b }))
}

// ---------------------------------------------------------------------------
// Read existing cluster registry entries
// ---------------------------------------------------------------------------

interface ExistingCluster {
  minLabel: string
  clusterId: string
  createdAt: Date
  customerCount: number
}

async function readExistingClusters(
  tx: PoolClient,
  workspaceId: string,
): Promise<Map<string, ExistingCluster>> {
  const result = await tx.query<{
    min_label: string
    cluster_id: string
    created_at: string
    customer_count: number
  }>(
    `SELECT min_label, cluster_id, created_at, customer_count
       FROM identity_cluster_registry
       WHERE workspace_id = $1`,
    [workspaceId],
  )

  const map = new Map<string, ExistingCluster>()
  for (const row of result.rows) {
    map.set(row.min_label, {
      minLabel: row.min_label,
      clusterId: row.cluster_id,
      createdAt: new Date(row.created_at),
      customerCount: row.customer_count,
    })
  }
  return map
}

// ---------------------------------------------------------------------------
// Upsert a cluster registry entry (older-cluster-wins on merge)
// ---------------------------------------------------------------------------

async function upsertClusterEntry(
  tx: PoolClient,
  workspaceId: string,
  minLabel: string,
  clusterId: string,
  customerCount: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO identity_cluster_registry (workspace_id, min_label, cluster_id, customer_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, min_label) DO UPDATE
         SET cluster_id = EXCLUDED.cluster_id,
             customer_count = EXCLUDED.customer_count,
             updated_at = now()`,
    [workspaceId, minLabel, clusterId, customerCount],
  )
}

// ---------------------------------------------------------------------------
// Stamp identity_cluster_id onto customer_pii for all nodes in a component
// ---------------------------------------------------------------------------

async function stampClusterOnPii(
  tx: PoolClient,
  workspaceId: string,
  members: string[],
  clusterId: string,
): Promise<number> {
  if (members.length === 0) return 0

  const result = await tx.query(
    `UPDATE customer_pii
       SET identity_cluster_id = $3, updated_at = now()
       WHERE workspace_id = $1
         AND customer_ref = ANY($2)
         AND (identity_cluster_id IS NULL OR identity_cluster_id != $3)`,
    [workspaceId, members, clusterId],
  )
  return result.rowCount ?? 0
}

// ---------------------------------------------------------------------------
// Main use-case
// ---------------------------------------------------------------------------

/**
 * Stitch identity clusters for a workspace using the MIN-label union-find.
 *
 * 1. Read all identity_cluster_edges for the workspace.
 * 2. Run union-find to get connected components.
 * 3. For each component: resolve cluster_id (older-cluster-wins on merge).
 * 4. Upsert identity_cluster_registry.
 * 5. Stamp identity_cluster_id onto customer_pii.
 *
 * Idempotent: re-running produces the same result (UPSERT keyed on min_label).
 */
export async function stitchClusters(command: StitchClustersCommand): Promise<StitchClustersResult> {
  if (!command._bypassFlagForTest) {
    assertIdentityStitcherEnabled()
  }

  const { workspaceId } = command

  if (!workspaceId) {
    throw new Error('[stitch-clusters] workspaceId is required')
  }

  let componentsProcessed = 0
  let clustersCreated = 0
  let clustersMerged = 0
  let customerPiiStamped = 0

  await withSuperadmin(async (tx: PoolClient) => {
    // 1. Read edges.
    const edges = await readEdges(tx, workspaceId)

    if (edges.length === 0) {
      // No edges = no stitching needed; singletons without edges are stamped elsewhere.
      return
    }

    // 2. Run union-find to get components.
    const components = buildComponentsFromEdges(edges)
    componentsProcessed = components.length

    // 3. Read existing registry to resolve cluster IDs (older-cluster-wins).
    const existingClusters = await readExistingClusters(tx, workspaceId)

    for (const component of components) {
      const { minLabel, members, size } = component

      // Check if any member already has a known cluster.
      // Collect all existing cluster entries for members of this component.
      const memberClusters: ExistingCluster[] = []
      for (const member of members) {
        const existing = existingClusters.get(member)
        if (existing) {
          memberClusters.push(existing)
        }
      }

      let resolvedClusterId: string

      if (memberClusters.length === 0) {
        // Entirely new component — assign a fresh UUID.
        resolvedClusterId = randomUUID()
        clustersCreated++
      } else if (memberClusters.length === 1) {
        // Component already has one cluster — reuse it.
        resolvedClusterId = memberClusters[0]!.clusterId
      } else {
        // Two or more existing clusters merging — older wins.
        clustersMerged++
        // Sort by createdAt to find the oldest.
        memberClusters.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        // Resolve winner among the top pair (the oldest).
        let winner = memberClusters[0]!
        for (let i = 1; i < memberClusters.length; i++) {
          const candidate = memberClusters[i]!
          const winningId = resolveWinningClusterId(
            { clusterId: winner.clusterId, createdAt: winner.createdAt },
            { clusterId: candidate.clusterId, createdAt: candidate.createdAt },
          )
          if (winningId === candidate.clusterId) {
            winner = candidate
          }
        }
        resolvedClusterId = winner.clusterId
      }

      // 4. Upsert the cluster registry entry.
      await upsertClusterEntry(tx, workspaceId, minLabel, resolvedClusterId, size)

      // 5. Stamp customer_pii for all component members.
      const stamped = await stampClusterOnPii(tx, workspaceId, members, resolvedClusterId)
      customerPiiStamped += stamped
    }
  })

  return {
    workspaceId,
    componentsProcessed,
    clustersCreated,
    clustersMerged,
    customerPiiStamped,
  }
}

// ---------------------------------------------------------------------------
// Insert an identity edge (when a new co-occurrence is observed)
// ---------------------------------------------------------------------------

export interface InsertEdgeCommand {
  workspaceId: string
  customerRefA: string
  customerRefB: string
  matchKeyType: 'email_hash' | 'phone_hash' | 'both'
  rawEventId?: string | null
}

/**
 * Insert a new identity edge (co-occurrence of strong identifiers).
 * Normalizes edge direction: nodeA <= nodeB.
 * Idempotent (ON CONFLICT DO NOTHING).
 */
export async function insertIdentityEdge(command: InsertEdgeCommand): Promise<void> {
  if (!command._bypassFlagForTest && process.env.IDENTITY_STITCHER !== 'true') return

  const { workspaceId, customerRefA, customerRefB, matchKeyType, rawEventId } = command

  // Normalize edge direction.
  const [nodeA, nodeB] =
    customerRefA <= customerRefB
      ? [customerRefA, customerRefB]
      : [customerRefB, customerRefA]

  // Self-loops are invalid.
  if (nodeA === nodeB) return

  await withSuperadmin(async (tx: PoolClient) => {
    await tx.query(
      `INSERT INTO identity_cluster_edges
           (workspace_id, node_a, node_b, match_key_type, raw_event_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workspace_id, node_a, node_b) DO NOTHING`,
      [workspaceId, nodeA, nodeB, matchKeyType, rawEventId ?? null],
    )
  })
}

// Extend command type for flag bypass in tests.
declare module './stitch-clusters.js' {
  interface InsertEdgeCommand {
    _bypassFlagForTest?: boolean
  }
}
