import { useMemo, useState } from "react";
import { Check, UserPlus } from "lucide-react";
import type { ToastType } from "../../App";
import type { Client } from "../../types";
import AddClientModal from "./AddClientModal";

interface ClientAutocompleteProps {
  label: string;
  placeholder?: string;
  clients: Client[];
  query: string;
  selectedId: string;
  onQueryChange: (q: string) => void;
  onSelect: (client: Client) => void;
  showAddClientButton?: boolean;
  addClientLinkLabel?: string;
  modalSubmitLabel?: string;
  toast?: (msg: string, type?: ToastType) => void;
}

export default function ClientAutocomplete({
  label,
  placeholder = "Начните вводить фамилию или имя...",
  clients,
  query,
  selectedId,
  onQueryChange,
  onSelect,
  showAddClientButton = false,
  addClientLinkLabel = "Добавить клиента",
  modalSubmitLabel = "Внести в базу",
  toast,
}: ClientAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [addModalOpen, setAddModalOpen] = useState(false);

  const suggestions = useMemo(() => {
    if (!query.trim() || selectedId) return [];
    const q = query.toLowerCase();
    return clients
      .filter((c) => `${c.firstName} ${c.lastName} ${c.lastName} ${c.firstName}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, clients, selectedId]);

  const select = (c: Client) => {
    onSelect(c);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(suggestions[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && suggestions.length > 0;

  return (
    <div className="field-stack relative">
      <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          placeholder={placeholder}
          className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 pr-9 text-sm transition-all"
          role="combobox"
          aria-expanded={showList}
        />
        {selectedId && (
          <Check className="w-4 h-4 text-indigo-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        )}
      </div>
      {showList && (
        <div className="absolute left-0 right-0 top-full bg-white border border-slate-200 rounded-lg shadow-lg z-50 mt-1 overflow-hidden">
          {suggestions.map((s, i) => (
            <div
              key={s.id}
              // onMouseDown fires before input blur, so the click is not swallowed
              onMouseDown={(e) => {
                e.preventDefault();
                select(s);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`cursor-pointer px-3.5 py-2.5 text-slate-800 text-sm border-b border-slate-50 last:border-0 transition-colors ${
                i === highlight ? "bg-indigo-50" : ""
              }`}
            >
              {s.lastName} {s.firstName}
            </div>
          ))}
        </div>
      )}

      {showAddClientButton && toast && (
        <>
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer mt-0.5"
          >
            <UserPlus className="w-3 h-3" />
            {addClientLinkLabel}
          </button>
          <AddClientModal
            open={addModalOpen}
            onClose={() => setAddModalOpen(false)}
            toast={toast}
            submitLabel={modalSubmitLabel}
            onSuccess={(client) => {
              onSelect(client);
            }}
          />
        </>
      )}
    </div>
  );
}
