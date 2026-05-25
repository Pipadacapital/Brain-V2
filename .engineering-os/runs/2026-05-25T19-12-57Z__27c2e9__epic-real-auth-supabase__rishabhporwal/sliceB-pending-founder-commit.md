# Pending Founder Commit — Slice B (signup + email confirmation + password recovery)

Stage 6 PASS (signed under standing delegation). **Nothing has been committed or pushed.**
Working-tree branch at build time: `feature/feat-store-order-fact-layer` (HEAD `fff6bcb`).
Slice A is already committed (fcea0b7). Per the feature-branch rule, the Founder should
commit slice B on a dedicated `feature/feat-auth-supabase-recovery` branch (cut from
`development`) before review.

Slice B is **Supabase-auth flows + pages only** — web-only, ZERO new deps, ZERO backend/DB
changes (no `/api/user/ensure`, no `/me`, no membership lookup — that is slice C).

## Commit ONLY these paths (explicit — NO `git add -A`)

Real `.env` / `.env.local` are git-ignored and MUST NOT be committed (verified: not in
`git status`). The following are pre-existing/generated and are **NOT slice B** — exclude:
`.claude/`, `CLAUDE.md`, `apps/web/next-env.d.ts`.

```bash
git add \
  apps/web/src/app/auth/sign-up/page.tsx \
  apps/web/src/app/auth/sign-up-success/page.tsx \
  apps/web/src/app/auth/forgot-password/page.tsx \
  apps/web/src/app/auth/update-password/page.tsx \
  apps/web/src/app/auth/confirm/route.ts \
  apps/web/src/interfaces/components/auth/sign-up-form.tsx \
  apps/web/src/interfaces/components/auth/forgot-password-form.tsx \
  apps/web/src/interfaces/components/auth/update-password-form.tsx \
  apps/web/src/interfaces/components/auth/login-form.tsx \
  apps/web/src/test/sign-up-form.test.tsx \
  apps/web/src/test/forgot-password-form.test.tsx \
  apps/web/src/test/update-password-form.test.tsx \
  apps/web/src/test/confirm-route.test.ts
```

Suggested commit message:

```
feat(slice-B-auth): signup + email confirmation + password recovery (Supabase flows)

- /auth/sign-up + SignUpForm → supabase.auth.signUp (emailRedirectTo /auth/callback)
- /auth/sign-up-success ("check your email")
- /auth/confirm route handler → verifyOtp → /dashboard (open-redirect-guarded ?next)
- /auth/forgot-password + ForgotPasswordForm → resetPasswordForEmail (-> /auth/update-password)
- /auth/update-password + UpdatePasswordForm → updateUser → /dashboard
- login-form: "Sign up" + "Forgot password?" links
- Carries slice-A posture: generic errors (no raw AuthApiError), no PII/secret logged,
  noValidate, a11y labels/roles. No new deps. No backend/DB (slice C).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

## Files in this slice

NEW pages (server-component shells):
- `apps/web/src/app/auth/sign-up/page.tsx`
- `apps/web/src/app/auth/sign-up-success/page.tsx`
- `apps/web/src/app/auth/forgot-password/page.tsx`
- `apps/web/src/app/auth/update-password/page.tsx`

NEW route handler:
- `apps/web/src/app/auth/confirm/route.ts`

NEW forms (client components):
- `apps/web/src/interfaces/components/auth/sign-up-form.tsx`
- `apps/web/src/interfaces/components/auth/forgot-password-form.tsx`
- `apps/web/src/interfaces/components/auth/update-password-form.tsx`

EDIT:
- `apps/web/src/interfaces/components/auth/login-form.tsx` (added Sign up + Forgot password links)

NEW tests:
- `apps/web/src/test/sign-up-form.test.tsx`
- `apps/web/src/test/forgot-password-form.test.tsx`
- `apps/web/src/test/update-password-form.test.tsx`
- `apps/web/src/test/confirm-route.test.ts`

## Founder dashboard action items (cannot be done in code — required for full e2e)

The flows are wired and verified mechanically + live (verifyOtp hit real Supabase and
redirected correctly on a bad token). To exercise a full end-to-end email round-trip
locally, the Supabase project (Auth → URL Configuration) must allow these redirect URLs:
- `http://localhost:3000/auth/callback`   (signup confirmation lands here)
- `http://localhost:3000/auth/update-password`   (password-recovery link lands here)
- Site URL `http://localhost:3000`.

With `mailer_autoconfirm:false` (current project setting), a brand-new signup cannot
complete confirmation without real email delivery — this is a Supabase mailer/dashboard
fact, not a code gap. All slice-B code paths are proven (method-called-with-correct-args +
pages render + redirects correct); see the Stage-5/6 verification in the final review.
