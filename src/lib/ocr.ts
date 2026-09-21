// src/lib/ocr.ts
// Claude Haiku Vision OCR — 把成绩单图片提取成结构化成绩行
// 严格 JSON schema 输出,匹配现有 CSV import 表头 (date,type,semester,subject,score,full_score,...)
//
// 重要: 调用方式跟 src/lib/ai.ts generateComment 一致,复用同一套 ANTHROPIC_* 环境变量

export type OCRRow = {
  date: string;          // YYYY-MM-DD
  type: string;          // monthly | midterm | final | quiz | other
  semester: string;      // e.g. 2025-fall
  subject: string;       // 语文 / 数学 / 英语 / 物理 ...
  score: number;
  full_score: number;    // 默认 100
  class_rank?: number | null;
  grade_rank?: number | null;
  notes?: string | null;
};

export type OCRResult = {
  ok: boolean;
  rows: OCRRow[];
  // 上下文字段 (如果能识别)
  student_name?: string | null;
  school?: string | null;
  grade?: string | null;
  // 调试
  raw?: string;
  error?: string;
  costUSD: number;
  inputTokens?: number;
  outputTokens?: number;
};

// JSON schema 强约束 — 用 output_config.format
const JSON_SCHEMA = {
  type: 'object',
  properties: {
    student_name: { type: ['string', 'null'] },
    school: { type: ['string', 'null'] },
    grade: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          type: { type: 'string', description: 'monthly/midterm/final/exam' },
          semester: { type: 'string', description: 'e.g. 2025-fall, 2024-spring' },
          subject: { type: 'string' },
          score: { type: ['number', 'null'] },
          full_score: { type: ['number', 'null'] },
          class_rank: { type: ['integer', 'null'] },
          grade_rank: { type: ['integer', 'null'] },
        },
        required: ['date', 'subject', 'score', 'full_score'],
        additionalProperties: false,
      },
    },
  },
  required: ['rows'],
  additionalProperties: false,
} as const;

const SYSTEM = `You are a precise OCR system for Chinese school grade reports (成绩单 / 成绩报告单 / 成绩册 / report cards).

Rules:
1. Read Chinese characters directly from the image; do NOT translate subject names (语文/数学/英语/物理/化学/生物/历史/地理/政治/科学 etc. stay as-is).
2. Extract EVERY exam/row visible in the table — multi-test reports are common.
3. date format MUST be YYYY-MM-DD. If year missing, assume the current year or fall-back to current academic year (秋季 = fall = Sep-Dec, 春季 = spring = Jan-Aug).
4. semester format: "<year>-<fall|spring|winter|summer>", e.g. 2025-fall, 2024-spring.
6. exam type: monthly(月考)/midterm(期中)/final(期末)/quiz(随堂)/exam(统考). Default 'monthly' if not clear.
7. score must be a number, never include Chinese characters like "二".
8. full_score default = 100 if not shown.
9. If illegible, use null for that field, do not guess.
10. Output ONLY the JSON object matching the schema. No markdown, no code fences, no prose.`;

// Claude vision pricing — Haiku 4.5: $1 input / $5 output per 1M tokens
const INPUT_PER_M = 1.0;
const OUTPUT_PER_M = 5.0;

export async function claudeVisionOCR(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
): Promise<OCRResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  const model = process.env.ANTHROPIC_MODEL || 'MiniMax-M3';
  if (!apiKey) {
    return { ok: false, rows: [], error: 'no API key (在 .dev.vars 设 ANTHROPIC_API_KEY,或 wrangler secret put ANTHROPIC_API_KEY)', costUSD: 0 };
  }

  // 严格 base64 (无 data URL 前缀,无换行)
  const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: SYSTEM,
        // 注意: output_config.format 是 Anthropic 结构化输出 (beta). 部分 base_url 可能忽略这个字段 — 失败时降级
        output_config: {
          format: { type: 'json_schema', json_schema: { name: 'grades', schema: JSON_SCHEMA, strict: true } },
        },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: cleanBase64 } },
              { type: 'text', text: '提取图中所有考试科目和分数,按 schema 输出 JSON。' },
            ],
          },
        ],
      }),
    });
  } catch (e: any) {
    return { ok: false, rows: [], error: `fetch failed: ${e.message}`, costUSD: 0 };
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { ok: false, rows: [], error: `Claude API ${res.status}: ${errText.slice(0, 300)}`, costUSD: 0 };
  }

  const j = await res.json() as any;
  const text: string = j?.content?.[0]?.text ?? '';
  const usage = j?.usage ?? {};
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const costUSD = (inputTokens * INPUT_PER_M + outputTokens * OUTPUT_PER_M) / 1_000_000;

  // 解析 JSON — 兼容 Claude 偶尔包 ```json ... ``` 围栏
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { /* fall through */ }
    }
  }

  if (!parsed || !Array.isArray(parsed.rows)) {
    return {
      ok: false,
      rows: [],
      raw: text,
      error: 'Claude 返回无法解析为 JSON rows[]',
      costUSD,
      inputTokens,
      outputTokens,
    };
  }

  const rows: OCRRow[] = parsed.rows
    .filter((r: any) => r && r.date && r.subject && typeof r.score === 'number')
    .map((r: any) => ({
      date: String(r.date).trim(),
      type: String(r.type || 'monthly').trim(),
      semester: String(r.semester || '').trim(),
      subject: String(r.subject).trim(),
      score: Number(r.score),
      full_score: Number(r.full_score ?? 100),
      class_rank: r.class_rank != null ? Number(r.class_rank) : null,
      grade_rank: r.grade_rank != null ? Number(r.grade_rank) : null,
    }));

  return {
    ok: true,
    rows,
    student_name: parsed.student_name ?? null,
    school: parsed.school ?? null,
    grade: parsed.grade ?? null,
    raw: text,
    costUSD,
    inputTokens,
    outputTokens,
  };
}