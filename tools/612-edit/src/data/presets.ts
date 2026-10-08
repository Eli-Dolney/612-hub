import type { FilterName, TextLayer } from "../types";
import { createShapeLayer, createTextLayer } from "../engine/document";

export const CANVAS_SIZES = [
  { id: "yt-thumb", name: "YouTube Thumbnail", width: 1280, height: 720, group: "YouTube" },
  { id: "yt-banner", name: "YouTube Banner", width: 2560, height: 1440, group: "YouTube" },
  { id: "ig-post", name: "Instagram Post", width: 1080, height: 1080, group: "Instagram" },
  { id: "ig-story", name: "Instagram Story", width: 1080, height: 1920, group: "Instagram" },
  { id: "x-post", name: "X / Twitter Post", width: 1200, height: 675, group: "X" },
  { id: "x-header", name: "X Header", width: 1500, height: 500, group: "X" },
  { id: "fb-post", name: "Facebook Post", width: 1200, height: 630, group: "Facebook" },
  { id: "li-post", name: "LinkedIn Post", width: 1200, height: 627, group: "LinkedIn" },
  { id: "tt-thumb", name: "TikTok / Shorts", width: 1080, height: 1920, group: "Vertical" },
  { id: "hd", name: "HD 1080p", width: 1920, height: 1080, group: "Video" },
  { id: "square", name: "Square 2000", width: 2000, height: 2000, group: "Photo" },
  { id: "photo-4-5", name: "Portrait 4:5", width: 1080, height: 1350, group: "Photo" },
] as const;

export const EXPORT_PRESETS = [
  { id: "yt-thumb", name: "YouTube Thumbnail", width: 1280, height: 720, format: "png" as const },
  { id: "yt-banner", name: "YouTube Banner", width: 2560, height: 1440, format: "png" as const },
  { id: "ig-post", name: "Instagram Post", width: 1080, height: 1080, format: "jpeg" as const },
  { id: "ig-story", name: "Instagram Story", width: 1080, height: 1920, format: "jpeg" as const },
  { id: "x-post", name: "X Post", width: 1200, height: 675, format: "jpeg" as const },
  { id: "x-header", name: "X Header", width: 1500, height: 500, format: "jpeg" as const },
  { id: "fb-cover", name: "Facebook Cover", width: 1200, height: 630, format: "jpeg" as const },
  { id: "li-post", name: "LinkedIn Post", width: 1200, height: 627, format: "jpeg" as const },
];

export const FONTS = [
  "Anton",
  "Archivo Black",
  "Bebas Neue",
  "Oswald",
  "Impact",
  "Arial Black",
  "Inter",
  "Georgia",
  "Courier New",
  "system-ui",
];

export const FILTERS: { id: FilterName; name: string }[] = [
  { id: "none", name: "None" },
  { id: "mono", name: "Mono" },
  { id: "sepia", name: "Sepia" },
  { id: "vintage", name: "Vintage" },
  { id: "cool", name: "Cool" },
  { id: "warm", name: "Warm" },
  { id: "dramatic", name: "Drama" },
  { id: "fade", name: "Fade" },
  { id: "invert", name: "Invert" },
];

export type TextPreset = {
  id: string;
  name: string;
  group: string;
  style: Partial<TextLayer>;
};

export const TEXT_PRESETS: TextPreset[] = [
  {
    id: "shock",
    name: "Shock Yellow",
    group: "YouTube",
    style: {
      fontFamily: "Anton",
      fontWeight: "400",
      color: "#ffe600",
      outline: { enabled: true, color: "#111111", width: 10 },
      shadow: { enabled: true, color: "rgba(0,0,0,0.7)", blur: 8, x: 4, y: 6 },
      glow: { enabled: false, color: "#000", size: 0 },
    },
  },
  {
    id: "white-pop",
    name: "White Pop",
    group: "YouTube",
    style: {
      fontFamily: "Archivo Black",
      color: "#ffffff",
      outline: { enabled: true, color: "#111111", width: 8 },
      shadow: { enabled: true, color: "rgba(0,0,0,0.55)", blur: 10, x: 0, y: 6 },
      glow: { enabled: false, color: "#000", size: 0 },
    },
  },
  {
    id: "click-red",
    name: "Click Red",
    group: "YouTube",
    style: {
      fontFamily: "Anton",
      color: "#ff2a2a",
      outline: { enabled: true, color: "#ffffff", width: 7 },
      shadow: { enabled: true, color: "#000000", blur: 0, x: 5, y: 6 },
      glow: { enabled: false, color: "#000", size: 0 },
    },
  },
  {
    id: "gold",
    name: "Gold",
    group: "YouTube",
    style: {
      fontFamily: "Anton",
      color: "#ffd000",
      outline: { enabled: true, color: "#5a2a00", width: 6 },
      shadow: { enabled: true, color: "rgba(0,0,0,0.6)", blur: 16, x: 0, y: 6 },
      glow: { enabled: true, color: "#ff9900", size: 18 },
    },
  },
  {
    id: "3d",
    name: "3D Stack",
    group: "YouTube",
    style: {
      fontFamily: "Archivo Black",
      color: "#ffffff",
      outline: { enabled: true, color: "#d10f6a", width: 5 },
      shadow: { enabled: true, color: "#9c0850", blur: 0, x: 6, y: 7 },
      glow: { enabled: false, color: "#000", size: 0 },
    },
  },
  {
    id: "neon-cyan",
    name: "Neon Cyan",
    group: "Gaming",
    style: {
      fontFamily: "Oswald",
      fontWeight: "700",
      color: "#7dfff6",
      outline: { enabled: true, color: "#04222a", width: 3 },
      shadow: { enabled: false, color: "#000", blur: 0, x: 0, y: 0 },
      glow: { enabled: true, color: "#00e5ff", size: 28 },
    },
  },
  {
    id: "neon-pink",
    name: "Neon Pink",
    group: "Gaming",
    style: {
      fontFamily: "Oswald",
      fontWeight: "700",
      color: "#ff4de3",
      outline: { enabled: true, color: "#ffffff", width: 2 },
      shadow: { enabled: false, color: "#000", blur: 0, x: 0, y: 0 },
      glow: { enabled: true, color: "#ff4de3", size: 26 },
    },
  },
  {
    id: "cyber",
    name: "Cyber",
    group: "Gaming",
    style: {
      fontFamily: "Courier New",
      fontWeight: "700",
      color: "#67ffd1",
      outline: { enabled: true, color: "#ff2bd6", width: 2 },
      shadow: { enabled: true, color: "#ff2bd6", blur: 12, x: 3, y: 0 },
      glow: { enabled: true, color: "#67ffd1", size: 16 },
    },
  },
  {
    id: "stream",
    name: "Stream",
    group: "Gaming",
    style: {
      fontFamily: "Anton",
      color: "#bf94ff",
      outline: { enabled: true, color: "#1b0b33", width: 6 },
      shadow: { enabled: false, color: "#000", blur: 0, x: 0, y: 0 },
      glow: { enabled: true, color: "#9146ff", size: 20 },
    },
  },
  {
    id: "clean",
    name: "Clean",
    group: "Minimal",
    style: {
      fontFamily: "Inter",
      fontWeight: "700",
      color: "#ffffff",
      outline: { enabled: false, color: "#000", width: 0 },
      shadow: { enabled: true, color: "rgba(0,0,0,0.45)", blur: 14, x: 0, y: 3 },
      glow: { enabled: false, color: "#000", size: 0 },
    },
  },
  {
    id: "serif",
    name: "Serif Quote",
    group: "Minimal",
    style: {
      fontFamily: "Georgia",
      fontWeight: "400",
      color: "#1c1c1c",
      outline: { enabled: false, color: "#000", width: 0 },
      shadow: { enabled: false, color: "#000", blur: 0, x: 0, y: 0 },
      glow: { enabled: false, color: "#000", size: 0 },
    },
  },
  {
    id: "outline-only",
    name: "Hollow",
    group: "Minimal",
    style: {
      fontFamily: "Bebas Neue",
      color: "rgba(0,0,0,0)",
      outline: { enabled: true, color: "#ffffff", width: 3 },
      shadow: { enabled: false, color: "#000", blur: 0, x: 0, y: 0 },
      glow: { enabled: false, color: "#000", size: 0 },
    },
  },
];

export type { TemplateDef } from "./templates";
export { TEMPLATES, TEMPLATE_GROUPS, featuredTemplateIds } from "./templates";

export const ELEMENTS: {
  id: string;
  name: string;
  group: string;
  make: (cx: number, cy: number) => ReturnType<typeof createShapeLayer> | ReturnType<typeof createTextLayer>;
}[] = [
  {
    id: "arrow",
    name: "Arrow",
    group: "Marks",
    make: (cx, cy) => createShapeLayer("arrow", cx - 140, cy - 24, 280, 48, { stroke: "#ff2d2d", fill: "#ff2d2d", strokeWidth: 12 }),
  },
  {
    id: "circle",
    name: "Circle",
    group: "Marks",
    make: (cx, cy) =>
      createShapeLayer("ellipse", cx - 90, cy - 90, 180, 180, { fill: "rgba(0,0,0,0)", stroke: "#ffe600", strokeWidth: 14 }),
  },
  {
    id: "box",
    name: "Box",
    group: "Marks",
    make: (cx, cy) => createShapeLayer("roundRect", cx - 160, cy - 90, 320, 180, { fill: "rgba(0,0,0,0.35)", stroke: "#fff", strokeWidth: 6 }),
  },
  {
    id: "star",
    name: "Star",
    group: "Marks",
    make: (cx, cy) => createShapeLayer("star", cx - 70, cy - 70, 140, 140, { fill: "#ffe600", strokeWidth: 0, sides: 5 }),
  },
  {
    id: "badge",
    name: "Pill",
    group: "Badges",
    make: (cx, cy) => createShapeLayer("badge", cx - 120, cy - 28, 240, 56, { fill: "#ff2d2d", strokeWidth: 0 }),
  },
  {
    id: "new",
    name: "NEW",
    group: "Badges",
    make: (cx, cy) =>
      createTextLayer("NEW", cx - 90, cy - 36, {
        width: 180,
        height: 72,
        fontSize: 48,
        fontFamily: "Oswald",
        fontWeight: "700",
        color: "#ffffff",
        outline: { enabled: true, color: "#d10f20", width: 6 },
      }),
  },
];
