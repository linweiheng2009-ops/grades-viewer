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