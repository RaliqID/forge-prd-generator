import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Reveal } from './Reveal';

/** Closing CTA band: deep green panel with layered depth and a stamp motif. */
export function CtaBand() {
  return (
    <section aria-labelledby="cta-heading" className="border-t border-border bg-paper-raised">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <Reveal>
          <div className="relative isolate overflow-hidden rounded-2xl border border-accent/25 bg-paper-raised px-6 py-14 text-center shadow-[0_1px_0_0_var(--border-paper)_inset,0_24px_60px_-32px_rgb(0_0_0/0.45)] sm:px-12 lg:py-20">
            {/* Layered wash: a soft radial bloom + a hairline grid, so the panel
                reads as depth rather than one flat saturated slab. */}
            <div
              aria-hidden
              className="absolute inset-0 -z-10 bg-[radial-gradient(120%_120%_at_50%_-20%,var(--accent-soft)_0%,transparent_62%)]"
            />
            <div
              aria-hidden
              className="bg-paper-grid mask-fade absolute inset-0 -z-10 opacity-[0.35]"
            />
            {/* Top hairline highlight — gives the panel a lit edge. */}
            <div
              aria-hidden
              className="absolute inset-x-10 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent"
            />

            <div className="relative">
              <span className="stamp text-accent">Mulai</span>

              <h2
                id="cta-heading"
                className="mx-auto mt-5 max-w-2xl font-heading text-2xl font-bold tracking-[-0.02em] text-ink sm:text-3xl lg:text-[2.6rem] lg:leading-[1.15]"
              >
                Dokumen yang membuat tim Anda{' '}
                <span className="text-accent">sejalan.</span>
              </h2>

              <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink-dim">
                Mulai dari satu paragraf ide. PRD lengkap menyusul beberapa menit kemudian —
                siap direvisi, dibagikan, dan diekspor.
              </p>

              {/* Concrete reassurance instead of a vague badge. */}
              <ul className="mx-auto mt-6 flex max-w-lg flex-wrap items-center justify-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-wider text-ink-dim">
                {['17 bagian terstruktur', 'Streaming real-time', 'Ekspor PDF'].map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <Check className="size-3.5 shrink-0 text-accent" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/new">
                  <Button size="lg" className="btn-goo h-11 gap-2 px-6">
                    Buat PRD Pertama Anda
                    <ArrowRight className="size-4" />
                  </Button>
                </Link>
              </div>

              <p className="mt-6 font-mono text-[11px] tracking-wider text-ink-dim">
                Sudah punya akun?{' '}
                <Link
                  href="/login"
                  className="font-semibold text-accent underline underline-offset-4 transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Masuk di sini
                </Link>
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

