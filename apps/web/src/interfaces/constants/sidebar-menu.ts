// Brain-native sidebar menu constants.
// Ported from legacy frontend/constants/sidebar-menu.ts.
// Uses @tabler/icons-react to match legacy visual glyphs.

import {
  IconChartBar,
  IconChartLine,
  IconClock,
  IconCurrencyDollar,
  IconDashboard,
  IconPlugConnected,
  IconReport,
  IconSettings,
  IconUsers,
  IconBuildingStore,
  IconBrandGoogle,
  IconBrandMeta,
  IconReceipt,
  IconTruck,
  IconPackage,
  IconShoppingBag,
  IconRefresh,
  IconSpeakerphone,
  IconActivity,
  IconRoute,
  IconTarget,
  IconCalendar,
  IconMail,
} from "@tabler/icons-react";

import type { FeatureKey, WorkspaceRole } from "@/lib/features.js";

export type SidebarNavItem = {
  title: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  featureKey?: FeatureKey;
  minRole?: WorkspaceRole;
};

export type SidebarNavSection = {
  title?: string;
  items: SidebarNavItem[];
};

/** Main nav as sections: Dashboard, Data Points (group), main pages, Settings (group). */
export const sidebarNavSections: SidebarNavSection[] = [
  {
    items: [
      { title: "Dashboard", path: "/dashboard", icon: IconDashboard },
    ],
  },
  {
    title: "Data Points",
    items: [
      { title: "Store", path: "/store", icon: IconBuildingStore },
      { title: "Meta Ads", path: "/meta-ads", icon: IconBrandMeta, featureKey: "meta_ads" },
      { title: "Google Ads", path: "/google-ads", icon: IconBrandGoogle, featureKey: "google_ads" },
      { title: "Shiprocket", path: "/shiprocket", icon: IconTruck, featureKey: "shiprocket" },
      { title: "Logistics", path: "/logistics", icon: IconPackage, featureKey: "logistics" },
      { title: "RTO Analytics", path: "/rto-analytics", icon: IconReport, featureKey: "rto_analytics" },
      { title: "COD vs Prepaid", path: "/cod-prepaid", icon: IconCurrencyDollar, featureKey: "cod_prepaid" },
      { title: "Pincode Intelligence", path: "/pincode-intelligence", icon: IconRoute, featureKey: "pincode_intelligence" },
      { title: "Store Analytics", path: "/analytics", icon: IconBuildingStore, featureKey: "store_analytics" },
    ],
  },
  {
    items: [
      { title: "P&L", path: "/pnl", icon: IconCurrencyDollar, featureKey: "pnl" },
      { title: "Waterfall", path: "/waterfall", icon: IconChartBar, featureKey: "waterfall" },
      { title: "Products", path: "/products", icon: IconShoppingBag, featureKey: "products" },
      { title: "First product cascade", path: "/first-product-cascade", icon: IconRoute, featureKey: "first_product_cascade" },
      { title: "Lifetime Value", path: "/lifetime-value", icon: IconReport, featureKey: "lifetime_value" },
      { title: "Cohorts", path: "/cohorts", icon: IconChartLine, featureKey: "cohorts" },
      { title: "Customer lifecycle", path: "/customer-lifecycle", icon: IconActivity, featureKey: "customer_lifecycle" },
      { title: "Acquisition", path: "/acquisition", icon: IconSpeakerphone, featureKey: "acquisition" },
      { title: "Calendar", path: "/calendar", icon: IconCalendar, featureKey: "calendar" },
      { title: "Email & SMS", path: "/email-sms", icon: IconMail, featureKey: "email_sms" },
      { title: "Distributions", path: "/distributions", icon: IconChartBar, featureKey: "distributions" },
      { title: "Timing", path: "/timings", icon: IconClock, featureKey: "timings" },
      { title: "Inventory", path: "/inventory", icon: IconPackage, featureKey: "inventory" },
      // Costs: new app route is /costs; legacy was settings/costs.
      // Keeping new path to match the actual route — path consolidation is Wave 3+ work.
      { title: "Costs", path: "/costs", icon: IconReceipt, minRole: "ANALYST" },
      { title: "Team", path: "/team", icon: IconUsers, minRole: "ANALYST" },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "General", path: "/settings", icon: IconSettings, minRole: "ANALYST" },
      { title: "Integrations", path: "/settings/integrations", icon: IconPlugConnected, minRole: "MANAGER" },
      // Backfill: new app uses /settings/backfill; legacy used settings/ads-backfill.
      // Keeping new path to match the actual route — deep-link alignment is a Wave 3+ task.
      { title: "Backfill", path: "/settings/backfill", icon: IconRefresh, minRole: "MANAGER" },
      { title: "Festivals", path: "/settings/festivals", icon: IconCalendar, featureKey: "festivals", minRole: "ANALYST" },
      { title: "Ad campaigns", path: "/settings/ad-campaigns", icon: IconBrandMeta, featureKey: "ad_campaigns", minRole: "ANALYST" },
      { title: "Goals", path: "/settings/goals", icon: IconTarget, featureKey: "goals", minRole: "ANALYST" },
    ],
  },
];

/** Flat list for consumers that need navMain (e.g. active-state lookup). */
export const sidebarMenuData = {
  navMain: sidebarNavSections.flatMap((s) => s.items),
};
