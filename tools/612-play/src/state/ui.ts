import { create } from "zustand";
import type { View } from "../lib/types";

type UiState = {
  view: View;
  search: string;
  searchOpen: boolean;
  eqOpen: boolean;
  helpOpen: boolean;
  context: { x: number; y: number; trackId: string } | null;
  setView: (view: View) => void;
  setSearch: (q: string) => void;
  setSearchOpen: (v: boolean) => void;
  setEqOpen: (v: boolean) => void;
  setHelpOpen: (v: boolean) => void;
  setContext: (c: UiState["context"]) => void;
};

export const useUi = create<UiState>((set) => ({
  view: { kind: "listen" },
  search: "",
  searchOpen: false,
  eqOpen: false,
  helpOpen: false,
  context: null,
  setView: (view) => set({ view, searchOpen: false }),
  setSearch: (search) => set({ search }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setEqOpen: (eqOpen) => set({ eqOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setContext: (context) => set({ context }),
}));
