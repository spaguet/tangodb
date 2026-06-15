import { create } from "zustand";
import { currentYearMonth } from "../lib/utils";

interface UIState {
  selectedMonth: string;
  selectedDate: string | null;
  subscriptionsTab: "active" | "sell";
  personalTab: "view" | "sell";
  editClientModal: { open: boolean; clientId: string | null };
  personalFilter: "all" | "yes" | "no";

  setSelectedMonth: (m: string) => void;
  setSelectedDate: (d: string | null) => void;
  setSubscriptionsTab: (t: "active" | "sell") => void;
  setPersonalTab: (t: "view" | "sell") => void;
  openEditClient: (id: string) => void;
  closeEditClient: () => void;
  setPersonalFilter: (f: "all" | "yes" | "no") => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedMonth: currentYearMonth(),
  selectedDate: null,
  subscriptionsTab: "active",
  personalTab: "view",
  editClientModal: { open: false, clientId: null },
  personalFilter: "all",

  setSelectedMonth: (m) => set({ selectedMonth: m }),
  setSelectedDate: (d) => set({ selectedDate: d }),
  setSubscriptionsTab: (t) => set({ subscriptionsTab: t }),
  setPersonalTab: (t) => set({ personalTab: t }),
  openEditClient: (id) => set({ editClientModal: { open: true, clientId: id } }),
  closeEditClient: () => set({ editClientModal: { open: false, clientId: null } }),
  setPersonalFilter: (f) => set({ personalFilter: f }),
}));
