import {
  ArrowUpRight,
  Brush,
  Circle,
  Droplet,
  Eraser,
  Hand,
  Minus,
  MousePointer2,
  Square,
  Star,
  Type,
  Wand2,
} from "lucide-react";
import type { Tool } from "../types";

const TOOLS: { id: Tool; label: string; icon: typeof Brush; extra?: boolean }[] = [
  { id: "select", label: "Select (V)", icon: MousePointer2 },
  { id: "pan", label: "Pan (H / Space)", icon: Hand },
  { id: "text", label: "Text (T)", extra: true, icon: Type },
  { id: "rect", label: "Rectangle (R)", icon: Square },
  { id: "ellipse", label: "Ellipse (O)", icon: Circle },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight },
  { id: "line", label: "Line", icon: Minus },
  { id: "star", label: "Star", extra: true, icon: Star },
  { id: "brush", label: "Brush (B)", icon: Brush },
  { id: "eraser", label: "Eraser (E)", icon: Eraser },
  { id: "eyedropper", label: "Eyedropper (I)", extra: true, icon: Droplet },
  { id: "wand", label: "Cutout wand (W)", icon: Wand2 },
];

export function Toolbar({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  return (
    <aside className="toolbar">
      {TOOLS.map((t, i) => (
        <span key={t.id} style={{ display: "contents" }}>
          {t.extra && i > 0 ? <div className="sep" /> : null}
          <button className={`tool${tool === t.id ? " active" : ""}`} title={t.label} onClick={() => onTool(t.id)}>
            <t.icon size={18} />
          </button>
        </span>
      ))}
    </aside>
  );
}
