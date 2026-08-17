import { Archive, FileText, RotateCcw, Search, Send, UserPlus, Users, X } from "lucide-react";
import { useState } from "react";
import type { Locale } from "../../i18n";
import PageTabs, { pageTabPanelCls } from "../PageTabs";
import { archivedClients, demoClients, type DemoClient } from "../data";
import { panelStrings } from "../panelStrings";
import { fieldCls, labelCls } from "../styles";

type Tab = "active" | "archive";

type Props = { locale: Locale };

function ClientCardModal({ client, locale, onClose }: { client: DemoClient; locale: Locale; onClose: () => void }) {
  const p = panelStrings(locale);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">
            {client.firstName} {client.lastName}
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-50 rounded-lg cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm demo-field-disabled">
          <div>
            <p className={labelCls}>{p.phone}</p>
            <p className="text-slate-700 mt-0.5">{client.phone}</p>
          </div>
          {client.email && (
            <div>
              <p className={labelCls}>{p.email}</p>
              <p className="text-slate-700 mt-0.5">{client.email}</p>
            </div>
          )}
          {client.telegram && (
            <div>
              <p className={labelCls}>{p.telegram}</p>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 mt-0.5 bg-[#229ED9]/10 text-[#1C82B4] rounded-md text-xs">
                <Send className="w-3 h-3" />
                {client.telegram.replace("https://t.me/", "@")}
              </span>
            </div>
          )}
          {client.note && (
            <div className="border-t border-slate-100 pt-3">
              <p className={labelCls}>{p.notes}</p>
              <p className="text-slate-600 text-xs mt-1 bg-slate-50 rounded-lg p-2 border border-slate-100">{client.note}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ClientsPanel({ locale }: Props) {
  const p = panelStrings(locale);
  const [tab, setTab] = useState<Tab>("active");
  const [cardClient, setCardClient] = useState<DemoClient | null>(null);
  const tabs = [
    { id: "active", label: locale === "ru" ? "Активные" : "Active", icon: Users },
    { id: "archive", label: locale === "ru" ? "Архив" : "Archive", icon: Archive },
  ];

  return (
    <div id="panel-newClient" className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      <div className="lg:col-span-4 bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack demo-field-disabled">
        <div className="flex items-center gap-2.5 text-slate-800 border-b border-slate-100 pb-3">
          <UserPlus className="w-4.5 h-4.5 text-indigo-500" />
          <h2 className="text-base font-semibold tracking-tight">{p.clientsAdd}</h2>
        </div>
        <div className="panel-form-stack font-sans space-y-3">
          <div className="field-stack">
            <label className={labelCls}>{p.firstName}</label>
            <input disabled className={fieldCls} placeholder="Elena" />
          </div>
          <div className="field-stack">
            <label className={labelCls}>{p.lastName}</label>
            <input disabled className={fieldCls} placeholder="Vasquez" />
          </div>
          <div className="field-stack">
            <label className={labelCls}>{p.phone}</label>
            <input disabled className={fieldCls} />
          </div>
          <div className="field-stack">
            <label className={labelCls}>{p.email}</label>
            <input disabled className={fieldCls} />
          </div>
          <button type="button" disabled className="w-full py-3 bg-indigo-600/50 text-white text-xs font-semibold uppercase tracking-widest rounded-lg cursor-not-allowed">
            {p.addSubmit}
          </button>
        </div>
      </div>

      <div className="lg:col-span-8 flex flex-col">
        <PageTabs tabs={tabs} activeTab={tab} onChange={setTab} />
        <div className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack ${pageTabPanelCls(tab, "active")}`}>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5 text-slate-800">
              <FileText className="w-4.5 h-4.5 text-indigo-500" />
              <h2 className="text-base font-semibold tracking-tight">{tab === "active" ? p.listActive : p.listArchive}</h2>
              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-semibold">
                {tab === "active" ? demoClients.length : archivedClients.length}
              </span>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input disabled placeholder={p.search} className={`${fieldCls} pl-10 text-xs`} />
            </div>
          </div>

          <div className="overflow-x-auto min-h-[200px]">
            {tab === "active" ? (
              <table className="w-full font-sans text-slate-700 text-left">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] uppercase text-slate-400 tracking-wider">
                    <th className="pb-3 pl-2 pr-8 font-semibold w-12">#</th>
                    <th className="pb-3 font-semibold">{p.tableName}</th>
                    <th className="pb-3 font-semibold text-center">{p.tableContact}</th>
                    <th className="pb-3 text-right pr-2 font-semibold">{p.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {demoClients.map((c, i) => (
                    <tr
                      key={c.id}
                      className="border-b border-slate-50 hover:bg-slate-50 transition-colors text-sm group cursor-pointer"
                      onClick={() => setCardClient(c)}
                    >
                      <td className="py-3 pl-2 text-slate-400 text-xs">{i + 1}</td>
                      <td className="py-3 font-semibold text-slate-800">
                        {c.lastName} {c.firstName}
                      </td>
                      <td className="py-3 text-center">
                        {c.telegram ? (
                          <span className="inline-flex p-1.5 bg-[#229ED9]/10 text-[#1C82B4] rounded-md">
                            <Send className="w-3.5 h-3.5" />
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">{c.phone}</span>
                        )}
                      </td>
                      <td className="py-3 text-right pr-2 text-slate-300 text-xs">{p.cardTitle}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full font-sans text-slate-700 text-left">
                <tbody>
                  {archivedClients.map((c) => (
                    <tr key={c.id} className="border-b border-slate-50 text-sm opacity-70">
                      <td className="py-3 pl-2 font-semibold">{c.lastName} {c.firstName}</td>
                      <td className="py-3 text-xs text-slate-400 text-right">
                        <span className="inline-flex items-center gap-1">
                          <RotateCcw className="w-3 h-3" />
                          {c.archivedAt}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {cardClient && <ClientCardModal client={cardClient} locale={locale} onClose={() => setCardClient(null)} />}
    </div>
  );
}
