import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FolderOpen,
  Grid3x3,
  ImagePlus,
  Redo2,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Welcome } from "./components/Welcome";
import { Toolbar } from "./components/Toolbar";
import { Stage, fitView } from "./components/Stage";
import { Sidebar } from "./components/Sidebar";
import { TemplateGallery } from "./components/TemplateGallery";
import { defaultBrush, type BrushSettings, type EditorDocument, type Tool, type ViewState } from "./types";
import { addLayer, createDocument, createImageLayer, duplicateLayer, fitImageInCanvas, removeLayer } from "./engine/document";
import { HistoryStack } from "./engine/history";
import { fileToDataUrl, loadImage } from "./engine/images";
import { exportDocument, loadProject, saveProject } from "./engine/export";
import { TEMPLATES } from "./data/templates";

type Tab = "design" | "type" | "photo" | "make" | "export";

const initialViewFor = (doc: EditorDocument): ViewState => {
  const vw = Math.max(400, window.innerWidth - 52 - 320);
  const vh = Math.max(300, window.innerHeight - 48 - 26);
  return fitView(doc, { width: vw, height: vh });
};

export default function App() {
  const [doc, setDoc] = useState<EditorDocument | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ zoom: 1, x: 0, y: 0 });
  const [tab, setTab] = useState<Tab>("design");
  const [brush, setBrush] = useState<BrushSettings>(defaultBrush());
  const [showSafe, setShowSafe] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [wandTolerance, setWandTolerance] = useState(48);
  const [wandGlobal, setWandGlobal] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [exportQuality, setExportQuality] = useState(92);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const history = useRef(new HistoryStack());
  const imageInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const startDoc = (next: EditorDocument) => {
    history.current.reset(next);
    setDoc(next);
    setSelectedId(next.layers.at(-1)?.id ?? null);
    setView(initialViewFor(next));
    setEditingTextId(null);
  };

  const commit = (next: EditorDocument, _label: string) => {
    history.current.push(next, _label);
    setDoc(next);
  };

  const addImages = useCallback(
    async (files: File[]) => {
      let current = docRef.current;
      for (const file of files) {
        if (file.name.endsWith(".grokedit.json")) {
          const loaded = loadProject(await file.text());
          startDoc(loaded);
          current = loaded;
          continue;
        }
        if (!file.type.startsWith("image/")) continue;
        const src = await fileToDataUrl(file);
        const img = await loadImage(src);
        if (!current) {
          const blank = createDocument(file.name.replace(/\.[^.]+$/, ""), img.naturalWidth, img.naturalHeight);
          blank.layers = [createImageLayer(file.name, src, 0, 0, img.naturalWidth, img.naturalHeight)];
          startDoc(blank);
          current = blank;
          setTab("photo");
          continue;
        }
        const box = fitImageInCanvas(img.naturalWidth, img.naturalHeight, current.width, current.height, "cover");
        const layer = createImageLayer(file.name, src, box.x, box.y, box.width, box.height);
        current = addLayer(current, layer);
        commit(current, "Add image");
        setSelectedId(layer.id);
        setTab("photo");
      }
    },
    [],
  );

  useEffect(() => {
    const image = new URLSearchParams(window.location.search).get("image");
    if (!image) return;
    const ports = [8788, 8792];
    void (async () => {
      for (const port of ports) {
        try {
          const url = `http://127.0.0.1:${port}/api/media/raw?path=${encodeURIComponent(image)}`;
          const res = await fetch(url);
          if (!res.ok) continue;
          const blob = await res.blob();
          const name = image.split("/").pop() || "frame.png";
          const file = new File([blob], name, { type: blob.type || "image/png" });
          await addImages([file]);
          window.history.replaceState({}, "", "/");
          return;
        } catch {
          /* try 612 Pull, then 612 Clip */
        }
      }
    })();
  }, [addImages]);

  const newBlank = (w: number, h: number, name: string) => {
    if (doc) {
      const next = {
        ...doc,
        name,
        width: w,
        height: h,
        layers: doc.layers.map((l) =>
          l.type === "fill" && l.x === 0 && l.y === 0 && l.width === doc.width && l.height === doc.height
            ? { ...l, width: w, height: h }
            : l,
        ),
      };
      commit(next, "Resize canvas");
      setView(initialViewFor(next));
      return;
    }
    startDoc(createDocument(name, w, h));
  };

  const applyTemplate = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    if (docRef.current && !window.confirm("Replace the current canvas with this template?")) return;
    startDoc(t.build());
    setGalleryOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && galleryOpen) {
        e.preventDefault();
        setGalleryOpen(false);
        return;
      }
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      const meta = e.metaKey || e.ctrlKey;
      const current = docRef.current;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (!current) return;
        const next = e.shiftKey ? history.current.redo(current) : history.current.undo(current);
        if (next) setDoc(next);
        return;
      }
      if (meta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (current) saveProject(current);
        return;
      }
      if (meta && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (current) exportDocument(current, exportFormat, exportQuality / 100);
        return;
      }
      if (meta && e.key.toLowerCase() === "o") {
        e.preventDefault();
        imageInput.current?.click();
        return;
      }
      if (meta && e.key === "0") {
        e.preventDefault();
        if (current) setView(initialViewFor(current));
        return;
      }
      if (meta && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setView((v) => ({ ...v, zoom: Math.min(8, v.zoom * 1.15) }));
        return;
      }
      if (meta && e.key === "-") {
        e.preventDefault();
        setView((v) => ({ ...v, zoom: Math.max(0.05, v.zoom / 1.15) }));
        return;
      }
      if (typing) return;
      if (!current) return;
      if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (!selectedId) return;
        const res = duplicateLayer(current, selectedId);
        if (res) {
          commit(res.doc, "Duplicate");
          setSelectedId(res.id);
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedId) return;
        e.preventDefault();
        commit(removeLayer(current, selectedId), "Delete");
        setSelectedId(null);
        return;
      }
      const map: Record<string, Tool> = {
        v: "select",
        h: "pan",
        t: "text",
        b: "brush",
        e: "eraser",
        r: "rect",
        o: "ellipse",
        i: "eyedropper",
        w: "wand",
      };
      if (galleryOpen) return;
      if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exportFormat, exportQuality, selectedId, galleryOpen]);

  if (!doc) {
    return (
      <>
        <Welcome
          onBlank={newBlank}
          onTemplate={applyTemplate}
          onOpenImage={() => imageInput.current?.click()}
          onOpenProject={() => projectInput.current?.click()}
        />
        <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => void addImages([...(e.target.files ?? [])])} />
        <input ref={projectInput} type="file" accept=".json,.grokedit.json" hidden onChange={(e) => void addImages([...(e.target.files ?? [])])} />
      </>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <b>612 Edit</b>
          <span>local</span>
        </div>
        <nav className="menu">
          <button onClick={() => {
            if (window.confirm("Leave this canvas? Unsaved edits are lost unless you saved a project.")) setDoc(null);
          }}>Home</button>
          <button onClick={() => imageInput.current?.click()}>
            <ImagePlus size={14} /> Open
          </button>
          <button onClick={() => saveProject(doc)}>
            <Save size={14} /> Save
          </button>
          <button onClick={() => projectInput.current?.click()}>
            <FolderOpen size={14} /> Project
          </button>
          <button onClick={() => setGalleryOpen(true)}>Templates</button>
        </nav>
        <div className="grow" />
        <button
          className="icon-btn"
          title="Undo"
          onClick={() => {
            const next = history.current.undo(doc);
            if (next) setDoc(next);
          }}
        >
          <Undo2 size={16} />
        </button>
        <button
          className="icon-btn"
          title="Redo"
          onClick={() => {
            const next = history.current.redo(doc);
            if (next) setDoc(next);
          }}
        >
          <Redo2 size={16} />
        </button>
        <button className="icon-btn" onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.05, v.zoom / 1.15) }))}>
          <ZoomOut size={16} />
        </button>
        <span className="zoom-read">{Math.round(view.zoom * 100)}%</span>
        <button className="icon-btn" onClick={() => setView((v) => ({ ...v, zoom: Math.min(8, v.zoom * 1.15) }))}>
          <ZoomIn size={16} />
        </button>
        <button className="icon-btn" title="Fit" onClick={() => setView(initialViewFor(doc))}>
          Fit
        </button>
        <button className={`icon-btn${showSafe ? " active" : ""}`} title="YouTube safe area" onClick={() => setShowSafe((s) => !s)}>
          Safe
        </button>
        <button className={`icon-btn${showGrid ? " active" : ""}`} title="Grid" onClick={() => setShowGrid((s) => !s)}>
          <Grid3x3 size={16} />
        </button>
        <button className="primary" onClick={() => exportDocument(doc, exportFormat, exportQuality / 100)}>
          <Download size={14} /> Export
        </button>
      </header>
      <div className="workspace">
        <Toolbar tool={tool} onTool={setTool} />
        <Stage
          doc={doc}
          tool={tool}
          selectedId={selectedId}
          view={view}
          brush={brush}
          showSafe={showSafe}
          showGrid={showGrid}
          wandTolerance={wandTolerance}
          wandGlobal={wandGlobal}
          editingTextId={editingTextId}
          onView={setView}
          onSelect={setSelectedId}
          onLive={setDoc}
          onCommit={commit}
          onColor={(hex) => setBrush((b) => ({ ...b, color: hex }))}
          onEditText={setEditingTextId}
          onDropFiles={(files) => void addImages(files)}
        />
        <Sidebar
          tab={tab}
          onTab={setTab}
          doc={doc}
          selectedId={selectedId}
          brush={brush}
          wandTolerance={wandTolerance}
          wandGlobal={wandGlobal}
          exportFormat={exportFormat}
          exportQuality={exportQuality}
          onBrush={setBrush}
          onWandTolerance={setWandTolerance}
          onWandGlobal={setWandGlobal}
          onExportFormat={setExportFormat}
          onExportQuality={setExportQuality}
          onDoc={setDoc}
          onCommit={commit}
          onSelect={setSelectedId}
          onApplyTemplate={applyTemplate}
          onOpenGallery={() => setGalleryOpen(true)}
          onNewSize={newBlank}
          onExport={(format, quality, w, h) => exportDocument(doc, format, quality, w, h)}
        />
      </div>
      <footer className="status">
        <span>
          {doc.width}×{doc.height}
        </span>
        <span>{doc.name}</span>
        <span>{tool}</span>
        <span>{doc.layers.length} layers</span>
        <span>
          <kbd className="kbd">V</kbd> select · <kbd className="kbd">T</kbd> type · <kbd className="kbd">B</kbd> brush · <kbd className="kbd">W</kbd> cutout ·{" "}
          <kbd className="kbd">⌘Z</kbd> undo
        </span>
      </footer>
      <input ref={imageInput} type="file" accept="image/*" hidden multiple onChange={(e) => void addImages([...(e.target.files ?? [])])} />
      <input ref={projectInput} type="file" accept=".json,.grokedit.json" hidden onChange={(e) => void addImages([...(e.target.files ?? [])])} />
      {galleryOpen ? <TemplateGallery variant="modal" onPick={applyTemplate} onClose={() => setGalleryOpen(false)} /> : null}
    </div>
  );
}
