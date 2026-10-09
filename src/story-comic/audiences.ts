export const audiences = [
  { value: '大众读者', hint: '表达通俗，背景信息充分，避免依赖专业知识。' },
  { value: '学龄前儿童', hint: '使用简单短句和具体形象，少量文字，以日常体验和图像理解为主。' },
  { value: '儿童', hint: '用儿童能理解的词语和生活情境，故事清晰有趣，知识解释具体直观。' },
  { value: '青少年', hint: '贴近成长、自我认识和同伴相处，尊重读者，避免说教。' },
  { value: '学生', hint: '贴近学习、校园和同学生活，概念循序渐进，兼顾趣味和理解。' },
  { value: '大学生', hint: '贴近大学学习、社交和初步独立生活，表达自然，保留思考空间。' },
  { value: '职场人士', hint: '贴近工作协作与职场沟通，例子具体务实，专业术语配简明解释。' },
  { value: '职场新人', hint: '贴近第一份工作与新环境适应，说明背景，提供易理解的情境和行动。' },
  { value: '家长', hint: '贴近亲子陪伴和家庭沟通，兼顾孩子与家长视角，避免责备和单一标准。' },
  { value: '教师', hint: '兼顾教学情境与知识准确性，用易于课堂讨论和解释的例子。' },
  { value: '中老年读者', hint: '文字简明、节奏舒缓，结合生活经验，避免网络黑话与年龄刻板印象。' },
] as const;
export const knownAudience = (value: string) => audiences.some(a => a.value === value);
export const audienceGuidance = (value: string) => audiences.find(a => a.value === value)?.hint ?? audiences[0].hint;
