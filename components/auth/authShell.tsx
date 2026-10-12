type AuthShellProps = {
  logoSrc?: string;
  className?: string;
};

export default function AuthShell({
  className = "",
}: AuthShellProps) {
  return (
    <aside
      className={`
        flex lg:min-h-dvh w-full min-w-0 flex-col items-start
        px-[clamp(20px,4.5vw,100px)] pb-[17px] justify-center
        ${className}
      `}
    >

      <div className="@container mx-auto w-full lg:max-w-[650px] max-w-[360px] min-w-[360px] p-2 text-[clamp(80%,90vw,100%)]">
        <h1 className="
        m-0 lg:text-[clamp(2.8rem,3vw,4.5rem)] text-[clamp(2em,3vw,3rem)] font-medium 
        lg:leading-[clamp(40px,4.5vw,65px)] leading-[35px] 
        text-[#181818] [word-spacing:-0.2em]">
          Plan your{" "}
          <span className="text-(--blue) font-bold lg:text-[clamp(3rem,3.2vw,4.5rem)] text-[clamp(2.2rem,3.5vw,3rem)]">UF</span> degree
          with{" "}
          <span className="text-(--orange) font-bold underline lg:text-[clamp(3rem,3.2vw,4.5rem)] text-[clamp(2.2rem,3.5vw,3rem)]">
            confidence
          </span>
          .
        </h1>

        <p className="mb-0 mt-[10px] lg:text-[clamp(0.75rem,1.4vw,1rem)] text-[clamp(0.75rem,1.2vw,1rem)] font-normal leading-6 text-[#777777]">
          Degree audits, schedules, and recommendations computed from UF
          requirements, explained in plain language.
        </p>
      </div>
    </aside>
  );
}
