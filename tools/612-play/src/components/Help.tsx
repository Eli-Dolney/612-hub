import { useUi } from "../state/ui";

const ROWS = [
  ["Space", "Play / pause"],
  ["← / →", "Seek 5 seconds"],
  ["Shift + ← / →", "Seek 15 seconds"],
  ["↑ / ↓", "Volume"],
  ["[ / ] or P / N", "Previous / next"],
  ["S", "Shuffle"],
  ["R", "Repeat"],
  ["L", "Like"],
  ["M", "Mute"],
  ["Q", "Queue"],
  ["⌘ / Ctrl + K", "Search"],
  ["?", "This list"],
];

export function Help() {
  const open = useUi((s) => s.helpOpen);
  const setHelpOpen = useUi((s) => s.setHelpOpen);
  if (!open) return null;
  return (
    <div className="modal-bg" onClick={() => setHelpOpen(false)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Shortcuts</h3>
        <div className="help-grid">
          {ROWS.map(([k, v]) => (
            <div key={k} className="help-row">
              <kbd>{k}</kbd>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
