import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getAuthUser } from '@/lib/auth/get-auth-user';
import { deriveStatus } from '@/lib/prd/status';
import type { PRDContent, PRDStatus } from '@/types';

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const prds = await prisma.pRD.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        content: true,
        modelUsed: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    // Normalize to the client's PRD shape (snake_case keys). Status is
    // re-derived from content rather than reported as stored: rows written
    // before status became derived can claim 'completed' while missing most
    // sections, and the list must not repeat that claim.
    return NextResponse.json({
      data: prds.map((p: (typeof prds)[number]) => {
        const content = (p.content ?? {}) as Partial<PRDContent>;
        return {
          id: p.id,
          title: p.title,
          description: p.description,
          status: deriveStatus(content, p.status as PRDStatus),
          model_used: p.modelUsed,
          created_at: p.createdAt.toISOString(),
          updated_at: p.updatedAt.toISOString(),
        };
      }),
    });
  } catch (err) {
    console.error('GET /api/prd failed:', err);
    return NextResponse.json({ error: 'Failed to load PRDs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const { title, description, content, markdown_content, model_used, idea, structure } = body ?? {};

    // Status is DERIVED, never taken from the request. A client-supplied
    // 'completed' on a payload holding one section is how a half-finished PRD
    // ended up displayed as done — the content is the only authority.
    const contentObj = (content ?? null) as Partial<PRDContent> | null;
    const status = deriveStatus(contentObj, body?.status as PRDStatus | undefined);

    const prd = await prisma.pRD.create({
      data: {
        userId: user.id,
        title: title ?? 'PRD Baru',
        description: description ?? null,
        status,
        // Prisma models a JSON null with an explicit sentinel rather than
        // `null`, so an absent payload is written as DbNull.
        content: contentObj ? (contentObj as Prisma.InputJsonValue) : Prisma.DbNull,
        markdownContent: markdown_content ?? null,
        modelUsed: model_used ?? null,
        idea: idea ?? null,
        structure: structure ?? null,
      },
    });

    return NextResponse.json({ data: prd }, { status: 201 });
  } catch (err) {
    console.error('POST /api/prd failed:', err);
    return NextResponse.json({ error: 'Failed to save PRD' }, { status: 500 });
  }
}
