import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ListOrdered, Plus, Trash2 } from "lucide-react";
import { api } from "./api";
import type { Detail, Health, Settings, Step, TrimMode } from "./types";

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

function trimStep(partial?: Partial<Extract<Step, { op: "trim" }>>): Step {
  return { id: uid(), op: "trim", mode: "keep", start: 0, duration: 30, ...partial };
}

function exportStep(captions: boolean): Step {
  return { id: uid(), op: "export", captions };
}

export const PRESETS: { id: string; label: string; hint: string; needsUrl?: boolean; steps: () => Step[] }[] = [
  {
    id: "cap30",
    label: "Shorts 30s",
    hint: "Keep 30s of this file, transcribe it, burn karaoke captions in the blur under the picture.",
    steps: () => [trimStep(), { id: uid(), op: "transcribe" }, exportStep(true)],
  },
  {
    id: "talk",
    label: "Whole file",
    hint: "Whisper the full clip, then export 9:16 with captions. Keep/drop lines after if you want.",
    steps: () => [{ id: uid(), op: "transcribe" }, exportStep(true)],
  },
  {
    id: "silent30",
    label: "30s silent",
    hint: "Keep the first 30 seconds. Skip Whisper and captions.",
    steps: () => [trimStep(), exportStep(false)],
  },
  {
    id: "pull30",
    label: "Download 30s",
    hint: "Paste a URL, keep 30s, skip speech. Switch to Shorts 30s if you want captions.",
    needsUrl: true,
    steps: () => [trimStep(), exportStep(false)],
  },
];

function stepTitle(step: Step) {
  if (step.op === "pull") return "Download";
  if (step.op === "transcribe") return "Transcribe";
  if (step.op === "export") return step.captions ? "Export + captions" : "Export, no captions";
  if (step.mode === "drop_head") return `Drop first ${step.duration}s`;
  if (step.mode === "drop_tail") return `Drop last ${step.duration}s`;
  return `Keep ${step.duration}s` + (step.start ? ` from ${step.start}s` : "");
}

export default function Pipeline({
  detail,
  health,
  settings,
  compact = false,
  onStatus,
}: {
  detail: Detail | null;
  health: Health | null;
  settings?: Partial<Settings>;
  compact?: boolean;
  onStatus: (text: string) => void;
}) {
  const [sourceKind, setSourceKind] = useState<"project" | "url">(detail ? "project" : "url");
  const [url, setUrl] = useState("");
  const [steps, setSteps] = useState<Step[]>(() => PRESETS[0].steps());
  const [preset, setPreset] = useState("cap30");

  const applyPreset = (id: string) => {
    const row = PRESETS.find((p) => p.id === id);
    if (!row) return;
    setPreset(id);
    setSteps(row.steps());
    if (row.needsUrl) setSourceKind("url");
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= steps.length) return;
    setSteps((list) => {
      const copy = [...list];
      const [row] = copy.splice(index, 1);
      copy.splice(next, 0, row);
      return copy;
    });
  };

  const patchStep = (id: string, patch: Partial<Step>) => {
    setSteps((list) => list.map((s) => (s.id === id ? ({ ...s, ...patch } as Step) : s)));
  };

  const snapshot = useMemo(() => {
    if (!settings) return {};
    const keys = [
      "frame",
      "layout",
      "border",
      "border_color",
      "credit",
      "credit_corner",
      "logo",
      "caption_style",
      "caption_position",
      "caption_active",
      "caption_rest",
      "caption_size",
      "caption_words",
      "caption_karaoke",
      "caption_uppercase",
      "captions",
      "model",
    ] as const;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (settings[key] != null && settings[key] !== "") out[key] = settings[key];
    }
    return out;
  }, [settings]);

  const queue = async () => {
    const useUrl = sourceKind === "url";
    if (useUrl && !url.trim()) {
      onStatus("Paste a video URL to download");
      return;
    }
    if (!useUrl && !detail) {
      onStatus("Open a clip, or switch the source to URL");
      return;
    }
    if (useUrl && health && health.ytdlp === false) {
      onStatus("yt-dlp is missing — install it in the GrokClip venv");
      return;
    }
    try {
      const job = await api.order({
        name: PRESETS.find((p) => p.id === preset)?.label || "Order",
        source: useUrl ? { kind: "url", url: url.trim() } : { kind: "project", slug: detail!.slug },
        steps,
        settings: snapshot,
      });
      onStatus(`Queued · ${job.title || "Order"} · #${job.id}`);
    } catch (err) {
      onStatus(err instanceof Error ? err.message : "Could not queue order");
    }
  };

  return (
    <div className={compact ? "pipe compact" : "pipe"}>
      {!compact && <div className="pane-head">Pipeline</div>}
      <div className="chip-row">
        <button className={sourceKind === "project" ? "tiny on" : "tiny"} onClick={() => setSourceKind("project")} disabled={!detail}>
          This clip
        </button>
        <button className={sourceKind === "url" ? "tiny on" : "tiny"} onClick={() => setSourceKind("url")}>
          URL
        </button>
      </div>
      {sourceKind === "url" && (
        <label className="field">
          Download
          <input
            value={url}
            placeholder="https://youtube.com/watch?v=…"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
      )}
      <div className="chip-row wrap">
        {PRESETS.filter((row) => sourceKind === "url" || !row.needsUrl).map((row) => (
          <button key={row.id} className={preset === row.id ? "tiny on" : "tiny"} onClick={() => applyPreset(row.id)}>
            {row.label}
          </button>
        ))}
      </div>
      <p className="hint">{PRESETS.find((p) => p.id === preset)?.hint}</p>
      <ol className="pipe-steps">
        {steps.map((step, index) => (
          <li key={step.id}>
            <span className="pipe-idx">{index + 1}</span>
            <div className="pipe-body">
              <strong>{stepTitle(step)}</strong>
              {step.op === "trim" && (
                <div className="pipe-edit">
                  <select value={step.mode} onChange={(e) => patchStep(step.id, { mode: e.target.value as TrimMode })}>
                    <option value="keep">Keep range</option>
                    <option value="drop_head">Drop start</option>
                    <option value="drop_tail">Drop end</option>
                  </select>
                  {step.mode === "keep" && (
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={step.start}
                      onChange={(e) => patchStep(step.id, { start: Number(e.target.value) })}
                      title="Start (seconds)"
                    />
                  )}
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={step.duration}
                    onChange={(e) => patchStep(step.id, { duration: Number(e.target.value) })}
                    title="Seconds"
                  />
                  <em>s</em>
                </div>
              )}
              {step.op === "export" && (
                <label className="check tight">
                  <input
                    type="checkbox"
                    checked={step.captions}
                    onChange={(e) => patchStep(step.id, { captions: e.target.checked })}
                  />
                  Burn captions
                </label>
              )}
            </div>
            <div className="pipe-tools">
              <button className="tiny" onClick={() => move(index, -1)} disabled={index === 0}>
                <ChevronUp size={12} />
              </button>
              <button className="tiny" onClick={() => move(index, 1)} disabled={index === steps.length - 1}>
                <ChevronDown size={12} />
              </button>
              <button className="tiny" onClick={() => setSteps((list) => list.filter((s) => s.id !== step.id))}>
                <Trash2 size={12} />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="chip-row wrap">
        <button className="tiny" onClick={() => setSteps((list) => [...list, trimStep()])}>
          <Plus size={12} /> Trim
        </button>
        <button className="tiny" onClick={() => setSteps((list) => [...list, { id: uid(), op: "transcribe" }])}>
          <Plus size={12} /> Transcribe
        </button>
        <button className="tiny" onClick={() => setSteps((list) => [...list, exportStep(true)])}>
          <Plus size={12} /> Export
        </button>
      </div>
      <button className="pull wide" onClick={() => void queue()}>
        <ListOrdered size={14} />
        Queue order
      </button>
    </div>
  );
}
