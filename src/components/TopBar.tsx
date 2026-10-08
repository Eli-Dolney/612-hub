import { HelpCircle, Search, SlidersHorizontal } from "lucide-react";
import { useLibrary } from "../state/library";
import { useUi } from "../state/ui";

export function TopBar() {
  const tracks = useLibrary((s) => s.tracks);
  const { setSearchOpen, setEqOpen, setHelpOpen } = useUi();
  return (
    <header className="topbar">
      <div className="brand">
        <b>612 Play</b>
        <span>listening room</span>
      </div>
      <button className="search-btn" onClick={() => setSearchOpen(true)}>
        <Search size={15} />
        <span>Search library</span>
        <kbd>⌘K</kbd>
      </button>
      <div className="top-right">
        <span className="muted">{tracks.length} tracks</span>
        <button className="icon-btn" title="Equalizer" onClick={() => setEqOpen(true)}>
          <SlidersHorizontal size={16} />
        </button>
        <button className="icon-btn" title="Shortcuts" onClick={() => setHelpOpen(true)}>
          <HelpCircle size={16} />
        </button>
      </div>
    </header>
  );
}
