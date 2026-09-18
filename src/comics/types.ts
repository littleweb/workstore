export type Ratio = "3:4" | "1:1" | "4:3" | "9:16";
export type Platform = "xiaohongshu" | "douyin" | "shipinhao";
export type Picture = { src: string; crop?: [number, number, number, number] };
export type Entity = {
  id: string;
  name: string;
  kind: "character" | "scene" | "prop";
  description: string;
  locked: boolean;
  reference?: Picture;
};
export type Page = {
  imageDialogue?: string;
  id: string;
  title: string;
  action: string;
  dialogue: string;
  entityIds: string[];
  state: string;
  image?: Picture;
  status: "draft" | "generating" | "ready" | "error";
  error?: string;
};
export type DialogueStyle = {
  rendering?: "integrated";
  lettering?: string;
  shape: "speech" | "thought";
  position: "top" | "bottom" | "auto";
  fill: "white" | "cream";
};
export type Template = {
  dialogueStyle?: DialogueStyle;
  type: "workstore.comic.template";
  schemaVersion: 1;
  templateId: string;
  revision: number;
  title: string;
  summary: string;
  category: string;
  style: string;
  defaultPages: number;
  supportedCounts: number[];
  entities: Entity[];
  beats: string[];
  example: Page[];
  cover: Picture;
  narrativeByCount?: Record<string, string[]>;
  publishingDirection?: string;
  continuity: string[];
  source: {
    kind: "original" | "authorized-reference";
    author: string;
    redistribution: string;
    referenceNotes?: string;
  };
};
export type Settings = {
  theme: string;
  ratio: Ratio;
  count: number;
  style: string;
  tone: string;
  ending: string;
  entities: Entity[];
};
export type PublishingDraft = {
  titleOptions?: string[];
  platform: Platform;
  sourceRevisionId: string;
  title: string;
  description: string;
  hashtags: string[];
  covers: Picture[];
  coverText: string;
  selectedCover: number;
  imageOrder: string[];
  updatedAt: number;
};
export type Snapshot = { settings: Settings; pages: Page[] };
export type Revision = Snapshot & {
  id: string;
  parentId?: string;
  restoredFrom?: string;
  title: string;
  createdAt: number;
};
export type ComicContent = Snapshot & {
  templateSnapshot: Template;
  templateOrigin: { templateId: string; revision: number };
  history: Revision[];
  currentRevisionId: string;
  publishing: Partial<Record<Platform, PublishingDraft>>;
  job?: {
    id: string;
    stage: string;
    status: "running" | "error" | "cancelled" | "done";
    error?: string;
    startedAt: number;
  };
  archived?: boolean;
};
export type FeedConfig = {
  mode: "builtin" | "remote";
  endpoint: string;
  enabled: boolean;
};
