import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthUser } from '@/lib/auth/get-auth-user';
import { isUuid } from '@/lib/is-uuid';
import { deriveStatus } from '@/lib/prd/status';
import type { PRDContent, PRDStatus } from '@/types';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    // Scope by userId so a foreign id returns 404 (no existence leak).
    const prd = await prisma.pRD.findFirst({ where: { id, userId: user.id } });
    if (!prd) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const content = (prd.content ?? {}) as Partial<PRDContent>;
    return NextResponse.json({
      data: {
        id: prd.id,
        user_id: prd.userId,
        title: prd.title,
        description: prd.description,
        // Derived, so opening a PRD saved as 'completed' with missing sections
        // reports what is actually there and the resume banner can appear.
        status: deriveStatus(content, prd.status as PRDStatus),
        content: prd.content,
        markdown_content: prd.markdownContent,
        model_used: prd.modelUsed,
        idea: prd.idea,
        structure: prd.structure,
        created_at: prd.createdAt.toISOString(),
        updated_at: prd.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    console.error('GET /api/prd/[id] failed:', err);
    return NextResponse.json({ error: 'Failed to load PRD' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const body = await req.json();
    const { title, description, content, markdown_content, model_used, idea, structure } = body ?? {};

    // Status is re-derived whenever content is part of the write so it can never
    // drift from the sections. It stays untouched when the request does not
    // carry content (a rename must not recompute from a value we never read).
    let derived: PRDStatus | undefined;
    if (content !== undefined) {
      derived = deriveStatus(
        (content ?? null) as Partial<PRDContent> | null,
        body?.status as PRDStatus | undefined
      );
    }

    // Guard by userId: updateMany returns count 0 for a foreign/missing id.
    const result = await prisma.pRD.updateMany({
      where: { id, userId: user.id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(derived !== undefined ? { status: derived } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(markdown_content !== undefined ? { markdownContent: markdown_content } : {}),
        ...(model_used !== undefined ? { modelUsed: model_used } : {}),
        ...(idea !== undefined ? { idea } : {}),
        ...(structure !== undefined ? { structure } : {}),
      },
    });
    if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error('PUT /api/prd/[id] failed:', err);
    return NextResponse.json({ error: 'Failed to update PRD' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const result = await prisma.pRD.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true, id });
  } catch (err) {
    console.error('DELETE /api/prd/[id] failed:', err);
    return NextResponse.json({ error: 'Failed to delete PRD' }, { status: 500 });
  }
}
