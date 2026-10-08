import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Stage } from "./components/Stage";
import { Collection } from "./components/Collection";
import { Queue } from "./components/Queue";
import { Dock } from "./components/Dock";
import { SearchModal } from "./components/SearchModal";
import { EqSheet } from "./components/EqSheet";
import { Help } from "./components/Help";
import { ContextMenu } from "./components/ContextMenu";
import { useLibrary } from "./state/library";
import { bindEngine, usePlayer } from "./state/player";
import { useUi } from "./state/ui";
import { handleFromDropItem } from "./lib/fs";

export function App() {
  const boot = useLibrary((s) => s.boot);
  const addFolder = useLibrary((s) => s.addFolder);
  const error = useLibrary((s) => s.error);
  const view = useUi((s) => s.view);
  const queueOpen = usePlayer((s) => s.queueOpen);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    bindEngine();
    void boot();
  }, [boot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
      const player = usePlayer.getState();
      const ui = useUi.getState();
      const lib = useLibrary.getState();

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.setSearchOpen(true);
        return;
      }
      if (e.key === "Escape") {
        ui.setSearchOpen(false);
        ui.setEqOpen(false);
        ui.setHelpOpen(false);
        ui.setContext(null);
        return;
      }
      if (typing) return;
      if (e.key === " ") {
        e.preventDefault();
        player.toggle();
      } else if (e.key === "ArrowRight" && e.shiftKey) {
        player.seek(player.currentTime + 15);
      } else if (e.key === "ArrowLeft" && e.shiftKey) {
        player.seek(Math.max(0, player.currentTime - 15));
      } else if (e.key === "ArrowRight") {
        player.seek(player.currentTime + 5);
      } else if (e.key === "ArrowLeft") {
        player.seek(Math.max(0, player.currentTime - 5));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        player.setVolume(player.volume + 0.05);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        player.setVolume(player.volume - 0.05);
      } else if (e.key.toLowerCase() === "n" || e.key === "]") {
        void player.next();
      } else if (e.key.toLowerCase() === "p" || e.key === "[") {
        void player.prev();
      } else if (e.key.toLowerCase() === "s") {
        player.toggleShuffle();
      } else if (e.key.toLowerCase() === "r") {
        player.cycleRepeat();
      } else if (e.key.toLowerCase() === "m") {
        player.toggleMute();
      } else if (e.key.toLowerCase() === "q") {
        player.setQueueOpen(!player.queueOpen);
      } else if (e.key.toLowerCase() === "l" && player.currentId) {
        lib.toggleLike(player.currentId);
      } else if (e.key === "?" || e.key.toLowerCase() === "h") {
        ui.setHelpOpen(!ui.helpOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    for (const item of [...e.dataTransfer.items]) {
      const handle = await handleFromDropItem(item);
      if (handle) {
        await addFolder(handle);
        return;
      }
    }
  }

  return (
    <div
      className={`shell ${queueOpen ? "" : "no-queue"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <TopBar />
      <Sidebar />
      {view.kind === "listen" ? <Stage /> : <Collection />}
      {queueOpen && <Queue />}
      <Dock />
      <SearchModal />
      <EqSheet />
      <Help />
      <ContextMenu />
      {error && <div className="toast">{error}</div>}
      {drag && <div className="drop-veil">Drop a music folder</div>}
    </div>
  );
}
