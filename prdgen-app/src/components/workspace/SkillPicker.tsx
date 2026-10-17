'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Lightbulb, Loader2, Search, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { suggestSkills } from '@/lib/skills/suggest';

/**
 * Engineering-skill picker.
 *
 * Skills are optional guidance read from the user's local skills directory
 * (see lib/skills/loader). The list is fetched from /api/skills and the picker
 * hides itself entirely when none are installed, so a deployment without skills
 * looks exactly like it did before.
 *
 * Selection is capped at 8 to bound prompt size — each skill's text is prepended
 * to every section request.
 */

const MAX_SELECTED = 8;

export interface SkillOption {
  id: string;
  name: string;
  description: string;
  size: number;
}

interface SkillPickerProps {
  selected: string[];
  onChange: (ids: string[]) => void;
  /** The user's idea text, used to suggest relevant skills. */
  idea?: string;
  /** When true the server chooses skills; `selected` is ignored. */
  auto: boolean;
  onAutoChange: (auto: boolean) => void;
}

/** Skills whose guidance most directly shapes a PRD. Used for the quick picks. */
const SUGGESTED = [
  'requirements-engineering',
  'feature-planning',
  'product-strategy',
  'architecture-decision',
  'api-design',
  'documentation-and-adrs',
  'clean-architecture',
  'domain-driven-design',
];

export function SkillPicker({ selected, onChange, idea = '', auto, onAutoChange }: SkillPickerProps) {
  const [skills, setSkills] = useState<SkillOption[] | null>(null);
  const [available, setAvailable] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/skills', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        setAvailable(Boolean(json.available));
        setSkills(Array.isArray(json.data) ? json.data : []);
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => {
    const map = new Map<string, SkillOption>();
    for (const s of skills ?? []) map.set(s.id, s);
    return map;
  }, [skills]);

  const filtered = useMemo(() => {
    const all = skills ?? [];
    const q = query.trim().toLowerCase();
    if (!q) {
      // Default view: the PRD-relevant quick picks first, then everything else.
      const suggested = SUGGESTED.map((id) => byId.get(id)).filter(
        (s): s is SkillOption => Boolean(s)
      );
      const suggestedIds = new Set(suggested.map((s) => s.id));
      return [...suggested, ...all.filter((s) => !suggestedIds.has(s.id))].slice(0, 60);
    }
    return all
      .filter(
        (s) => s.id.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [skills, query, byId]);

  // Skills worth suggesting for this specific idea. Recomputed as the user
  // types, but only from the already-fetched catalogue (no network).
  const suggestions = useMemo(() => {
    if (!skills || skills.length === 0) return [];
    return suggestSkills(idea, skills, 4).filter((s) => !selected.includes(s.id));
  }, [idea, skills, selected]);

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
      return;
    }
    if (selected.length >= MAX_SELECTED) return;
    onChange([...selected, id]);
  }

  // Still loading.
  if (skills === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <Loader2 className="size-3.5 animate-spin" />
        Memuat skills…
      </div>
    );
  }

  // No skills installed — render nothing rather than an empty shell.
  if (!available) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <h2 className="text-lg font-bold text-ink">Engineering Skills</h2>
          <span className="font-mono text-[11px] text-ink-faint">
            opsional · {skills.length} tersedia
          </span>
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="font-mono text-[11px] text-ink-dim underline underline-offset-2 hover:text-ink"
          >
            bersihkan ({selected.length})
          </button>
        )}
      </div>

      <p className="text-sm text-ink-dim">
        PRD akan mengikuti standar engineering dari skill yang dipilih.
      </p>

      {/* Auto vs manual */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onAutoChange(true)}
          className={cn(
            'rounded-sm border px-2.5 py-1.5 font-mono text-[11px] transition-colors',
            auto
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-ink-dim hover:border-ink-faint hover:text-ink'
          )}
          aria-pressed={auto}
        >
          Otomatis
        </button>
        <button
          type="button"
          onClick={() => onAutoChange(false)}
          className={cn(
            'rounded-sm border px-2.5 py-1.5 font-mono text-[11px] transition-colors',
            !auto
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-ink-dim hover:border-ink-faint hover:text-ink'
          )}
          aria-pressed={!auto}
        >
          Pilih manual
        </button>
        {auto && (
          <span className="text-[11px] text-ink-faint">
            Skill dipilih dari ide Anda saat generate.
          </span>
        )}
      </div>

      {/* Everything below is the manual picker; hidden in auto mode. */}
      {!auto && (
        <>
      {/* Suggestions derived from the idea text */}
      {suggestions.length > 0 && (
        <div className="rounded-sm border border-primary/20 bg-primary/5 p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <Lightbulb className="size-3.5 text-primary" aria-hidden />
            <span className="font-mono text-[11px] uppercase tracking-wider text-primary">
              Disarankan untuk ide ini
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s.id)}
                title={s.reason}
                className="inline-flex items-center gap-1 rounded-sm border border-border bg-paper px-2 py-1 font-mono text-[11px] text-ink-dim transition-colors hover:border-primary hover:text-primary"
              >
                + {byId.get(s.id)?.name ?? s.id}
                <span className="text-ink-faint">· {s.reason}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-sm border border-primary/30 bg-primary/10 px-2 py-1 font-mono text-[11px] text-primary"
            >
              {byId.get(id)?.name ?? id}
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-label={`Hapus ${id}`}
                className="rounded-sm hover:text-stamp"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="rounded-md border border-border">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-ink-dim hover:text-ink"
          aria-expanded={open}
        >
          <span>
            {selected.length === 0
              ? 'Pilih skill…'
              : `${selected.length} skill dipilih${selected.length >= MAX_SELECTED ? ' (maksimum)' : ''}`}
          </span>
          <Search className="size-3.5 shrink-0" aria-hidden />
        </button>

        {open && (
          <div className="border-t border-border p-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari skill — mis. requirements, api, security…"
              className="mb-3 w-full rounded-sm border border-border bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none"
            />
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {filtered.length === 0 && (
                <p className="px-2 py-3 text-xs text-ink-faint">Tidak ada skill yang cocok.</p>
              )}
              {filtered.map((s) => {
                const isSelected = selected.includes(s.id);
                const disabled = !isSelected && selected.length >= MAX_SELECTED;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggle(s.id)}
                    disabled={disabled}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left transition-colors',
                      isSelected ? 'bg-primary/10' : 'hover:bg-paper-raised',
                      disabled && 'cursor-not-allowed opacity-40'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border',
                        isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                      )}
                      aria-hidden
                    >
                      {isSelected && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-mono text-xs font-semibold text-ink">{s.id}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-ink-dim line-clamp-2">
                        {s.description || '(tanpa deskripsi)'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
