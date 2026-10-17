import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth/get-auth-user';
import { listSkills } from '@/lib/skills/loader';

export const dynamic = 'force-dynamic';

/**
 * List the engineering skills available on this machine.
 *
 * Metadata only — no bodies. The picker needs names and descriptions, and
 * shipping every body to the browser would be megabytes of text the client
 * never displays. The server loads the chosen bodies when generating.
 *
 * `available: false` means no skills directory was found; the UI then hides the
 * picker instead of showing an empty list, and generation is unaffected.
 */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const refresh = url.searchParams.get('refresh') === '1';

  const skills = await listSkills(refresh);

  return NextResponse.json(
    {
      available: skills.length > 0,
      count: skills.length,
      data: skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        size: s.size,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
