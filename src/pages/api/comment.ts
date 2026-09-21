import type { APIRoute } from 'astro';
import db from '../../lib/db';
import { listComments } from '../../lib/repo';

export const POST: APIRoute = async ({ request, redirect }) => {
  const fd = await request.formData();
  const action = fd.get('_action');

  if (action === 'delete') {
    const id = Number(fd.get('id'));
    if (!Number.isNaN(id)) {
      db.prepare('DELETE FROM ai_comments WHERE id = ?').run(id);
    }
    const sid = String(fd.get('student_id') ?? '');
    return redirect(sid ? `/student/${sid}?deleted_comment=1` : '/');
  }

  return new Response('unknown action', { status: 400 });
};

export const GET: APIRoute = async ({ url }) => {
  // /api/comment?export=1&student_id=xxx → JSON 导出
  const sid = url.searchParams.get('student_id');
  if (!sid) return new Response('student_id required', { status: 400 });
  const comments = listComments(sid);
  return new Response(JSON.stringify(comments, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="comments-${sid.slice(0, 8)}.json"`,
    },
  });
};
