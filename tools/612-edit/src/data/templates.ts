import type { EditorDocument, Layer, TextLayer } from "../types";
import { addLayers, createDocument, createFill, createShapeLayer, createTextLayer } from "../engine/document";

export type TemplateDef = {
  id: string;
  name: string;
  group: string;
  width: number;
  height: number;
  swatch: [string, string];
  tags: string[];
  blurb: string;
  build: () => EditorDocument;
};

export const TEMPLATE_GROUPS = [
  "YouTube",
  "Gaming",
  "Tutorial",
  "Podcast",
  "News",
  "Instagram",
  "Stories",
  "X",
  "LinkedIn",
  "Banners",
] as const;

const plain: Partial<TextLayer> = {
  outline: { enabled: false, color: "#000000", width: 0 },
  shadow: { enabled: false, color: "#000000", blur: 0, x: 0, y: 0 },
  glow: { enabled: false, color: "#000000", size: 0 },
};

const ytOutline: Partial<TextLayer> = {
  fontFamily: "Anton",
  fontWeight: "400",
  color: "#ffffff",
  outline: { enabled: true, color: "#111111", width: 8 },
  shadow: { enabled: true, color: "rgba(0,0,0,0.6)", blur: 10, x: 0, y: 6 },
  glow: { enabled: false, color: "#000", size: 0 },
};

const txt = (
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<TextLayer> = {},
): TextLayer => createTextLayer(text, x, y, { width: w, height: h, ...extra });

const bg = (
  name: string,
  w: number,
  h: number,
  start: string,
  end: string,
  angle = 135,
  kind: "linear" | "radial" = "linear",
): EditorDocument => {
  const doc = createDocument(name, w, h, start);
  doc.layers = [createFill("Background", w, h, start, { kind, start, end, angle })];
  return doc;
};

const well = (x: number, y: number, w: number, h: number, label = "PHOTO"): Layer[] => [
  createShapeLayer("rect", x, y, w, h, { name: "Photo well", fill: "#0c1018", stroke: "#3a455c", strokeWidth: 3 }),
  txt(label, x, y + h / 2 - 16, w, 32, {
    ...plain,
    fontFamily: "Inter",
    fontWeight: "600",
    fontSize: 18,
    color: "#6d778c",
    align: "center",
  }),
];

const pack = (doc: EditorDocument, layers: Layer[]): EditorDocument => addLayers(doc, layers);

const def = (
  id: string,
  name: string,
  group: string,
  width: number,
  height: number,
  swatch: [string, string],
  tags: string[],
  blurb: string,
  build: () => EditorDocument,
): TemplateDef => ({ id, name, group, width, height, swatch, tags, blurb, build });

const YT = 1280;
const YH = 720;

export const TEMPLATES: TemplateDef[] = [
  def("face-title", "Face + Title", "YouTube", YT, YH, ["#0b1220", "#1c3a5f"], ["youtube", "face", "split"], "Photo left, big title on a dark panel.", () =>
    pack(bg("Face + Title", YT, YH, "#0b1220", "#17324f", 120), [
      ...well(0, 0, 760, 720, "DROP FACE / SCREENSHOT"),
      createShapeLayer("rect", 760, 0, 520, 720, { name: "Panel", fill: "#111827", strokeWidth: 0 }),
      txt("YOUR\nTITLE", 790, 160, 460, 280, { ...ytOutline, fontSize: 92, align: "left", color: "#fff200" }),
      txt("One-line hook here", 790, 480, 460, 56, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 28, color: "#d7e3f4", align: "left" }),
    ]),
  ),

  def("face-right", "Title + Face", "YouTube", YT, YH, ["#1a0a08", "#7a1d12"], ["youtube", "face"], "Title left, photo well on the right.", () =>
    pack(bg("Title + Face", YT, YH, "#1a0a08", "#5a140e", 40), [
      ...well(700, 0, 580, 720, "PHOTO"),
      txt("I TRIED\nTHIS", 48, 140, 640, 280, { ...ytOutline, fontSize: 108, align: "left", color: "#ffffff" }),
      txt("AND IT BROKE", 48, 460, 620, 70, { ...ytOutline, fontSize: 42, align: "left", color: "#ffd000", outline: { enabled: true, color: "#111", width: 5 } }),
    ]),
  ),

  def("big-type", "Big Type", "YouTube", YT, YH, ["#140308", "#4a1014"], ["youtube", "text"], "Full-frame shouting title with a CTA pill.", () =>
    pack(bg("Big Type", YT, YH, "#140308", "#4a1014", 160), [
      txt("STOP\nSCROLLING", 80, 120, 1120, 360, { ...ytOutline, fontSize: 148, outline: { enabled: true, color: "#111", width: 12 } }),
      createShapeLayer("badge", 470, 540, 340, 64, { fill: "#ff2d2d", strokeWidth: 0, name: "Badge" }),
      txt("WATCH THIS", 470, 548, 340, 52, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 32 }),
    ]),
  ),

  def("yellow-pop", "Yellow Pop", "YouTube", YT, YH, ["#0a0a0a", "#222"], ["youtube", "classic"], "Classic black canvas, yellow Impact title.", () =>
    pack(bg("Yellow Pop", YT, YH, "#0e0e0e", "#1c1c1c", 180), [
      ...well(40, 80, 560, 560, "PHOTO"),
      txt("WAIT\nWHAT?!", 640, 140, 600, 320, { ...ytOutline, fontSize: 120, color: "#ffe600", align: "left" }),
      createShapeLayer("arrow", 640, 500, 280, 56, { stroke: "#ff2d2d", fill: "#ff2d2d", strokeWidth: 14, name: "Arrow" }),
    ]),
  ),

  def("circle-arrow", "Circle + Arrow", "YouTube", YT, YH, ["#101418", "#2a3344"], ["youtube", "arrow", "highlight"], "Highlight a detail with a circle and arrow.", () =>
    pack(bg("Circle + Arrow", YT, YH, "#12161c", "#243044", 90), [
      ...well(0, 0, 1280, 720, "SCREENSHOT"),
      createShapeLayer("ellipse", 780, 160, 280, 280, { fill: "rgba(0,0,0,0)", stroke: "#ffe600", strokeWidth: 16, name: "Circle" }),
      createShapeLayer("arrow", 420, 280, 340, 60, { rotation: -12, stroke: "#ff2d2d", fill: "#ff2d2d", strokeWidth: 16, name: "Arrow" }),
      txt("LOOK", 80, 520, 420, 120, { ...ytOutline, fontSize: 92, color: "#ffe600", align: "left" }),
    ]),
  ),

  def("listicle", "Listicle", "YouTube", YT, YH, ["#08101c", "#123056"], ["youtube", "list", "number"], "Giant number + list title.", () =>
    pack(bg("Listicle", YT, YH, "#08101c", "#123056", 50), [
      txt("7", 40, 40, 280, 280, { ...ytOutline, fontSize: 260, color: "#5b8cff", align: "left", outline: { enabled: true, color: "#071018", width: 10 } }),
      txt("THINGS I\nWISH I KNEW", 340, 160, 900, 260, { ...ytOutline, fontSize: 86, align: "left" }),
      txt("BEFORE STARTING", 340, 460, 880, 70, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 36, color: "#9ec0ff", align: "left" }),
    ]),
  ),

  def("top-ten", "Top 10", "YouTube", YT, YH, ["#1a1204", "#c9a227"], ["youtube", "rank"], "Gold ranked list cover.", () =>
    pack(bg("Top 10", YT, YH, "#1a1406", "#6b5310", 160, "radial"), [
      createShapeLayer("badge", 80, 80, 220, 72, { fill: "#111111", strokeWidth: 0, name: "Tag" }),
      txt("RANKED", 80, 92, 220, 48, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 28 }),
      txt("TOP 10", 80, 220, 1120, 180, { ...ytOutline, fontSize: 150, color: "#ffd000" }),
      txt("You have to see #1", 80, 460, 1120, 80, { ...ytOutline, fontSize: 48, fontFamily: "Oswald", fontWeight: "700" }),
    ]),
  ),

  def("versus", "Versus", "YouTube", YT, YH, ["#111", "#333"], ["youtube", "vs", "split"], "Two photos, VS in the middle.", () => {
    const doc = createDocument("Versus", YT, YH, "#111");
    doc.layers = [
      createFill("Left", 640, 720, "#1a1f2c"),
      { ...createFill("Right", 640, 720, "#2c1a1a"), x: 640 },
    ];
    return pack(doc, [
      ...well(40, 120, 540, 480, "OPTION A"),
      ...well(700, 120, 540, 480, "OPTION B"),
      createShapeLayer("ellipse", 560, 280, 160, 160, { fill: "#ffe600", strokeWidth: 0, name: "VS disc" }),
      txt("VS", 560, 318, 160, 90, { ...plain, fontFamily: "Anton", fontSize: 72, color: "#111111" }),
    ]);
  }),

  def("split-ba", "Before / After", "YouTube", YT, YH, ["#111111", "#3a3a3a"], ["youtube", "split", "photo"], "Side-by-side comparison.", () => {
    const doc = createDocument("Before / After", YT, YH, "#111");
    doc.layers = [createFill("Left", 640, 720, "#1c1c1c"), { ...createFill("Right", 640, 720, "#3a3a3a"), x: 640 }];
    return pack(doc, [
      createShapeLayer("rect", 628, 0, 24, 720, { fill: "#ffffff", strokeWidth: 0, name: "Split" }),
      txt("BEFORE", 40, 40, 280, 64, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 42, align: "left" }),
      txt("AFTER", 960, 40, 280, 64, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 42, align: "right", color: "#ffe600" }),
    ]);
  }),

  def("bottom-third", "Bottom Third", "YouTube", YT, YH, ["#0d1520", "#1c3048"], ["youtube", "lower-third"], "Photo full-bleed with a title bar.", () =>
    pack(bg("Bottom Third", YT, YH, "#0d1520", "#1c3048", 90), [
      ...well(0, 0, 1280, 720, "DROP PHOTO"),
      createShapeLayer("rect", 0, 520, 1280, 200, { fill: "rgba(8,10,16,0.88)", strokeWidth: 0, name: "Bar" }),
      txt("THE TITLE GOES HERE", 48, 548, 1180, 80, { ...ytOutline, fontSize: 56, align: "left" }),
      txt("And a quieter subtitle under it", 48, 630, 1000, 48, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 24, color: "#c5cde0", align: "left" }),
    ]),
  ),

  def("reaction", "Reaction", "YouTube", YT, YH, ["#ff416c", "#ff4b2b"], ["youtube", "reaction"], "Giant reaction word + photo well.", () =>
    pack(bg("Reaction", YT, YH, "#c4123a", "#e24a1c", 90), [
      ...well(40, 200, 520, 460, "FACE"),
      txt("OMG", 560, 80, 680, 220, { ...ytOutline, fontSize: 180, outline: { enabled: true, color: "#111", width: 12 } }),
      txt("I CAN'T\nBELIEVE THIS", 580, 340, 640, 220, { ...ytOutline, fontSize: 64, align: "left", color: "#fff200" }),
    ]),
  ),

  def("question", "Question", "YouTube", YT, YH, ["#0b1a14", "#123c2c"], ["youtube", "question"], "Curiosity gap title with a big question mark.", () =>
    pack(bg("Question", YT, YH, "#0b1a14", "#123c2c", 140), [
      txt("?", 820, 40, 420, 420, { ...plain, fontFamily: "Anton", fontSize: 380, color: "rgba(61,214,140,0.22)" }),
      txt("IS THIS\nEVEN REAL?", 64, 160, 900, 280, { ...ytOutline, fontSize: 100, align: "left" }),
      txt("Watch to the end", 64, 500, 700, 60, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 32, color: "#3dd68c", align: "left" }),
    ]),
  ),

  def("exposed", "Exposed", "YouTube", YT, YH, ["#140404", "#5a0a0a"], ["youtube", "drama"], "Redacted-bar drama layout.", () =>
    pack(bg("Exposed", YT, YH, "#140404", "#4a0c0c", 180), [
      txt("EXPOSED", 80, 80, 1120, 140, { ...ytOutline, fontSize: 110, color: "#ff2d2d" }),
      createShapeLayer("rect", 80, 280, 1120, 120, { fill: "#111111", strokeWidth: 0, name: "Redact" }),
      txt("████  █████  ███", 80, 300, 1120, 80, { ...plain, fontFamily: "Inter", fontWeight: "700", fontSize: 48, color: "#333" }),
      txt("They didn't want this public", 80, 460, 1120, 70, { ...ytOutline, fontSize: 42, fontFamily: "Oswald", fontWeight: "700" }),
    ]),
  ),

  def("review", "Review Score", "YouTube", YT, YH, ["#101018", "#2a2040"], ["youtube", "review"], "Big score badge over a photo well.", () =>
    pack(bg("Review Score", YT, YH, "#101018", "#241c38", 50), [
      ...well(0, 0, 820, 720, "GAME / PRODUCT"),
      createShapeLayer("roundRect", 860, 180, 360, 360, { fill: "#7c3aed", radius: 28, strokeWidth: 0, name: "Score" }),
      txt("9.4", 860, 240, 360, 160, { ...plain, fontFamily: "Anton", fontSize: 140 }),
      txt("OUT OF 10", 860, 420, 360, 50, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 24, color: "#e9d5ff" }),
    ]),
  ),

  def("cinematic", "Cinematic", "YouTube", YT, YH, ["#07080c", "#1a1c24"], ["youtube", "film"], "Letterboxed documentary title.", () =>
    pack(bg("Cinematic", YT, YH, "#07080c", "#161820", 180), [
      ...well(0, 80, 1280, 560, "STILL"),
      createShapeLayer("rect", 0, 0, 1280, 80, { fill: "#000", strokeWidth: 0, name: "Bar top" }),
      createShapeLayer("rect", 0, 640, 1280, 80, { fill: "#000", strokeWidth: 0, name: "Bar bottom" }),
      txt("A SHORT FILM", 80, 300, 1120, 80, { ...plain, fontFamily: "Bebas Neue", fontSize: 72, letterSpacing: 8 }),
      txt("THE LAST LIGHT", 80, 380, 1120, 90, { ...plain, fontFamily: "Georgia", fontSize: 36, color: "#c8c4b8" }),
    ]),
  ),

  def("challenge", "Challenge", "YouTube", YT, YH, ["#1c1408", "#e85d04"], ["youtube", "challenge"], "24 hour / I survived layout.", () =>
    pack(bg("Challenge", YT, YH, "#1c1408", "#7a2e08", 120), [
      createShapeLayer("badge", 80, 80, 280, 64, { fill: "#ff7a18", strokeWidth: 0, name: "Tag" }),
      txt("24 HOURS", 80, 92, 280, 44, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 26, color: "#111" }),
      txt("I SURVIVED\nON $1", 80, 200, 1120, 280, { ...ytOutline, fontSize: 108, align: "left" }),
      txt("Don't try this", 80, 540, 600, 60, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 28, color: "#ffd0a8", align: "left" }),
    ]),
  ),

  def("finance", "Finance", "YouTube", YT, YH, ["#07140c", "#0b3d24"], ["youtube", "money"], "Green money / market thumbnail.", () =>
    pack(bg("Finance", YT, YH, "#07140c", "#0b3d24", 40), [
      txt("+$12,480", 64, 80, 1150, 140, { ...ytOutline, fontSize: 110, color: "#3dd68c", align: "left" }),
      txt("THIS STRATEGY\nACTUALLY WORKS", 64, 260, 1100, 240, { ...ytOutline, fontSize: 72, align: "left" }),
      txt("No hype. Just the chart.", 64, 560, 800, 50, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 24, color: "#9ee0bc", align: "left" }),
    ]),
  ),

  def("sports", "Sports Board", "YouTube", YT, YH, ["#081018", "#12305a"], ["youtube", "sports"], "Scoreboard-style recap.", () =>
    pack(bg("Sports Board", YT, YH, "#081018", "#12305a", 180), [
      txt("FINAL", 80, 48, 300, 48, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 28, color: "#7aa2ff", align: "left" }),
      txt("HOME  24", 80, 160, 520, 160, { ...ytOutline, fontSize: 92, align: "left" }),
      txt("AWAY  21", 80, 340, 520, 160, { ...ytOutline, fontSize: 92, align: "left", color: "#ffb4b4" }),
      ...well(700, 80, 520, 560, "HIGHLIGHT"),
    ]),
  ),

  def("tutorial", "How-To", "Tutorial", YT, YH, ["#071c22", "#0d3d48"], ["youtube", "tutorial", "how-to"], "Step-by-step tutorial cover.", () =>
    pack(bg("How-To", YT, YH, "#071c22", "#0d3d48", 40), [
      txt("HOW TO", 80, 80, 500, 56, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 32, color: "#5ce1e6", align: "left" }),
      txt("Edit photos\nwithout Photoshop", 80, 150, 760, 260, { ...ytOutline, fontSize: 64, align: "left" }),
      createShapeLayer("rect", 80, 470, 640, 8, { fill: "#5ce1e6", strokeWidth: 0, name: "Rule" }),
      txt("Free  ·  Local  ·  Fast", 80, 500, 640, 50, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 26, color: "#c8e8ec", align: "left" }),
      ...well(880, 120, 340, 480, "UI"),
    ]),
  ),

  def("tech-terminal", "Tech Terminal", "Tutorial", YT, YH, ["#05080c", "#0d1f18"], ["tutorial", "dev", "code"], "Dev / coding video cover.", () =>
    pack(bg("Tech Terminal", YT, YH, "#05080c", "#0a1c14", 180), [
      createShapeLayer("roundRect", 60, 80, 1160, 560, { fill: "#0b1210", stroke: "#1f3d32", strokeWidth: 2, radius: 16, name: "Window" }),
      txt("> npm run build", 100, 140, 1080, 70, { ...plain, fontFamily: "Courier New", fontWeight: "700", fontSize: 36, color: "#67ff9a", align: "left" }),
      txt("I AUTOMATED\nMY WHOLE WEEK", 100, 260, 1080, 240, { ...ytOutline, fontSize: 72, align: "left" }),
    ]),
  ),

  def("steps", "3 Steps", "Tutorial", YT, YH, ["#10141c", "#243044"], ["tutorial", "steps"], "Three numbered cards.", () =>
    pack(bg("3 Steps", YT, YH, "#10141c", "#1c2838", 90), [
      txt("DO THIS IN 3 STEPS", 60, 48, 1160, 80, { ...ytOutline, fontSize: 48 }),
      createShapeLayer("roundRect", 60, 180, 360, 460, { fill: "#1a2433", radius: 18, strokeWidth: 0, name: "1" }),
      createShapeLayer("roundRect", 460, 180, 360, 460, { fill: "#1a2433", radius: 18, strokeWidth: 0, name: "2" }),
      createShapeLayer("roundRect", 860, 180, 360, 460, { fill: "#1a2433", radius: 18, strokeWidth: 0, name: "3" }),
      txt("01", 60, 220, 360, 100, { ...plain, fontFamily: "Anton", fontSize: 72, color: "#5b8cff" }),
      txt("02", 460, 220, 360, 100, { ...plain, fontFamily: "Anton", fontSize: 72, color: "#3dd68c" }),
      txt("03", 860, 220, 360, 100, { ...plain, fontFamily: "Anton", fontSize: 72, color: "#ffb020" }),
      txt("Plan", 60, 360, 360, 60, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 36 }),
      txt("Build", 460, 360, 360, 60, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 36 }),
      txt("Ship", 860, 360, 360, 60, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 36 }),
    ]),
  ),

  def("podcast", "Podcast Bar", "Podcast", YT, YH, ["#16120c", "#c45a12"], ["podcast", "talk"], "Photo with a lower-third show bar.", () =>
    pack(bg("Podcast Bar", YT, YH, "#16120c", "#3a220e", 90), [
      ...well(0, 0, 1280, 560, "GUEST / HOST"),
      createShapeLayer("rect", 0, 560, 1280, 160, { fill: "#111111", strokeWidth: 0, name: "Bar" }),
      txt("THE CONVERSATION", 48, 590, 900, 100, { ...plain, fontFamily: "Bebas Neue", fontSize: 56, align: "left" }),
      createShapeLayer("ellipse", 1100, 590, 100, 100, { fill: "#ff7a18", strokeWidth: 0, name: "Dot" }),
    ]),
  ),

  def("podcast-two", "Two Hosts", "Podcast", YT, YH, ["#120c18", "#3a2060"], ["podcast", "split"], "Two photo wells and a show title.", () =>
    pack(bg("Two Hosts", YT, YH, "#120c18", "#2a1848", 180), [
      ...well(40, 40, 580, 500, "HOST A"),
      ...well(660, 40, 580, 500, "HOST B"),
      txt("EP. 42  —  THE LONG TAKE", 40, 580, 1200, 90, { ...ytOutline, fontSize: 48, fontFamily: "Bebas Neue" }),
    ]),
  ),

  def("news-break", "Breaking", "News", YT, YH, ["#1a0505", "#8b0000"], ["news", "breaking"], "Breaking news ticker thumbnail.", () =>
    pack(bg("Breaking", YT, YH, "#1a0505", "#5a0000", 180), [
      createShapeLayer("rect", 0, 0, 1280, 90, { fill: "#ff2d2d", strokeWidth: 0, name: "Ticker" }),
      txt("BREAKING", 40, 18, 600, 60, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 40, align: "left" }),
      txt("HEADLINE GOES\nRIGHT HERE", 48, 160, 1180, 280, { ...ytOutline, fontSize: 92, align: "left" }),
      txt("Live updates · 6:42 PM", 48, 500, 800, 50, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 24, color: "#ffc9c9", align: "left" }),
    ]),
  ),

  def("news-clean", "News Clean", "News", YT, YH, ["#0c1220", "#1a2744"], ["news", "anchor"], "Clean news lower-third.", () =>
    pack(bg("News Clean", YT, YH, "#0c1220", "#1a2744", 90), [
      ...well(0, 0, 1280, 720, "B-ROLL / ANCHOR"),
      createShapeLayer("rect", 0, 560, 18, 160, { fill: "#5b8cff", strokeWidth: 0, name: "Accent" }),
      createShapeLayer("rect", 18, 560, 1262, 160, { fill: "rgba(8,12,22,0.92)", strokeWidth: 0, name: "Bar" }),
      txt("TONIGHT", 48, 572, 400, 36, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 18, color: "#5b8cff", align: "left" }),
      txt("The story in one sentence", 48, 612, 1180, 70, { ...plain, fontFamily: "Inter", fontWeight: "700", fontSize: 36, align: "left" }),
    ]),
  ),

  def("gaming-hype", "Gaming Hype", "Gaming", YT, YH, ["#140624", "#2a0a4a"], ["gaming", "clutch"], "Neon clutch / hype title.", () =>
    pack(bg("Gaming Hype", YT, YH, "#140624", "#2a0a4a", 150), [
      txt("CLUTCH", 80, 180, 1120, 180, {
        fontFamily: "Anton",
        fontSize: 160,
        color: "#ffffff",
        outline: { enabled: true, color: "#7a2bff", width: 8 },
        glow: { enabled: true, color: "#9b5cff", size: 24 },
        shadow: { enabled: false, color: "#000", blur: 0, x: 0, y: 0 },
      }),
      txt("YOU WON'T BELIEVE THIS ENDING", 80, 420, 1120, 80, {
        fontFamily: "Oswald",
        fontWeight: "700",
        fontSize: 36,
        color: "#67ff9a",
        outline: { enabled: true, color: "#06140c", width: 4 },
        glow: { enabled: false, color: "#000", size: 0 },
        shadow: { enabled: false, color: "#000", blur: 0, x: 0, y: 0 },
      }),
    ]),
  ),

  def("stream-live", "Stream Starting", "Gaming", 1920, 1080, ["#1a0a2e", "#9146ff"], ["gaming", "stream", "twitch"], "Starting-soon stream scene.", () =>
    pack(bg("Stream Starting", 1920, 1080, "#1a0a2e", "#3b1466", 180, "radial"), [
      txt("STREAM STARTING", 80, 360, 1760, 160, {
        fontFamily: "Anton",
        fontSize: 120,
        color: "#ffffff",
        outline: { enabled: true, color: "#9146ff", width: 6 },
        glow: { enabled: true, color: "#9146ff", size: 28 },
        shadow: { enabled: false, color: "#000", blur: 0, x: 0, y: 0 },
      }),
      txt("GET READY", 80, 560, 1760, 80, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 48, color: "#67ff9a" }),
    ]),
  ),

  def("victory", "Victory", "Gaming", YT, YH, ["#ffd700", "#ff8c00"], ["gaming", "win"], "Gold victory royale style.", () =>
    pack(bg("Victory", YT, YH, "#ffb000", "#c45a00", 180, "radial"), [
      txt("VICTORY", 80, 180, 1120, 180, { ...ytOutline, fontSize: 140, color: "#ffffff", outline: { enabled: true, color: "#111", width: 10 } }),
      txt("#1  CHAMPION", 80, 400, 1120, 90, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 56, color: "#1a1208" }),
    ]),
  ),

  def("rank-up", "Rank Up", "Gaming", YT, YH, ["#0a1628", "#1d4e89"], ["gaming", "rank"], "Ranked grind thumbnail.", () =>
    pack(bg("Rank Up", YT, YH, "#0a1628", "#163a66", 50), [
      createShapeLayer("star", 80, 200, 220, 220, { fill: "#5b8cff", strokeWidth: 0, sides: 5, name: "Rank" }),
      txt("FROM IRON\nTO IMMORTAL", 340, 180, 900, 280, { ...ytOutline, fontSize: 86, align: "left" }),
      txt("The climb nobody asked for", 340, 500, 860, 60, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 28, color: "#9ec0ff", align: "left" }),
    ]),
  ),

  def("ig-quote", "Quote Card", "Instagram", 1080, 1080, ["#f4e7d8", "#e8cbb4"], ["instagram", "quote"], "Soft quote post.", () =>
    pack(bg("Quote Card", 1080, 1080, "#f4e7d8", "#e8cbb4", 135), [
      txt("“Write the line\npeople screenshot.”", 90, 360, 900, 280, {
        ...plain,
        fontFamily: "Georgia",
        fontWeight: "400",
        fontSize: 54,
        color: "#2a2118",
        lineHeight: 1.25,
      }),
      txt("— your name", 90, 700, 900, 60, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 28, color: "#6b5748" }),
    ]),
  ),

  def("ig-tip", "Tip Card", "Instagram", 1080, 1080, ["#0f172a", "#1e3a5f"], ["instagram", "carousel", "tip"], "Educational carousel cover.", () =>
    pack(bg("Tip Card", 1080, 1080, "#0f172a", "#1e3a5f", 140), [
      createShapeLayer("badge", 80, 80, 200, 56, { fill: "#5b8cff", strokeWidth: 0, name: "Tag" }),
      txt("TIP 01", 80, 90, 200, 40, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 22 }),
      txt("Save this\nfor later", 80, 280, 920, 280, { ...ytOutline, fontSize: 92, align: "left" }),
      txt("Swipe for the full list →", 80, 900, 900, 50, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 24, color: "#9ec0ff", align: "left" }),
    ]),
  ),

  def("ig-announce", "Announcement", "Instagram", 1080, 1080, ["#111111", "#333"], ["instagram", "launch"], "Bold launch / drop post.", () =>
    pack(bg("Announcement", 1080, 1080, "#111111", "#2a2a2a", 180), [
      txt("IT'S LIVE", 80, 360, 920, 160, { ...ytOutline, fontSize: 110 }),
      txt("Link in bio", 80, 560, 920, 60, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 32, color: "#ffe600" }),
    ]),
  ),

  def("ig-product", "Product", "Instagram", 1080, 1080, ["#f5f2ea", "#d9d2c3"], ["instagram", "product"], "Light product shot frame.", () =>
    pack(bg("Product", 1080, 1080, "#f5f2ea", "#ddd6c8", 135), [
      ...well(140, 80, 800, 720, "PRODUCT PHOTO"),
      txt("NEW ARRIVAL", 80, 840, 920, 70, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 36, color: "#1a1a1a" }),
      txt("Tap to shop", 80, 920, 920, 50, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 22, color: "#6b6560" }),
    ]),
  ),

  def("story-cover", "Story Cover", "Stories", 1080, 1920, ["#24103f", "#5b21b6"], ["story", "instagram", "tiktok"], "Vertical cover for stories / shorts.", () =>
    pack(bg("Story Cover", 1080, 1920, "#24103f", "#5b21b6", 180), [
      txt("TODAY", 80, 760, 920, 140, { ...plain, fontFamily: "Bebas Neue", fontSize: 120, shadow: { enabled: true, color: "rgba(0,0,0,0.35)", blur: 18, x: 0, y: 8 } }),
      txt("Tap through", 80, 920, 920, 80, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 36, color: "#e9d5ff" }),
    ]),
  ),

  def("story-quote", "Story Quote", "Stories", 1080, 1920, ["#111111", "#222"], ["story", "quote"], "Full-screen quote story.", () =>
    pack(bg("Story Quote", 1080, 1920, "#111111", "#1c1c1c", 180), [
      txt("A line that\nholds the\nwhole screen.", 80, 640, 920, 420, { ...ytOutline, fontSize: 72, align: "left", lineHeight: 1.15 }),
      txt("@yourhandle", 80, 1680, 920, 50, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 22, color: "#8b90a0", align: "left" }),
    ]),
  ),

  def("story-countdown", "Story Countdown", "Stories", 1080, 1920, ["#1a0508", "#7a1020"], ["story", "countdown"], "Launch countdown story.", () =>
    pack(bg("Story Countdown", 1080, 1920, "#1a0508", "#5a1018", 180), [
      txt("DROPS IN", 80, 620, 920, 80, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 36, color: "#ffb0b0" }),
      txt("03:12:08", 80, 740, 920, 200, { ...ytOutline, fontSize: 120, color: "#ffffff" }),
      txt("Set a reminder", 80, 1000, 920, 60, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 28, color: "#e8c0c0" }),
    ]),
  ),

  def("shorts-hook", "Shorts Hook", "Stories", 1080, 1920, ["#0a0a0a", "#222"], ["shorts", "tiktok", "youtube"], "Vertical hook with big type.", () =>
    pack(bg("Shorts Hook", 1080, 1920, "#0a0a0a", "#1a1a1a", 180), [
      ...well(40, 220, 1000, 900, "CLIP"),
      txt("WATCH\nTHIS PART", 60, 1180, 960, 280, { ...ytOutline, fontSize: 92, color: "#ffe600", align: "left" }),
      createShapeLayer("arrow", 60, 1520, 280, 64, { stroke: "#ff2d2d", fill: "#ff2d2d", strokeWidth: 14, name: "Arrow" }),
    ]),
  ),

  def("x-announce", "X Announcement", "X", 1200, 675, ["#0b1419", "#1d9bf0"], ["x", "twitter"], "Wide announcement card.", () =>
    pack(bg("X Announcement", 1200, 675, "#0b1419", "#123044", 180), [
      txt("BIG NEWS", 64, 180, 1070, 140, { ...ytOutline, fontSize: 92, align: "left" }),
      txt("One sentence. That's the post.", 64, 360, 1070, 60, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 28, color: "#9ec0ff", align: "left" }),
    ]),
  ),

  def("x-thread", "Thread Cover", "X", 1200, 675, ["#111", "#333"], ["x", "thread"], "Thread / essay header.", () =>
    pack(bg("Thread Cover", 1200, 675, "#111111", "#2a2a2a", 90), [
      txt("A THREAD", 64, 80, 400, 40, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 20, color: "#888", align: "left" }),
      txt("Everything I learned\nshipping in public", 64, 200, 1070, 220, { ...ytOutline, fontSize: 56, align: "left", fontFamily: "Inter", fontWeight: "700" }),
      txt("1 / 12", 64, 540, 200, 40, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 20, color: "#888", align: "left" }),
    ]),
  ),

  def("li-stat", "LinkedIn Stat", "LinkedIn", 1200, 627, ["#0a2540", "#0a66c2"], ["linkedin", "stat"], "Big stat for a LinkedIn post.", () =>
    pack(bg("LinkedIn Stat", 1200, 627, "#0a2540", "#0a4d8c", 40), [
      txt("47%", 48, 80, 1100, 180, { ...plain, fontFamily: "Anton", fontSize: 160, color: "#70b5f9", align: "left" }),
      txt("of teams still do this\nmanually.", 48, 300, 1100, 160, { ...plain, fontFamily: "Inter", fontWeight: "700", fontSize: 40, align: "left" }),
    ]),
  ),

  def("li-carousel", "LinkedIn Carousel", "LinkedIn", 1080, 1080, ["#f3f6f8", "#d0e0ea"], ["linkedin", "carousel"], "Square carousel title slide.", () =>
    pack(bg("LinkedIn Carousel", 1080, 1080, "#f3f6f8", "#dce7ef", 135), [
      txt("01 / 08", 80, 80, 300, 40, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 22, color: "#0a66c2", align: "left" }),
      txt("A practical\nframework\nfor better\nreviews", 80, 220, 920, 520, { ...plain, fontFamily: "Inter", fontWeight: "700", fontSize: 64, color: "#1b1f23", align: "left", lineHeight: 1.15 }),
    ]),
  ),

  def("yt-banner", "Channel Art", "Banners", 2560, 1440, ["#0b1220", "#1c3a5f"], ["youtube", "banner"], "YouTube channel art with TV-safe text.", () =>
    pack(bg("Channel Art", 2560, 1440, "#0b1220", "#1c3a5f", 120), [
      createShapeLayer("rect", 520, 510, 1520, 420, { fill: "rgba(8,12,22,0.35)", strokeWidth: 0, name: "Safe" }),
      txt("YOUR CHANNEL", 520, 560, 1520, 140, { ...ytOutline, fontSize: 96 }),
      txt("Uploads every Friday", 520, 740, 1520, 70, { ...plain, fontFamily: "Oswald", fontWeight: "700", fontSize: 36, color: "#9ec0ff" }),
    ]),
  ),

  def("x-header", "X Header", "Banners", 1500, 500, ["#0b1419", "#1d9bf0"], ["x", "header"], "Wide profile header.", () =>
    pack(bg("X Header", 1500, 500, "#0b1419", "#123044", 0), [
      txt("Building in public", 64, 160, 1370, 100, { ...ytOutline, fontSize: 64, align: "left" }),
      txt("tools  ·  notes  ·  shipping", 64, 280, 1000, 50, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 24, color: "#9ec0ff", align: "left" }),
    ]),
  ),

  def("li-banner", "LinkedIn Banner", "Banners", 1584, 396, ["#0a2540", "#0a66c2"], ["linkedin", "banner"], "Professional cover banner.", () =>
    pack(bg("LinkedIn Banner", 1584, 396, "#0a2540", "#0a4d8c", 0), [
      txt("Design  ·  Product  ·  Systems", 64, 140, 1450, 80, { ...plain, fontFamily: "Inter", fontWeight: "700", fontSize: 42, align: "left" }),
      txt("Open to interesting problems", 64, 230, 1200, 40, { ...plain, fontFamily: "Inter", fontWeight: "600", fontSize: 20, color: "#9ec0ff", align: "left" }),
    ]),
  ),
];

export const templatesById = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

export const featuredTemplateIds = [
  "face-title",
  "yellow-pop",
  "listicle",
  "versus",
  "tutorial",
  "gaming-hype",
  "ig-quote",
  "shorts-hook",
];
