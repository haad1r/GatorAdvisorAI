import AuthShell from "@/components/auth/authShell";
import { FluidScale } from "@/components/auth/fluid-scale";

/*
 * Mobile: one column in normal flow (logo, title, card, footer). The two
 * spacers split any spare height 1:2, so the content sits a third of the way
 * down; when there is none they collapse and the page scrolls.
 * Desktop (lg): title and card side by side; logo and footer are pinned to
 * the corners.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="relative flex min-h-dvh w-full min-w-[360px] flex-col lg:flex-row">
      <img
        src="/logo.png"
        alt="GatorAdvisor"
        className="mx-auto block h-[112px] w-[250px] shrink-0 object-cover object-top lg:absolute lg:top-0 lg:left-4 lg:mx-0 lg:h-[150px] lg:object-contain lg:object-center"
      />
      <div aria-hidden="true" className="flex-1 lg:hidden" />
      <AuthShell className="px-4 py-0 lg:w-1/2 lg:p-30 lg:-translate-y-20" />
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
