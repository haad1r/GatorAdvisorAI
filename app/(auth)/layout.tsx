import Image from "next/image";
import AuthShell from "@/components/auth/authShell";
import { FluidScale } from "@/components/auth/fluid-scale";
import { ThemeToggle } from "@/components/theme/theme-toggle";

/*
 * Mobile: one column in normal flow (logo, title, card, footer). The two
 * spacers split any spare height 1:2, so the content sits a third of the way
 * down; when there is none they collapse and the page scrolls.
 * Desktop (lg): title and card side by side; logo and footer are pinned to
 * the corners.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="relative isolate flex min-h-dvh w-full min-w-[360px] flex-col lg:flex-row">
      {/* Trimmed logo; the padding reproduces where the full-size logo used to sit. */}
      <div className="mx-auto shrink-0 pt-[44px] pb-[18px] lg:absolute lg:top-[50px] lg:left-[34px] lg:mx-0 lg:p-0">
        <Image src="/logo-mark.png" alt="GatorAdvisor" width={214} height={50} priority className="dark:hidden" />
        <Image src="/logo-mark-dark.png" alt="GatorAdvisor" width={214} height={50} priority className="hidden dark:block" />
      </div>
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>
      <div aria-hidden="true" className="flex-1 lg:hidden" />
      <AuthShell className="px-4 py-0 lg:w-1/2 lg:p-30 lg:-translate-y-20" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 hidden overflow-hidden lg:block">
        <div className="absolute inset-y-[4%] left-1/2 w-16 [mask-image:linear-gradient(to_bottom,transparent,black_30%,black_70%,transparent)]">
          <div className="absolute inset-y-0 left-0 w-px bg-foreground/[0.08] dark:bg-foreground/15" />
          {/* Eased falloff so the shadow has no visible end edge. */}
          <div className="absolute inset-0 [--s:0.06] dark:[--s:0.32] bg-[linear-gradient(to_right,rgb(0_0_0/var(--s)),rgb(0_0_0/calc(var(--s)*0.55))_15%,rgb(0_0_0/calc(var(--s)*0.25))_40%,rgb(0_0_0/calc(var(--s)*0.08))_70%,transparent)]" />
        </div>
      </div>
      <section className="flex w-full min-w-[360px] items-center justify-center px-4 pt-6 lg:min-h-dvh lg:w-1/2 lg:px-0 lg:py-8">
        {/* Grows the auth cards with the column width, like AuthShell. */}
        <FluidScale>{children}</FluidScale>
      </section>
      <div aria-hidden="true" className="flex-[2] lg:hidden" />
      <p className="mx-auto mt-2 mb-6 w-[calc(100%-2rem)] max-w-xs text-center text-xs leading-[14px] font-normal text-muted-foreground lg:absolute lg:bottom-6 lg:left-8 lg:m-0 lg:w-auto lg:text-left">
        This is not an official UF service. Always confirm plans with your UF
        advisor.
      </p>
    </main>
  );
}
