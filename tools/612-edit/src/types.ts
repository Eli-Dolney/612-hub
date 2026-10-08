export type BlendMode =
  | "source-over"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion";

export type Tool =
  | "select"
  | "pan"
  | "text"
  | "rect"
  | "ellipse"
  | "arrow"
  | "line"
  | "star"
  | "brush"
  | "eraser"
  | "eyedropper"
  | "wand";

export type FilterName =
  | "none"
  | "mono"
  | "sepia"
  | "vintage"
  | "cool"
  | "warm"
  | "dramatic"
  | "fade"
  | "invert";

export type Adjustments = {
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  temperature: number;
  blur: number;
  vignette: number;
  filter: FilterName;
};

export type TextAlign = "left" | "center" | "right";

export type BaseLayer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type FillLayer = BaseLayer & {
  type: "fill";
  fill: string;
  gradient?: {
    kind: "linear" | "radial";
    start: string;
    end: string;
    angle: number;
  };
};

export type ImageLayer = BaseLayer & {
  type: "image";
  src: string;
  adjustments: Adjustments;
  flipH: boolean;
  flipV: boolean;
};

export type TextLayer = BaseLayer & {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  align: TextAlign;
  color: string;
  letterSpacing: number;
  lineHeight: number;
  outline: { enabled: boolean; color: string; width: number };
  shadow: { enabled: boolean; color: string; blur: number; x: number; y: number };
  glow: { enabled: boolean; color: string; size: number };
};

export type ShapeKind =
  | "rect"
  | "roundRect"
  | "ellipse"
  | "triangle"
  | "star"
  | "polygon"
  | "line"
  | "arrow"
  | "badge";

export type ShapeLayer = BaseLayer & {
  type: "shape";
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  sides: number;
  radius: number;
};

export type DrawLayer = BaseLayer & {
  type: "draw";
  src: string;
};

export type Layer = FillLayer | ImageLayer | TextLayer | ShapeLayer | DrawLayer;

export type EditorDocument = {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: Layer[];
};

export type BrushSettings = {
  size: number;
  opacity: number;
  hardness: number;
  color: string;
};

export type ViewState = {
  zoom: number;
  x: number;
  y: number;
};

export const defaultAdjustments = (): Adjustments => ({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  temperature: 0,
  blur: 0,
  vignette: 0,
  filter: "none",
});

export const defaultBrush = (): BrushSettings => ({
  size: 24,
  opacity: 1,
  hardness: 0.85,
  color: "#ffffff",
});
