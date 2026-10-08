import { useEffect, useRef, useState } from "react";
import type { BrushSettings, EditorDocument, Layer, Tool, ViewState } from "../types";
import { addLayer, createShapeLayer, createTextLayer, updateLayer } from "../engine/document";
import { floodRemove, removeSimilarColor, rgbToHex, samplePixel } from "../engine/bgremove";
import { flattenToCanvas, rasterizeDrawLayer, renderDocument } from "../engine/render";
import { applyResize, hitHandle, hitTest, handlePositions, type Handle } from "../engine/hitTest";
import { canvasToDataUrl, getCachedImage, loadImage } from "../engine/images";
import { uid } from "../engine/ids";
import type { DrawLayer, ShapeKind } from "../types";

type Props = {
  doc: EditorDocument;
  tool: Tool;
  selectedId: string | null;
  view: ViewState;
  brush: BrushSettings;
  showSafe: boolean;
  showGrid: boolean;
  wandTolerance: number;
  wandGlobal: boolean;
  editingTextId: string | null;
  onView: (v: ViewState) => void;
  onSelect: (id: string | null) => void;
  onLive: (doc: EditorDocument) => void;
  onCommit: (doc: EditorDocument, label: string) => void;
  onColor: (hex: string) => void;
  onEditText: (id: string | null) => void;
  onDropFiles: (files: File[]) => void;
};

const shapeTool: Record<string, ShapeKind> = {
  rect: "roundRect",
  ellipse: "ellipse",
  arrow: "arrow",
  line: "line",
  star: "star",
};

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; sx: number; sy: number; lx: number; ly: number; id: string }
  | { kind: "resize"; handle: Handle; sx: number; sy: number; id: string; start: Layer }
  | { kind: "rotate"; id: string; cx: number; cy: number }
  | { kind: "shape"; x: number; y: number; id: string }
  | { kind: "brush"; id: string };

export function Stage({
  doc,
  tool,
  selectedId,
  view,
  brush,
  showSafe,
  showGrid,
  wandTolerance,
  wandGlobal,
  editingTextId,
  onView,
  onSelect,
  onLive,
  onCommit,
  onColor,
  onEditText,
  onDropFiles,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const space = useRef(false);
  const [hoverDrop, setHoverDrop] = useState(false);
  const [tick, setTick] = useState(0);
  const docRef = useRef(doc);
  docRef.current = doc;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const srcs = doc.layers
      .filter((l): l is Extract<Layer, { src: string }> => l.type === "image" || l.type === "draw")
      .map((l) => l.src)
      .filter(Boolean);
    let stop = false;
    Promise.all(srcs.map((s) => loadImage(s).catch(() => null))).then(() => {
      if (!stop) setTick((n) => n + 1);
    });
    return () => {
      stop = true;
    };
  }, [doc]);

  const metrics = () => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vw = wrap.clientWidth;
    const vh = wrap.clientHeight;
    return { canvas, wrap, dpr, vw, vh };
  };

  const screenToWorld = (clientX: number, clientY: number, v = viewRef.current) => {
    const { wrap, vw, vh } = metrics();
    const r = wrap.getBoundingClientRect();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    const artLeft = vw / 2 + v.x - (docRef.current.width * v.zoom) / 2;
    const artTop = vh / 2 + v.y - (docRef.current.height * v.zoom) / 2;
    return { x: (sx - artLeft) / v.zoom, y: (sy - artTop) / v.zoom, sx, sy };
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vw = wrap.clientWidth;
      const vh = wrap.clientHeight;
      canvas.width = Math.max(1, Math.floor(vw * dpr));
      canvas.height = Math.max(1, Math.floor(vh * dpr));
      const ctx = canvas.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#151821";
      ctx.fillRect(0, 0, vw, vh);

      const v = viewRef.current;
      const d = docRef.current;
      ctx.save();
      ctx.translate(vw / 2 + v.x, vh / 2 + v.y);
      ctx.scale(v.zoom, v.zoom);
      ctx.translate(-d.width / 2, -d.height / 2);

      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 28 / v.zoom;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, d.width, d.height);
      ctx.shadowBlur = 0;

      renderDocument(ctx, d, { checkerboard: true });

      if (showGrid) {
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1 / v.zoom;
        const step = 64;
        ctx.beginPath();
        for (let x = 0; x <= d.width; x += step) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, d.height);
        }
        for (let y = 0; y <= d.height; y += step) {
          ctx.moveTo(0, y);
          ctx.lineTo(d.width, y);
        }
        ctx.stroke();
      }
      if (showSafe) {
        ctx.strokeStyle = "rgba(255,220,80,0.55)";
        ctx.setLineDash([8 / v.zoom, 6 / v.zoom]);
        ctx.lineWidth = 1 / v.zoom;
        ctx.strokeRect(d.width * 0.05, d.height * 0.05, d.width * 0.9, d.height * 0.9);
        ctx.setLineDash([]);
      }

      const selected = d.layers.find((l) => l.id === selectedId);
      if (selected && selected.visible) {
        const hs = handlePositions(selected, v.zoom);
        ctx.save();
        ctx.translate(selected.x + selected.width / 2, selected.y + selected.height / 2);
        ctx.rotate((selected.rotation * Math.PI) / 180);
        ctx.strokeStyle = "#5b8cff";
        ctx.lineWidth = 1.5 / v.zoom;
        ctx.strokeRect(-selected.width / 2, -selected.height / 2, selected.width, selected.height);
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(hs.n.x, hs.n.y);
        ctx.lineTo(hs.rotate.x, hs.rotate.y);
        ctx.strokeStyle = "#5b8cff";
        ctx.lineWidth = 1 / v.zoom;
        ctx.stroke();
        const s = 7 / v.zoom;
        (Object.entries(hs) as [string, { x: number; y: number }][]).forEach(([name, p]) => {
          ctx.fillStyle = name === "rotate" ? "#3dd68c" : "#fff";
          ctx.strokeStyle = "#5b8cff";
          ctx.lineWidth = 1 / v.zoom;
          ctx.beginPath();
          ctx.rect(p.x - s / 2, p.y - s / 2, s, s);
          ctx.fill();
          ctx.stroke();
        });
      }
      ctx.restore();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const d = docRef.current;
      const vw = wrap.clientWidth;
      const vh = wrap.clientHeight;
      const r = wrap.getBoundingClientRect();
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const artLeft = vw / 2 + v.x - (d.width * v.zoom) / 2;
      const artTop = vh / 2 + v.y - (d.height * v.zoom) / 2;
      const worldX = (sx - artLeft) / v.zoom;
      const worldY = (sy - artTop) / v.zoom;
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      const zoom = Math.min(8, Math.max(0.05, v.zoom * factor));
      const newArtLeft = sx - worldX * zoom;
      const newArtTop = sy - worldY * zoom;
      onView({
        zoom,
        x: newArtLeft - vw / 2 + (d.width * zoom) / 2,
        y: newArtTop - vh / 2 + (d.height * zoom) / 2,
      });
    };
    wrap.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      wrap.removeEventListener("wheel", wheel);
    };
  }, [doc, view, selectedId, showGrid, showSafe, tick, onView]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const cursorClass = () => {
    if (drag.current?.kind === "pan") return "panning";
    if (tool === "pan" || space.current) return "pan";
    if (tool !== "select") return "cross";
    return "";
  };

  const ensureDrawLayer = (d: EditorDocument): { doc: EditorDocument; layer: DrawLayer } => {
    const existing = [...d.layers].reverse().find((l) => l.type === "draw" && !l.locked) as DrawLayer | undefined;
    if (existing) return { doc: d, layer: existing };
    const canvas = document.createElement("canvas");
    canvas.width = d.width;
    canvas.height = d.height;
    const layer: DrawLayer = {
      id: uid(),
      type: "draw",
      name: "Drawing",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "source-over",
      x: 0,
      y: 0,
      width: d.width,
      height: d.height,
      rotation: 0,
      src: canvasToDataUrl(canvas),
    };
    return { doc: addLayer(d, layer), layer };
  };

  const paintAt = (layer: DrawLayer, x: number, y: number, erase: boolean) => {
    const canvas = rasterizeDrawLayer(layer);
    const ctx = canvas.getContext("2d")!;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = brush.opacity;
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    ctx.fillStyle = brush.color;
    ctx.beginPath();
    ctx.arc(x - layer.x, y - layer.y, brush.size / 2, 0, Math.PI * 2);
    ctx.fill();
    layer.src = canvasToDataUrl(canvas);
    void loadImage(layer.src);
  };

  const onPointerDown = async (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const w = screenToWorld(e.clientX, e.clientY);
    const d = docRef.current;
    const usingPan = tool === "pan" || space.current || e.buttons === 4;
    if (usingPan) {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    if (tool === "eyedropper") {
      const flat = flattenToCanvas(d);
      const p = samplePixel(flat, w.x, w.y);
      onColor(rgbToHex(p[0], p[1], p[2]));
      return;
    }
    if (tool === "wand") {
      const layer = hitTest(d, w.x, w.y);
      if (layer?.type !== "image") return;
      const nx = (w.x - layer.x) / layer.width;
      const ny = (w.y - layer.y) / layer.height;
      const src = wandGlobal
        ? await (async () => {
            const flat = flattenToCanvas(d);
            const p = samplePixel(flat, w.x, w.y);
            return removeSimilarColor(layer.src, [p[0], p[1], p[2]], wandTolerance);
          })()
        : await floodRemove(layer.src, nx, ny, wandTolerance);
      await loadImage(src);
      onCommit(updateLayer(d, layer.id, { src }), "Cutout");
      return;
    }
    if (tool === "text") {
      const hit = hitTest(d, w.x, w.y);
      if (hit?.type === "text") {
        onSelect(hit.id);
        onEditText(hit.id);
        return;
      }
      const layer = createTextLayer("TITLE", w.x - 200, w.y - 40, { width: 400, height: 90, fontSize: 72 });
      onCommit(addLayer(d, layer), "Add text");
      onSelect(layer.id);
      onEditText(layer.id);
      return;
    }
    if (tool in shapeTool) {
      const kind = shapeTool[tool];
      const layer = createShapeLayer(kind, w.x, w.y, 1, 1, {
        fill: kind === "arrow" || kind === "line" ? brush.color : brush.color,
        stroke: kind === "arrow" || kind === "line" ? brush.color : "#ffffff",
      });
      drag.current = { kind: "shape", x: w.x, y: w.y, id: layer.id };
      onSelect(layer.id);
      onLive(addLayer(d, layer));
      return;
    }
    if (tool === "brush" || tool === "eraser") {
      const next = ensureDrawLayer(d);
      paintAt(next.layer, w.x, w.y, tool === "eraser");
      drag.current = { kind: "brush", id: next.layer.id };
      onLive(updateLayer(next.doc, next.layer.id, { src: next.layer.src }));
      return;
    }

    const selected = d.layers.find((l) => l.id === selectedId);
    if (selected && !selected.locked) {
      const handle = hitHandle(selected, w.x, w.y, view.zoom);
      if (handle === "rotate") {
        drag.current = {
          kind: "rotate",
          id: selected.id,
          cx: selected.x + selected.width / 2,
          cy: selected.y + selected.height / 2,
        };
        return;
      }
      if (handle) {
        drag.current = { kind: "resize", handle, sx: w.x, sy: w.y, id: selected.id, start: { ...selected } };
        return;
      }
    }
    const hit = hitTest(d, w.x, w.y);
    onSelect(hit?.id ?? null);
    if (hit && !hit.locked) {
      drag.current = { kind: "move", sx: w.x, sy: w.y, lx: hit.x, ly: hit.y, id: hit.id };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = docRef.current;
    const cur = drag.current;
    if (!cur) return;
    const w = screenToWorld(e.clientX, e.clientY);
    if (cur.kind === "pan") {
      onView({
        ...viewRef.current,
        x: cur.vx + (e.clientX - cur.sx),
        y: cur.vy + (e.clientY - cur.sy),
      });
      return;
    }
    if (cur.kind === "move") {
      onLive(updateLayer(d, cur.id, { x: cur.lx + (w.x - cur.sx), y: cur.ly + (w.y - cur.sy) }));
      return;
    }
    if (cur.kind === "resize") {
      const start = cur.start;
      const dx = w.x - cur.sx;
      const dy = w.y - cur.sy;
      const rad = (-start.rotation * Math.PI) / 180;
      const ldx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ldy = dx * Math.sin(rad) + dy * Math.cos(rad);
      onLive(updateLayer(d, cur.id, applyResize(start, cur.handle, ldx, ldy)));
      return;
    }
    if (cur.kind === "rotate") {
      const ang = (Math.atan2(w.y - cur.cy, w.x - cur.cx) * 180) / Math.PI + 90;
      onLive(updateLayer(d, cur.id, { rotation: ang }));
      return;
    }
    if (cur.kind === "shape") {
      const x = Math.min(cur.x, w.x);
      const y = Math.min(cur.y, w.y);
      const width = Math.max(4, Math.abs(w.x - cur.x));
      const height = Math.max(4, Math.abs(w.y - cur.y));
      onLive(updateLayer(d, cur.id, { x, y, width, height }));
      return;
    }
    if (cur.kind === "brush") {
      const layer = d.layers.find((l) => l.id === cur.id) as DrawLayer | undefined;
      if (!layer) return;
      paintAt(layer, w.x, w.y, tool === "eraser");
      onLive(updateLayer(d, layer.id, { src: layer.src }));
    }
  };

  const onPointerUp = () => {
    const cur = drag.current;
    drag.current = null;
    if (!cur || cur.kind === "pan") return;
    onCommit(docRef.current, cur.kind === "brush" ? "Paint" : cur.kind === "shape" ? "Shape" : "Transform");
  };

  const selectedText = doc.layers.find((l): l is Extract<Layer, { type: "text" }> => l.id === editingTextId && l.type === "text");

  return (
    <div
      className={`stage-wrap${hoverDrop ? " drag" : ""}`}
      ref={wrapRef}
      onDragOver={(e) => {
        e.preventDefault();
        setHoverDrop(true);
      }}
      onDragLeave={() => setHoverDrop(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHoverDrop(false);
        onDropFiles([...e.dataTransfer.files]);
      }}
    >
      <canvas
        ref={canvasRef}
        className={`stage-canvas ${cursorClass()}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          const w = screenToWorld(e.clientX, e.clientY);
          const hit = hitTest(doc, w.x, w.y);
          if (hit?.type === "text") {
            onSelect(hit.id);
            onEditText(hit.id);
          }
        }}
      />
      <div className="drop-hint" />
      {selectedText ? (
        <textarea
          className="text-edit"
          style={{ left: 24, bottom: 24, width: 360, height: 90 }}
          value={selectedText.text}
          autoFocus
          onChange={(e) => onLive(updateLayer(doc, selectedText.id, { text: e.target.value, name: e.target.value.slice(0, 18) || "Text" }))}
          onBlur={() => {
            onCommit(docRef.current, "Edit text");
            onEditText(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
          }}
        />
      ) : null}
    </div>
  );
}

export function fitView(doc: EditorDocument, wrap: { width: number; height: number }): ViewState {
  const pad = 72;
  const zoom = Math.min((wrap.width - pad) / doc.width, (wrap.height - pad) / doc.height, 1.5);
  return { zoom, x: 0, y: 0 };
}
