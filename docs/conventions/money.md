# Convention: Money Representation

**Rule:** Money is always integer minor units (paise for INR). Never float, never NUMERIC.

## Postgres
- Column type: `BIGINT`
- Companion column: `currency_code CHAR(3)` (ISO 4217 — `INR`, `USD`, etc.)
- Example: `amount_paise BIGINT NOT NULL, currency_code CHAR(3) NOT NULL DEFAULT 'INR'`

## ClickHouse
- Column type: `Int64` (never Float64 or Decimal)
- Same `currency_code` companion column.

## gRPC / Protobuf
- Use `int64 amount = 1;` + `string currency_code = 2;`
- Never `float`, `double`, or `google.type.Money` (which uses nanos — more complex than needed).

## Application layer (TypeScript)
- Use `bigint` or a validated integer type; never `number` for money.
- Display layer converts to display units (paise ÷ 100 = rupees) at render time only.

## Application layer (Python)
- Use `int`; never `float` or `Decimal` in transit.
- Conversion to display units at the presentation layer only.

## Rationale
Floating-point arithmetic is non-associative and produces rounding errors that
compound across GMV aggregations. BIGINT arithmetic is exact. Billing/metering
(in `core-service`) meters on realized/delivered GMV in integer paise — never
placed GMV, never float.

## Code home
- The billing/metering implementation: `apps/core-service/src/domain/billing/`
- RTO/COD/GST math: `apps/analytics-service/src/domain/` + `pylibs/brain_regional/`
