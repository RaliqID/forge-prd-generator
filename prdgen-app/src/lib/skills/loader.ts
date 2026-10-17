import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Skills: reusable engineering guidance that shapes how a PRD is written.
 *
 * A "skill" is a directory containing a `SKILL.md` with YAML-ish frontmatter
 * (name/description) and a markdown body of principles, workflows and checks.
 * They are read from the local OpenCode skills directory at runtime.
 *
 * Why read from disk instead of vendoring into this repo
 * -----------------------------------------------------
 * Several of the skills in a typical collection carry an explicit
 * "all rights reserved / do NOT redistribute" notice. Copying them into this
 * repository would redistribute them, which is not ours to do. Reading them at
 * runtime keeps the guidance available to the user's own machine without ever
 * putting someone else's content into the project.
 *
 * Consequence: skills are optional. A deployment without a skills directory
 * simply gets an empty catalogue and generation behaves exactly as before.
 *
 * Security: only a NAME from the catalogue is accepted from the client. The
 * file path is resolved server-side from the discovered list, so a request can
 * never point the reader at an arbitrary path (no traversal).
 */

/**
 * Where to look for skills.
 *
 * An explicit SKILLS_DIR is AUTHORITATIVE: if it is set but missing, we report
 * no skills rather than silently falling back to a default location. Falling
 * back would make an explicitly-configured (or test) directory appear to
 * contain whatever happens to be in the user's home directory.
 */
function candidateRoots(): string[] {
  const fromEnv = process.env.SKILLS_DIR?.trim();
  if (fromEnv) return [fromEnv];

  const home = os.homedir();
  return [
    path.join(home, '.config', 'opencode', 'skills'),
    path.join(home, '.opencode', 'skills'),
    path.join(home, '.claude', 'skills'),
  ];
}

export interface SkillMeta {
  /** Directory name — the stable id used in requests. */
  id: string;
  /** Frontmatter `name`, falling back to the directory name. */
  name: string;
  /** Frontmatter `description` (one line, may be long). */
  description: string;
  /** Body size in characters, so callers can budget. */
  size: number;
  /** Whether the file carries a redistribution restriction. */
  restricted: boolean;
}

export interface Skill extends SkillMeta {
  /** Markdown body with frontmatter stripped. */
  body: string;
}

/** Parse the leading `--- ... ---` block into key/value pairs. */
function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const match = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: raw };

  const data: Record<string, string> = {};
  let currentKey: string | null = null;
  // Inside a `key: >-` / `key: |` block the indented lines are continuations of
  // the previous key, not new keys.
  let inBlockScalar = false;

  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      currentKey = kv[1];
      let value = kv[2].trim();
      // YAML block scalar markers mean "the value is the indented lines below".
      inBlockScalar = /^[>|][+-]?$/.test(value);
      if (inBlockScalar) {
        data[currentKey] = '';
        continue;
      }
      // Strip surrounding quotes so descriptions compare/serialize cleanly.
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        value = value.slice(1, -1);
      }
      data[currentKey] = value;
      continue;
    }
    // Continuation of a folded/literal block, or a wrapped line.
    if (currentKey && /^\s+\S/.test(line)) {
      const joined = `${data[currentKey] ?? ''} ${line.trim()}`.trim();
      data[currentKey] = joined;
      continue;
    }
    // A blank line ends a block scalar but not a wrapped line.
    if (inBlockScalar && line.trim() === '') inBlockScalar = false;
  }

  return { data, body: raw.slice(match[0].length) };
}

/**
 * A skill is "restricted" when its own text says it may not be redistributed.
 * We still READ it locally (that is what the user installed it for) but the
 * flag lets callers avoid echoing the body anywhere that looks like publishing.
 */
function isRestricted(raw: string): boolean {
  return /all rights reserved|do not redistribute|local personal use only/i.test(raw);
}

/** Cache the catalogue: the directory rarely changes and scanning is I/O. */
let catalogueCache: { root: string | null; skills: SkillMeta[]; at: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function findRoot(): Promise<string | null> {
  for (const dir of candidateRoots()) {
    try {
      const stat = await fs.stat(dir);
      if (stat.isDirectory()) return dir;
    } catch {
      // not present — try the next candidate
    }
  }
  return null;
}

/**
 * List available skills (metadata only — bodies are loaded on demand so the
 * catalogue stays cheap to serve and to render in a picker).
 */
export async function listSkills(force = false): Promise<SkillMeta[]> {
  const now = Date.now();
  if (!force && catalogueCache && now - catalogueCache.at < CACHE_TTL_MS) {
    return catalogueCache.skills;
  }

  const root = await findRoot();
  if (!root) {
    catalogueCache = { root: null, skills: [], at: now };
    return [];
  }

  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    catalogueCache = { root, skills: [], at: now };
    return [];
  }

  const skills: SkillMeta[] = [];
  await Promise.all(
    entries.map(async (id) => {
      const file = path.join(root, id, 'SKILL.md');
      try {
        const raw = await fs.readFile(file, 'utf8');
        const { data, body } = parseFrontmatter(raw);
        skills.push({
          id,
          name: data.name || id,
          description: data.description || '',
          size: body.length,
          restricted: isRestricted(raw),
        });
      } catch {
        // Not a skill directory (or unreadable) — skip silently.
      }
    })
  );

  skills.sort((a, b) => a.id.localeCompare(b.id));
  catalogueCache = { root, skills, at: now };
  return skills;
}

/**
 * Load one skill by id.
 *
 * The id must exist in the discovered catalogue — it is never joined to a path
 * directly, so `../` and absolute paths cannot escape the skills root.
 */
export async function loadSkill(id: string): Promise<Skill | null> {
  const catalogue = await listSkills();
  const meta = catalogue.find((s) => s.id === id);
  if (!meta) return null;

  const root = catalogueCache?.root;
  if (!root) return null;

  try {
    const raw = await fs.readFile(path.join(root, meta.id, 'SKILL.md'), 'utf8');
    const { body } = parseFrontmatter(raw);
    return { ...meta, body };
  } catch {
    return null;
  }
}

/** Load several skills, preserving the requested order and skipping misses. */
export async function loadSkills(ids: string[]): Promise<Skill[]> {
  const unique = [...new Set(ids)].slice(0, 8); // bound the prompt cost
  const loaded = await Promise.all(unique.map((id) => loadSkill(id)));
  return loaded.filter((s): s is Skill => s !== null);
}

/**
 * Build the prompt block for a set of skills.
 *
 * Bodies are truncated per skill and in total: a PRD prompt already carries a
 * large system message, and an unbounded skills block would crowd out the
 * product context (and cost tokens on every section).
 */
export function buildSkillsPromptBlock(skills: Skill[]): string {
  if (skills.length === 0) return '';

  const PER_SKILL_CAP = 6000;
  const TOTAL_CAP = 18000;

  const parts: string[] = [];
  let used = 0;

  for (const skill of skills) {
    if (used >= TOTAL_CAP) break;
    const remaining = TOTAL_CAP - used;
    const cap = Math.min(PER_SKILL_CAP, remaining);
    const text = skill.body.length > cap ? `${skill.body.slice(0, cap)}\n…(dipotong)` : skill.body;
    parts.push(`### ${skill.name}\n${text.trim()}`);
    used += text.length;
  }

  return `# ENGINEERING SKILLS (WAJIB DIPATUHI)
Dokumen ini harus mengikuti standar engineering dari skill berikut. Terapkan
prinsip, struktur, dan checklist-nya saat menulis setiap section. Jika sebuah
skill menyebut praktik yang tidak relevan dengan produk ini, lewati bagian itu
dan tetap ikuti sisanya.

${parts.join('\n\n---\n\n')}`;
}
