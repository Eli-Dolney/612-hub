import { useEffect, useRef } from "react";

const PLAYER = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  html,body{margin:0;height:100%;background:#0c0d10;color:#8b90a0;font:12px Inter,system-ui,sans-serif;}
  #status{padding:8px 10px;}
</style>
</head>
<body>
<div id="status">Loading Strudel…</div>
<script type="module">
  import { init, evaluate, hush } from 'https://esm.sh/@strudel/web@1.2.5';
  const status = document.getElementById('status');
  let ready = false;
  init().then(() => {
    ready = true;
    status.textContent = 'Ready — press Play';
    parent.postMessage({ type: 'strudel-ready' }, '*');
  }).catch((err) => {
    status.textContent = 'Strudel failed to load (needs network once for @strudel/web)';
    parent.postMessage({ type: 'strudel-error', message: String(err) }, '*');
  });
  window.addEventListener('message', async (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'play') {
      try {
        await init();
        await evaluate(msg.code || '');
        status.textContent = 'Playing';
        parent.postMessage({ type: 'strudel-playing' }, '*');
      } catch (err) {
        status.textContent = 'Error: ' + (err && err.message ? err.message : err);
        parent.postMessage({ type: 'strudel-error', message: String(err) }, '*');
      }
    }
    if (msg.type === 'stop') {
      try { hush(); } catch (e) {}
      status.textContent = 'Stopped';
      parent.postMessage({ type: 'strudel-stopped' }, '*');
    }
  });
</script>
</body>
</html>`;

export default function StrudelStage({
  code,
  playing,
}: {
  code: string;
  playing: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const pending = useRef<"play" | "stop" | null>(null);

  const post = (type: "play" | "stop") => {
    const win = frame.current?.contentWindow;
    if (!win) return;
    if (!ready.current) {
      pending.current = type;
      return;
    }
    if (type === "play") win.postMessage({ type: "play", code }, "*");
    else win.postMessage({ type: "stop" }, "*");
  };

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data?.type === "strudel-ready") {
        ready.current = true;
        if (pending.current) {
          post(pending.current);
          pending.current = null;
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    post(playing ? "play" : "stop");
  }, [playing, code]);

  return (
    <iframe
      ref={frame}
      className="strudel-frame"
      title="Strudel live player"
      sandbox="allow-scripts allow-same-origin"
      srcDoc={PLAYER}
    />
  );
}
