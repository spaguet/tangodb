import { createContext, useContext, type ReactNode } from "react";
import { usePlaceholderStore } from "./usePlaceholderStore";

type PlaceholderStore = ReturnType<typeof usePlaceholderStore>;

const PlaceholderStoreContext = createContext<PlaceholderStore | null>(null);

export function PlaceholderStoreProvider({ children }: { children: ReactNode }) {
  const store = usePlaceholderStore();
  return (
    <PlaceholderStoreContext.Provider value={store}>{children}</PlaceholderStoreContext.Provider>
  );
}

export function useStore(): PlaceholderStore {
  const store = useContext(PlaceholderStoreContext);
  if (!store) throw new Error("useStore must be used within PlaceholderStoreProvider");
  return store;
}
