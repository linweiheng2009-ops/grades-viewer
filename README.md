# 成绩看板 (grades-viewer)

本地版学生成绩评估看板。Astro 7 + better-sqlite3 + 纯 SVG 图表 + AI 评语。

## 启动

```bash
npm install
npm run dev      # http://127.0.0.1:4321
npm run build    # 生产构建
```

首次启动自动创建 `data/grades.db` 并建表。

## 功能

- 📋 **学生管理** — 多孩子、emoji 头像、年级/学校
- 📥 **CSV 导入** — 标准列：date / type / semester / subject / score / full_score / class_rank / grade_rank / total_score / class_size / grade_size / notes
- 📈 **科目趋势** — 纯 SVG 自绘折线图，4 色 palette
- 🎯 **强弱雷达** — 最近考试 vs 历史均值
- 📊 **最近考试表格** — 分数 + 班级排名
- 💬 **AI 学期评语** — 基于 Claude Haiku（无 API key 时走规则引擎兜底）
- 🖨 **PDF 导出** — 浏览器原生 `window.print()` 保存为 A4 PDF

## 隐私

- 所有数据存在本地 `data/grades.db`
- 默认不上传任何服务器
- AI 评语仅在生成时调用 Anthropic API（可禁用 `ANTHROPIC_API_KEY` 走规则兜底）

## 环境变量

| 变量 | 用途 |
|------|------|
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | AI 评语所需 |
| `ANTHROPIC_BASE_URL` | 自定义 base URL（默认 anthropic.com） |
| `ANTHROPIC_MODEL` | 模型名（默认 `MiniMax-M3`） |

## 路线

- W1 ✅ 数据模型 + CSV 导入
- W2 ✅ 趋势 / 雷达 / 排名 视图
- W3 ✅ AI 学期评语 + PDF 导出
- W4 🚧 多孩子切换 + 部署 + 域名（暂缓，本地版已够用）

## 数据结构

```
students (id, name, birth_date, grade, school, avatar)
exams    (id, student_id, date, type, semester, total_score, class_rank, grade_rank, class_size, grade_size, notes)
subject_scores (exam_id, subject, score, full_score, class_rank, grade_rank)
ai_comments (student_id, exam_id?, semester, type, content, cost_usd)
```
