export const sizes = [
  {
    id: "xhs-portrait",
    label: "小红书竖图 · 3:4",
    ratio: "3:4",
    width: 1242,
    height: 1656,
  },
  {
    id: "square",
    label: "方图 · 1:1",
    ratio: "1:1",
    width: 1080,
    height: 1080,
  },
  {
    id: "portrait",
    label: "全屏竖图 · 9:16",
    ratio: "9:16",
    width: 1080,
    height: 1920,
  },
  {
    id: "landscape",
    label: "横图 · 4:3",
    ratio: "4:3",
    width: 1600,
    height: 1200,
  },
  {
    id: "wide",
    label: "宽屏 · 16:9",
    ratio: "16:9",
    width: 1920,
    height: 1080,
  },
];
export const sizeFor = (id?: string) =>
  sizes.find((s) => s.id === id) ?? sizes[0];
export const pageCounts = [0, 4, 6, 8, 12, 16, 18, 20];
