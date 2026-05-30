'use client';

// @paradigm: sql
// OnboardingForm — multi-step workspace setup (Wave 2 parity, Slice C+).
//
// Steps (matching legacy exactly):
//   1. Profile  — fullName + email (disabled) + role card selector (required)
//   2. Brand    — brandName + slug + industry pills + monthly-revenue range buttons
//   3. Platform — Shopify / WooCommerce branded logo cards (required)
//   4. Connect  — Shopify handle+suffix OR WooCommerce storeUrl/consumerKey/consumerSecret
//
// isNewWorkspace mode: skips Step 1 (profile), heading changes to "Create a new workspace".
// On submit calls tRPC onboarding.complete; on success navigates to /w/{slug}/dashboard.
//
// CF-C6-PII-CLIENT-1: never log email or token.
// CF-S10-HONEST-STATE-1: Woo connect validates credentials on backend; Shopify defers
//   OAuth to Integrations but the UI step/fields are fully restored.

import { useState, useId } from 'react';
import { trpc } from '@/infrastructure/trpc-client.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/interfaces/components/ui/button.js';
import { Input } from '@/interfaces/components/ui/input.js';
import { Label } from '@/interfaces/components/ui/label.js';
import {
  IconUser,
  IconBuildingStore,
  IconPlugConnected,
  IconArrowRight,
  IconArrowLeft,
  IconCheck,
  IconShoppingCart,
} from '@tabler/icons-react';

// ---------------------------------------------------------------------------
// Constants (matching legacy exactly)
// ---------------------------------------------------------------------------

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const STEPS = [
  { id: 'profile', label: 'Your profile', icon: IconUser },
  { id: 'brand', label: 'Your brand', icon: IconBuildingStore },
  { id: 'platform', label: 'Platform', icon: IconShoppingCart },
  { id: 'connect', label: 'Connect store', icon: IconPlugConnected },
] as const;

type StepId = (typeof STEPS)[number]['id'];

const ROLES = [
  { value: 'founder', label: 'Founder / CEO', description: 'I run the business' },
  { value: 'marketing', label: 'Marketing', description: 'I manage growth & ads' },
  { value: 'analyst', label: 'Data / Analytics', description: 'I analyze performance' },
  { value: 'developer', label: 'Developer', description: 'I build & integrate' },
  { value: 'agency', label: 'Agency', description: 'I manage client brands' },
  { value: 'other', label: 'Other', description: 'Something else' },
];

const INDUSTRIES = [
  'Fashion & Apparel',
  'Beauty & Cosmetics',
  'Health & Wellness',
  'Food & Beverage',
  'Home & Garden',
  'Electronics',
  'Sports & Outdoors',
  'Toys & Games',
  'Pet Supplies',
  'Other',
];

// Legacy uses USD ranges; Brain is India-first so labels are aligned to INR lakh/crore
// while keeping the same curated-button UX (per parity audit note on P1 feature).
const REVENUE_RANGES = [
  { value: 'pre-revenue', label: 'Pre-revenue' },
  { value: '0-10l', label: '₹0 – ₹10L/mo' },
  { value: '10l-50l', label: '₹10L – ₹50L/mo' },
  { value: '50l-2cr', label: '₹50L – ₹2Cr/mo' },
  { value: '2cr-10cr', label: '₹2Cr – ₹10Cr/mo' },
  { value: '10cr+', label: '₹10Cr+/mo' },
];

// ---------------------------------------------------------------------------
// Platform SVG logos (inline — zero extra deps)
// ---------------------------------------------------------------------------

function ShopifyLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 256 292" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M223.773 55.382c-.221-1.591-1.591-2.519-2.740-2.630-.037-.003-8.063-.154-8.063-.154s-6.364-6.250-7.024-6.910c-.660-.659-1.981-.459-2.491-.300-.030.009-1.383.428-3.691 1.142-2.196-6.321-6.067-12.138-12.855-12.138-.188 0-.38.007-.572.017-1.879-2.487-4.204-3.578-6.209-3.578-15.388 0-22.724 19.229-25.026 29.011-5.973 1.851-10.218 3.163-10.773 3.335-3.339 1.048-3.441 1.149-3.875 4.299-.326 2.371-9.021 69.576-9.021 69.576l67.419 11.670 36.609-7.901c-.001 0-12.404-95.388-12.688-97.439z" fill="#95BF47"/>
      <path d="M200.995 46.153c-.188 0-.377.007-.566.017-1.567-2.075-3.476-3.312-5.412-3.578 0 0-15.388 0-15.388 19.229-4.975 1.540-8.505 2.634-8.505 2.634l33.987 5.878c-.001 0-3.438-24.180-4.116-24.180z" fill="#5E8E3E"/>
      <path d="M128.046 177.031l-16.959 5.053s-2.511-13.268-5.622-29.607c6.617-.994 12.621-1.960 18.028-2.861 2.234 11.758 4.553 27.415 4.553 27.415z" fill="#FFFFFF"/>
    </svg>
  );
}

function WooCommerceLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 256 154" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M23.759 0h208.482C244.886 0 256 11.114 256 24.759v104.482C256 142.886 244.886 154 231.241 154H23.759C10.114 154 0 142.886 0 129.241V24.759C0 11.114 11.114 0 23.759 0z" fill="#7F54B3"/>
      <path d="M14.578 23.759c1.743-2.323 4.356-3.776 7.546-4.065 6.124-.58 9.61 2.614 10.455 9.61l8.994 60.038 19.795-37.811c1.744-3.195 3.922-4.937 6.7-5.082 3.922-.29 6.535 2.034 7.67 6.99 2.903 14.52 6.825 26.934 11.472 37.521l11.762-113.98c.58-4.647 2.903-6.99 6.99-6.99 2.034 0 4.067.869 5.52 2.323 1.453 1.453 2.323 3.486 2.033 5.52l-16.01 148.51c-.58 5.227-3.195 7.96-7.67 8.25-4.647.29-7.67-2.034-9.414-7.26l-14.52-38.099-13.651 26.353c-2.034 3.776-4.357 5.81-7.26 5.81-4.067 0-6.535-2.323-7.67-7.26L20.099 44.423c-.29-2.034 0-4.067.58-6.1l-6.101-14.564z" fill="#FFFFFF"/>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OnboardingFormProps {
  defaultFullName?: string;
  email?: string;
  isNewWorkspace?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OnboardingForm({
  defaultFullName = '',
  email = '',
  isNewWorkspace = false,
}: OnboardingFormProps) {
  // In "add another workspace" mode the profile step is skipped.
  const stepsToShow = isNewWorkspace ? STEPS.slice(1) : STEPS;

  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  // Profile
  const [fullName, setFullName] = useState(defaultFullName);
  const [role, setRole] = useState('');
  // Brand
  const [brandName, setBrandName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [industry, setIndustry] = useState('');
  const [monthlyRevenue, setMonthlyRevenue] = useState('');
  // Platform
  const [platform, setPlatform] = useState<'SHOPIFY' | 'WOOCOMMERCE' | ''>('');
  // Connect — Shopify
  const [storeHandle, setStoreHandle] = useState('');
  // Connect — WooCommerce
  const [wcStoreUrl, setWcStoreUrl] = useState('');
  const [wcConsumerKey, setWcConsumerKey] = useState('');
  const [wcConsumerSecret, setWcConsumerSecret] = useState('');

  // The effective slug tracks brand name until the user manually edits it.
  // Uses the same toSlug algorithm as legacy for identical default values.
  const effectiveSlug = slugTouched ? slug : toSlug(brandName);

  // contentStep maps the current stepsToShow index back to the canonical step id.
  const currentStepId: StepId = stepsToShow[stepIndex]?.id ?? 'profile';

  // Resolve the real STEPS index (used to match against contentStep checks).
  const canonicalStepIndex = STEPS.findIndex((s) => s.id === currentStepId);

  const canProceed = (): boolean => {
    if (isNewWorkspace) {
      // No profile step — brand is first.
      if (stepIndex === 0) return brandName.trim().length > 0 && effectiveSlug.trim().length > 0;
      if (stepIndex === 1) return platform !== '';
      return true; // connect step: can always skip
    }
    if (stepIndex === 0) return fullName.trim().length > 0 && role.length > 0;
    if (stepIndex === 1) return brandName.trim().length > 0 && effectiveSlug.trim().length > 0;
    if (stepIndex === 2) return platform !== '';
    return true; // connect step
  };

  const handleNext = () => {
    if (!canProceed()) return; // button is disabled, but defensive guard
    if (stepIndex < stepsToShow.length - 1) {
      setStepIndex(stepIndex + 1);
      setError(null);
    }
  };

  const handleBack = () => {
    if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
      setError(null);
    }
  };

  const completeMutation = trpc.onboarding.complete.useMutation({
    onSuccess: (data) => {
      // Hard navigation so middleware re-evaluates the new membership.
      window.location.assign(data.redirectTo || '/dashboard');
    },
    onError: (err) => {
      setError(err.message.replace(/\s*request_id=.*/, '') || 'Could not complete setup. Try again.');
    },
  });

  const hasWcCredentials =
    wcStoreUrl.trim().length > 0 &&
    wcConsumerKey.trim().length > 0 &&
    wcConsumerSecret.trim().length > 0;

  const submitOnboarding = () => {
    setError(null);
    completeMutation.mutate({
      fullName: fullName.trim(),
      jobRole: role,
      brandName: brandName.trim(),
      slug: effectiveSlug.trim().toLowerCase(),
      industry,
      monthlyRevenue,
      platform: platform as 'SHOPIFY' | 'WOOCOMMERCE',
      storeHandle:
        platform === 'SHOPIFY'
          ? storeHandle.trim() || null
          : wcStoreUrl.trim() || null,
    });
  };

  const isPending = completeMutation.isPending;
  const isLastStep = stepIndex === stepsToShow.length - 1;

  return (
    <div className="w-full" data-testid="onboarding-form">
      {/* Step rail — icon+label with connector lines; completed steps clickable */}
      <div className="mb-8 flex items-center justify-center gap-2" role="list" aria-label="Onboarding steps">
        {stepsToShow.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === stepIndex;
          const isCompleted = i < stepIndex;
          return (
            <div key={s.id} className="flex items-center gap-2" role="listitem">
              {i > 0 && (
                <div
                  aria-hidden="true"
                  className={cn(
                    'h-px w-8 transition-colors',
                    isCompleted ? 'bg-primary' : 'bg-border',
                  )}
                />
              )}
              <button
                type="button"
                aria-current={isActive ? 'step' : undefined}
                aria-label={`${s.label}${isCompleted ? ' (completed)' : ''}`}
                onClick={() => isCompleted && setStepIndex(i)}
                disabled={!isCompleted}
                className={cn(
                  'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive && 'bg-primary text-primary-foreground',
                  isCompleted && 'cursor-pointer bg-primary/10 text-primary',
                  !isActive && !isCompleted && 'bg-muted text-muted-foreground',
                )}
              >
                {isCompleted ? (
                  <IconCheck className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Icon className="h-4 w-4" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Step content card */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">

        {/* ------------------------------------------------------------------ */}
        {/* Step 1 — Profile                                                    */}
        {/* ------------------------------------------------------------------ */}
        {canonicalStepIndex === 0 && (
          <div className="space-y-6" data-testid="step-profile">
            <div>
              <h2 className="text-lg font-semibold">Tell us about yourself</h2>
              <p className="text-sm text-muted-foreground">
                This helps us personalize your experience.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="onb-fullname">Full name <span className="text-destructive" aria-hidden="true">*</span></Label>
              <Input
                id="onb-fullname"
                data-testid="input-fullname"
                placeholder="Jane Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoFocus
                autoComplete="name"
                aria-required="true"
                aria-describedby={error ? errorId : undefined}
              />
            </div>

            {email && (
              <div className="grid gap-2">
                <Label htmlFor="onb-email">Email</Label>
                <Input
                  id="onb-email"
                  value={email}
                  disabled
                  className="text-muted-foreground"
                  aria-label="Email address (read-only)"
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label>What&apos;s your role? <span className="text-destructive" aria-hidden="true">*</span></Label>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Select your role">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    role="radio"
                    aria-checked={role === r.value}
                    data-testid={`role-${r.value}`}
                    onClick={() => setRole(r.value)}
                    className={cn(
                      'flex flex-col items-start rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                      role === r.value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border',
                    )}
                  >
                    <span className="text-sm font-medium">{r.label}</span>
                    <span className="text-xs text-muted-foreground">{r.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Step 2 — Brand                                                      */}
        {/* ------------------------------------------------------------------ */}
        {canonicalStepIndex === 1 && (
          <div className="space-y-6" data-testid="step-brand">
            <div>
              <h2 className="text-lg font-semibold">Set up your brand</h2>
              <p className="text-sm text-muted-foreground">
                We&apos;ll create a workspace for your brand&apos;s analytics.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="onb-brandname">
                Brand name <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <Input
                id="onb-brandname"
                data-testid="input-brandname"
                placeholder="Acme Inc."
                value={brandName}
                onChange={(e) => {
                  setBrandName(e.target.value);
                  if (!slugTouched) setSlug(toSlug(e.target.value));
                }}
                autoFocus
                aria-required="true"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="onb-slug">
                Workspace URL <span className="text-destructive" aria-hidden="true">*</span>
              </Label>
              <div className="flex items-center">
                <span className="flex h-9 items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground select-none">
                  app/
                </span>
                <Input
                  id="onb-slug"
                  data-testid="input-slug"
                  placeholder="acme-inc"
                  className="rounded-l-none"
                  value={effectiveSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                  }}
                  aria-required="true"
                  aria-invalid={effectiveSlug && !SLUG_REGEX.test(effectiveSlug) ? 'true' : undefined}
                  aria-describedby={error ? errorId : undefined}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only.
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Industry</Label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Select your industry">
                {INDUSTRIES.map((ind) => (
                  <button
                    key={ind}
                    type="button"
                    aria-pressed={industry === ind}
                    data-testid={`industry-${ind.toLowerCase().replace(/\s+/g, '-')}`}
                    onClick={() => setIndustry(industry === ind ? '' : ind)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-accent',
                      industry === ind
                        ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {ind}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Monthly revenue</Label>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Select monthly revenue range">
                {REVENUE_RANGES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    aria-pressed={monthlyRevenue === r.value}
                    data-testid={`revenue-${r.value}`}
                    onClick={() => setMonthlyRevenue(monthlyRevenue === r.value ? '' : r.value)}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent',
                      monthlyRevenue === r.value
                        ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary'
                        : 'border-border text-muted-foreground',
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Step 3 — Platform selection                                         */}
        {/* ------------------------------------------------------------------ */}
        {canonicalStepIndex === 2 && (
          <div className="space-y-6" data-testid="step-platform">
            <div>
              <h2 className="text-lg font-semibold">What platform is your store on?</h2>
              <p className="text-sm text-muted-foreground">
                Choose your ecommerce platform to connect your store.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4" role="radiogroup" aria-label="Select platform">
              {/* Shopify card */}
              <button
                type="button"
                role="radio"
                aria-checked={platform === 'SHOPIFY'}
                data-testid="platform-shopify"
                onClick={() => setPlatform('SHOPIFY')}
                className={cn(
                  'flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-colors hover:bg-accent',
                  platform === 'SHOPIFY'
                    ? 'border-primary bg-primary/5 ring-2 ring-primary'
                    : 'border-border',
                )}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#96bf48]/10">
                  <ShopifyLogo className="h-7 w-7" />
                </div>
                <div>
                  <p className="font-semibold">Shopify</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Connect via custom app token</p>
                </div>
                {platform === 'SHOPIFY' && (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary" aria-hidden="true">
                    <IconCheck className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
              </button>

              {/* WooCommerce card */}
              <button
                type="button"
                role="radio"
                aria-checked={platform === 'WOOCOMMERCE'}
                data-testid="platform-woocommerce"
                onClick={() => setPlatform('WOOCOMMERCE')}
                className={cn(
                  'flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-colors hover:bg-accent',
                  platform === 'WOOCOMMERCE'
                    ? 'border-primary bg-primary/5 ring-2 ring-primary'
                    : 'border-border',
                )}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#7F54B3]/10">
                  <WooCommerceLogo className="h-7 w-7" />
                </div>
                <div>
                  <p className="font-semibold">WooCommerce</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">WordPress / WooCommerce</p>
                </div>
                {platform === 'WOOCOMMERCE' && (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary" aria-hidden="true">
                    <IconCheck className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Step 4 — Connect store (Shopify)                                   */}
        {/* ------------------------------------------------------------------ */}
        {canonicalStepIndex === 3 && platform === 'SHOPIFY' && (
          <div className="space-y-6" data-testid="step-connect-shopify">
            <div>
              <h2 className="text-lg font-semibold">Connect your Shopify store</h2>
              <p className="text-sm text-muted-foreground">
                Enter your Shopify store handle. You can complete the OAuth connection from
                Integrations using your custom app Admin API token after your workspace is created.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="onb-store-handle">Store URL</Label>
              <div className="flex items-center">
                <Input
                  id="onb-store-handle"
                  data-testid="input-store-handle"
                  placeholder="your-store"
                  value={storeHandle}
                  onChange={(e) => setStoreHandle(e.target.value)}
                  className="rounded-r-none"
                  autoFocus
                />
                <span className="flex h-9 items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground select-none">
                  .myshopify.com
                </span>
              </div>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              Don&apos;t worry — you can connect your store anytime from your workspace settings.
            </p>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Step 4 — Connect store (WooCommerce)                               */}
        {/* ------------------------------------------------------------------ */}
        {canonicalStepIndex === 3 && platform === 'WOOCOMMERCE' && (
          <div className="space-y-6" data-testid="step-connect-woo">
            <div>
              <h2 className="text-lg font-semibold">Connect your WooCommerce store</h2>
              <p className="text-sm text-muted-foreground">
                Enter your store URL and WooCommerce REST API credentials.
              </p>
            </div>

            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="onb-wc-url">Store URL</Label>
                <Input
                  id="onb-wc-url"
                  data-testid="input-wc-url"
                  placeholder="https://mybrand.com"
                  value={wcStoreUrl}
                  onChange={(e) => setWcStoreUrl(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="onb-wc-key">Consumer Key</Label>
                <Input
                  id="onb-wc-key"
                  data-testid="input-wc-key"
                  placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={wcConsumerKey}
                  onChange={(e) => setWcConsumerKey(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="onb-wc-secret">Consumer Secret</Label>
                <Input
                  id="onb-wc-secret"
                  data-testid="input-wc-secret"
                  type="password"
                  placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={wcConsumerSecret}
                  onChange={(e) => setWcConsumerSecret(e.target.value)}
                />
              </div>
            </div>

            <p className="rounded-lg bg-muted px-4 py-3 text-xs text-muted-foreground">
              Generate API keys in your WordPress dashboard under{' '}
              <strong>WooCommerce &rarr; Settings &rarr; Advanced &rarr; REST API</strong>.
              Set permissions to <strong>Read</strong>.
            </p>

            <p className="text-center text-xs text-muted-foreground">
              You can also connect your store anytime from your workspace settings.
            </p>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <p
            id={errorId}
            role="alert"
            aria-live="assertive"
            className="mt-4 text-sm text-destructive"
            data-testid="onboarding-error"
          >
            {error}
          </p>
        )}

        {/* Navigation row */}
        <div className="mt-6 flex items-center justify-between">
          {stepIndex > 0 ? (
            <Button
              type="button"
              variant="ghost"
              onClick={handleBack}
              disabled={isPending}
              data-testid="btn-back"
            >
              <IconArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Back
            </Button>
          ) : (
            <div />
          )}

          {!isLastStep ? (
            <Button
              type="button"
              onClick={handleNext}
              disabled={!canProceed()}
              data-testid="btn-continue"
            >
              Continue
              <IconArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              {/* Shopify connect step — "Launch workspace" (Shopify OAuth deferred to Integrations) */}
              {platform === 'SHOPIFY' && (
                <Button
                  type="button"
                  onClick={submitOnboarding}
                  disabled={isPending}
                  data-testid="btn-launch-shopify"
                >
                  {isPending ? 'Setting up…' : 'Launch workspace'}
                  <IconArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                </Button>
              )}

              {/* WooCommerce — skip or connect */}
              {platform === 'WOOCOMMERCE' && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={submitOnboarding}
                    disabled={isPending}
                    data-testid="btn-skip-woo"
                  >
                    Skip for now
                  </Button>
                  <Button
                    type="button"
                    onClick={submitOnboarding}
                    disabled={isPending || !hasWcCredentials}
                    data-testid="btn-connect-woo"
                  >
                    {isPending ? 'Connecting…' : 'Connect & launch'}
                    <IconArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
                  </Button>
                </>
              )}

              {/* Fallback — shouldn't reach here (platform required to advance) */}
              {platform === '' && (
                <Button
                  type="button"
                  onClick={submitOnboarding}
                  disabled={isPending}
                  data-testid="btn-launch-fallback"
                >
                  Launch
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
