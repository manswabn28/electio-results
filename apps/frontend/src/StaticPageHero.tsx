import type { ReactNode } from "react";

type StaticPageHeroProps = {
  eyebrow?: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
};

export function StaticPageHero({ eyebrow, title, subtitle, actions }: StaticPageHeroProps) {
  return (
    <section className="overflow-hidden border-b border-white/10 bg-[radial-gradient(circle_at_left,rgba(249,115,22,0.18),transparent_32%),radial-gradient(circle_at_right,rgba(34,197,94,0.16),transparent_30%),linear-gradient(160deg,#020617,#0f172a_46%,#08111f)] text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            {eyebrow ? (
              <div className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-300">
                {eyebrow}
              </div>
            ) : null}
            <h1 className="mt-3 text-4xl font-black tracking-tight text-white sm:text-5xl">
              {title}
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-300 sm:text-lg">
              {subtitle}
            </p>
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </div>
    </section>
  );
}
