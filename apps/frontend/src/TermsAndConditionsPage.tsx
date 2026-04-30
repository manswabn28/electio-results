import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { trackPageView } from "./analytics";
import { ContentCard } from "./ContentCard";
import { Footer } from "./Footer";
import { SeoMeta } from "./SeoMeta";
import { StaticPageHero } from "./StaticPageHero";

type TermsAndConditionsPageProps = {
  onBack: () => void;
  onNavigate: (path: string) => void;
};

type TermsSection = {
  id: string;
  title: string;
  body: string[];
};

const TERMS_SECTIONS: TermsSection[] = [
  {
    id: "acceptance-of-terms",
    title: "Acceptance of Terms",
    body: [
      "By accessing or using OneKerala Results, you agree to these Terms and Conditions. If you do not agree with these terms, please discontinue use of the website."
    ]
  },
  {
    id: "nature-of-service",
    title: "Nature of the Service",
    body: [
      "OneKerala Results is an independent election information platform that provides election-related result summaries, constituency pages, candidate information, visualizations, shareable graphics, live-style updates, historical context, and related public information.",
      "The service is provided free of charge for public convenience."
    ]
  },
  {
    id: "independent-platform",
    title: "Independent Platform",
    body: [
      "OneKerala Results is independently created and maintained.",
      "The platform is not affiliated with, endorsed by, sponsored by, or officially connected to the Election Commission of India, any State Election Commission, any government department or authority, any political party, any candidate, any campaign organization, any television channel, any newspaper, or any media organization.",
      "Any references to election authorities, political parties, candidates, constituencies, or public institutions are for informational purposes only."
    ]
  },
  {
    id: "data-sources",
    title: "Data Sources",
    body: [
      "Election result information displayed on this website may be based on publicly available official election result sources, including official result pages and statistical reports published by the Election Commission of India or other competent public sources wherever available.",
      "The platform may process, summarize, reformat, visualize, or present such publicly available information in a user-friendly format."
    ]
  },
  {
    id: "official-results",
    title: "Official Results",
    body: [
      "OneKerala Results is not an official election result declaration platform.",
      "Final, certified, legally binding election results are issued only by the competent election authorities.",
      "Users should verify final results, candidate details, vote counts, margins, and declarations from official sources before relying on them for any formal, legal, journalistic, academic, political, or financial purpose."
    ]
  },
  {
    id: "accuracy-and-timeliness",
    title: "Accuracy and Timeliness",
    body: [
      "We make reasonable efforts to keep information accurate and timely. However, election result data may change frequently during counting.",
      "The website may contain delayed information, incomplete information, temporary inaccuracies, formatting errors, caching delays, source parsing issues, discrepancies caused by changes in official website structure, and interruptions due to technical issues or high traffic.",
      "We do not guarantee that all information will always be accurate, complete, current, uninterrupted, or error-free."
    ]
  },
  {
    id: "no-warranty",
    title: "No Warranty",
    body: [
      "The website and all information, features, graphics, pages, predictions, alerts, summaries, and visualizations are provided on an “as is” and “as available” basis.",
      "No warranties are provided, whether express or implied, including warranties of accuracy, reliability, availability, fitness for a particular purpose, or non-infringement."
    ]
  },
  {
    id: "prediction-disclaimer",
    title: "Prediction, Confidence Meter, and Analysis Disclaimer",
    body: [
      "Any prediction meter, confidence score, trend label, battleground classification, historical interpretation, or analysis shown on the platform is for informational and engagement purposes only.",
      "Such features are based on simple logic, available data, historical patterns, or current trends and should not be treated as guaranteed forecasts, official analysis, or professional political advice.",
      "Election outcomes can change quickly during counting."
    ]
  },
  {
    id: "limitation-of-liability",
    title: "Limitation of Liability",
    body: [
      "To the maximum extent permitted by applicable law, the owner, developer, maintainer, or operator of OneKerala Results shall not be liable for any loss, damage, claim, dispute, or consequence arising from use of the website, inability to access the website, reliance on displayed data, inaccurate or delayed information, technical errors, service interruptions, third-party source changes, shared images or links generated from the platform, or decisions made based on information displayed on the website.",
      "This includes direct, indirect, incidental, consequential, special, punitive, or similar damages."
    ]
  },
  {
    id: "user-responsibility",
    title: "User Responsibility",
    body: [
      "Users are responsible for how they interpret and use the information provided.",
      "Users should independently verify important information from official sources.",
      "Users should not misuse, misrepresent, or present platform-generated content as official certification."
    ]
  },
  {
    id: "acceptable-use",
    title: "Acceptable Use",
    body: [
      "Users agree not to attack, overload, or disrupt the website; attempt unauthorized access; misuse APIs or backend endpoints; scrape excessively or abuse automated requests; upload or transmit malicious code; impersonate the platform or its owner; use the platform for unlawful purposes; manipulate shared content to mislead others; or remove branding from generated share cards if such branding is part of the design."
    ]
  },
  {
    id: "intellectual-property",
    title: "Intellectual Property",
    body: [
      "Unless otherwise stated, the website design, custom interface, branding, original graphics, layout, code, copy, share-card designs, and user experience elements belong to the owner/operator of OneKerala Results.",
      "Election-related public data, names of candidates, names of political parties, symbols, logos, trademarks, and official information remain the property of their respective owners or authorities.",
      "Use of third-party names, party names, symbols, or references is for identification and informational purposes only."
    ]
  },
  {
    id: "third-party-links",
    title: "Third-Party Links and Services",
    body: [
      "The website may link to or rely on third-party websites, tools, analytics, hosting providers, APIs, or publicly available sources.",
      "We are not responsible for the availability, accuracy, content, policies, or practices of third-party websites or services."
    ]
  },
  {
    id: "availability-and-service-changes",
    title: "Availability and Service Changes",
    body: [
      "The website may be modified, updated, suspended, limited, or discontinued at any time without prior notice.",
      "Features may be added or removed based on technical feasibility, cost, reliability, or legal considerations."
    ]
  },
  {
    id: "privacy-and-analytics",
    title: "Privacy and Analytics",
    body: [
      "The website may collect limited technical or usage information such as device type, browser type, approximate region, visited pages, performance logs, and analytics events to improve reliability and user experience.",
      "The platform does not intend to sell personal data.",
      "If analytics, cookies, advertising, login, chat, notifications, or user accounts are added, a separate Privacy Policy may be created or updated."
    ]
  },
  {
    id: "feedback-and-submissions",
    title: "User Feedback and Submissions",
    body: [
      "If users submit feedback, suggestions, corrections, messages, or feature ideas, they grant permission for such input to be reviewed and used to improve the platform without compensation or obligation."
    ]
  },
  {
    id: "generated-share-cards",
    title: "Generated Share Cards and Public Sharing",
    body: [
      "The platform may allow users to generate and share election result cards, images, links, or summaries.",
      "Users are responsible for how they share such content. Shared cards or summaries may become outdated as counting progresses. Users should verify the latest information before resharing."
    ]
  },
  {
    id: "legal-compliance",
    title: "Legal Compliance",
    body: [
      "Users are responsible for complying with applicable laws, platform rules, election-related regulations, and public communication standards when using or sharing information from this website."
    ]
  },
  {
    id: "governing-law",
    title: "Governing Law",
    body: [
      "These Terms shall be interpreted in accordance with applicable laws of the operator’s jurisdiction, subject to mandatory legal protections that may apply.",
      "If required, disputes shall be handled by competent courts or authorities in the relevant jurisdiction."
    ]
  },
  {
    id: "contact",
    title: "Contact",
    body: [
      "For questions, corrections, concerns, or legal inquiries, contact:",
      "support@results.onekeralam.in"
    ]
  },
  {
    id: "updates-to-terms",
    title: "Updates to These Terms",
    body: [
      "These Terms and Conditions may be updated from time to time. Continued use of the website after updates means you accept the revised terms."
    ]
  }
];

export function TermsAndConditionsPage({ onBack, onNavigate }: TermsAndConditionsPageProps) {
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const effectiveDate = useMemo(
    () => new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
    []
  );

  useEffect(() => {
    const title = "Terms and Conditions | OneKerala Results";
    trackPageView(title);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950">
      <SeoMeta
        title="Terms and Conditions | OneKerala Results"
        description="Read the terms and conditions for using OneKerala Results, an independent election results information platform."
        path="/terms-and-conditions"
      />
      <StaticPageHero
        eyebrow="Terms & Conditions"
        title="Terms and Conditions"
        subtitle="Please read these terms carefully before using OneKerala Results."
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
        <ContentCard className="border-amber-200 bg-amber-50">
          <div className="flex gap-3">
            <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-black uppercase tracking-[0.2em] text-amber-900">Important disclaimer</div>
              <p className="mt-2 text-base leading-7 text-amber-950">
                This is an independent informational platform. Always verify final certified results with official election authorities.
              </p>
            </div>
          </div>
        </ContentCard>

        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <ContentCard className="lg:sticky lg:top-4">
              <div className="hidden lg:block">
                <div className="text-sm font-black uppercase tracking-[0.2em] text-zinc-500">Contents</div>
                <nav className="mt-4 space-y-2" aria-label="Terms table of contents">
                  {TERMS_SECTIONS.map((section, index) => (
                    <a key={section.id} className="block rounded-xl px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950" href={`#${section.id}`}>
                      {index + 1}. {section.title}
                    </a>
                  ))}
                </nav>
              </div>
              <div className="lg:hidden">
                <button
                  className="flex w-full items-center justify-between rounded-xl border border-zinc-200 px-3 py-3 text-left text-sm font-black text-zinc-900"
                  onClick={() => setMobileTocOpen((current) => !current)}
                  type="button"
                  aria-expanded={mobileTocOpen}
                  aria-controls="terms-mobile-toc"
                >
                  Table of contents
                  <span>{mobileTocOpen ? "−" : "+"}</span>
                </button>
                {mobileTocOpen ? (
                  <nav className="mt-3 space-y-2" id="terms-mobile-toc" aria-label="Terms table of contents">
                    {TERMS_SECTIONS.map((section, index) => (
                      <a key={section.id} className="block rounded-xl bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700" href={`#${section.id}`}>
                        {index + 1}. {section.title}
                      </a>
                    ))}
                  </nav>
                ) : null}
              </div>
            </ContentCard>
          </aside>

          <div className="space-y-6">
            <ContentCard>
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Effective Date: {effectiveDate}
              </div>
            </ContentCard>

            {TERMS_SECTIONS.map((section, index) => (
              <ContentCard key={section.id} className="scroll-mt-6" title={`${index + 1}. ${section.title}`}>
                <div id={section.id} className="space-y-4 text-base leading-8 text-zinc-700">
                  {section.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </ContentCard>
            ))}
          </div>
        </div>
      </main>

      <Footer navigate={onNavigate} />
    </div>
  );
}
