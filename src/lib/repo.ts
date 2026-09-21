import type { AstroGlobal } from 'astro';
import type { DB } from './db';
import { randomUUID } from 'node:crypto';

// ---------- DB 注入 ----------
// 优先级: Astro.locals.runtime.env.DB (CF Pages / wrangler dev) → process.env.LOCAL_DB_PATH 走 better-sqlite3
let _localSqlite: any = null;
let _localDb: DB | null = null;
async function localSqliteDb(): Promise<DB> {
  if (_localDb) return _localDb;
  if (process.env.LOCAL_DB_PATH) {
    if (!_localSqlite) {
      // 用 eval 包裹 dynamic import,避开 CF build 时静态分析 better-sqlite3
      const dynImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
      const Database = (await dynImport('better-sqlite3')).default;
      const { mkdirSync } = await import('node:fs');
      const { dirname, resolve } = await import('node:path');
      const p = resolve(process.env.LOCAL_DB_PATH);
      mkdirSync(dirname(p), { recursive: true });
      _localSqlite = new Database(p);
      _localSqlite.pragma('journal_mode = WAL');
    }
    const { fromSqlite } = await import('./db');
    _localDb = fromSqlite(_localSqlite);
  }
  return _localDb!;
}
// 标记: 部署到 CF Pages 时,即便 import better-sqlite3 失败 (native binding),
// 我们只在 LOCAL_DB_PATH 显式设置时才尝试加载,触发条件用户可控。

// 兼容 APIRoute({ locals }) 和 AstroGlobal (页面) 两种调用方式
export type DbHost = AstroGlobal | { locals: any };
export async function getDb(host: DbHost): Promise<DB> {
  const d1 = (host as any).locals?.runtime?.env?.DB;
  if (d1) return d1;
  const local = await localSqliteDb();
  if (local) return local;
  throw new Error('no DB: 部署到 CF Pages 应绑定 D1;本地可设 LOCAL_DB_PATH=data/grades.db');
}

export async function ensureSchema(db: DB) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      birth_date TEXT,
      grade TEXT,
      school TEXT,
      avatar TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      semester TEXT NOT NULL,
      total_score REAL,
      class_rank INTEGER,
      grade_rank INTEGER,
      class_size INTEGER,
      grade_size INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_exams_student ON exams(student_id, date);
    CREATE TABLE IF NOT EXISTS subject_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      score REAL NOT NULL,
      full_score REAL NOT NULL,
      class_rank INTEGER,
      grade_rank INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_scores_exam ON subject_scores(exam_id);
    CREATE INDEX IF NOT EXISTS idx_scores_subject ON subject_scores(subject);
    CREATE TABLE IF NOT EXISTS ai_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      exam_id TEXT,
      semester TEXT,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      cost_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_comments_student ON ai_comments(student_id, created_at);
  `);
}

// ---------- types ----------
export type Student = {
  id: string; name: string; birth_date: string | null; grade: string | null;
  school: string | null; avatar: string | null; created_at: string;
};
export type Exam = {
  id: string; student_id: string; date: string; type: string; semester: string;
  total_score: number | null; class_rank: number | null; grade_rank: number | null;
  class_size: number | null; grade_size: number | null; notes: string | null;
  created_at: string;
};
export type SubjectScore = {
  id: number; exam_id: string; subject: string; score: number; full_score: number;
  class_rank: number | null; grade_rank: number | null;
};
export type AIComment = {
  id: number; student_id: string; exam_id: string | null; semester: string | null;
  type: 'exam' | 'semester' | 'year'; content: string; cost_usd: number | null;
  created_at: string;
};

// ---------- students ----------
export async function listStudents(db: DB): Promise<Student[]> {
  const r = await db.prepare('SELECT * FROM students ORDER BY created_at DESC').all<Student>();
  return r.results;
}
export async function getStudent(db: DB, id: string): Promise<Student | null> {
  return await db.prepare('SELECT * FROM students WHERE id = ?').bind(id).first<Student>();
}
export async function createStudent(db: DB, s: Omit<Student, 'id' | 'created_at'>): Promise<Student> {
  const id = randomUUID();
  await db.prepare(
    'INSERT INTO students(id,name,birth_date,grade,school,avatar) VALUES (?,?,?,?,?,?)'
  ).bind(id, s.name, s.birth_date ?? null, s.grade ?? null, s.school ?? null, s.avatar ?? null).run();
  return (await getStudent(db, id))!;
}
export async function updateStudent(db: DB, id: string, patch: Partial<Omit<Student, 'id' | 'created_at'>>) {
  const fields = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined);
  if (!fields.length) return;
  const sql = `UPDATE students SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`;
  await db.prepare(sql).bind(...fields.map((f) => patch[f as keyof typeof patch]), id).run();
}
export async function deleteStudent(db: DB, id: string) {
  await db.prepare('DELETE FROM students WHERE id = ?').bind(id).run();
}

// ---------- exams + scores ----------
export async function listExams(db: DB, studentId: string): Promise<Exam[]> {
  const r = await db.prepare('SELECT * FROM exams WHERE student_id = ? ORDER BY date ASC').bind(studentId).all<Exam>();
  return r.results;
}
export async function listScoresForStudent(db: DB, studentId: string): Promise<(SubjectScore & { date: string; type: string; semester: string })[]> {
  const r = await db.prepare(
    `SELECT s.*, e.date, e.type, e.semester
     FROM subject_scores s JOIN exams e ON s.exam_id = e.id
     WHERE e.student_id = ?
     ORDER BY e.date ASC, s.subject ASC`
  ).bind(studentId).all<any>();
  return r.results;
}

// ---------- 预测 (纯函数,无需 DB) ----------
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

// ---------- comments ----------
export async function listComments(db: DB, studentId: string): Promise<AIComment[]> {
  const r = await db.prepare(
    'SELECT * FROM ai_comments WHERE student_id = ? ORDER BY created_at DESC'
  ).bind(studentId).all<AIComment>();
  return r.results;
}
export async function saveComment(db: DB, c: Omit<AIComment, 'id' | 'created_at'>): Promise<AIComment> {
  const r = await db.prepare(
    `INSERT INTO ai_comments(student_id,exam_id,semester,type,content,cost_usd)
     VALUES (?,?,?,?,?,?) RETURNING *`
  ).bind(
    c.student_id, c.exam_id, c.semester, c.type, c.content, c.cost_usd ?? null
  ).first<AIComment>();
  return r!;
}
export async function deleteComment(db: DB, id: number) {
  await db.prepare('DELETE FROM ai_comments WHERE id = ?').bind(id).run();
}

// ---------- CSV import (纯函数式,接受 DB) ----------
export type ImportResult = { exams: number; scores: number; skipped: number };
import Papa from 'papaparse';
export async function importCSV(db: DB, studentId: string, csv: string): Promise<ImportResult> {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true, skipEmptyLines: true,
  });
  if (parsed.errors.length) throw new Error(`CSV parse: ${parsed.errors[0].message}`);
  const findExam = await db.prepare(
    `SELECT id FROM exams WHERE student_id = ? AND date = ? AND semester = ?`
  );
  const insertExam = await db.prepare(
    `INSERT INTO exams(id,student_id,date,type,semester,total_score,class_rank,grade_rank,class_size,grade_size,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insertScore = await db.prepare(
    `INSERT INTO subject_scores(exam_id,subject,score,full_score,class_rank,grade_rank)
     VALUES (?,?,?,?,?,?)`
  );

  let examCount = 0, scoreCount = 0, skipped = 0;
  for (const r of parsed.data) {
    const date = (r.date || '').trim();
    const semester = (r.semester || '').trim();
    const subject = (r.subject || '').trim();
    const score = parseFloat(r.score);
    const full = parseFloat(r.full_score);
    if (!date || !semester || !subject || Number.isNaN(score) || Number.isNaN(full)) {
      skipped++; continue;
    }
    const type = (r.type || 'monthly').trim();
    let existing = await findExam.bind(studentId, date, semester).first<{ id: string }>();
    let examId = existing?.id;
    if (!examId) {
      examId = randomUUID();
      await insertExam.bind(
        examId, studentId, date, type, semester,
        numOrNull(r.total_score), intOrNull(r.class_rank), intOrNull(r.grade_rank),
        intOrNull(r.class_size), intOrNull(r.grade_size),
        (r.notes || '').trim() || null
      ).run();
      examCount++;
    }
    await insertScore.bind(
      examId, subject, score, full,
      intOrNull(r.class_rank), intOrNull(r.grade_rank)
    ).run();
    scoreCount++;
  }
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

// ---------- demo seed ----------
export async function seedDemo(db: DB, studentId: string) {
  const rows = [
    ['2025-09-15', 'monthly', '2025-fall', '语文', '82'],
    ['2025-09-15', 'monthly', '2025-fall', '数学', '78'],
    ['2025-09-15', 'monthly', '2025-fall', '英语', '88'],
    ['2025-10-20', 'monthly', '2025-fall', '语文', '85'],
    ['2025-10-20', 'monthly', '2025-fall', '数学', '82'],
    ['2025-10-20', 'monthly', '2025-fall', '英语', '90'],
    ['2025-11-25', 'midterm', '2025-fall', '语文', '86'],
    ['2025-11-25', 'midterm', '2025-fall', '数学', '88'],
    ['2025-11-25', 'midterm', '2025-fall', '英语', '92'],
    ['2026-01-12', 'final', '2025-fall', '语文', '89'],
    ['2026-01-12', 'final', '2025-fall', '数学', '91'],
    ['2026-01-12', 'final', '2025-fall', '英语', '94'],
  ];
  const csv = ['date,type,semester,subject,score,full_score']
    .concat(rows.map((r) => r.join(',') + ',100'))
    .join('\n');
  await importCSV(db, studentId, csv);
}
