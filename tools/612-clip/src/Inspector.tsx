import { useEffect, useMemo, useState, type RefObject } from "react";
import { Clapperboard, FolderOpen, ImagePlus, Trash2, X } from "lucide-react";
import { api, fmtDur, mediaUrl } from "./api";
import Pipeline from "./Pipeline";
import type { Clip, Detail, Health, InboxState, Job, Segment, Settings } from "./types";

const FONTS = [
  ["inter", "Inter"],
  ["montserrat", "Montserrat"],
  ["oswald", "Oswald"],
  ["anton", "Anton"],
  ["rubik", "Rubik"],
] as const;

const STYLE_PRESETS: Record<string, Partial<Settings> & { caption_style: string }> = {
  hook: {
    caption_style: "hook",
    caption_position: "blur",
    caption_active: "#f5a524",
    caption_rest: "#ffffff",
    caption_size: "m",
    caption_words: 4,
    caption_karaoke: true,
    caption_uppercase: false,
  },
  boxed: {
    caption_style: "boxed",
    caption_position: "lower",
    caption_active: "#ffffff",
    caption_rest: "#ffffff",
    caption_size: "m",
    caption_words: 5,
    caption_karaoke: false,
    caption_uppercase: true,
  },
  minimal: {
    caption_style: "minimal",
    caption_position: "lower",
    caption_active: "#ffffff",
    caption_rest: "#cccccc",
    caption_size: "s",
    caption_words: 6,
    caption_karaoke: false,
    caption_uppercase: false,
  },
};

const PLATFORM_PRESETS: Record<string, Partial<Settings>> = {
  tiktok: { frame: "9:16", caption_position: "blur", layout: "blur" },
  reels: { frame: "4:5", caption_position: "lower", layout: "blur" },
  shorts: { frame: "9:16", caption_position: "blur", layout: "blur" },
};

function kindLabel(job: Job) {
  if (job.kind === "order") return job.title || "Order";
  if (job.kind === "clip") return job.title || "Save clip";
  if (job.kind === "clips") return "Save kept";
  if (job.kind === "suggest") return job.title || "Suggest";
  return { probe: "Probe", transcribe: "Whisper", export: "Concat bundle" }[job.kind] || job.kind;
}

export default function Inspector({
  detail,
  health,
  clips,
  segments,
  jobs,
  busy,
  creditDraft,
  logoRef,
  selectedClipId,
  inboxRecipe,
  onCredit,
  onPatchSetting,
  onPatchSettings,
  onStatus,
  onDeleted,
  onTranscribe,
  onExportBundle,
  onDetail,
  onInboxRecipe,
}: {
  detail: Detail | null;
  health: Health | null;
  clips: Clip[];
  segments: Segment[];
  jobs: Job[];
  busy: boolean;
  creditDraft: string;
  logoRef: RefObject<HTMLInputElement | null>;
  selectedClipId: number | null;
  inboxRecipe: InboxState["recipe"];
  onCredit: (value: string) => void;
  onPatchSetting: (key: string, value: unknown) => void;
  onPatchSettings: (settings: Record<string, unknown>) => void;
  onStatus: (text: string) => void;
  onDeleted: () => void;
  onTranscribe: (scope: "all" | "kept") => void;
  onExportBundle: () => void;
  onDetail: (next: Detail) => void;
  onInboxRecipe: (recipe: InboxState["recipe"]) => void;
}) {
  const [tab, setTab] = useState<"clips" | "captions" | "look" | "batch">("clips");
  const [inbox, setInbox] = useState<InboxState | null>(null);
  const clip = clips.find((c) => c.id === selectedClipId) || null;
  const cueSegs = useMemo(() => {
    if (clip) return segments.filter((s) => s.end > clip.start && s.start < clip.end);
    return segments;
  }, [clip, segments]);
  const targetS = detail?.settings.suggest_target_s ?? 30;

  useEffect(() => {
    if (tab !== "batch") return;
    api.inbox().then(setInbox).catch(() => undefined);
    const tick = window.setInterval(() => {
      api.inbox().then(setInbox).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(tick);
  }, [tab]);

  const suggest = async (mode: "hooks" | "silence" | "both") => {
    if (!detail) return;
    try {
      await api.suggest(detail.slug, { mode, target_s: targetS });
      onStatus(mode === "silence" ? "Strip silence queued…" : "Suggest hooks queued…");
    } catch (err) {
      onStatus(err instanceof Error ? err.message : "Suggest failed");
    }
  };

  return (
    <aside className="inspector">
      <div className="insp-tabs">
        {(
          [
            ["clips", "Clips"],
            ["captions", "Captions"],
            ["look", "Look"],
            ["batch", "Batch"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? "tiny on" : "tiny"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "clips" && (
        <>
          <div className="pane-head">Keepers</div>
          {detail ? (
            <>
              <dl className="stats">
                <div>
                  <dt>Kept</dt>
                  <dd>{fmtDur(detail.kept_duration)}</dd>
                </div>
                <div>
                  <dt>Clips</dt>
                  <dd>{clips.length ? `${detail.kept_clips}/${clips.length}` : "0"}</dd>
                </div>
                <div>
                  <dt>Lines</dt>
                  <dd>
                    {detail.kept_lines}/{detail.lines}
                  </dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{detail.settings.model}</dd>
                </div>
              </dl>
              <label className="field">
                Whisper
                <select
                  value={detail.settings.model}
                  onChange={(e) => onPatchSetting("model", e.target.value)}
                  disabled={busy}
                >
                  {(health?.models || ["tiny", "base", "small"]).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <div className="chip-row wrap">
                <button className="tiny" disabled={busy || !detail.duration} onClick={() => onTranscribe("kept")}>
                  Transcribe kept
                </button>
                <button className="tiny" disabled={busy || !detail.duration} onClick={() => onTranscribe("all")}>
                  Whole file
                </button>
              </div>

              <div className="pane-head">Suggest</div>
              <label className="field">
                Target length
                <div className="chip-row">
                  {([15, 30, 45] as const).map((s) => (
                    <button
                      key={s}
                      className={targetS === s ? "tiny on" : "tiny"}
                      onClick={() => onPatchSetting("suggest_target_s", s)}
                    >
                      {s}s
                    </button>
                  ))}
                </div>
              </label>
              <div className="chip-row wrap">
                <button
                  className="tiny"
                  disabled={busy || !segments.length}
                  onClick={() => void suggest("hooks")}
                  title="Needs a transcript"
                >
                  Suggest hooks
                </button>
                <button className="tiny" disabled={busy || !detail.duration} onClick={() => void suggest("silence")}>
                  Strip silence
                </button>
              </div>

              <label className="check">
                <input
                  type="checkbox"
                  checked={detail.settings.remove_fillers}
                  onChange={(e) => onPatchSetting("remove_fillers", e.target.checked)}
                />
                Drop um / uh / like
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={detail.settings.tighten_pauses}
                  onChange={(e) => onPatchSetting("tighten_pauses", e.target.checked)}
                />
                Tighten long pauses
              </label>
              <label className="field">
                Split pause (s)
                <input
                  type="number"
                  min={0.2}
                  max={5}
                  step={0.1}
                  value={detail.settings.split_pause_s ?? 0.8}
                  onChange={(e) => onPatchSetting("split_pause_s", Math.max(0.2, Number(e.target.value) || 0.8))}
                />
              </label>
              <label className="field">
                Padding (s)
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.02}
                  value={detail.settings.padding_s ?? 0.08}
                  onChange={(e) => onPatchSetting("padding_s", Math.max(0, Number(e.target.value) || 0))}
                />
              </label>
              <button className="ghost wide" disabled={busy || !detail.duration} onClick={onExportBundle}>
                Export joined video
              </button>
            </>
          ) : (
            <p className="hint">Pick a 612 Pull download, mark keepers, save only those.</p>
          )}
        </>
      )}

      {tab === "captions" && detail && (
        <>
          <div className="pane-head">Captions</div>
          <label className="check">
            <input
              type="checkbox"
              checked={detail.settings.captions}
              onChange={(e) => onPatchSetting("captions", e.target.checked)}
            />
            Burn captions
          </label>
          <label className="field">
            Profile
            <div className="chip-row">
              {(
                [
                  ["intro", "Intro"],
                  ["tts", "TTS long"],
                  ["silent", "Silent"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={(detail.settings.caption_profile || "intro") === id ? "tiny on" : "tiny"}
                  onClick={() => onPatchSettings({ caption_profile: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            Font
            <div className="chip-row wrap">
              {FONTS.map(([id, label]) => (
                <button
                  key={id}
                  className={`tiny font-chip font-${id}${
                    (detail.settings.caption_font || "inter") === id ? " on" : ""
                  }`}
                  onClick={() => onPatchSetting("caption_font", id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            Style
            <div className="chip-row">
              {(
                [
                  ["hook", "Hook"],
                  ["boxed", "Boxed"],
                  ["minimal", "Minimal"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={detail.settings.caption_style === id ? "tiny on" : "tiny"}
                  onClick={() => onPatchSettings({ ...STYLE_PRESETS[id], caption_profile: "custom" })}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            Position
            <div className="chip-row">
              {(
                [
                  ["blur", "Blur"],
                  ["lower", "Lower third"],
                  ["center", "Center"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={(detail.settings.caption_position || "blur") === id ? "tiny on" : "tiny"}
                  onClick={() => onPatchSetting("caption_position", id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            Size
            <div className="chip-row">
              {(["s", "m", "l"] as const).map((id) => (
                <button
                  key={id}
                  className={(detail.settings.caption_size || "m") === id ? "tiny on" : "tiny"}
                  onClick={() => onPatchSetting("caption_size", id)}
                >
                  {id.toUpperCase()}
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            Active color
            <input
              type="color"
              className="swatch"
              value={detail.settings.caption_active || "#f5a524"}
              onChange={(e) => onPatchSetting("caption_active", e.target.value)}
            />
          </label>
          <label className="field">
            Rest color
            <input
              type="color"
              className="swatch"
              value={detail.settings.caption_rest || "#ffffff"}
              onChange={(e) => onPatchSetting("caption_rest", e.target.value)}
            />
          </label>
          <label className="field">
            Words per line
            <input
              type="number"
              min={1}
              max={6}
              value={detail.settings.caption_words ?? 4}
              onChange={(e) =>
                onPatchSetting("caption_words", Math.max(1, Math.min(6, Number(e.target.value) || 4)))
              }
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={detail.settings.caption_karaoke !== false}
              onChange={(e) => onPatchSetting("caption_karaoke", e.target.checked)}
            />
            Karaoke highlight
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(detail.settings.caption_uppercase)}
              onChange={(e) => onPatchSetting("caption_uppercase", e.target.checked)}
            />
            Uppercase
          </label>

          <div className="pane-head">{clip ? `Lines in ${clip.label}` : "Edit lines"}</div>
          <p className="hint">Click a line to fix Whisper. Preview and burn use the edited words.</p>
          <ul className="cue-list">
            {cueSegs.map((seg) => (
              <CueRow key={seg.id} seg={seg} slug={detail.slug} onStatus={onStatus} onDetail={onDetail} />
            ))}
            {!cueSegs.length && (
              <li className="muted">
                {segments.length ? "No lines in this clip." : "Transcribe kept ranges first."}
              </li>
            )}
          </ul>
        </>
      )}

      {tab === "look" && detail && (
        <>
          <div className="pane-head">Frame</div>
          <label className="field">
            Platform
            <div className="chip-row wrap">
              {(
                [
                  ["tiktok", "TikTok"],
                  ["reels", "Reels"],
                  ["shorts", "Shorts"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className="tiny"
                  onClick={() => onPatchSettings({ ...PLATFORM_PRESETS[id] })}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            Frame
            <div className="chip-row">
              {(["9:16", "16:9", "1:1", "4:5"] as const).map((frame) => (
                <button
                  key={frame}
                  className={detail.settings.frame === frame ? "tiny on" : "tiny"}
                  onClick={() => onPatchSetting("frame", frame)}
                >
                  {frame}
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            Fit
            <select value={detail.settings.layout} onChange={(e) => onPatchSetting("layout", e.target.value)}>
              <option value="blur">Blur fill</option>
              <option value="crop">Face crop</option>
            </select>
          </label>
          <div className="pane-head">Brand</div>
          <label className="field">
            Credit
            <input
              value={creditDraft}
              placeholder="@yourhandle"
              onChange={(e) => onCredit(e.target.value)}
              onBlur={() => {
                if (creditDraft !== (detail.settings.credit || "")) {
                  onPatchSetting("credit", creditDraft);
                }
              }}
            />
          </label>
          <label className="field">
            Credit corner
            <select
              value={detail.settings.credit_corner}
              onChange={(e) => onPatchSetting("credit_corner", e.target.value)}
            >
              <option value="bl">Lower left</option>
              <option value="br">Lower right</option>
            </select>
          </label>
          <label className="field">
            Border
            <select value={detail.settings.border} onChange={(e) => onPatchSetting("border", e.target.value)}>
              <option value="none">None</option>
              <option value="solid">Solid</option>
              <option value="glow">Glow</option>
            </select>
          </label>
          <label className="field">
            Border color
            <input
              type="color"
              className="swatch"
              value={detail.settings.border_color || "#c084fc"}
              onChange={(e) => onPatchSetting("border_color", e.target.value)}
            />
          </label>
          <div className="logo-row">
            {detail.settings.logo ? (
              <img className="logo-thumb" src={mediaUrl(detail.slug, detail.settings.logo)} alt="Logo" />
            ) : (
              <span className="muted">No logo</span>
            )}
            <button className="tiny" onClick={() => logoRef.current?.click()}>
              <ImagePlus size={12} />
              {detail.settings.logo ? "Replace" : "Logo"}
            </button>
            {detail.settings.logo && (
              <button
                className="tiny"
                onClick={async () => {
                  const next = await api.clearLogo(detail.slug);
                  onDetail(next);
                }}
              >
                Clear
              </button>
            )}
            <input
              ref={logoRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  const next = await api.uploadLogo(detail.slug, file);
                  onDetail(next);
                  onStatus("Logo on the opposite corner from the credit");
                } catch (err) {
                  onStatus(err instanceof Error ? err.message : "Logo upload failed");
                }
              }}
            />
          </div>
          <div className="pane-head">Bundle</div>
          {detail.bundle ? (
            <div className="bundle">
              {detail.bundle.thumbnail && (
                <img src={mediaUrl(detail.slug, detail.bundle.thumbnail)} alt="Thumbnail" />
              )}
              <p className="hint">{detail.youtube?.title}</p>
              {detail.bundle.clip_files && detail.bundle.clip_files.length > 0 && (
                <p className="hint">{detail.bundle.clip_files.length} individual clip files</p>
              )}
              <div className="chip-row wrap">
                {detail.bundle.captions && (
                  <a className="tiny" href={mediaUrl(detail.slug, detail.bundle.captions)} download>
                    Download SRT
                  </a>
                )}
                {(detail.bundle.captions_ass || detail.bundle.captions?.replace(/\.srt$/i, ".ass")) && (
                  <a
                    className="tiny"
                    href={mediaUrl(
                      detail.slug,
                      detail.bundle.captions_ass ||
                        String(detail.bundle.captions).replace(/\.srt$/i, ".ass"),
                    )}
                    download
                  >
                    Download ASS
                  </a>
                )}
              </div>
              <button
                className="tiny wide"
                disabled={busy || !segments.length}
                onClick={async () => {
                  try {
                    const next = await api.captions(detail.slug);
                    onDetail(next);
                    onStatus("Wrote captions.srt + captions.ass");
                  } catch (err) {
                    onStatus(err instanceof Error ? err.message : "Caption export failed");
                  }
                }}
              >
                Write SRT / ASS only
              </button>
              <button className="ghost wide" onClick={() => api.open(detail.slug)}>
                <FolderOpen size={14} />
                Reveal folder
              </button>
              <button className="pull wide" onClick={() => api.grokedit(detail.slug)}>
                <Clapperboard size={14} />
                Thumbnail → 612 Edit
              </button>
            </div>
          ) : (
            <div className="bundle">
              <p className="hint">Save kept clips for small files. Concat bundle if you want one joined export.</p>
              <button
                className="tiny wide"
                disabled={busy || !segments.length}
                onClick={async () => {
                  try {
                    const next = await api.captions(detail.slug);
                    onDetail(next);
                    onStatus("Wrote captions.srt + captions.ass");
                  } catch (err) {
                    onStatus(err instanceof Error ? err.message : "Caption export failed");
                  }
                }}
              >
                Write SRT / ASS only
              </button>
            </div>
          )}
        </>
      )}

      {tab === "batch" && (
        <>
          <div className="pane-head">Watch inbox</div>
          <p className="hint">Drop files into the inbox folder. Day-to-day chopping lives in Clips.</p>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(inbox?.enabled)}
              onChange={async (e) => {
                try {
                  const next = await api.patchInbox({ enabled: e.target.checked });
                  setInbox(next);
                  onStatus(next.enabled ? "Watching inbox" : "Inbox watch off");
                } catch (err) {
                  onStatus(err instanceof Error ? err.message : "Inbox update failed");
                }
              }}
            />
            Watch inbox folder
          </label>
          <label className="field">
            Recipe for drops
            <div className="chip-row wrap">
              {(
                [
                  ["suggest", "Suggest"],
                  ["shorts", "Shorts"],
                  ["silent", "Silent"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={(inbox?.recipe || inboxRecipe) === id ? "tiny on" : "tiny"}
                  onClick={async () => {
                    onInboxRecipe(id);
                    try {
                      const next = await api.patchInbox({ recipe: id });
                      setInbox(next);
                    } catch (err) {
                      onStatus(err instanceof Error ? err.message : "Could not set recipe");
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          <p className="hint mono">{inbox?.path || "…"}</p>
          <button
            className="tiny"
            onClick={async () => {
              try {
                const row = await api.openInbox();
                onStatus(`Inbox · ${row.path}`);
              } catch (err) {
                onStatus(err instanceof Error ? err.message : "Could not open inbox");
              }
            }}
          >
            <FolderOpen size={12} /> Reveal inbox
          </button>
          {inbox?.recent && inbox.recent.length > 0 && (
            <ul className="jobs">
              {inbox.recent.slice(0, 8).map((row, i) => (
                <li key={`${row.path}-${i}`}>
                  <em className={row.error ? "error" : "done"}>{row.recipe || "inbox"}</em>
                  <span>{row.name}</span>
                  <span>{row.error || row.slug || ""}</span>
                </li>
              ))}
            </ul>
          )}
          <Pipeline
            detail={detail}
            health={health}
            settings={detail ? { ...detail.settings, credit: creditDraft } : undefined}
            onStatus={onStatus}
          />
        </>
      )}

      {detail && (
        <button
          className="ghost wide danger"
          onClick={async () => {
            await api.remove(detail.slug);
            onDeleted();
          }}
        >
          <Trash2 size={14} />
          Delete project
        </button>
      )}

      <div className="pane-head">Jobs</div>
      <ul className="jobs">
        {(detail ? jobs.filter((job) => job.project === detail.slug || job.status === "running" || job.status === "queued") : jobs).slice(0, 6).map((job) => (
          <li key={job.id}>
            <em className={job.status}>{kindLabel(job)}</em>
            <span className="job-step" title={job.error || job.step}>{job.step}</span>
            <span className="job-tools">
              {job.status === "queued" || job.status === "running" ? (
                <>
                  {Math.round(job.progress * 100)}%
                  <button
                    className="tiny"
                    title="Cancel"
                    onClick={() => void api.cancel(job.id).then(() => onStatus("Cancelled"))}
                  >
                    <X size={10} />
                  </button>
                </>
              ) : null}
            </span>
          </li>
        ))}
        {!jobs.length && <li className="muted">Idle</li>}
      </ul>
    </aside>
  );
}

function CueRow({
  seg,
  slug,
  onStatus,
  onDetail,
}: {
  seg: Segment;
  slug: string;
  onStatus: (text: string) => void;
  onDetail: (next: Detail) => void;
}) {
  const [draft, setDraft] = useState(seg.text);
  useEffect(() => {
    setDraft(seg.text);
  }, [seg.text]);
  return (
    <li>
      <span className="time">{fmtDur(seg.start)}</span>
      <textarea
        className="cue-edit"
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          if (draft.trim() === seg.text.trim()) return;
          try {
            const next = await api.patchSegment(slug, seg.id, draft);
            onDetail(next);
            onStatus("Caption line updated");
          } catch (err) {
            onStatus(err instanceof Error ? err.message : "Could not edit line");
            setDraft(seg.text);
          }
        }}
      />
    </li>
  );
}
