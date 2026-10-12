import AuthShell from "@/components/auth/authShell";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="relative flex min-h-dvh w-full min-w-[360px] flex-col lg:flex-row">
      <img
        src="/logo.png"
        alt="GatorAdvisor"
        className="block h-[150px] w-[250px] shrink-0 object-contain absolute top-0 left-4"
      />
      <AuthShell className="lg:w-1/2 p-30 lg:-translate-y-20" />
      <section className="flex lg:min-h-dvh lg:py-0 w-full min-w-[360px] items-center justify-center pt-6 pb-40 lg:w-1/2">
        {children}
      </section>
      <p className="absolute bottom-6 left-8 m-0 max-w-xs text-left text-xs font-normal leading-[14px] text-[#777777]">
        This is not an official UF service. Always confirm plans with your UF
        advisor.
      </p>
    </main>
  );
}