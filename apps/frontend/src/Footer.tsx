type FooterProps = {
  navigate?: (path: string) => void;
};

const FOOTER_LINKS = [
  { href: "/about-us", label: "About Us" },
  { href: "/contact-us", label: "Contact Us" },
  { href: "/terms-and-conditions", label: "Terms & Conditions" }
] as const;

export function Footer({ navigate }: FooterProps) {
  return (
    <footer className="border-t border-white/10 bg-[linear-gradient(180deg,#0b1220,#050816)] text-zinc-200">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-8 text-center sm:px-6 lg:px-8 lg:py-10 lg:text-left">
        <div className="flex flex-col items-center justify-between gap-4 lg:flex-row lg:items-start">
          <div className="max-w-sm">
            <div className="text-sm font-semibold text-zinc-100">
              © 2026 OneKerala Results. All rights reserved.
            </div>
          </div>

          <nav
            className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
            aria-label="Footer navigation"
          >
            {FOOTER_LINKS.map((link) => (
              <a
                key={link.href}
                className="text-sm font-semibold text-zinc-300 transition hover:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                href={link.href}
                onClick={(event) => {
                  if (!navigate) return;
                  event.preventDefault();
                  navigate(link.href);
                }}
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="max-w-sm text-sm font-medium leading-6 text-zinc-400 lg:text-right">
            Independent platform. Verify final results with official sources.
          </div>
        </div>

        <div className="border-t border-white/10 pt-4 text-xs leading-6 text-zinc-500">
          Election data is based on publicly available official election result sources wherever available.
        </div>
      </div>
    </footer>
  );
}
