# Frontend conventions

Working agreement for issue #12. This covers the routes, layouts, component folders, and API client boundary that exist now, and who edits the shared files.

Screens stay presentation-only until Maria's Clerk setup and Shaun's fixture schema are handed off. Do not add a second Clerk or Supabase project, and do not put service-role keys or database credentials in browser code.

## Routes

Route groups in brackets do not appear in the URL. `/sign-in`, `/sign-up`, and `/onboarding` share `app/(auth)/layout.tsx`. The signed-in pages share `app/(app)/layout.tsx`.

| Path | File | What it is now | Owner |
| --- | --- | --- | --- |
| `/` | `app/(app)/page.tsx` | Redirects to `/dashboard`. | Braydin |
| `/dashboard`, `/audit`, `/courses`, `/recommendations`, `/plan`, `/schedule`, `/advisor`, `/import`, `/settings` | `app/(app)/<name>/page.tsx` | The #21 page map. Each is an `EmptyState` placeholder until its API exists. `/schedule` gets the calendar/agenda shell (#12 step 6). | Owners per #21 |
| `/preview` | `app/preview/page.tsx` | Gallery of loading, empty, error, and status states, plus a mock API demo. Always uses the mocks, never a real backend, and needs no sign-in. | Braydin |
| `/sign-in` | `app/(auth)/sign-in/[[...sign-in]]/page.tsx` | Clerk `<SignIn />`. A redirect here is not access control. | Zain |
| `/sign-up` | `app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Clerk `<SignUp />`. | Zain |
| `/onboarding` | `app/(auth)/onboarding/page.tsx` | Static wizard with placeholder majors, catalog years, and terms. Still public. | Zain |

`proxy.ts` runs Clerk middleware and does not protect any route yet. Leave route protection until Maria's publishable key, allowed URLs, and setup notes are in place. Signed-out users must be sent to `/sign-in` by the backend-approved Clerk config, not by a frontend-only check.

The app pages are placeholders. Real content waits for the API contracts. New signed-in routes go in `app/(app)/` and get one entry in `components/nav/nav-items.ts`, which drives the sidebar, menu, tab bar, and page title.

## Layouts

**Root** (`app/layout.tsx`). Sets the Host Grotesk font, page metadata, and wraps the tree in `ClerkProvider`. Every page gets this.

**Auth** (`app/(auth)/layout.tsx`). Logo, `AuthShell`, the page content, and the "not an official UF service" footer. New sign-in, sign-up, and onboarding screens go in the `(auth)` group so they pick this up. Do not copy the logo or footer into a page.

**App** (`app/(app)/layout.tsx`). Wraps every signed-in page in `AppShell`, following #21:

- Desktop (`lg`+): left sidebar (logo, main pages, Settings, account) and a sticky top bar with the page title, the student's program and catalog year, and the theme toggle.
- Below `lg`: top bar with a menu button (all pages, in a panel built on the shared dialog) and a bottom tab bar for Dashboard, Audit, Plan, Schedule, Advisor.
- Footer: data freshness (catalog year, last schedule data update) from `api.getDataFreshness()`, plus the "not an official UF service" note.
- A skip link and `<main id="main">`.

The top bar renders the page title as the page's only `<h1>`, from `nav-items.ts`. Pages render only their content: no `<h1>`, header, or `<main>`. Auth pages and `/preview` stay outside this group.

The account control shows Clerk's `UserButton` (with a Dark/Light mode item) when signed in and a "Sign in" link when not. That is display only. It does not protect the route.

## Component conventions

Import from the `@/` aliases in `components.json`. New UI follows the folder it belongs to:

| Folder | Use it for | Owner |
| --- | --- | --- |
| `components/ui/` | shadcn primitives (button, input, badge, alert, skeleton, label, native select, dialog). Feature code composes these. It does not restyle them for one screen. | Shared. See below. |
| `components/feedback/` | `LoadingBlock`, `EmptyState`, `ErrorPanel`, `StatusBadge`. | Braydin |
| `components/forms/` | `FormField`, `FormErrorSummary`, `SubmitButton`. | Zain |
| `components/auth/` | `AuthShell` and other auth chrome. | Zain |
| `components/nav/` | `AppShell`, `nav-items.ts` (the page map), `NavList`/`MobileTabBar`/`MobileMenu` (`aria-current` on the active link), `PageTitle`, `ProgramSummary`, `FreshnessFooter`, `AccountButton`, `LogoLink`. | Braydin (was Nav) |
| `components/calendar/` | `ScheduleView` (week navigation, Week/List switch, loading/empty/error), `WeekGrid`, `AgendaList`, `UnscheduledList`, `CalendarEvent`. Date and label helpers are in `lib/schedule.ts`. | Braydin (was Nav) |
| `components/theme/` | `ThemeScript` (in the root layout's `<head>`, sets `.dark` before first paint) and `ThemeToggle`. With no saved choice the theme follows the OS setting. | Braydin (was Nav) |
| `components/onboarding/` | The onboarding wizard. | Zain |
| `lib/forms.ts` | The `FormState` contract every form returns. | Zain |
| `lib/onboarding.ts` | Placeholder profile fields. Swap the option lists for Shaun's schema when it exists. Do not add more placeholder majors here. | Zain |

Nav's work (shell, theme, calendar, accessibility review) is now covered by Braydin.

Conventions already in the code:

- Forms return `FormState` from `lib/forms.ts`. Field errors render under the control through `FormField`. The summary renders through `FormErrorSummary`, which takes focus only when `submittedAt` changes.
- `FormField` wires `label`, `aria-describedby`, and `aria-invalid`. Pass its control props through to the input.
- Status is never color alone. `StatusBadge` takes a `kind` and a visible `label`.
- Brand colors come from tokens in `app/globals.css`, never hex values in components (#21). `text-brand-blue`/`bg-brand-blue` for navigation, active states, headings, and links (UF blue in light, a lighter blue in dark so it passes 4.5:1). Primary actions use the default `Button`, which is UF orange with near-black text (white on UF orange fails contrast). `--orange`/`--blue` are the raw values; use the `brand-*` tokens instead.
- `LoadingBlock` sets `aria-busy` and an accessible name.
- Dialogs use `components/ui/dialog.tsx` (Base UI). Focus trapping, Escape, and returning focus to the trigger are built in. Always give it a `DialogTitle`. If the action removes the trigger (e.g. deleting a row), pass `finalFocus` so focus lands somewhere sensible instead of the top of the page. See `app/preview/dialog-demo.tsx`.
- Preview new feedback states on `/preview` before using them in a feature page.

## Responsive and accessibility patterns

These are the patterns the shell, dialog, and calendar already follow. New screens use them too.

**Breakpoints.** One switch point: `lg` (1024px). Below it is the phone/tablet layout, at and above it the desktop layout. Check every screen at 375px (no sideways scroll) and at 1280px, in both themes.

| Pattern | Below `lg` | `lg` and up |
| --- | --- | --- |
| Navigation | Top bar with a menu button (the sidebar in a dialog panel) plus a 5-item bottom tab bar | Left sidebar |
| Calendar | Agenda list only | Week grid, with a Week/List switch |
| Dialog buttons | Stacked, full width | Side by side, equal width |
| Content | `px-4` | `px-8`, max width `6xl` |

**Rules**

- **Status is never color alone.** Pair color with text or a shape: `StatusBadge` labels, the calendar's "Lecture"/"Exam" tags, the "Today" tag, and the bar beside the active nav item.
- **Every control has a name.** Icon-only buttons get an `aria-label` ("Open menu", "Next week"). When several buttons share visible text, add hidden context (`Remove<span className="sr-only"> COP3502</span>`).
- **One `<h1>` per page,** and no skipped levels. In the app the top bar renders it; pages start at `<h2>`.
- **Long or visual content gets a text version.** Calendar events have a full `aria-label` ("COP3503 lecture, Monday 10:40 AM to 11:30 AM, CSE A101"); the grid is also offered as a list (#21: calendars always have a list alternative).
- **Calendar events are tinted by type** (lecture/discussion blue, lab green via `--event-lab`, exam orange, with a colored left edge), and the type is always shown as text too. Class names must be written out in full, never built with template strings, or Tailwind won't generate them.
- **Calendar cards** look the same in every view: course and type on the first line, time and room on the second, 12px apart (which puts the time at the bottom of a one-period grid block). The grid drops AM/PM because its hour labels show it; the lists keep it.
- **Meeting times and rooms have no data source yet.** The SOC scraper does not collect them (they need a signed-in UF session), so they will likely be entered manually by the student. The mock rooms and times are made up. Missing values show as "Time TBA" / "Location TBA", never a guess.
- **Never invent data.** TBA and online meetings are listed under "Not on the calendar", never placed at a made-up time. A failed request says so (`ErrorPanel`, "Data freshness is unavailable") instead of showing a guess.
- **Announce changes.** Content that updates without a page load (the week range, mock results) sits in an `aria-live="polite"` region.
- **Contrast is at least 4.5:1** for text, including muted text on the canvas and on tinted calendar cards. Use the tokens (`text-muted-foreground`, `text-destructive`); they were tuned to pass axe in both themes.
- **Scrollable areas are focusable** (`tabIndex={0}`, a `role="region"` with an `aria-label`, and a focus ring) so keyboard users can scroll them, like the week grid.
- **Loading states are announced.** `LoadingBlock` is a `role="status"` region with hidden "Loading…" text.
- **Touch targets** are at least 40px tall (nav rows and tabs are 44px+).
- **Focus is always visible** (`focus-visible:ring-3`), and dialogs use `finalFocus` when the action removes the button that opened them.
- **Dates are formatted by hand or in `America/New_York`.** `Intl` output can differ between Node and the browser, which breaks hydration (see `formatWeekRange`).

On `/sign-in` and `/sign-up`, Clerk's card title is the `<h1>`, so the `AuthShell` headline renders as a `<p>` there. On `/onboarding` the headline is the `<h1>`.

## API client boundary

The rules:

- Feature components call one shared client. They do not `fetch` Supabase, the degree engines, or live academic services themselves.
- Mock responses use the same client functions, so a screen cannot tell a fixture from a later network call.
- The client is responsible for expired-session, authorization, validation, quota, and stale-record responses. Map those onto `FormState`, `ErrorPanel`, and `StatusBadge` in the screen. Do not invent a second error shape.
- Browser code receives only the Clerk publishable key. Server secrets stay on the server. Maria owns provider restrictions and token validation.

### Using it

```tsx
const api = useApi()
const result = await api.getCoursework()
if (result.ok) setRows(result.data.rows)
else setPanel(toErrorPanel(result.error)) // or toFormState(result.error) in a form
```

Calls never throw. Check `result.ok` before reading `data`.

| File | What it does |
| --- | --- |
| `lib/api/types.ts` | Request, response, and error shapes. **Provisional** until Maria publishes `api-contracts.md`; replace this file when she does. |
| `lib/api/client.ts` | The functions screens call: `getProfile`/`saveProfile`, `getLatestSurvey`/`submitSurvey`, `getCoursework`/`saveCoursework`, `getSchedule(weekStart)`, `getDataFreshness()`. |
| `lib/api/use-api.ts` | `useApi()` for client components. Uses the mocks when `NEXT_PUBLIC_API_MOCKS=true`, otherwise the real backend with the Clerk session token. |
| `lib/api/transport.ts` | The real backend: `fetch` plus HTTP status to error code (401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 409 `STALE_WRITE`, 400/422 `VALIDATION_ERROR`, 429 `QUOTA_EXCEEDED`, 5xx `SERVER`, failed fetch `NETWORK`). |
| `lib/api/errors.ts` | `toFormState()` for forms and `toErrorPanel()` for `ErrorPanel`. One message per error code. |
| `lib/mocks/fixtures.ts` | Synthetic starting data. No real student records. |
| `lib/mocks/handlers.ts` | The fake backend: in-memory saves, validation, and `STALE_WRITE` when a save sends an old `version`. |
| `lib/mocks/transport.ts` | Fake latency (300 to 700 ms) and forced error scenarios. |

### Mocks

Copy `NEXT_PUBLIC_API_MOCKS=true` from `.env.example` into `.env.local`. Every endpoint above is mocked; none are live yet.

To see an error state, add `?mock=<scenario>` to any URL: `expired`, `forbidden`, `validation`, `quota`, `stale`, `network`, `server`, or `slow` (3 s delay). It is remembered until `?mock=off`. `validation` and `stale` only affect saves. `/preview` has a demo with a scenario picker.

`OnboardingForm` saves through `api.saveProfile`, so `?mock=` scenarios show up in its error summary. The option lists in `lib/onboarding.ts` are still placeholders.

## Checks and tests

Run these before opening a PR:

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run check` | Typecheck, lint, then a production build |
| `npm run test:e2e` | Playwright smoke tests and axe checks |

First time only: `npx playwright install chromium`.

`npm run test:e2e` reuses a dev server on port 3001 if one is running, otherwise it starts one. It needs `.env.local` with the Clerk publishable key and `NEXT_PUBLIC_API_MOCKS=true`, the same setup as `npm run dev`. No extra Clerk, Supabase, or test projects are needed. Every test runs twice: desktop (1280px) and mobile (375px).

| File in `e2e/` | Covers |
| --- | --- |
| `navigation.spec.ts` | Root redirect, skip link, every sidebar link and its `aria-current`, the mobile tab bar and menu (Escape returns focus), no sideways scroll at 375px |
| `auth-boundary.spec.ts` | Signed-out "Sign in" link reaches Clerk's form, sign-up renders, expired-session and forbidden responses show their messages, one `<h1>` on each auth page |
| `loading-failures.spec.ts` | Loading state, server/network/quota errors with "Try again", recovery after a retry, footer freshness failure, no `/api` requests while mocks are on |
| `theme.spec.ts` | Follows the OS with no saved choice, the toggle saves and survives a reload, a saved dark theme applies before first paint |
| `accessibility.spec.ts` | axe (WCAG 2.1 A/AA) on `/dashboard`, `/schedule`, `/settings`, `/preview` in light and dark |

Signed-in flows are not covered yet: they need a Clerk test user from Maria. Add them once she provides one, using Clerk's testing tokens rather than a real account.

A failed test keeps a trace in `test-results/`. Open it with `npx playwright show-trace <path>/trace.zip`.

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
