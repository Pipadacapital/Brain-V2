// ScaffoldPage — placeholder for Phase 2 pages.
// Renders inside the shell layout with a heading + breadcrumb + coming-soon note.

import type { ReactNode } from "react";

interface ScaffoldPageProps {
  title: string;
  description?: string;
  icon?: ReactNode;
}

export function ScaffoldPage({ title, description }: ScaffoldPageProps) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>

      <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
        <p className="text-sm font-medium text-foreground mb-1">
          Coming in Phase 2
        </p>
        <p className="text-xs text-muted-foreground">
          Full data wiring for {title} is scheduled for Phase 2.
          The navigation, shell, and routing are ready — only the data layer
          remains.
        </p>
      </div>
    </div>
  );
}
