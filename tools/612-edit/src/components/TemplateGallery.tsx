import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { TEMPLATE_GROUPS, TEMPLATES, type TemplateDef } from "../data/templates";
import { renderDocument } from "../engine/render";

function Thumb({ template }: { template: TemplateDef }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let stop = false;
    const draw = async () => {
      await document.fonts.ready;
      if (stop || !ref.current) return;
      const doc = template.build();
      const canvas = ref.current;
      const max = 420;
      const scale = max / Math.max(doc.width, doc.height);
      const w = Math.max(1, Math.round(doc.width * scale));
      const h = Math.max(1, Math.round(doc.height * scale));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);
      renderDocument(ctx, doc, { checkerboard: false });
    };
    void draw();
    return () => {
      stop = true;
    };
  }, [template]);

  return <canvas ref={ref} className="gallery-thumb" />;
}

export function TemplateGallery({
  variant,
  onPick,
  onClose,
}: {
  variant: "page" | "modal";
  onPick: (id: string) => void;
  onClose?: () => void;
}) {
  const [group, setGroup] = useState("All");
  const [q, setQ] = useState("");

  const items = useMemo(() => {
    const query = q.trim().toLowerCase();
    return TEMPLATES.filter((t) => {
      if (group !== "All" && t.group !== group) return false;
      if (!query) return true;
      return (
        t.name.toLowerCase().includes(query) ||
        t.group.toLowerCase().includes(query) ||
        t.blurb.toLowerCase().includes(query) ||
        t.tags.some((tag) => tag.includes(query))
      );
    });
  }, [group, q]);

  const body = (
    <div className={`gallery ${variant}`}>
      <div className="gallery-bar">
        <div>
          <h2>Template gallery</h2>
          <p>
            {items.length} of {TEMPLATES.length} layouts · click to start editing. Photo wells are placeholders — drop a file on the canvas after.
          </p>
        </div>
        {onClose ? (
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        ) : null}
      </div>
      <div className="gallery-filters">
        <label className="gallery-search">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, tags…" />
        </label>
        <div className="chips">
          <button className={`chip${group === "All" ? " active" : ""}`} onClick={() => setGroup("All")}>
            All
          </button>
          {TEMPLATE_GROUPS.map((g) => (
            <button key={g} className={`chip${group === g ? " active" : ""}`} onClick={() => setGroup(g)}>
              {g}
            </button>
          ))}
        </div>
      </div>
      <div className="gallery-grid">
        {items.map((t) => (
          <button key={t.id} className="gallery-card" onClick={() => onPick(t.id)}>
            <div className="gallery-frame" style={{ aspectRatio: `${t.width} / ${t.height}` }}>
              <Thumb template={t} />
            </div>
            <div className="gallery-meta">
              <b>{t.name}</b>
              <span>
                {t.group} · {t.width}×{t.height}
              </span>
              <em>{t.blurb}</em>
            </div>
          </button>
        ))}
      </div>
      {items.length === 0 ? <p className="hint">No templates match that search.</p> : null}
    </div>
  );

  if (variant === "modal") {
    return (
      <div className="gallery-overlay" onClick={onClose}>
        <div className="gallery-modal" onClick={(e) => e.stopPropagation()}>
          {body}
        </div>
      </div>
    );
  }
  return body;
}
