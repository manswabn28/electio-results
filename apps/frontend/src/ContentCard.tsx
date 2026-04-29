import type { ReactNode } from "react";

type ContentCardProps = {
  title?: string;
  children: ReactNode;
  className?: string;
};

export function ContentCard({ title, children, className = "" }: ContentCardProps) {
  return (
    <section className={`rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_18px_40px_rgba(15,23,42,0.08)] sm:p-7 ${className}`}>
      {title ? <h2 className="text-xl font-black tracking-tight text-zinc-950">{title}</h2> : null}
      <div className={title ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
