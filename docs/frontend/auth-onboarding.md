# Auth, onboarding & shared forms (issue #12, Zain)

Checkpoint 1: presentation only. Everything runs locally with no live
services. Clerk and the backend are wired in at later checkpoints.

## Routes

| Route | File | Notes |
|---|---|---|
| `/sign-in` | `app/(auth)/sign-in/[[...sign-in]]/page.tsx` | Optional catch-all because Clerk uses sub-paths |
| `/sign-up` | `app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Same |
| `/onboarding` | `app/(auth)/onboarding/page.tsx` | 3 steps: About you → Your program → Review |

All three share `app/(auth)/layout.tsx` → `<AuthShell>` (brand panel on
desktop, single column down to 375px). `(auth)` is a route group, so it
doesn't appear in the URL.

## Clerk hand-off (waiting on TEAM-01)

`<ClerkSlot>` (`components/auth/clerk-slot.tsx`) marks where Clerk's
prebuilt `<SignIn />` / `<SignUp />` mount. We do **not** build our own
credential form. When the publishable key is ready:

1. Install `@clerk/nextjs` and wrap the root layout in `<ClerkProvider>`.
2. Replace `<ClerkSlot flow="sign-in" />` with `<SignIn />` (and sign-up likewise), redirecting new users to `/onboarding`.
3. Protect `/onboarding` (see the TODO in its page).

Only the **publishable** key goes in the browser. Secret keys stay server-side.

## Onboarding data (waiting on TEAM-02)

Majors, catalog years and graduation terms in `lib/onboarding.ts` are
**placeholders**. Replace them with the approved fixture schema/API; don't
extend them. `validateProfile()` is a pure function so the backend action
can reuse it. Client checks are never the only validation.

`OnboardingForm` takes an `onSubmit(profile) => Promise<FormState>` prop.
It defaults to a local mock; swap in the authenticated API client call.

## Shared form pattern

Every form returns the same `FormState` (`lib/forms.ts`):

```ts
{ status: "idle" | "success" | "error", message?, fieldErrors?: { [name]: string[] } }
```

Works directly with `useActionState` for server actions.

| Component | Use |
|---|---|
| `FormField` | Label + control + hint + error. Passes `id`, `name`, `aria-invalid`, `aria-describedby` to the control via a render prop. |
| `FormErrorSummary` | Top-of-form error box. Takes focus on failed submit, links each error to its field. |
| `SubmitButton` | Disables + spinner while pending (`useFormStatus`, or pass `pending`). |
| `Input`, `Label`, `NativeSelect` | Base controls (`components/ui`). Native select on purpose: works with FormData and mobile pickers. |

```tsx
<FormField id="major" label="Major" error={fieldError(state, "major")} required>
  {(p) => <NativeSelect {...p}>…</NativeSelect>}
</FormField>
```

## Error pattern

- **Field / form errors** → `FormField` + `FormErrorSummary`.
- **Inline request failure** → Braydin's `ErrorPanel`.
- **Page crash** → `app/error.tsx` → `RouteError`. Never shows raw error
  text (can leak server details); shows the digest for bug reports, with
  "Try again" (`retry()`, this Next version's API) and "Go home".

See `/preview` for live examples.
