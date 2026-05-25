// Brain-native sidebar menu constants.
// Adapted from legacy frontend/constants/sidebar-menu.ts.
// Uses lucide-react icons (available in Brain's stack) instead of @tabler/icons-react
// since tabler is now also installed. We use tabler to match the legacy visually.

import {
  LayoutDashboard,
  Store,
  TrendingUp,
  LineChart,
  Clock,
  DollarSign,
  Database,
  PlugZap,
  BarChart3,
  Settings,
  Users,
  Package,
  ShoppingBag,
  RefreshCw,
  Megaphone,
  Activity,
  Navigation,
  Target,
  Calendar,
  Mail,
  FileText,
  Truck,
  BrainCircuit,
} from "lucide-react";

export type SidebarNavItem = {
  title: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
};

export type SidebarNavSection = {
  title?: string;
  items: SidebarNavItem[];
};

export const sidebarNavSections: SidebarNavSection[] = [
  {
    items: [
      { title: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "Data Points",
    items: [
      { title: "Store", path: "/store", icon: Store },
      { title: "Meta Ads", path: "/meta-ads", icon: Megaphone },
      { title: "Google Ads", path: "/google-ads", icon: TrendingUp },
      { title: "Shiprocket", path: "/shiprocket", icon: Truck },
      { title: "Logistics", path: "/logistics", icon: Package },
      { title: "RTO Analytics", path: "/rto-analytics", icon: FileText },
      { title: "COD vs Prepaid", path: "/cod-prepaid", icon: DollarSign },
      { title: "Pincode Intelligence", path: "/pincode-intelligence", icon: Navigation },
      { title: "Store Analytics", path: "/analytics", icon: Store },
    ],
  },
  {
    items: [
      { title: "P&L", path: "/pnl", icon: DollarSign },
      { title: "Waterfall", path: "/waterfall", icon: BarChart3 },
      { title: "Products", path: "/products", icon: ShoppingBag },
      { title: "First product cascade", path: "/first-product-cascade", icon: Navigation },
      { title: "Lifetime Value", path: "/lifetime-value", icon: FileText },
      { title: "Cohorts", path: "/cohorts", icon: LineChart },
      { title: "Customer lifecycle", path: "/customer-lifecycle", icon: Activity },
      { title: "Acquisition", path: "/acquisition", icon: Megaphone },
      { title: "Calendar", path: "/calendar", icon: Calendar },
      { title: "Email & SMS", path: "/email-sms", icon: Mail },
      { title: "Distributions", path: "/distributions", icon: BarChart3 },
      { title: "Timing", path: "/timings", icon: Clock },
      { title: "Inventory", path: "/inventory", icon: Package },
      { title: "Costs", path: "/costs", icon: FileText },
      { title: "Team", path: "/team", icon: Users },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "General", path: "/settings", icon: Settings },
      { title: "Integrations", path: "/settings/integrations", icon: PlugZap },
      { title: "Backfill", path: "/settings/backfill", icon: RefreshCw },
      { title: "Festivals", path: "/settings/festivals", icon: Calendar },
      { title: "Ad campaigns", path: "/settings/ad-campaigns", icon: Megaphone },
      { title: "Goals", path: "/settings/goals", icon: Target },
    ],
  },
];
