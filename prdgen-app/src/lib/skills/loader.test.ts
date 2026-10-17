import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { listSkills, loadSkill, loadSkills, buildSkillsPromptBlock } from './loader';

/**
 * The skill loader reads guidance from a directory of `SKILL.md` files at
 * runtime rather than vendoring it, because parts of a typical collection carry
 * a "do not redistribute" notice. That makes the filesystem the input, so these
 * tests build a real temporary directory instead of mocking `fs` — the parsing,
 * the traversal guard and the caps are what actually matter.
 */

let root: string;
let prevSkillsDir: string | undefined;

async function writeSkill(id: string, frontmatter: string, body: string) {
  const dir = path.join(root, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}`, 'utf8');
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-skills-'));
  prevSkillsDir = process.env.SKILLS_DIR;
  process.env.SKILLS_DIR = root;
});

afterEach(async () => {
  if (prevSkillsDir === undefined) delete process.env.SKILLS_DIR;
  else process.env.SKILLS_DIR = prevSkillsDir;
  await fs.rm(root, { recursive: true, force: true });
});

describe('listSkills', () => {
  it('reads id, name and description from frontmatter', async () => {
    await writeSkill('requirements-engineering', 'name: Requirements Engineering\ndescription: Turn vague asks into requirements.', '# Body');
    const skills = await listSkills(true);
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe('requirements-engineering');
    expect(skills[0].name).toBe('Requirements Engineering');
    expect(skills[0].description).toContain('vague asks');
  });

  it('falls back to the directory name when frontmatter has no name', async () => {
    await writeSkill('plain-skill', 'description: no name here', '# Body');
    const [skill] = await listSkills(true);
    expect(skill.name).toBe('plain-skill');
  });

  it('handles quoted descriptions', async () => {
    await writeSkill('quoted', `name: Quoted\ndescription: 'Has: a colon, and quotes'`, '# Body');
    const [skill] = await listSkills(true);
    expect(skill.description).toBe('Has: a colon, and quotes');
  });

  it('joins a multi-line folded description', async () => {
    await writeSkill('folded', 'name: Folded\ndescription: >-\n  first part\n  second part', '# Body');
    const [skill] = await listSkills(true);
    expect(skill.description).toBe('first part second part');
  });

  it('flags a redistribution restriction', async () => {
    await writeSkill('restricted', 'name: R\ndescription: d', 'All rights reserved. Do NOT redistribute.');
    await writeSkill('open', 'name: O\ndescription: d', 'MIT licensed.');
    const skills = await listSkills(true);
    const byId = new Map(skills.map((s) => [s.id, s]));
    expect(byId.get('restricted')?.restricted).toBe(true);
    expect(byId.get('open')?.restricted).toBe(false);
  });

  it('skips directories without a SKILL.md', async () => {
    await fs.mkdir(path.join(root, 'not-a-skill'), { recursive: true });
    await writeSkill('real', 'name: Real', '# Body');
    const skills = await listSkills(true);
    expect(skills.map((s) => s.id)).toEqual(['real']);
  });

  it('returns an empty list when the directory is missing', async () => {
    process.env.SKILLS_DIR = path.join(root, 'does-not-exist');
    const skills = await listSkills(true);
    expect(skills).toEqual([]);
  });

  it('sorts by id for a stable picker order', async () => {
    await writeSkill('zeta', 'name: Z', 'b');
    await writeSkill('alpha', 'name: A', 'a');
    const skills = await listSkills(true);
    expect(skills.map((s) => s.id)).toEqual(['alpha', 'zeta']);
  });
});

describe('loadSkill', () => {
  it('returns the body with frontmatter stripped', async () => {
    await writeSkill('demo', 'name: Demo\ndescription: d', '# Heading\n\nContent here.');
    await listSkills(true);
    const skill = await loadSkill('demo');
    expect(skill?.body).toContain('# Heading');
    expect(skill?.body).not.toContain('name: Demo');
  });

  it('returns null for an unknown id', async () => {
    await listSkills(true);
    expect(await loadSkill('nope')).toBeNull();
  });

  it('refuses path traversal — only catalogued ids resolve', async () => {
    await writeSkill('safe', 'name: Safe', 'body');
    await listSkills(true);
    // An escape attempt is just an unknown id; it never touches the filesystem.
    expect(await loadSkill('../../etc/passwd')).toBeNull();
    expect(await loadSkill('/etc/passwd')).toBeNull();
    expect(await loadSkill('..')).toBeNull();
  });
});

describe('loadSkills', () => {
  it('preserves order, dedupes and skips misses', async () => {
    await writeSkill('a', 'name: A', 'body a');
    await writeSkill('b', 'name: B', 'body b');
    await listSkills(true);
    const loaded = await loadSkills(['b', 'missing', 'a', 'b']);
    expect(loaded.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('caps the number loaded', async () => {
    for (let i = 0; i < 12; i++) await writeSkill(`s${i}`, `name: S${i}`, 'body');
    await listSkills(true);
    const ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const loaded = await loadSkills(ids);
    expect(loaded).toHaveLength(8);
  });
});

describe('buildSkillsPromptBlock', () => {
  const mk = (id: string, body: string) => ({
    id,
    name: id.toUpperCase(),
    description: '',
    size: body.length,
    restricted: false,
    body,
  });

  it('returns an empty string when there are no skills', () => {
    expect(buildSkillsPromptBlock([])).toBe('');
  });

  it('includes each skill name and body', () => {
    const block = buildSkillsPromptBlock([mk('alpha', 'rule one'), mk('beta', 'rule two')]);
    expect(block).toContain('ALPHA');
    expect(block).toContain('rule one');
    expect(block).toContain('BETA');
    expect(block).toContain('rule two');
  });

  it('truncates a single oversized skill', () => {
    const block = buildSkillsPromptBlock([mk('huge', 'x'.repeat(20_000))]);
    expect(block.length).toBeLessThan(9_000);
    expect(block).toContain('dipotong');
  });

  it('bounds the total across many skills', () => {
    const many = Array.from({ length: 8 }, (_, i) => mk(`s${i}`, 'y'.repeat(6_000)));
    const block = buildSkillsPromptBlock(many);
    // 18000 total cap + per-skill headers/markup, so comfortably under 20k.
    expect(block.length).toBeLessThan(20_000);
  });

  it('states that structural rules still win', () => {
    const block = buildSkillsPromptBlock([mk('x', 'body')]);
    expect(block).toContain('WAJIB DIPATUHI');
  });
});
