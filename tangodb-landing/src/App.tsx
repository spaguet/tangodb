import { AudienceSection } from "./components/AudienceSection";

import { CrmCapabilities } from "./components/CrmCapabilities";

import { DemoSection } from "./components/DemoSection";

import { Features } from "./components/Features";

import { Footer } from "./components/Footer";

import { Header } from "./components/Header";

import { Hero } from "./components/Hero";

import { ModularitySection } from "./components/ModularitySection";

import { PlatformSection } from "./components/PlatformSection";

import { FaqSection } from "./components/FaqSection";

import { PricingSection } from "./components/PricingSection";

import { TrustSection } from "./components/TrustSection";

import { useI18n } from "./hooks/useI18n";
import { PRIVACY_PATH } from "./config";
import { PrivacyPage } from "./components/PrivacyPage";
import { useLandingAnalytics } from "./hooks/useLandingAnalytics";



export default function App() {

  const { locale, t, setLocale } = useI18n();

  useLandingAnalytics(locale);

  const normalizedPath = window.location.pathname.replace(/\/$/, "") || "/";
  const isPrivacyPage = normalizedPath === PRIVACY_PATH;

  if (isPrivacyPage) {
    return <PrivacyPage locale={locale} onLocaleChange={setLocale} t={t} />;
  }



  return (

    <div className="min-h-screen flex flex-col">

      <Header locale={locale} onLocaleChange={setLocale} t={t} />

      <main className="flex-1">

        <Hero locale={locale} t={t} />

        <TrustSection locale={locale} t={t} />

        <Features locale={locale} t={t} />

        <AudienceSection t={t} />

        <PricingSection locale={locale} t={t} />

        <DemoSection locale={locale} t={t} />

        <CrmCapabilities locale={locale} t={t} />

        <ModularitySection t={t} />

        <PlatformSection locale={locale} t={t} />

        <FaqSection locale={locale} t={t} />

      </main>

      <Footer locale={locale} t={t} />

    </div>

  );

}

