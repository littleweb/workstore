export const styles = ['简约', '商务', '手绘', '杂志'] as const;
export const sizes = ['16:9', '4:3', '3:4', '1:1'] as const;
export const episodeCounts = [1, 3, 6, 12] as const;
export type CreationOptions = {
  style: (typeof styles)[number];
  size: (typeof sizes)[number];
  episodes: (typeof episodeCounts)[number];
  workspace: '个人空间' | '灵感收集';
  permission: '默认权限' | '每次询问' | '仅供阅读';
};
export type Work = CreationOptions & {
  id: string;
  name: string;
  topic: string;
  category: string;
  cover: 'report' | 'editorial' | 'dashboard' | 'draft';
};
export const defaultOptions: CreationOptions = {
  style: '简约', size: '16:9', episodes: 1, workspace: '个人空间', permission: '默认权限',
};
export const sampleWorks: Work[] = [
  { ...defaultOptions, id: 'report', name: '本月经营复盘报告', category: '文档处理', cover: 'report',
    topic: '制作一份本月经营复盘报告，梳理营收、成本与关键增长机会。' },
  { ...defaultOptions, style: '杂志', id: 'editorial', name: '公众号创刊推文', category: '内容创作', cover: 'editorial',
    topic: '写一篇公众号创刊推文：从一页空白，到无限可能。语气真诚、温暖，有开篇故事。' },
  { ...defaultOptions, id: 'dashboard', name: '销售数据分析仪表盘', category: '数据分析', cover: 'dashboard',
    topic: '设计一个销售数据分析仪表盘，展示销售趋势、产品表现和转化率。' },
];

// No provider, file-system, persistence or application workspace is accessed by this demo.
export function createDemoDraft(topic: string, options: CreationOptions, id: string): Work | null {
  const text = topic.trim();
  if (!text || text.length > 1200) return null;
  const characters = Array.from(text);
  return {
    ...options, id, topic: text, name: characters.slice(0, 24).join('') + (characters.length > 24 ? '…' : ''),
    cover: 'draft', category: '创作草稿',
  };
}
