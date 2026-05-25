'use client';

// @paradigm: sql
// OnboardingForm — multi-step workspace setup (Slice C).
//
// Steps: profile (fullName/role) → brand (brandName/slug/industry/monthlyRevenue)
//        → platform (shopify/woocommerce + store handle).
// On submit, calls the tRPC onboarding.complete procedure which, in ONE transaction,
// upserts the user + creates the Workspace + WorkspaceMember(OWNER) in the LOCAL dev DB,
// then redirects to /dashboard.
//
// The live Shopify/Woo OAuth connect is DEFERRED to slice D — the platform step captures
// the store handle but the connect action is a disabled "coming in integrations" affordance.
//
// CF-C6-PII-CLIENT-1: never log email/token. CF-C6-PERF-A11Y-1: labels, error roles, kbd nav.

import { useState, useId } from 'react';
import { trpc } from '@/infrastructure/trpc-client.js';

type Step = 'profile' | 'brand' | 'platform';
type Platform = 'SHOPIFY' | 'WOOCOMMERCE';

interface OnboardingFormProps {
  defaultFullName?: string;
}

// Mirror the core-service slug rule (lowercase alnum + interior hyphens).
const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function OnboardingForm({ defaultFullName = '' }: OnboardingFormProps) {
  const [step, setStep] = useState<Step>('profile');
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  // Profile
  const [fullName, setFullName] = useState(defaultFullName);
  const [jobRole, setJobRole] = useState('');
  // Brand
  const [brandName, setBrandName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [industry, setIndustry] = useState('');
  const [monthlyRevenue, setMonthlyRevenue] = useState('');
  // Platform
  const [platform, setPlatform] = useState<Platform>('SHOPIFY');
  const [storeHandle, setStoreHandle] = useState('');

  const fullNameId = useId();
  const jobRoleId = useId();
  const brandNameId = useId();
  const slugId = useId();
  const industryId = useId();
  const revenueId = useId();
  const storeId = useId();

  const completeMutation = trpc.onboarding.complete.useMutation({
    onSuccess: (data) => {
      // Hard navigation so the middleware re-evaluates with the new membership and
      // the dashboard picks up the fresh workspace.
      window.location.assign(data.redirectTo || '/dashboard');
    },
    onError: (err) => {
      // Generic, no internal detail leaked — show the server's user-safe message.
      setError(err.message.replace(/\s*request_id=.*/, '') || 'Could not complete setup. Try again.');
    },
  });

  // Auto-derive the slug from the brand name until the user edits it manually.
  const onBrandNameChange = (v: string) => {
    setBrandName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const goNext = () => {
    setError(null);
    if (step === 'profile') {
      if (!fullName.trim()) {
        setError('Please enter your name.');
        return;
      }
      setStep('brand');
      return;
    }
    if (step === 'brand') {
      if (!brandName.trim()) {
        setError('Brand name is required.');
        return;
      }
      if (!SLUG_REGEX.test(slug)) {
        setError('Workspace URL must be lowercase letters, numbers, and hyphens (no leading/trailing hyphen).');
        return;
      }
      setStep('platform');
      return;
    }
  };

  const goBack = () => {
    setError(null);
    if (step === 'brand') setStep('profile');
    else if (step === 'platform') setStep('brand');
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    completeMutation.mutate({
      fullName: fullName.trim(),
      jobRole: jobRole.trim(),
      brandName: brandName.trim(),
      slug: slug.trim(),
      industry: industry.trim(),
      monthlyRevenue: monthlyRevenue.trim(),
      platform,
      storeHandle: storeHandle.trim() || null,
    });
  };

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
  const labelClass = 'block text-sm font-medium text-gray-700';

  return (
    <div className="bg-white py-8 px-6 shadow rounded-lg space-y-6">
      {/* Step indicator */}
      <ol className="flex items-center justify-center gap-2 text-xs text-gray-500" aria-label="Onboarding steps">
        {(['profile', 'brand', 'platform'] as Step[]).map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              aria-current={step === s ? 'step' : undefined}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${
                step === s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
              }`}
            >
              {i + 1}
            </span>
            <span className="capitalize">{s}</span>
          </li>
        ))}
      </ol>

      <form onSubmit={handleSubmit} aria-label="Workspace setup form" noValidate className="space-y-6">
        {step === 'profile' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <label htmlFor={fullNameId} className={labelClass}>Your name</label>
              <input id={fullNameId} className={inputClass} value={fullName}
                onChange={(e) => setFullName(e.target.value)} autoComplete="name" required
                aria-describedby={error ? errorId : undefined} />
            </div>
            <div className="space-y-1">
              <label htmlFor={jobRoleId} className={labelClass}>Your role (optional)</label>
              <input id={jobRoleId} className={inputClass} value={jobRole}
                onChange={(e) => setJobRole(e.target.value)} placeholder="Founder, Growth, Ops…" />
            </div>
          </div>
        )}

        {step === 'brand' && (
          <div className="space-y-4">
            <div className="space-y-1">
              <label htmlFor={brandNameId} className={labelClass}>Brand name</label>
              <input id={brandNameId} className={inputClass} value={brandName}
                onChange={(e) => onBrandNameChange(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <label htmlFor={slugId} className={labelClass}>Workspace URL</label>
              <div className="flex items-center gap-1 text-sm text-gray-500">
                <span>brain.app/w/</span>
                <input id={slugId} className={inputClass} value={slug}
                  onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
                  required aria-describedby={error ? errorId : undefined}
                  aria-invalid={slug && !SLUG_REGEX.test(slug) ? 'true' : undefined} />
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor={industryId} className={labelClass}>Industry (optional)</label>
              <input id={industryId} className={inputClass} value={industry}
                onChange={(e) => setIndustry(e.target.value)} placeholder="Beauty, Apparel, Food…" />
            </div>
            <div className="space-y-1">
              <label htmlFor={revenueId} className={labelClass}>Monthly revenue (optional)</label>
              <input id={revenueId} className={inputClass} value={monthlyRevenue}
                onChange={(e) => setMonthlyRevenue(e.target.value)} placeholder="e.g. 5-10L" />
            </div>
          </div>
        )}

        {step === 'platform' && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className={labelClass}>Where do you sell?</legend>
              <div className="flex gap-3">
                {(['SHOPIFY', 'WOOCOMMERCE'] as Platform[]).map((p) => (
                  <label key={p} className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm ${
                    platform === p ? 'border-blue-600 ring-1 ring-blue-600' : 'border-gray-300'
                  }`}>
                    <input type="radio" name="platform" value={p} checked={platform === p}
                      onChange={() => setPlatform(p)} className="sr-only" />
                    {p === 'SHOPIFY' ? 'Shopify' : 'WooCommerce'}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1">
              <label htmlFor={storeId} className={labelClass}>Store handle (optional)</label>
              <input id={storeId} className={inputClass} value={storeHandle}
                onChange={(e) => setStoreHandle(e.target.value)}
                placeholder={platform === 'SHOPIFY' ? 'your-store (.myshopify.com)' : 'yourstore.com'} />
            </div>
            {/* Slice D affordance: the live connect is deferred. */}
            <button type="button" disabled aria-disabled="true"
              className="w-full rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-400 cursor-not-allowed">
              Connect store — coming in integrations
            </button>
          </div>
        )}

        {error && (
          <p id={errorId} role="alert" aria-live="assertive" className="text-sm text-red-600">{error}</p>
        )}

        <div className="flex items-center justify-between gap-3">
          {step !== 'profile' ? (
            <button type="button" onClick={goBack}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Back
            </button>
          ) : <span />}

          {step !== 'platform' ? (
            <button type="button" onClick={goNext}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
              Continue
            </button>
          ) : (
            <button type="submit" disabled={completeMutation.isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed">
              {completeMutation.isPending ? 'Creating workspace…' : 'Create workspace'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
