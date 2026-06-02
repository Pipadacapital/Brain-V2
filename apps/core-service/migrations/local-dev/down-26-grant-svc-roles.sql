-- Reverse of 26-grant-svc-roles.sql — revoke svc_core's table grants.
-- P1-18: kept in sync with the up — the 5 dropped OLAP facts + legacy_aggregates.*
-- are gone (file 23) so they are no longer granted, hence no longer revoked here.
REVOKE SELECT, INSERT, UPDATE, DELETE ON
  users, workspaces, workspace_members, invitations,
  connector_connections, connector_credentials, connector_oauth_states,
  connector_order_facts, connector_line_item_facts, connector_product_facts,
  connector_ad_spend_facts, connector_refund_facts,
  customer_pii, audit_log, notifications, ai_insights,
  marketing_actions, workspace_costs, workspace_misc_expenses, workspace_metric_goals,
  workspace_festivals, workspace_cogs_settings, workspace_ad_campaign_classifications,
  connector_definitions
FROM svc_core;
