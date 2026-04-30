import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Mail, MessageSquareWarning, Wrench } from "lucide-react";
import { trackPageView } from "./analytics";
import { ContentCard } from "./ContentCard";
import { Footer } from "./Footer";
import { SeoMeta } from "./SeoMeta";
import { StaticPageHero } from "./StaticPageHero";

type ContactUsPageProps = {
  onBack: () => void;
  onNavigate: (path: string) => void;
};

const CONTACT_EMAIL = "support@results.onekeralam.in";

export function ContactUsPage({ onBack, onNavigate }: ContactUsPageProps) {
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const title = "Contact Us | OneKerala Results";
    trackPageView(title);
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950">
      <SeoMeta
        title="Contact Us | OneKerala Results"
        description="Contact OneKerala Results for feedback, corrections, technical issues, legal concerns, or suggestions."
        path="/contact-us"
      />
      <StaticPageHero
        eyebrow="Contact Us"
        title="Contact Us"
        subtitle="We welcome feedback, corrections, suggestions, and genuine inquiries."
        actions={
          <button
            className="inline-flex items-center rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
            onClick={onBack}
            type="button"
          >
            Back to Live Dashboard
          </button>
        }
      />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-6">
            <ContentCard>
              <div className="space-y-5 text-base leading-8 text-zinc-700">
                <p>Thank you for using OneKerala Results.</p>
                <p>
                  If you notice an issue, have a suggestion, want to report an incorrect display, or need to contact us for any genuine reason, please reach out.
                </p>
                <p>You may contact us regarding:</p>
                <ul className="grid gap-3 sm:grid-cols-2">
                  <Bullet>technical issues</Bullet>
                  <Bullet>incorrect or outdated data display</Bullet>
                  <Bullet>broken pages or links</Bullet>
                  <Bullet>constituency or candidate information corrections</Bullet>
                  <Bullet>feature suggestions</Bullet>
                  <Bullet>feedback about user experience</Bullet>
                  <Bullet>legal or compliance concerns</Bullet>
                  <Bullet>media or collaboration inquiries</Bullet>
                </ul>
              </div>
            </ContentCard>

            <ContentCard title="Correction Requests">
              <div className="space-y-4 text-base leading-8 text-zinc-700">
                <p>
                  If you believe any information shown on the platform is inaccurate, outdated, incomplete, or misleading, please contact us with:
                </p>
                <ul className="grid gap-3 sm:grid-cols-2">
                  <Bullet>page link</Bullet>
                  <Bullet>constituency name</Bullet>
                  <Bullet>election name</Bullet>
                  <Bullet>issue description</Bullet>
                  <Bullet>reference source if available</Bullet>
                </ul>
                <p>We will make reasonable efforts to review genuine correction requests.</p>
              </div>
            </ContentCard>

            <ContentCard title="Response Note">
              <p className="text-base leading-8 text-zinc-700">
                This is an independently maintained project. We will try to respond to genuine inquiries as time permits, but immediate responses cannot be guaranteed.
              </p>
              <p className="mt-4 text-base font-semibold leading-8 text-zinc-800">
                Your feedback helps improve the platform and make election information easier for users to follow.
              </p>
            </ContentCard>
          </div>

          <div className="space-y-6">
            <ContentCard>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="mt-1 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-black uppercase tracking-[0.2em] text-zinc-500">Primary contact email</div>
                    <a className="mt-2 inline-block text-lg font-black text-zinc-950 hover:text-amber-700" href={`mailto:${CONTACT_EMAIL}`}>
                      {CONTACT_EMAIL}
                    </a>
                  </div>
                </div>
                <a
                  className="inline-flex w-full items-center justify-center rounded-md bg-amber-500 px-4 py-3 text-sm font-black text-zinc-950 transition hover:bg-amber-400"
                  href={`mailto:${CONTACT_EMAIL}`}
                >
                  Email Us
                </a>
              </div>
            </ContentCard>

            <ContentCard title="Contact form">
              <form className="space-y-4" onSubmit={handleSubmit}>
                <LabeledField id="contact-name" label="Name">
                  <input className="h-11 w-full rounded-xl border border-zinc-300 px-3 text-sm text-zinc-950 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-200" id="contact-name" name="name" type="text" />
                </LabeledField>
                <LabeledField id="contact-email" label="Email">
                  <input className="h-11 w-full rounded-xl border border-zinc-300 px-3 text-sm text-zinc-950 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-200" id="contact-email" name="email" type="email" />
                </LabeledField>
                <LabeledField id="contact-subject" label="Subject">
                  <input className="h-11 w-full rounded-xl border border-zinc-300 px-3 text-sm text-zinc-950 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-200" id="contact-subject" name="subject" type="text" />
                </LabeledField>
                <LabeledField id="contact-message" label="Message">
                  <textarea className="min-h-36 w-full rounded-2xl border border-zinc-300 px-3 py-3 text-sm text-zinc-950 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-200" id="contact-message" name="message" />
                </LabeledField>
                <button className="inline-flex w-full items-center justify-center rounded-md bg-zinc-950 px-4 py-3 text-sm font-black text-white transition hover:bg-zinc-800" type="submit">
                  Submit
                </button>
                {submitted ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
                    Thank you. Please contact us directly at support@results.onekeralam.in for now.
                  </div>
                ) : null}
              </form>
            </ContentCard>

            <div className="grid gap-4 sm:grid-cols-2">
              <InfoMiniCard icon={Wrench} title="Technical issues" body="Share the page link, browser, and what broke so we can reproduce the problem faster." />
              <InfoMiniCard icon={MessageSquareWarning} title="Legal or corrections" body="Include the exact election, constituency, and source reference whenever possible." />
            </div>
          </div>
        </div>
      </main>

      <Footer navigate={onNavigate} />
    </div>
  );
}

function LabeledField({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-2 block text-sm font-black text-zinc-800" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

function InfoMiniCard({
  icon: Icon,
  title,
  body
}: {
  icon: typeof Mail;
  title: string;
  body: string;
}) {
  return (
    <ContentCard className="h-full">
      <div className="flex items-start gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-base font-black text-zinc-950">{title}</div>
          <p className="mt-2 text-sm leading-7 text-zinc-600">{body}</p>
        </div>
      </div>
    </ContentCard>
  );
}

function Bullet({ children }: { children: string }) {
  return (
    <li className="flex gap-3 text-base leading-7 text-zinc-700">
      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}
