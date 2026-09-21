import type { APIRoute } from 'astro';
import { deleteComment, listComments, getDb, ensureSchema } from '../../lib/repo';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const fd = await request.formData();
  const action = fd.get('_action');
  const db = await getDb({ locals } as any);
  await ensureSchema(db);

  if (action === 'delete') {
    const id = Number(fd.get('id'));
    if (!Number.isNaN(id)) {
      await deleteComment(db, id);
    }
    const sid = String(fd.get('student_id') ?? '');
    return redirect(sid ? `/student/${sid}?deleted_comment=1` : '/');
  }

  return new Response('unknown action', { status: 400 });
};

export const GET: APIRoute = async ({ url, locals }) => {
  const sid = url.searchParams.get('student_id');
  if (!sid) return new Response('student_id required', { status: 400 });
  const db = await getDb({ locals } as any);
  await ensureSchema(db);
  const comments = await listComments(db, sid);
  return new Response(JSON.stringify(comments, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="comments-${sid.slice(0, 8)}.json"`,
    },
  });
};