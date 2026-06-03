'use client';

// workspace-slug-context.tsx
// Carries the workspaceSlug captured from the URL params (app/w/[workspaceSlug]/...)
// down to any client component that needs it.
//
// The URL is the single source of truth for the ACTIVE workspace slug; Redux
// session still carries the resolved workspaceId for tRPC calls.
//
// Usage (client component):
//   const slug = useWorkspaceSlug();
//   const href = useScopedPath('/dashboard');   // → /w/sugandh-lok/dashboard
//
// Usage (outside React — e.g. inline string building):
//   import { scopedPath } from '@/infrastructure/workspace-slug-context';
//   scopedPath(slug, '/dashboard');             // → /w/sugandh-lok/dashboard
//
// Graceful-degradation contract: when slug is empty (context not yet hydrated,
// or called outside the workspace shell) all helpers return the flat path rather
// than crashing. This keeps global/admin pages safe.

import { createContext, useContext } from 'react';

const WorkspaceSlugContext = createContext<string>('');

export function WorkspaceSlugProvider({
  slug,
  children,
}: {
  slug: string;
  children: React.ReactNode;
}) {
  return (
    <WorkspaceSlugContext.Provider value={slug}>
      {children}
    </WorkspaceSlugContext.Provider>
  );
}

/** React hook — reads the slug from context. Returns '' when outside the shell. */
export function useWorkspaceSlug(): string {
  return useContext(WorkspaceSlugContext);
}

/**
 * Pure function — converts a flat shell path to a workspace-scoped URL.
 * Safe to call from anywhere; degrades to the flat path when slug is absent.
 *
 * scopedPath('sugandh-lok', '/dashboard')  →  '/w/sugandh-lok/dashboard'
 * scopedPath('',            '/dashboard')  →  '/dashboard'        (graceful)
 */
export function scopedPath(slug: string, path: string): string {
  if (!slug) return path;
  return `/w/${slug}${path}`;
}

/**
 * React hook — returns a helper that builds workspace-scoped paths.
 * Equivalent to (path) => scopedPath(useWorkspaceSlug(), path).
 *
 * const toPath = useScopedPath();
 * toPath('/dashboard')  →  '/w/sugandh-lok/dashboard'
 */
export function useScopedPath(): (path: string) => string {
  const slug = useWorkspaceSlug();
  return (path: string) => scopedPath(slug, path);
}
