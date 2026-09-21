import type { APIRoute } from 'astro';
import { createStudent, deleteStudent, importCSV, seedDemo, getDb, ensureSchema } from '../../lib/repo';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const fd = await request.formData();
  const action = fd.get('_action');
  const db = await getDb({ locals } as any);
  await ensureSchema(db);

  if (action === 'delete') {
    await deleteStudent(db, String(fd.get('id')));
    return redirect('/?deleted=1');
  }
  if (action === 'import') {
    const sid = String(fd.get('student_id'));
    const csv = String(fd.get('csv') ?? '');
    try {
      const r = await importCSV(db, sid, csv);
      return redirect(`/student/${sid}?imported=${r.scores}`);
    } catch (e: any) {
      return new Response(`CSV 解析失败: ${e.message}`, { status: 400 });
    }
  }
  if (action === 'seed') {
    const sid = String(fd.get('student_id'));
    await seedDemo(db, sid);
    return redirect(`/student/${sid}?imported=demo`);
  }

  const name = String(fd.get('name') ?? '').trim();
  if (!name) return new Response('name required', { status: 400 });
  const s = await createStudent(db, {
    name,
    grade: strOrNull(fd.get('grade')),
    school: strOrNull(fd.get('school')),
    avatar: strOrNull(fd.get('avatar')),
    birth_date: null,
  });
  return redirect(`/?created=${s.id}`);
};

function strOrNull(v: FormDataEntryValue | null) {
  const s = v == null ? '' : String(v).trim();
  return s || null;
}