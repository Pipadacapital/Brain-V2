// @paradigm: sql
// Resolve the authenticated user's active workspace slug via the gateway.
// Shared by the bare-path resolver routes (/dashboard, /settings/integrations)
// that redirect to the workspace-scoped /w/{slug}/... URL. CF-C6-PII-CLIENT-1:
// never log email or token.

/** Fetch the user's active workspace slug from the gateway using the session token. */
export async function fetchActiveWorkspaceSlug(accessToken: string): Promise<string | null> {
  try {
    const gatewayUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    // auth.session returns workspaceId + role; workspace.list gives us the slug.
    const url = `${gatewayUrl}/trpc/workspace.list?batch=1&input=${encodeURIComponent('{"0":{}}')}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Array<{
      result?: { data?: { json?: { workspaces?: Array<{ slug?: string; isDefault?: boolean }> } } };
    }>;
    const workspaces = body?.[0]?.result?.data?.json?.workspaces;
    if (!Array.isArray(workspaces) || workspaces.length === 0) return null;
    // First workspace = the default/active one as ordered by the gateway.
    return workspaces[0]?.slug ?? null;
  } catch {
    return null;
  }
}
