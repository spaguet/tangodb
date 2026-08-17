import {
  BookOpen,
  Building2,
  Database,
  KeyRound,
  MapPin,
  Settings,
  Ticket,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Locale } from "../../i18n";
import type { SettingsSection } from "../../lib/demoDeepLink";
import { disciplines, locations, settingsGeneral, STUDIO_NAME } from "../data";
import { panelStrings } from "../panelStrings";
import { fieldCls, labelCls } from "../styles";

type Section = SettingsSection;

type Props = { locale: Locale; initialSection?: Section };

export function SettingsPanel({ locale, initialSection }: Props) {
  const p = panelStrings(locale);
  const [section, setSection] = useState<Section>(initialSection ?? "general");

  useEffect(() => {
    if (initialSection) setSection(initialSection);
  }, [initialSection]);

  const nav = [
    { id: "general" as const, label: p.settingsGeneral, icon: Settings },
    { id: "organization" as const, label: p.settingsOrganization, icon: Building2 },
    { id: "subscriptions" as const, label: p.settingsSubscriptions, icon: Ticket },
    { id: "disciplines" as const, label: p.settingsDisciplines, icon: BookOpen },
    { id: "locations" as const, label: p.settingsLocations, icon: MapPin },
    { id: "data" as const, label: p.settingsData, icon: Database },
    { id: "license" as const, label: p.settingsLicense, icon: KeyRound },
  ];

  return (
    <div className="flex flex-col lg:flex-row gap-5 lg:gap-8">
      <nav className="lg:w-52 shrink-0">
        <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold px-1 mb-2">
          {p.settingsNav}
        </p>
        <div className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  active
                    ? "bg-gold-50 text-gold-700 border border-gold-100"
                    : "text-ink-600 hover:bg-ink-50 border border-transparent"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex-1 min-w-0 demo-field-disabled">
        {section === "general" && (
          <div className="panel-card-stack max-w-xl">
            <div>
              <h2 className="text-base font-semibold text-ink-900">{p.generalTitle}</h2>
              <p className="text-xs text-ink-500 mt-1">{p.generalSubtitle}</p>
            </div>
            <div className="bg-white rounded-xl border border-ink-200 shadow-xs p-4 space-y-4 font-sans">
              {(
                [
                  [p.locale, settingsGeneral.locale],
                  [p.currency, settingsGeneral.currency],
                  [p.currencyDisplay, settingsGeneral.currencyDisplay],
                  [p.timezone, settingsGeneral.timezone],
                  [p.weekStart, settingsGeneral.weekStart],
                  [p.branding, settingsGeneral.branding],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="field-stack">
                  <label className={labelCls}>{label}</label>
                  <div className={fieldCls + " bg-ink-50"}>{value}</div>
                </div>
              ))}
              <p className="text-xs text-ink-500 bg-ink-50 rounded-lg px-3 py-2">{p.currencyPreview}</p>
              <button type="button" disabled className="w-full py-2.5 bg-gold-600/40 text-white text-xs font-semibold uppercase tracking-wider rounded-lg cursor-not-allowed">
                {locale === "ru" ? "Сохранить" : "Save"}
              </button>
            </div>
          </div>
        )}

        {section === "organization" && (
          <div className="panel-card-stack max-w-xl">
            <div>
              <h2 className="text-base font-semibold text-ink-900">{p.orgTitle}</h2>
              <p className="text-xs text-ink-500 mt-1">{p.orgSubtitle}</p>
            </div>
            <div className="bg-white rounded-xl border border-ink-200 shadow-xs p-4 space-y-3">
              <div className="field-stack">
                <label className={labelCls}>{p.orgName}</label>
                <div className={fieldCls + " bg-ink-50"}>{STUDIO_NAME}</div>
              </div>
              <div className="space-y-2 pt-2">
                {[
                  locale === "ru" ? "Групповые абонементы" : "Group subscriptions",
                  locale === "ru" ? "Персональные уроки" : "Private lessons",
                  locale === "ru" ? "Финансы" : "Finance",
                  locale === "ru" ? "Парные форматы" : "Pair formats",
                ].map((mod) => (
                  <label key={mod} className="flex items-center gap-2 text-sm text-ink-700">
                    <input type="checkbox" checked disabled className="rounded border-ink-300 text-gold-700" />
                    {mod}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        {section === "subscriptions" && (
          <div className="panel-card-stack max-w-xl">
            <div>
              <h2 className="text-base font-semibold text-ink-900">{p.subsTitle}</h2>
              <p className="text-xs text-ink-500 mt-1">{p.subsSubtitle}</p>
            </div>
            <div className="bg-white rounded-xl border border-ink-200 shadow-xs p-4 space-y-4 font-sans">
              <label className="flex items-start gap-2 text-sm text-ink-700">
                <input type="checkbox" checked disabled className="mt-0.5 rounded border-ink-300 text-gold-700" />
                <span>
                  <span className="font-medium">{p.freezeEnabled}</span>
                  <p className="text-xs text-ink-500 mt-1 leading-relaxed">{p.freezeEnabledDesc}</p>
                </span>
              </label>
              <div className="space-y-4">
                <div className="field-stack">
                  <label className={labelCls}>{p.freezeMax}</label>
                  <div className={fieldCls + " bg-ink-50"}>1</div>
                </div>
                <div className="field-stack">
                  <label className={labelCls}>{p.freezeMin}</label>
                  <div className={fieldCls + " bg-ink-50"}>8</div>
                </div>
                <p className="text-xs text-ink-500 bg-ink-50 rounded-lg px-3 py-2">
                  {p.policySummary.replace("{max}", "1").replace("{min}", "8")}
                </p>
              </div>
              <button type="button" disabled className="w-full py-2.5 bg-gold-600/40 text-white text-xs font-semibold uppercase tracking-wider rounded-lg cursor-not-allowed">
                {locale === "ru" ? "Сохранить" : "Save"}
              </button>
            </div>
          </div>
        )}

        {section === "disciplines" && (
          <div className="panel-card-stack max-w-xl">
            <h2 className="text-base font-semibold text-ink-900">{p.disciplinesTitle}</h2>
            <div className="bg-white rounded-xl border border-ink-200 shadow-xs divide-y divide-ink-100">
              {disciplines.map((d) => (
                <div key={d} className="px-4 py-3 flex items-center justify-between text-sm">
                  <span className="font-medium text-ink-800">{d}</span>
                  <span className="text-[10px] text-ink-500 uppercase font-semibold">Active</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === "locations" && (
          <div className="panel-card-stack max-w-xl">
            <h2 className="text-base font-semibold text-ink-900">{p.locationsTitle}</h2>
            <div className="bg-white rounded-xl border border-ink-200 shadow-xs divide-y divide-ink-100">
              {locations.map((loc) => (
                <div key={loc.name} className="px-4 py-3">
                  <p className="text-sm font-semibold text-ink-800">{loc.name}</p>
                  <p className="text-xs text-ink-500 mt-0.5">{loc.address}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === "data" && (
          <div className="panel-card-stack max-w-xl">
            <h2 className="text-base font-semibold text-ink-900">{p.dataTitle}</h2>
            <div className="bg-white rounded-xl border border-ink-200 shadow-xs p-4 space-y-3">
              <p className="text-sm text-ink-600">{p.dataHint}</p>
              <button type="button" disabled className="px-4 py-2 bg-gold-600/40 text-white text-xs font-semibold rounded-lg cursor-not-allowed">
                {p.exportBtn}
              </button>
            </div>
          </div>
        )}

        {section === "license" && (
          <div className="panel-card-stack max-w-xl">
            <h2 className="text-base font-semibold text-ink-900">{p.licenseTitle}</h2>
            <div className="bg-white rounded-xl border border-ink-200 shadow-xs p-4">
              <div className="flex items-center gap-2 text-gold-700">
                <Ticket className="w-5 h-5" />
                <p className="text-sm font-semibold">{p.licenseActive}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
