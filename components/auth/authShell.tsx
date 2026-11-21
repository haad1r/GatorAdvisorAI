"use client";

import { usePathname } from "next/navigation";

type AuthShellProps = {
  logoSrc?: string;
  className?: string;
};

export default function AuthShell({
  className = "",
}: AuthShellProps) {
  /* Clerk's card title is the <h1> on sign-in and sign-up, so the headline steps aside there. */
  const Headline = /^\/sign-(in|up)(\/|$)/.test(usePathname()) ? "p" : "h1";
  return (
    <aside
      className={`
        flex lg:min-h-dvh w-full min-w-0 flex-col items-center lg:items-start
        px-[clamp(20px,4.5vw,100px)] pb-[17px] justify-center
        ${className}
      `}
    >

      <div className="@container mx-auto w-full text-center lg:text-left lg:scale-110 lg:max-w-[650px] max-w-[360px] min-w-0 lg:min-w-[360px] p-2 text-[clamp(80%,90vw,100%)]">
        <Headline className="
        m-0 lg:text-[clamp(2.8rem,3vw,4.5rem)] text-[clamp(2.25em,3vw,3rem)] font-medium 
        lg:leading-[1.15] leading-[42px]
        text-foreground [word-spacing:-0.2em]">
          Plan your{" "}
          <span className="text-brand-blue font-bold lg:text-[clamp(3rem,3.2vw,4.5rem)] text-[clamp(2.5rem,3.5vw,3rem)]">UF</span> degree
          with{" "}
          <span className="text-brand-orange font-bold lg:text-[clamp(3rem,3.2vw,4.5rem)] text-[clamp(2.5rem,3.5vw,3rem)]">
            confidence
          </span>
          .
        </Headline>

        <p className="mb-0 mt-[10px] lg:text-[clamp(0.75rem,1.4vw,1rem)] text-[clamp(0.75rem,1.2vw,1rem)] font-normal leading-normal lg:leading-6 text-muted-foreground">
          Degree audits, schedules, and recommendations computed from UF
          requirements, explained in plain language.
        </p>
      </div>
    </aside>
  );
}
