"""Store analytics application use-cases (Phase 2, slice 1).

First occupant of the analytics-service application layer. The StoreSummaryQuery
reads canonical facts through the ClickHouse query gateway (workspace-scoped,
fail-closed) and assembles the revenue ladder using registry definitions.
"""
