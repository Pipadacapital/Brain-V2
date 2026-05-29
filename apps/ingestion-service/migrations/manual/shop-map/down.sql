-- =============================================================================
-- IDENTITY MAP — DOWN: DROP connector_identity_map
--
-- Fully reverses step-a-create.sql.
-- Safe to run at any point: the table is additive and empty in prod
-- until Stage-8 seeds the Sugandh-Lok row.
-- No FK references from other tables; drop is unconditional.
-- =============================================================================

DROP TABLE IF EXISTS connector_identity_map;
