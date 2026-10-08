import { EQ_FREQS, EQ_PRESETS } from "../lib/types";
import { usePlayer } from "../state/player";
import { useUi } from "../state/ui";

export function EqSheet() {
  const open = useUi((s) => s.eqOpen);
  const setEqOpen = useUi((s) => s.setEqOpen);
  const { eqOn, bands, glue, crossfadeMs, vis, setEqOn, setBand, applyPreset, setGlue, setCrossfade, setVis } = usePlayer();
  if (!open) return null;

  return (
    <div className="modal-bg" onClick={() => setEqOpen(false)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>Sound</h3>
          <label className="switch">
            <input type="checkbox" checked={eqOn} onChange={(e) => setEqOn(e.target.checked)} />
            EQ
          </label>
        </div>
        <div className="preset-row">
          {EQ_PRESETS.map((p) => (
            <button key={p.name} className="chip" onClick={() => applyPreset(p.name)}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="eq">
          {EQ_FREQS.map((f, i) => (
            <label key={f} className="eq-col">
              <input
                type="range"
                min={-12}
                max={12}
                step={0.5}
                value={bands[i] ?? 0}
                onChange={(e) => setBand(i, Number(e.target.value))}
              />
              <span>{f >= 1000 ? `${f / 1000}k` : f}</span>
            </label>
          ))}
        </div>
        <label className="switch">
          <input type="checkbox" checked={glue} onChange={(e) => setGlue(e.target.checked)} />
          Glue compressor — evens loud and quiet albums
        </label>
        <div className="xfade">
          <span>Visualizer</span>
          <select className="vis-select" value={vis} onChange={(e) => setVis(e.target.value as typeof vis)}>
            <option value="aurora">Aurora</option>
            <option value="bars">Bars</option>
            <option value="wave">Wave</option>
            <option value="radial">Radial</option>
            <option value="particles">Particles</option>
            <option value="spectrogram">Spectrogram</option>
          </select>
          <span />
        </div>
        <div className="xfade">
          <span>Crossfade</span>
          <input
            type="range"
            min={0}
            max={8000}
            step={500}
            value={crossfadeMs}
            onChange={(e) => setCrossfade(Number(e.target.value))}
          />
          <b>{crossfadeMs === 0 ? "off" : `${crossfadeMs / 1000}s`}</b>
        </div>
      </div>
    </div>
  );
}
