// AI 评语生成 - 直接调 Anthropic API(跟 token-burn 同一套 env)
// 仅在调用时联网,其他完全离线
import type { Student } from './db';
import type { SubjectScore, Exam } from './db';

export type CommentInput = {
  student: Student;
  semester: string;
  type: 'exam' | 'semester' | 'year';
  scores: (SubjectScore & { date: string; type: string; semester: string })[];
};

const SYSTEM = `你是中国家长请的家庭教育顾问,基于真实成绩数据写学期评估。
要求:
1. 客观不夸张,不用"孩子很棒"等套话
2. 找 1-2 个最明显的进步点 + 1-2 个最需关注的薄弱点
3. 给 3 条可执行的下阶段建议(每条 ≤ 1 行)
4. 中文,口吻像跟家长朋友聊天
5. 输出 markdown 三段:【进步】【薄弱】【建议】
6. 不要写"尊敬的家长"开头,不要寒暄
根据 type 不同调整粒度:
- type=exam: 聚焦本次考试,150 字以内,重点讲"这次的表现"
- type=semester: 学期总评,200 字,讲"这一学期的变化曲线"
- type=year: 全年总览,250 字,讲"今年的整体轨迹 + 下学年方向"`;

export async function generateComment(input: CommentInput): Promise<{ content: string; costUSD: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const model = process.env.ANTHROPIC_MODEL || 'MiniMax-M3';

  if (!apiKey) {
    // 没配 key 时,返回规则引擎兜底评语,保证流程能跑通
    return { content: ruleBased(input), costUSD: 0 };
  }

  const summary = buildSummary(input);
  const userPrompt = `学生:${input.student.name} (${input.student.grade ?? ''})\n学期:${input.semester}\n类型:${input.type} (${input.type === 'exam' ? '单次考试' : input.type === 'semester' ? '学期总评' : '全年总览'})\n\n成绩摘要:\n${summary}\n\n输出:`;

  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: input.type === 'exam' ? 450 : input.type === 'semester' ? 600 : 750,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI 调用失败 ${res.status}: ${t.slice(0, 200)}`);
  }
  const j: any = await res.json();
  const content = j.content?.[0]?.text ?? '';
  const inT = j.usage?.input_tokens ?? 0;
  const outT = j.usage?.output_tokens ?? 0;
  // Haiku 4.5 价: input $1/M, output $5/M
  const costUSD = (inT * 1 + outT * 5) / 1_000_000;
  return { content, costUSD };
}

function buildSummary(input: CommentInput) {
  const bySubj: Record<string, { score: number; date: string }[]> = {};
  for (const s of input.scores) {
    (bySubj[s.subject] ??= []).push({ score: s.score, date: s.date });
  }
  return Object.entries(bySubj)
    .map(([subj, arr]) => {
      const sorted = arr.sort((a, b) => a.date.localeCompare(b.date));
      const first = sorted[0].score;
      const last = sorted.at(-1)!.score;
      const delta = last - first;
      const trend = delta > 3 ? '↑进步' : delta < -3 ? '↓退步' : '→持平';
      return `${subj}: ${sorted.map((p) => p.score).join('→')} (净${delta >= 0 ? '+' : ''}${delta} ${trend})`;
    })
    .join('\n');
}

// 无 API key 时兜底:基于规则的简易评语
function ruleBased(input: CommentInput): string {
  const bySubj: Record<string, number[]> = {};
  for (const s of input.scores) (bySubj[s.subject] ??= []).push(s.score);
  const lines = Object.entries(bySubj).map(([subj, arr]) => {
    const delta = arr.at(-1)! - arr[0];
    return { subj, delta, last: arr.at(-1)! };
  });
  const up = lines.filter((l) => l.delta > 3).sort((a, b) => b.delta - a.delta);
  const down = lines.filter((l) => l.delta < -3).sort((a, b) => a.delta - b.delta);
  const weakest = [...lines].sort((a, b) => a.last - b.last)[0];
  const strongest = [...lines].sort((a, b) => b.last - a.last)[0];
  return [
    `【进步】${up.length ? up.slice(0, 2).map((l) => `${l.subj}+${l.delta}`).join('、') : '各科表现平稳'}`,
    `【薄弱】${down.length ? down.slice(0, 2).map((l) => `${l.subj}${l.delta}`).join('、') : (weakest ? `${weakest.subj}(${weakest.last}) 仍需巩固` : '整体均衡')}`,
    `【建议】1) 重点提升 ${weakest?.subj ?? '薄弱科'}; 2) 保持 ${strongest?.subj ?? '优势科'} 学习节奏; 3) 错题本每周回顾 1 次`,
  ].join('\n');
}
