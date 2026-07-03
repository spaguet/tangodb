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

export default function App() {
  const { locale, t, setLocale } = useI18n();

  return (
    <div className="min-h-screen flex flex-col">
      <Header locale={locale} onLocaleChange={setLocale} t={t} />
      <main className="flex-1">
        <Hero t={t} />
        <TrustSection t={t} />
        <Features t={t} />
        <ModularitySection t={t} />
        <DemoSection locale={locale} t={t} />
        <CrmCapabilities t={t} />
        <PlatformSection locale={locale} t={t} />
        <PricingSection t={t} />
        <FaqSection t={t} />
      </main>
      <Footer t={t} />
    </div>
  );
}
