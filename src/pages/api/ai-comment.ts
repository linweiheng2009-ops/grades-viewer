import type { APIRoute } from 'astro';
import { getStudent, listScoresForStudent, listExams, saveComment } from '../../lib/repo';
import { generateComment } from '../../lib/ai';

export const POST: APIRoute = async ({ request, redirect }) => {
  const fd = await request.formData();
  const studentId = String(fd.get('student_id'));
  const type = (String(fd.get('type') || 'semester') as 'exam' | 'semester' | 'year');
  const semester = fd.get('semester') ? String(fd.get('semester')) : undefined;
  const examId = fd.get('exam_id') ? String(fd.get('exam_id')) : undefined;

  const student = getStudent(studentId);
  if (!student) return new Response('student not found', { status: 404 });

  // 取成绩
  let scores = listScoresForStudent(studentId);
  if (semester) scores = scores.filter((s) => s.semester === semester);
  if (examId) scores = scores.filter((s) => s.exam_id === examId);
  if (!scores.length) {
    return new Response('没有成绩数据可评', { status: 400 });
  }

  const targetSemester = semester ?? scores.at(-1)!.semester;
  try {
    const r = await generateComment({ student, scores, semester: targetSemester, type });
    saveComment({
      student_id: studentId,
      exam_id: examId ?? null,
      semester: targetSemester,
      type,
      content: r.content,
      cost_usd: r.costUSD,
    });
    return redirect(`/student/${studentId}?commented=1`);
  } catch (e: any) {
    return new Response(`AI 生成失败: ${e.message}`, { status: 500 });
  }
};
