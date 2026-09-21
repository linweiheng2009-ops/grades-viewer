import type { APIRoute } from 'astro';
import { listStudents } from '../../lib/repo';
import Papa from 'papaparse';

// dry-run 解析:返回将被插入的行预览 + 异常告警,不落库
export const POST: APIRoute = async ({ request }) => {
  const fd = await request.formData();
  const csv = String(fd.get('csv') ?? '').trim();
  if (!csv) return new Response('empty csv', { status: 400 });

  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    return json({ ok: false, errors: parsed.errors.map((e) => `行 ${e.row}: ${e.message}`) });
  }

  const valid: any[] = [];
  const issues: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  parsed.data.forEach((r, idx) => {
    const row = idx + 2; // header 占第 1 行
    const date = (r.date || '').trim();
    const semester = (r.semester || '').trim();
    const subject = (r.subject || '').trim();
    const score = parseFloat(r.score);
    const full = parseFloat(r.full_score);

    if (!date || !semester || !subject) {
      issues.push(`行 ${row}: 缺少 date/semester/subject`);
      return;
    }
    if (Number.isNaN(score) || Number.isNaN(full)) {
      issues.push(`行 ${row}: score 或 full_score 非数字`);
      return;
    }
    if (score < 0 || score > full) {
      issues.push(`行 ${row}: 分数 ${score} 超出满分 ${full}`);
      return;
    }
    if (date > today) {
      issues.push(`行 ${row}: 日期 ${date} 在未来`);
    }
    const cr = parseInt(r.class_rank);
    const cs = parseInt(r.class_size);
    if (!Number.isNaN(cr) && !Number.isNaN(cs) && (cr < 1 || cr > cs)) {
      issues.push(`行 ${row}: 班级排名 ${cr} 超出班级人数 ${cs}`);
    }

    valid.push({
      row,
      date,
      semester,
      subject,
      score,
      full_score: full,
      class_rank: Number.isNaN(cr) ? null : cr,
      grade_rank: parseInt(r.grade_rank) || null,
      total_score: parseFloat(r.total_score) || null,
      class_size: Number.isNaN(cs) ? null : cs,
      grade_size: parseInt(r.grade_size) || null,
      type: r.type || 'monthly',
      notes: (r.notes || '').trim() || null,
    });
  });

  // 推算会创建多少个新 exam (按 date+semester 去重)
  const examKeys = new Set(valid.map((v) => `${v.date}|${v.semester}`));

  return json({
    ok: true,
    total: parsed.data.length,
    valid_count: valid.length,
    issue_count: issues.length,
    new_exams: examKeys.size,
    new_scores: valid.length,
    preview: valid.slice(0, 5),
    issues: issues.slice(0, 10),
    more_issues: Math.max(0, issues.length - 10),
  });
};

function json(d: any) {
  return new Response(JSON.stringify(d, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
}
