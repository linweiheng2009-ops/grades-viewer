import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// 数据文件存到项目根的 data/grades.db,首次访问自动建表
const DB_PATH = resolve(process.cwd(), 'data/grades.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS students (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    birth_date    TEXT,
    grade         TEXT,
    school        TEXT,
    avatar        TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS exams (
    id            TEXT PRIMARY KEY,
    student_id    TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,
    type          TEXT NOT NULL CHECK(type IN ('midterm','final','monthly','quiz')),
    semester      TEXT NOT NULL,
    total_score   REAL,
    class_rank    INTEGER,
    grade_rank    INTEGER,
    class_size    INTEGER,
    grade_size    INTEGER,
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_exams_student ON exams(student_id, date);

  CREATE TABLE IF NOT EXISTS subject_scores (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_id       TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    subject       TEXT NOT NULL,
    score         REAL NOT NULL,
    full_score    REAL NOT NULL,
    class_rank    INTEGER,
    grade_rank    INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_scores_exam ON subject_scores(exam_id);
  CREATE INDEX IF NOT EXISTS idx_scores_subject ON subject_scores(subject);

  CREATE TABLE IF NOT EXISTS ai_comments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id    TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    exam_id       TEXT REFERENCES exams(id) ON DELETE SET NULL,
    semester      TEXT,
    type          TEXT NOT NULL CHECK(type IN ('exam','semester','year')),
    content       TEXT NOT NULL,
    cost_usd      REAL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_comments_student ON ai_comments(student_id, created_at);
`);

export default db;
export type Student = {
  id: string;
  name: string;
  birth_date: string | null;
  grade: string | null;
  school: string | null;
  avatar: string | null;
  created_at: string;
};
export type Exam = {
  id: string;
  student_id: string;
  date: string;
  type: 'midterm' | 'final' | 'monthly' | 'quiz';
  semester: string;
  total_score: number | null;
  class_rank: number | null;
  grade_rank: number | null;
  class_size: number | null;
  grade_size: number | null;
  notes: string | null;
  created_at: string;
};
export type SubjectScore = {
  id: number;
  exam_id: string;
  subject: string;
  score: number;
  full_score: number;
  class_rank: number | null;
  grade_rank: number | null;
};
