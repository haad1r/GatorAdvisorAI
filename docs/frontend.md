# Frontend conventions

Working agreement for issue #12. This covers the routes, layouts, component folders, and API client boundary that exist now, and who edits the shared files.

Screens stay presentation-only until Maria's Clerk setup and Shaun's fixture schema are handed off. Do not add a second Clerk or Supabase project, and do not put service-role keys or database credentials in browser code.

## Routes

The `(auth)` group does not appear in the URL. `/sign-in`, `/sign-up`, and `/onboarding` share `app/(auth)/layout.tsx`.

| Path | File | What it is now | Owner |
| --- | --- | --- | --- |
| `/` | `app/page.tsx` | Next.js starter page. Nav replaces this with the app shell. | Nav |
| `/preview` | `app/preview/page.tsx` | Static gallery of loading, empty, error, and status states. No API and no sign-in. | Braydin |
| `/sign-in` | `app/(auth)/sign-in/[[...sign-in]]/page.tsx` | Clerk `<SignIn />`. A redirect here is not access control. | Zain |
| `/sign-up` | `app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Clerk `<SignUp />`. | Zain |
| `/onboarding` | `app/(auth)/onboarding/page.tsx` | Static wizard with placeholder majors, catalog years, and terms. Still public. | Zain |

`proxy.ts` runs Clerk middleware and does not protect any route yet. Leave route protection until Maria's publishable key, allowed URLs, and setup notes are in place. Signed-out users must be sent to `/sign-in` by the backend-approved Clerk config, not by a frontend-only check.

Later app routes (audit, schedule, calendar) wait for Nav's shell and for the API contracts. Add them to this table when they exist.

## Layouts

**Root** (`app/layout.tsx`). Sets the Host Grotesk font, page metadata, and wraps the tree in `ClerkProvider`. Every page gets this.

**Auth** (`app/(auth)/layout.tsx`). Logo, `AuthShell`, the page content, and the "not an official UF service" footer. New sign-in, sign-up, and onboarding screens go in the `(auth)` group so they pick this up. Do not copy the logo or footer into a page.

The signed-in app shell (navigation, theme toggle, page frame) is Nav's and does not exist yet. It wraps routes outside `(auth)`. Auth pages stay on the auth layout.

## Component conventions

Import from the `@/` aliases in `components.json`. New UI follows the folder it belongs to:

| Folder | Use it for | Owner |
| --- | --- | --- |
| `components/ui/` | shadcn primitives (button, input, badge, alert, skeleton, label, native select). Feature code composes these. It does not restyle them for one screen. | Shared. See below. |
| `components/feedback/` | `LoadingBlock`, `EmptyState`, `ErrorPanel`, `StatusBadge`. | Braydin |
| `components/forms/` | `FormField`, `FormErrorSummary`, `SubmitButton`. | Zain |
| `components/auth/` | `AuthShell` and other auth chrome. | Zain |
| `components/onboarding/` | The onboarding wizard. | Zain |
| `lib/forms.ts` | The `FormState` contract every form returns. | Zain |
| `lib/onboarding.ts` | Placeholder profile fields. Swap the option lists for Shaun's schema when it exists. Do not add more placeholder majors here. | Zain |

Nav's navigation, theme toggle, and calendar/agenda components get their own folders (`components/nav/`, `components/calendar/`) when that work starts. Nav also reviews accessibility on the other folders.

Conventions already in the code:

- Forms return `FormState` from `lib/forms.ts`. Field errors render under the control through `FormField`. The summary renders through `FormErrorSummary`, which takes focus only when `submittedAt` changes.
- `FormField` wires `label`, `aria-describedby`, and `aria-invalid`. Pass its control props through to the input.
- Status is never color alone. `StatusBadge` takes a `kind` and a visible `label`.
- `LoadingBlock` sets `aria-busy` and an accessible name.
- Preview new feedback states on `/preview` before using them in a feature page.

## API client boundary

There is no API client yet. Building it is step 4 of issue #12. The boundary is:

- Feature components call one shared client. They do not `fetch` Supabase, the degree engines, or live academic services themselves.
- The client will live in `lib/api/`. Mock responses for local UI work use the same functions, so a screen cannot tell a fixture from a later network call.
- The client is responsible for expired-session, authorization, validation, quota, and stale-record responses. Map those onto `FormState`, `ErrorPanel`, and `StatusBadge` in the screen. Do not invent a second error shape.
- Browser code receives only the Clerk publishable key. Server secrets stay on the server. Maria owns provider restrictions and token validation.

`OnboardingForm`'s default `mockSave` and the lists in `lib/onboarding.ts` are presentation stand-ins. They are not this client and not an approved fixture schema.

## Shared files

Message the owner before editing a file you do not own. Braydin checks with Zain before touching a shared file.

| File | Owner | What they control |
| --- | --- | --- |
| `app/layout.tsx` | Zain | `ClerkProvider`, font, metadata. Nav adds the theme class on `<html>` and coordinates that edit with Zain. |
| `app/(auth)/layout.tsx` | Zain | Auth chrome. |
| `app/globals.css` | Nav | Light/dark tokens and the theme switch. `--orange` and `--blue` are shared brand tokens. Coordinate before changing them. |
| `components/ui/*` | Whoever needs the primitive | Add a shadcn component in its own commit. Review it with the other two before merging. Do not fork a primitive for one feature. |
| `package.json`, `package-lock.json` | Whoever adds the dependency | Say why in the PR. No extra auth or database packages. |
| `proxy.ts` | Zain | Clerk middleware. Route protection waits on Maria's setup. |
| `app/preview/page.tsx` | Braydin | Gallery only. Feature pages do not import this route. |
