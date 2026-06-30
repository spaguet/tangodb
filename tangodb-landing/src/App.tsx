import { DemoSection } from "./components/DemoSection";
import { Features } from "./components/Features";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { PlatformSection } from "./components/PlatformSection";
import { useI18n } from "./hooks/useI18n";

export default function App() {
  const { locale, t, setLocale } = useI18n();

  return (
    <div className="min-h-screen flex flex-col">
      <Header locale={locale} onLocaleChange={setLocale} t={t} />
      <main className="flex-1">
        <Hero t={t} />
        <Features t={t} />
        <PlatformSection t={t} />
        <DemoSection locale={locale} t={t} />
      </main>
      <Footer t={t} />
    </div>
  );
}
