import {
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from "lucide-react";
import type { BlendMode, BrushSettings, EditorDocument, Layer, TextLayer } from "../types";
import { CANVAS_SIZES, ELEMENTS, EXPORT_PRESETS, FILTERS, FONTS, TEMPLATES, TEXT_PRESETS, featuredTemplateIds } from "../data/presets";
import { addLayer, createTextLayer, reorderLayer, updateLayer } from "../engine/document";
import { measureText } from "../engine/render";

type Tab = "design" | "type" | "photo" | "make" | "export";

const blends: BlendMode[] = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
];

function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="swatch">
      <input type="color" value={value.startsWith("#") && value.length === 7 ? value : "#ffffff"} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="slider">
      <label>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span>{value}</span>
    </div>
  );
}

export function Sidebar({
  tab,
  onTab,
  doc,
  selectedId,
  brush,
  wandTolerance,
  wandGlobal,
  exportFormat,
  exportQuality,
  onBrush,
  onWandTolerance,
  onWandGlobal,
  onExportFormat,
  onExportQuality,
  onDoc,
  onCommit,
  onSelect,
  onApplyTemplate,
  onOpenGallery,
  onNewSize,
  onExport,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  doc: EditorDocument;
  selectedId: string | null;
  brush: BrushSettings;
  wandTolerance: number;
  wandGlobal: boolean;
  exportFormat: "png" | "jpeg" | "webp";
  exportQuality: number;
  onBrush: (b: BrushSettings) => void;
  onWandTolerance: (n: number) => void;
  onWandGlobal: (v: boolean) => void;
  onExportFormat: (f: "png" | "jpeg" | "webp") => void;
  onExportQuality: (n: number) => void;
  onDoc: (d: EditorDocument) => void;
  onCommit: (d: EditorDocument, label: string) => void;
  onSelect: (id: string | null) => void;
  onApplyTemplate: (id: string) => void;
  onOpenGallery: () => void;
  onNewSize: (w: number, h: number, name: string) => void;
  onExport: (format: "png" | "jpeg" | "webp", quality: number, w?: number, h?: number) => void;
}) {
  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;
  const patch = (p: Partial<Layer>, label = "Layer") => {
    if (!selected) return;
    onCommit(updateLayer(doc, selected.id, p), label);
  };
  const live = (p: Partial<Layer>) => {
    if (!selected) return;
    onDoc(updateLayer(doc, selected.id, p));
  };

  return (
    <aside className="sidebar">
      <div className="tabs">
        {(["design", "type", "photo", "make", "export"] as Tab[]).map((t) => (
          <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => onTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="side-body">
        {tab === "design" && (
          <>
            <div className="section">
              <h3>Canvas sizes</h3>
              <div className="grid-2">
                {CANVAS_SIZES.map((s) => (
                  <button key={s.id} className="size-card" onClick={() => onNewSize(s.width, s.height, s.name)}>
                    <b>{s.name}</b>
                    <span>
                      {s.width}×{s.height}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="section">
              <h3>Templates</h3>
              <button className="primary" style={{ width: "100%", marginBottom: 10 }} onClick={onOpenGallery}>
                Open full gallery
              </button>
              <div className="grid-2">
                {TEMPLATES.filter((t) => featuredTemplateIds.includes(t.id)).map((t) => (
                  <button key={t.id} className="tpl-card" onClick={() => onApplyTemplate(t.id)}>
                    <div
                      className="tpl-thumb"
                      style={{ background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}
                    >
                      {t.name}
                    </div>
                    <b>{t.name}</b>
                    <span>
                      {t.width}×{t.height}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === "type" && (
          <>
            <div className="section">
              <h3>Add text</h3>
              <button
                className="primary"
                style={{ width: "100%" }}
                onClick={() => {
                  const layer = createTextLayer("YOUR TITLE", doc.width / 2 - 320, doc.height / 2 - 70, {
                    width: 640,
                    height: 140,
                    fontSize: 96,
                  });
                  onCommit(addLayer(doc, layer), "Add text");
                  onSelect(layer.id);
                }}
              >
                New text layer
              </button>
            </div>
            <div className="section">
              <h3>Thumbnail styles</h3>
              {TEXT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className="preset-card"
                  onClick={() => {
                    if (selected?.type !== "text") {
                      const layer = createTextLayer("TITLE", doc.width / 2 - 280, 80, { width: 560, height: 140, ...p.style });
                      const sized = measureText(layer);
                      onCommit(addLayer(doc, { ...layer, ...sized }), "Text style");
                      onSelect(layer.id);
                      return;
                    }
                    const next = { ...selected, ...p.style } as TextLayer;
                    const sized = measureText(next);
                    patch({ ...p.style, width: Math.max(selected.width, sized.width), height: Math.max(selected.height, sized.height) }, "Text style");
                  }}
                >
                  <span
                    style={{
                      fontFamily: p.style.fontFamily,
                      color: p.style.color,
                      fontWeight: 800,
                      WebkitTextStroke: p.style.outline?.enabled ? `1px ${p.style.outline.color}` : undefined,
                      textShadow: p.style.glow?.enabled
                        ? `0 0 12px ${p.style.glow.color}`
                        : p.style.shadow?.enabled
                          ? `${p.style.shadow.x}px ${p.style.shadow.y}px ${p.style.shadow.blur}px ${p.style.shadow.color}`
                          : undefined,
                    }}
                  >
                    {p.name}
                  </span>
                </button>
              ))}
            </div>
            {selected?.type === "text" && (
              <div className="section">
                <h3>Selected text</h3>
                <div className="field">
                  <label>Content</label>
                  <textarea rows={3} value={selected.text} onChange={(e) => live({ text: e.target.value })} onBlur={() => patch({ text: selected.text }, "Text")} />
                </div>
                <div className="field">
                  <label>Font</label>
                  <select value={selected.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value }, "Font")}>
                    {FONTS.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <Slider label="Size" value={selected.fontSize} min={12} max={220} onChange={(n) => live({ fontSize: n })} />
                <div className="field">
                  <label>Color</label>
                  <Color value={selected.color} onChange={(c) => patch({ color: c }, "Color")} />
                </div>
                <div className="row">
                  {(["left", "center", "right"] as const).map((a) => (
                    <button key={a} className={`chip${selected.align === a ? " active" : ""}`} onClick={() => patch({ align: a }, "Align")}>
                      {a}
                    </button>
                  ))}
                </div>
                <label className="hint">
                  <input
                    type="checkbox"
                    checked={selected.outline.enabled}
                    onChange={(e) => patch({ outline: { ...selected.outline, enabled: e.target.checked } }, "Outline")}
                  />{" "}
                  Outline
                </label>
                {selected.outline.enabled && (
                  <>
                    <Color value={selected.outline.color} onChange={(c) => patch({ outline: { ...selected.outline, color: c } }, "Outline")} />
                    <Slider label="Width" value={selected.outline.width} min={1} max={18} onChange={(n) => live({ outline: { ...selected.outline, width: n } })} />
                  </>
                )}
                <label className="hint">
                  <input
                    type="checkbox"
                    checked={selected.shadow.enabled}
                    onChange={(e) => patch({ shadow: { ...selected.shadow, enabled: e.target.checked } }, "Shadow")}
                  />{" "}
                  Shadow
                </label>
                <label className="hint">
                  <input
                    type="checkbox"
                    checked={selected.glow.enabled}
                    onChange={(e) => patch({ glow: { ...selected.glow, enabled: e.target.checked } }, "Glow")}
                  />{" "}
                  Glow
                </label>
                {selected.glow.enabled && (
                  <>
                    <Color value={selected.glow.color} onChange={(c) => patch({ glow: { ...selected.glow, color: c } }, "Glow")} />
                    <Slider label="Glow" value={selected.glow.size} min={4} max={40} onChange={(n) => live({ glow: { ...selected.glow, size: n } })} />
                  </>
                )}
              </div>
            )}
          </>
        )}

        {tab === "photo" && (
          <>
            <p className="hint">Select an image layer, then adjust. Cutout uses the wand tool — click a background color. Everything stays on this machine.</p>
            {selected?.type === "image" ? (
              <>
                <Slider
                  label="Bright"
                  value={selected.adjustments.brightness}
                  min={-80}
                  max={80}
                  onChange={(n) => live({ adjustments: { ...selected.adjustments, brightness: n } })}
                />
                <Slider
                  label="Contrast"
                  value={selected.adjustments.contrast}
                  min={-80}
                  max={80}
                  onChange={(n) => live({ adjustments: { ...selected.adjustments, contrast: n } })}
                />
                <Slider
                  label="Saturate"
                  value={selected.adjustments.saturation}
                  min={-100}
                  max={100}
                  onChange={(n) => live({ adjustments: { ...selected.adjustments, saturation: n } })}
                />
                <Slider label="Hue" value={selected.adjustments.hue} min={-180} max={180} onChange={(n) => live({ adjustments: { ...selected.adjustments, hue: n } })} />
                <Slider
                  label="Warmth"
                  value={selected.adjustments.temperature}
                  min={-80}
                  max={80}
                  onChange={(n) => live({ adjustments: { ...selected.adjustments, temperature: n } })}
                />
                <Slider label="Blur" value={selected.adjustments.blur} min={0} max={12} onChange={(n) => live({ adjustments: { ...selected.adjustments, blur: n } })} />
                <Slider
                  label="Vignette"
                  value={selected.adjustments.vignette}
                  min={0}
                  max={100}
                  onChange={(n) => live({ adjustments: { ...selected.adjustments, vignette: n } })}
                />
                <div className="chips">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      className={`chip${selected.adjustments.filter === f.id ? " active" : ""}`}
                      onClick={() => patch({ adjustments: { ...selected.adjustments, filter: f.id } }, "Filter")}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
                <div className="row">
                  <button className="ghost" onClick={() => patch({ flipH: !selected.flipH }, "Flip")}>
                    Flip H
                  </button>
                  <button className="ghost" onClick={() => patch({ flipV: !selected.flipV }, "Flip")}>
                    Flip V
                  </button>
                </div>
              </>
            ) : (
              <p className="hint">Drop a photo onto the canvas or use File → Open image.</p>
            )}
            <div className="section">
              <h3>Local cutout</h3>
              <Slider label="Tolerance" value={wandTolerance} min={8} max={140} onChange={onWandTolerance} />
              <label className="hint">
                <input type="checkbox" checked={wandGlobal} onChange={(e) => onWandGlobal(e.target.checked)} /> Remove this color everywhere (not just the clicked region)
              </label>
            </div>
            <div className="section">
              <h3>Brush</h3>
              <Slider label="Size" value={brush.size} min={2} max={120} onChange={(n) => onBrush({ ...brush, size: n })} />
              <Slider label="Opacity" value={Math.round(brush.opacity * 100)} min={10} max={100} onChange={(n) => onBrush({ ...brush, opacity: n / 100 })} />
              <div className="field">
                <label>Color</label>
                <Color value={brush.color} onChange={(c) => onBrush({ ...brush, color: c })} />
              </div>
            </div>
          </>
        )}

        {tab === "make" && (
          <>
            <div className="section">
              <h3>Marks & badges</h3>
              <div className="grid-2">
                {ELEMENTS.map((el) => (
                  <button
                    key={el.id}
                    className="el-card"
                    onClick={() => {
                      const layer = el.make(doc.width / 2, doc.height / 2);
                      onCommit(addLayer(doc, layer), "Add element");
                      onSelect(layer.id);
                    }}
                  >
                    {el.name}
                  </button>
                ))}
              </div>
            </div>
            {selected?.type === "shape" && (
              <div className="section">
                <h3>Shape</h3>
                <div className="field">
                  <label>Fill</label>
                  <Color value={selected.fill.startsWith("#") ? selected.fill : "#ff2d2d"} onChange={(c) => patch({ fill: c }, "Fill")} />
                </div>
                <div className="field">
                  <label>Stroke</label>
                  <Color value={selected.stroke.startsWith("#") ? selected.stroke : "#ffffff"} onChange={(c) => patch({ stroke: c }, "Stroke")} />
                </div>
                <Slider label="Stroke" value={selected.strokeWidth} min={0} max={24} onChange={(n) => live({ strokeWidth: n })} />
              </div>
            )}
            {selected?.type === "fill" && (
              <div className="section">
                <h3>Background</h3>
                <Color value={selected.fill.startsWith("#") ? selected.fill : "#111111"} onChange={(c) => patch({ fill: c, gradient: undefined }, "Background")} />
              </div>
            )}
          </>
        )}

        {tab === "export" && (
          <>
            <div className="section">
              <h3>One-click</h3>
              {EXPORT_PRESETS.map((p) => (
                <button key={p.id} className="size-card" style={{ marginBottom: 8 }} onClick={() => onExport(p.format, 0.92, p.width, p.height)}>
                  <b>{p.name}</b>
                  <span>
                    {p.width}×{p.height} · {p.format.toUpperCase()}
                  </span>
                </button>
              ))}
            </div>
            <div className="field">
              <label>Format</label>
              <select value={exportFormat} onChange={(e) => onExportFormat(e.target.value as "png" | "jpeg" | "webp")}>
                <option value="png">PNG (transparent)</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </div>
            {(exportFormat === "jpeg" || exportFormat === "webp") && (
              <Slider label="Quality" value={exportQuality} min={50} max={100} onChange={onExportQuality} />
            )}
            <button className="primary" style={{ width: "100%" }} onClick={() => onExport(exportFormat, exportQuality / 100)}>
              <Download size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
              Export current size
            </button>
            <p className="hint" style={{ marginTop: 10 }}>
              Files download locally. Nothing is uploaded.
            </p>
          </>
        )}

        {selected && (
          <div className="section">
            <h3>Layer</h3>
            <Slider label="Opacity" value={Math.round(selected.opacity * 100)} min={5} max={100} onChange={(n) => live({ opacity: n / 100 })} />
            <div className="field">
              <label>Blend</label>
              <select value={selected.blendMode} onChange={(e) => patch({ blendMode: e.target.value as BlendMode }, "Blend")}>
                {blends.map((b) => (
                  <option key={b} value={b}>
                    {b === "source-over" ? "normal" : b}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
      <div className="layers">
        <div className="row" style={{ marginBottom: 8, justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Layers</h3>
          <div className="row">
            <button className="icon-btn" title="Up" onClick={() => selected && onCommit(reorderLayer(doc, selected.id, 1), "Reorder")}>
              <ChevronUp size={14} />
            </button>
            <button className="icon-btn" title="Down" onClick={() => selected && onCommit(reorderLayer(doc, selected.id, -1), "Reorder")}>
              <ChevronDown size={14} />
            </button>
            <button
              className="icon-btn"
              title="Delete"
              onClick={() => selected && onCommit({ ...doc, layers: doc.layers.filter((l) => l.id !== selected.id) }, "Delete")}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        {[...doc.layers].reverse().map((layer) => (
          <div key={layer.id} className={`layer${layer.id === selectedId ? " on" : ""}`} onClick={() => onSelect(layer.id)}>
            <button
              title="Visibility"
              onClick={(e) => {
                e.stopPropagation();
                onCommit(updateLayer(doc, layer.id, { visible: !layer.visible }), "Visibility");
              }}
            >
              {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <input
              value={layer.name}
              onChange={(e) => onDoc(updateLayer(doc, layer.id, { name: e.target.value }))}
              onBlur={() => onCommit(doc, "Rename")}
            />
            <button
              title="Lock"
              onClick={(e) => {
                e.stopPropagation();
                onCommit(updateLayer(doc, layer.id, { locked: !layer.locked }), "Lock");
              }}
            >
              {layer.locked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
          </div>
        ))}
        <button
          className="ghost"
          style={{ width: "100%", marginTop: 4 }}
          onClick={() => {
            const layer = createTextLayer("Text", 80, 80, { width: 280, height: 80, fontSize: 48 });
            onCommit(addLayer(doc, layer), "Add text");
            onSelect(layer.id);
          }}
        >
          <Plus size={12} /> Text layer
        </button>
      </div>
    </aside>
  );
}
