"""inventory_levels_query.py — InventoryLevelsQuery use-case (Phase 2, slice 6).

@paradigm: sql (deterministic integer aggregation + the velocity-window cascade; zero LLM/ML)

The per-SKU inventory levels table for ONE workspace, ported Brain-native from legacy
routes/workspaces/inventory.ts + lib/inventory-constants.ts onto the slice-1..5 foundation.

LEGACY GROUND TRUTH (lib/inventory-constants.ts — read at Stage 1, NOT the slice-table shorthand):
  - There is NO turnover ratio. The two real primitives are (Rohan Finding 3):
        days_left   = first non-zero velocity window L30→L90→L180→L360 → round(inv/avgDaily);
                      inv<=0 → 0 ; no velocity → 999999 (INFINITE sentinel)  → inventory_days_left
        sell_through = sales365 / (sales365 + inventory)                     → inventory_sell_through_bp
  - status (classifyInventoryStatus, PRIORITY order):
        inv <= 0           → 'Out of stock'
        days_left < 21     → 'Restock Soon'
        days_left >= 365   → 'Severely Overstocked'
        days_left >= 180   → 'Overstocked'
        else               → 'Healthy'

HONEST-INPUT PATTERN: the connector/fact layer produces per-SKU current inventory + the
L30/L90/L180/L360 sold quantities. This use-case assembles the registry-traceable days-left
+ sell-through + the status classification. integer-only; no float.

TENANCY: query_metrics(workspace_id, ...) only; falsy workspace_id → UnscopedQueryError.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from brain_metrics.registry.definitions import (
    inventory_days_left as _DAYS_LEFT_DEF,
    inventory_sell_through_bp as _SELL_THROUGH_DEF,
    _INVENTORY_INFINITE_DAYS,
)

from ....infrastructure.clickhouse.query_gateway import (
    DateRange,
    UnscopedQueryError,
    query_metrics,
)

# Status thresholds (mirror legacy INVENTORY_THRESHOLDS).
_RESTOCK_SOON_DAYS = 21
_OVERSTOCKED_DAYS = 180
_SEVERELY_OVERSTOCKED_DAYS = 365

INVENTORY_SORT = ("label", "current_inventory", "days_left", "sell_through", "status")
# status sort order (worst → best, matching legacy status_order severity).
_STATUS_ORDER = {
    "Out of stock": 0,
    "Restock Soon": 1,
    "Healthy": 2,
    "Overstocked": 3,
    "Severely Overstocked": 4,
}


@dataclass(frozen=True)
class InventoryFact:
    """One SKU/variant of pre-aggregated inventory facts (counts)."""

    label: str
    sku: str
    current_inventory: int
    qty_l30: int
    qty_l90: int
    qty_l180: int
    qty_l360: int


@dataclass(frozen=True)
class InventoryFacts:
    """Per-workspace inventory aggregates."""

    skus: tuple[InventoryFact, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class InventoryRow:
    label: str
    sku: str
    current_inventory: int
    days_left: int            # 999999 = INFINITE (stock but no velocity)
    sell_through_bp: int | None
    status: str


@dataclass(frozen=True)
class InventoryLevelsResult:
    workspace_id: str
    grain: str
    sort: str
    direction: str
    rows: tuple[InventoryRow, ...]
    total_rows: int


def _classify_status(current_inventory: int, days_left: int) -> str:
    """Inventory status by priority (legacy classifyInventoryStatus)."""
    if current_inventory <= 0:
        return "Out of stock"
    if days_left < _RESTOCK_SOON_DAYS:
        return "Restock Soon"
    if days_left >= _SEVERELY_OVERSTOCKED_DAYS:
        return "Severely Overstocked"
    if days_left >= _OVERSTOCKED_DAYS:
        return "Overstocked"
    return "Healthy"


class InventoryLevelsQuery:
    """Assemble the inventory levels table for one workspace."""

    def execute(
        self,
        workspace_id: str,
        date_range: DateRange,
        facts: InventoryFacts,
        *,
        grain: str = "product",
        sort: str = "days_left",
        direction: str = "asc",
        status_filter: str | None = None,
        _client: object | None = None,
    ) -> InventoryLevelsResult:
        if not workspace_id or not workspace_id.strip():
            raise UnscopedQueryError(
                "InventoryLevelsQuery.execute: workspace_id must not be empty or None. "
                "An un-scoped query is a tenancy violation. CF-C4-QUERY-SCOPE-ISOLATION-1."
            )
        grain = "variant" if grain == "variant" else "product"
        if sort not in INVENTORY_SORT:
            sort = "days_left"
        direction = "desc" if direction == "desc" else "asc"

        # Fail-closed scoped read (observability + tenancy choke).
        query_metrics(workspace_id, "inventory_sell_through_bp", date_range, _client=_client)

        rows: list[InventoryRow] = []
        for s in facts.skus:
            days_left = _DAYS_LEFT_DEF.formula_py(
                s.current_inventory, s.qty_l30, s.qty_l90, s.qty_l180, s.qty_l360
            )
            # sales365 = the L360 sold quantity (legacy uses L360 as soldLast365).
            sell_through = _SELL_THROUGH_DEF.formula_py(s.qty_l360, s.current_inventory)
            status = _classify_status(s.current_inventory, days_left)
            rows.append(
                InventoryRow(
                    label=s.label,
                    sku=s.sku,
                    current_inventory=s.current_inventory,
                    days_left=days_left,
                    sell_through_bp=sell_through,
                    status=status,
                )
            )

        if status_filter:
            rows = [r for r in rows if r.status == status_filter]

        rows = _apply_sort(rows, sort, direction)

        return InventoryLevelsResult(
            workspace_id=workspace_id,
            grain=grain,
            sort=sort,
            direction=direction,
            rows=tuple(rows),
            total_rows=len(rows),
        )


def _apply_sort(rows: list[InventoryRow], sort: str, direction: str) -> list[InventoryRow]:
    reverse = direction == "desc"

    def key(r: InventoryRow):
        if sort == "label":
            return r.label.lower()
        if sort == "status":
            return _STATUS_ORDER.get(r.status, 99)
        mapping = {
            "current_inventory": r.current_inventory,
            "days_left": r.days_left,
            "sell_through": r.sell_through_bp if r.sell_through_bp is not None else -1,
        }
        return mapping.get(sort, r.days_left)

    return sorted(rows, key=key, reverse=reverse)
