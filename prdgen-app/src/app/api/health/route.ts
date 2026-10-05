import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { PROVIDERS, resolveStructuredModel } from '@/lib/ai/providers';

export const dynamic = 'force-dynamic';

/**
 * Liveness + readiness probe.
 *
 * Reports each dependency the app needs, with a status the caller can act on:
 *   ok      — reachable and usable
 *   missing — not configured (may be fine: e.g. no Supabase in dev mode)
 *   down    — configured but not answering
 *
 * HTTP is 200 when the app can serve (DB reachable, or a clear reason it can't)
 * and 503 only when a hard dependency is down, so a load balancer can act on it.
 * The body never leaks secrets — only booleans and provider names.
 */

type Status = 'ok' | 'missing' | 'down';

interface Check {
  status: Status;
  detail?: string;
}

export async function GET() {
  const checks: Record<string, Check> = {};

  // ── Database ──
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: 'ok', detail: `${Date.now() - dbStart}ms` };
  } catch (err) {
    checks.database = {
      status: 'down',
      detail: err instanceof Error ? err.message.split('\n')[0].slice(0, 200) : 'unreachable',
    };
  }

  // ── AI providers ── configured means "a key is present", not "it works" —
  // an actual call would cost tokens on every health check.
  const configuredProviders = Object.values(PROVIDERS)
    .filter((p) => Boolean(process.env[p.envKey]))
    .map((p) => p.id);
  checks.aiProviders = configuredProviders.length
    ? { status: 'ok', detail: configuredProviders.join(', ') }
    : { status: 'missing', detail: 'no provider key set (mock mode)' };

  // ── Auth ──
  checks.auth = isSupabaseConfigured()
    ? { status: 'ok', detail: 'supabase' }
    : { status: 'missing', detail: 'dev mode (no Supabase configured)' };

  // ── Structured-output model ── surfaces the misconfiguration that silently
  // produced an empty feature map (a combo/router alias instead of a model).
  if (configuredProviders.includes('9router')) {
    checks.structuredModel = { status: 'ok', detail: resolveStructuredModel() };
  }

  const hardFailure = checks.database.status === 'down';
  const body = {
    status: hardFailure ? 'unhealthy' : 'healthy',
    version: process.env.npm_package_version ?? '0.1.0',
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks,
  };

  return NextResponse.json(body, {
    status: hardFailure ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
