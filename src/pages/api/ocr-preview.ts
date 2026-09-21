// src/pages/api/ocr-preview.ts
// POST /api/ocr-preview
// 接收 multipart/form-data { student_id, image: File }
// 调 Claude Haiku Vision 提取成绩行 → 复用 /api/import 同款 dry-run 校验
// 返回 { ok, total, valid_count, issue_count, new_exams, new_scores, preview, issues, more_issues, raw, costUSD, meta }

import type { APIRoute } from 'astro';
import { claudeVisionOCR } from '../../lib/ocr';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
]);

function json(d: any, status = 200) {
  return new Response(JSON.stringify(d, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// 与 src/pages/api/import.ts 完全同款校验 (单 source of truth)
function validateRows(rows: any[], now = new Date().toISOString().slice(0, 10)) {
  const valid: any[] = [];
  const issues: string[] = [];
  rows.forEach((r, idx) => {
    const row = idx + 1;
    const date = (r.date || '').trim();
    const semester = (r.semester || '').trim();
    const subject = (r.subject || '').trim();
    const score = Number(r.score);
    const full = Number(r.full_score);

    if (!date || !semester || !subject) {
      issues.push(`行 ${row}: 缺少 date/semester/subject`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      issues.push(`行 ${row}: 日期 "${date}" 不是 YYYY-MM-DD 格式`);
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
    if (date > now) {
      issues.push(`行 ${row}: 日期 ${date} 在未来`);
    }

    valid.push({
      row,
      date,
      semester,
      subject,
      score,
      full_score: full,
      class_rank: r.class_rank ?? null,
      grade_rank: r.grade_rank ?? null,
      total_score: null,
      class_size: null,
      grade_size: null,
      type: r.type || 'monthly',
      notes: null,
    });
  });
  const examKeys = new Set(valid.map((v) => `${v.date}|${v.semester}`));
  return { valid, issues, new_exams: examKeys.size };
}

export const POST: APIRoute = async ({ request }) => {
  let fd: FormData;
  try {
    fd = await request.formData();
  } catch (e: any) {
    return json({ ok: false, error: `表单解析失败: ${e.message}` }, 400);
  }

  const studentId = String(fd.get('student_id') ?? '');
  const file = fd.get('image');
  if (!studentId) return json({ ok: false, error: 'student_id 必填' }, 400);
  if (!file || !(file instanceof File)) return json({ ok: false, error: 'image 文件必填' }, 400);

  if (file.size > MAX_IMAGE_BYTES) {
    return json({
      ok: false,
      error: `图片太大 (${(file.size / 1024 / 1024).toFixed(1)}MB, 上限 4MB)。请先压缩或裁剪。`,
    }, 413);
  }

  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return json({
      ok: false,
      error: `不支持的图片格式 "${mime || 'unknown'}"。支持: JPEG/PNG/WEBP/GIF。HEIC 请在 iPhone 设置改成"兼容性最佳"。`,
    }, 415);
  }

  // 读 bytes → base64
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  const base64 = btoa(binary);
  // 标准化 mime (jpeg/jpg → jpeg)
  const stdMime = mime === 'image/jpg' ? 'image/jpeg' : (mime as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif');

  // 调 Vision OCR
  const ocr = await claudeVisionOCR(base64, stdMime);
  if (!ocr.ok) {
    return json({
      ok: false,
      error: ocr.error || 'OCR 识别失败',
      raw: ocr.raw,
      costUSD: ocr.costUSD,
    }, 502);
  }
  if (ocr.rows.length === 0) {
    return json({
      ok: false,
      error: 'OCR 成功但没识别到任何成绩行。请确认图片清晰,且包含表格。',
      raw: ocr.raw,
      costUSD: ocr.costUSD,
    }, 400);
  }

  // dry-run 校验 (跟 /api/import 同款)
  const { valid, issues, new_exams } = validateRows(ocr.rows);

  return json({
    ok: true,
    student_id: studentId,
    total: ocr.rows.length,
    valid_count: valid.length,
    issue_count: issues.length,
    new_exams,
    new_scores: valid.length,
    preview: valid.slice(0, 10),
    issues: issues.slice(0, 10),
    more_issues: Math.max(0, issues.length - 10),
    // OCR 上下文
    meta: {
      student_name: ocr.student_name,
      school: ocr.school,
      grade: ocr.grade,
    },
    costUSD: ocr.costUSD,
    inputTokens: ocr.inputTokens,
    outputTokens: ocr.outputTokens,
    raw: ocr.raw,
  });
};