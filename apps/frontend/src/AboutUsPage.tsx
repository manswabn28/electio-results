import { useEffect } from "react";
import { Coins, Focus, Landmark, ShieldCheck } from "lucide-react";
import { applySeo } from "./seo";
import { trackPageView } from "./analytics";
import { ContentCard } from "./ContentCard";
import { Footer } from "./Footer";
import { StaticPageHero } from "./StaticPageHero";

type AboutUsPageProps = {
  onBack: () => void;
  onNavigate: (path: string) => void;
};

const MISSION_CARDS = [
  {
    title: "Free for Users",
    body: "The platform is available free of charge and was created for public usefulness.",
    icon: Coins
  },
  {
    title: "Independent",
    body: "This project is not affiliated with any political party, media group, government body, or election authority.",
    icon: ShieldCheck
  },
  {
    title: "Official-Source Based",
    body: "Result information is based on publicly available official election result sources wherever available.",
    icon: Landmark
  },
  {
    title: "Personalized Tracking",
    body: "Users can focus on the constituencies, candidates, and contests they care about most.",
    icon: Focus
  }
] as const;

export function AboutUsPage({ onBack, onNavigate }: AboutUsPageProps) {
  useEffect(() => {
    const title = "About Us | OneKerala Results";
    const description =
      "Learn about OneKerala Results, an independent, free, self-funded election results tracking platform built to make official election result information easier to follow.";
    applySeo({
      title,
      description,
      path: "/about-us",
      ogTitle: title,
      ogDescription: description
    });
    trackPageView(title);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-950">
      <StaticPageHero
        eyebrow="About Us"
        title="About OneKerala Results"
        subtitle="An independent, free, and user-friendly election results tracker built to help people follow the constituencies that matter to them."
        actions={<BackToDashboardButton onBack={onBack} />}
      />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <ContentCard>
          <div className="space-y-5 text-base leading-8 text-zinc-700">
            <p>
              OneKerala Results is an independent election results tracking platform created out of personal curiosity, passion for technology, and interest in making public election information easier to follow.
            </p>
            <p>
              This platform was built with a simple goal: to help users track election results in a cleaner, faster, and more personalized way.
            </p>
            <p>
              Traditional election coverage can be noisy. Official result websites are important and authoritative, but they may not always be easy for every user to follow quickly on mobile. Many people only care about a few constituencies, hometown seats, candidates, or close contests. OneKerala Results is designed to make that experience simpler.
            </p>
          </div>
        </ContentCard>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {MISSION_CARDS.map((item) => {
            const Icon = item.icon;
            return (
              <ContentCard key={item.title} className="h-full">
                <div className="flex h-full flex-col gap-4">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="text-lg font-black text-zinc-950">{item.title}</div>
                  <p className="text-sm leading-7 text-zinc-600">{item.body}</p>
                </div>
              </ContentCard>
            );
          })}
        </div>

        <ContentCard title="Our purpose">
          <ul className="grid gap-3 text-base leading-7 text-zinc-700 sm:grid-cols-2">
            <Bullet>make official election result information easier to understand</Bullet>
            <Bullet>help users track selected constituencies and candidates</Bullet>
            <Bullet>reduce noise from large result dashboards</Bullet>
            <Bullet>provide mobile-friendly live result views</Bullet>
            <Bullet>highlight close contests and important result changes</Bullet>
            <Bullet>offer shareable election updates for public convenience</Bullet>
          </ul>
        </ContentCard>

        <ContentCard title="What this project is">
          <ul className="grid gap-3 text-base leading-7 text-zinc-700">
            <Bullet>independently created</Bullet>
            <Bullet>completely free for users</Bullet>
            <Bullet>self-funded, including hosting and domain costs</Bullet>
            <Bullet>built out of personal interest and public usefulness</Bullet>
            <Bullet>not operated for profit</Bullet>
            <Bullet>not affiliated with any political party, candidate, media organization, government authority, or the Election Commission of India</Bullet>
          </ul>
        </ContentCard>

        <ContentCard title="Data Source Transparency">
          <div className="space-y-4 text-base leading-8 text-zinc-700">
            <p>
              Election result information shown on OneKerala Results is based on publicly available official election result sources, including result pages and statistical information published by the Election Commission of India wherever available.
            </p>
            <p>
              The Election Commission of India is the official constitutional authority responsible for conducting and administering elections in India. Final official results and certified declarations remain with the competent election authorities.
            </p>
            <p>
              While we make reasonable efforts to present information accurately and quickly, users should always verify final and legally binding results from official sources.
            </p>
          </div>
        </ContentCard>

        <ContentCard title="Why This Platform Exists">
          <div className="space-y-4 text-base leading-8 text-zinc-700">
            <p>
              OneKerala Results exists because many users want a focused result experience. They may want to quickly check:
            </p>
            <ul className="grid gap-3 sm:grid-cols-2">
              <Bullet>their own constituency</Bullet>
              <Bullet>their hometown seat</Bullet>
              <Bullet>a favorite candidate</Bullet>
              <Bullet>close battles</Bullet>
              <Bullet>party-wise trends</Bullet>
              <Bullet>previous election history</Bullet>
              <Bullet>final winning margins</Bullet>
            </ul>
            <p>
              The platform is designed as a public utility and second-screen companion, not as a replacement for official sources or professional media coverage.
            </p>
          </div>
        </ContentCard>

        <ContentCard title="Our Commitment">
          <ul className="grid gap-3 text-base leading-7 text-zinc-700 sm:grid-cols-2">
            <Bullet>a clean and simple user experience</Bullet>
            <Bullet>fast and readable result updates</Bullet>
            <Bullet>transparent source disclosure</Bullet>
            <Bullet>politically neutral presentation</Bullet>
            <Bullet>free access for users</Bullet>
            <Bullet>useful shareable result pages</Bullet>
          </ul>
          <p className="mt-5 text-base font-semibold text-zinc-800">
            Built independently with passion. Offered freely for public use.
          </p>
        </ContentCard>
      </main>

      <Footer navigate={onNavigate} />
    </div>
  );
}

function BackToDashboardButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      className="inline-flex items-center rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
      onClick={onBack}
      type="button"
    >
      Back to Live Dashboard
    </button>
  );
}

function Bullet({ children }: { children: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}
