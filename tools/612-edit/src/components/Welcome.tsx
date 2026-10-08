import { CANVAS_SIZES } from "../data/presets";
import { TemplateGallery } from "./TemplateGallery";

export function Welcome({
  onBlank,
  onTemplate,
  onOpenImage,
  onOpenProject,
}: {
  onBlank: (w: number, h: number, name: string) => void;
  onTemplate: (id: string) => void;
  onOpenImage: () => void;
  onOpenProject: () => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-inner" style={{ maxWidth: 1180 }}>
        <h1>612 Edit</h1>
        <p className="lede">
          Free local thumbnail and photo editor. Pick a template, drop in a photo, edit the type. Nothing leaves this computer.
        </p>
        <div className="hero-actions">
          <button className="primary" onClick={() => onBlank(1280, 720, "YouTube Thumbnail")}>
            Blank YouTube thumbnail
          </button>
          <button className="ghost" onClick={onOpenImage}>
            Open photo
          </button>
          <button className="ghost" onClick={onOpenProject}>
            Open project
          </button>
        </div>
        <h2>Start from a size</h2>
        <div className="grid-3" style={{ marginBottom: 28 }}>
          {CANVAS_SIZES.slice(0, 9).map((s) => (
            <button key={s.id} className="size-card" onClick={() => onBlank(s.width, s.height, s.name)}>
              <b>{s.name}</b>
              <span>
                {s.width}×{s.height}
              </span>
            </button>
          ))}
        </div>
        <TemplateGallery variant="page" onPick={onTemplate} />
      </div>
    </div>
  );
}
