-- LOCAL seed for the real-time webhook demo (NOT prod data).
-- Maps the demo Shopify shop domain → the local Sugandhlok workspace so a verified
-- `orders/*` webhook resolves to a real workspace. The demo webhook sends this same
-- x-shopify-shop-domain. Prod seeding is the Stage-8 ceremony (per-real-shop), never this.
--
-- Idempotent: re-running is a no-op (ON CONFLICT on the composite PK).
INSERT INTO connector_identity_map (vendor, external_identity, workspace_id)
VALUES ('shopify', 'sugandhlok.myshopify.com', 'f165da80-e6d5-4c58-9aff-ec654b873bd7')
ON CONFLICT (vendor, external_identity) DO UPDATE SET workspace_id = EXCLUDED.workspace_id;
