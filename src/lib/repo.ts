import db, { type Student, type Exam, type SubjectScore } from './db';
import { randomUUID } from 'node:crypto';
import Papa from 'papaparse';

export type AIComment = {
  id: number;
  student_id: string;
  exam_id: string | null;
  semester: string | null;
  type: 'exam' | 'semester' | 'year';
  content: string;
  cost_usd: number | null;
  created_at: string;
};

export function listComments(studentId: string): AIComment[] {
  return db
    .prepare('SELECT * FROM ai_comments WHERE student_id = ? ORDER BY created_at DESC')
    .all(studentId) as AIComment[];
}

export function saveComment(c: Omit<AIComment, 'id' | 'created_at'>): AIComment {
  const r = db
    .prepare(
      `INSERT INTO ai_comments(student_id,exam_id,semester,type,content,cost_usd)
       VALUES (?,?,?,?,?,?) RETURNING *`
    )
    .get(
      c.student_id,
      c.exam_id,
      c.semester,
      c.type,
      c.content,
      c.cost_usd ?? null
    ) as AIComment;
  return r;
}

// ---------- students ----------
export function listStudents(): Student[] {
  return db.prepare('SELECT * FROM students ORDER BY created_at DESC').all() as Student[];
}
export function getStudent(id: string): Student | undefined {
  return db.prepare('SELECT * FROM students WHERE id = ?').get(id) as Student | undefined;
}
export function createStudent(s: Omit<Student, 'id' | 'created_at'>): Student {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO students(id,name,birth_date,grade,school,avatar) VALUES (?,?,?,?,?,?)'
  ).run(id, s.name, s.birth_date ?? null, s.grade ?? null, s.school ?? null, s.avatar ?? null);
  return getStudent(id)!;
}
export function updateStudent(id: string, patch: Partial<Omit<Student, 'id' | 'created_at'>>) {
  const fields = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined);
  if (!fields.length) return;
  const sql = `UPDATE students SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...fields.map((f) => patch[f as keyof typeof patch]), id);
}
export function deleteStudent(id: string) {
  db.prepare('DELETE FROM students WHERE id = ?').run(id);
}

// ---------- exams + scores ----------
export function listExams(studentId: string): Exam[] {
  return db
    .prepare('SELECT * FROM exams WHERE student_id = ? ORDER BY date ASC')
    .all(studentId) as Exam[];
}
export function listScoresForStudent(studentId: string): (SubjectScore & { date: string; type: string; semester: string })[] {
  return db
    .prepare(
      `SELECT s.*, e.date, e.type, e.semester
       FROM subject_scores s JOIN exams e ON s.exam_id = e.id
       WHERE e.student_id = ?
       ORDER BY e.date ASC, s.subject ASC`
    )
    .all(studentId) as any;
}

// 线性外推(用最近 N 点做最小二乘),返回下次预测分数
// N < 2 时返回 null
export function predictNext(scores: { subject: string; score: number; date: string }[], windowSize = 3): Record<string, number | null> {
  const bySubj: Record<string, { score: number; date: string }[]> = {};
  for (const s of scores) (bySubj[s.subject] ??= []).push(s);
  const out: Record<string, number | null> = {};
  for (const [subj, arr] of Object.entries(bySubj)) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    const win = arr.slice(-windowSize);
    if (win.length < 2) {
      out[subj] = win.length ? win[0].score : null;
      continue;
    }
    // 最小二乘 y = a + b*x,x 是 0..n-1
    const n = win.length;
    const sumX = (n - 1) * n / 2;
    const sumY = win.reduce((s, p) => s + p.score, 0);
    const sumXY = win.reduce((s, p, i) => s + i * p.score, 0);
    const sumX2 = (n - 1) * n * (2 * n - 1) / 6;
    const b = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const a = (sumY - b * sumX) / n;
    const next = a + b * n;
    out[subj] = Math.max(0, Math.min(100, Math.round(next)));
  }
  return out;
}

// ---------- CSV import ----------
// CSV 格式: date,type,semester,subject,score,full_score,class_rank,grade_rank,total_score,class_size,grade_size,notes
// 一次导入可包含同一学生多次考试 / 多科。
export type ImportResult = { exams: number; scores: number; skipped: number };
export function importCSV(studentId: string, csv: string): ImportResult {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length) {
    throw new Error(`CSV parse: ${parsed.errors[0].message}`);
  }
  const insertExam = db.prepare(
    `INSERT INTO exams(id,student_id,date,type,semester,total_score,class_rank,grade_rank,class_size,grade_size,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insertScore = db.prepare(
    `INSERT INTO subject_scores(exam_id,subject,score,full_score,class_rank,grade_rank)
     VALUES (?,?,?,?,?,?)`
  );
  const findExam = db.prepare(
    `SELECT id FROM exams WHERE student_id = ? AND date = ? AND semester = ?`
  );

  let examCount = 0,
    scoreCount = 0,
    skipped = 0;
  const tx = db.transaction((rows: Record<string, string>[]) => {
    for (const r of rows) {
      const date = (r.date || '').trim();
      const semester = (r.semester || '').trim();
      const subject = (r.subject || '').trim();
      const score = parseFloat(r.score);
      const full = parseFloat(r.full_score);
      if (!date || !semester || !subject || Number.isNaN(score) || Number.isNaN(full)) {
        skipped++;
        continue;
      }
      const type = (r.type || 'monthly').trim() as Exam['type'];
      let examId = findExam.get(studentId, date, semester) as { id: string } | undefined;
      if (!examId) {
        const id = randomUUID();
        insertExam.run(
          id,
          studentId,
          date,
          type,
          semester,
          numOrNull(r.total_score),
          intOrNull(r.class_rank),
          intOrNull(r.grade_rank),
          intOrNull(r.class_size),
          intOrNull(r.grade_size),
          (r.notes || '').trim() || null
        );
        examCount++;
        examId = { id };
      }
      insertScore.run(
        examId.id,
        subject,
        score,
        full,
        intOrNull(r.class_rank),
        intOrNull(r.grade_rank)
      );
      scoreCount++;
    }
  });
  tx(parsed.data);
  return { exams: examCount, scores: scoreCount, skipped };
}

function numOrNull(s?: string) {
  if (s === undefined || s === '') return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}
function intOrNull(s?: string) {
  if (s === undefined || s === '') return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

// ---------- seed sample data (for demo only) ----------
export function seedDemo(studentId: string) {
  const rows = [
    // date,        type,     semester,        subject, score, full
    ['2025-09-15', 'monthly', '2025-fall', '语文', '82', '100'],
    ['2025-09-15', 'monthly', '2025-fall', '数学', '78', '100'],
    ['2025-09-15', 'monthly', '2025-fall', '英语', '88', '100'],
    ['2025-10-20', 'monthly', '2025-fall', '语文', '85', '100'],
    ['2025-10-20', 'monthly', '2025-fall', '数学', '82', '100'],
    ['2025-10-20', 'monthly', '2025-fall', '英语', '90', '100'],
    ['2025-11-25', 'midterm', '2025-fall', '语文', '86', '100'],
    ['2025-11-25', 'midterm', '2025-fall', '数学', '88', '100'],
    ['2025-11-25', 'midterm', '2025-fall', '英语', '92', '100'],
    ['2026-01-12', 'final', '2025-fall', '语文', '89', '100'],
    ['2026-01-12', 'final', '2025-fall', '数学', '91', '100'],
    ['2026-01-12', 'final', '2025-fall', '英语', '94', '100'],
  ];
  const csv = ['date,type,semester,subject,score,full_score']
    .concat(rows.map((r) => r.join(',')))
    .join('\n');
  importCSV(studentId, csv);
}
