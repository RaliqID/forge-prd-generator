/**
 * Skill auto-selection: pick which engineering skills apply to a product idea.
 *
 * Replaces the earlier hand-written keyword rules. Those only knew about ~14
 * skills, so a catalogue of 378 was mostly unreachable — `auth-security`,
 * `security-audit`, `payments`, `realtime-collaboration` and hundreds more could
 * never be suggested no matter what the idea said. Matching the idea against
 * each skill's own id + description scales to the whole catalogue and keeps
 * working when the user installs new skills.
 *
 * The scorer is intentionally simple and inspectable:
 *
 *   score = Σ over matched terms of  (termWeight × fieldWeight)
 *
 *  - Terms come from the idea (words and short phrases, lowercased, stopworded).
 *  - A skill is scored on its id (weighted higher — it is curated) and its
 *    description (weighted lower — verbose, so a common word hits many skills).
 *  - A term that appears in MANY skills is discounted (inverse document
 *    frequency), otherwise "aplikasi" or "data" would match everything.
 *
 * Deterministic and dependency-free so it can run on the client, and testable
 * without a model call.
 */

export interface SuggestibleSkill {
  id: string;
  description?: string;
}

export interface SkillSelection {
  id: string;
  /** Normalised 0-1 confidence, for display and thresholding. */
  score: number;
  /** The terms that triggered the match — makes a wrong pick debuggable. */
  matched: string[];
}

/**
 * Words that carry no domain signal. Indonesian and English, since ideas are
 * written in both. Deliberately excludes words that DO signal domain (e.g.
 * "data", "user", "sistem" appear in real requirements).
 */
const STOPWORDS = new Set([
  // English
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'for', 'with', 'without',
  'to', 'of', 'in', 'on', 'at', 'by', 'from', 'as', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its', 'we',
  'our', 'you', 'your', 'they', 'their', 'i', 'my', 'me', 'can', 'will', 'would',
  'should', 'could', 'may', 'might', 'must', 'have', 'has', 'had', 'do', 'does',
  'did', 'not', 'no', 'yes', 'so', 'such', 'than', 'too', 'very', 'just', 'also',
  'more', 'most', 'some', 'any', 'all', 'each', 'every', 'other', 'into', 'over',
  'under', 'about', 'like', 'want', 'wants', 'need', 'needs', 'make', 'makes',
  'build', 'building', 'create', 'creating', 'use', 'using', 'used', 'get', 'gets',
  'app', 'apps', 'application', 'applications', 'platform', 'product', 'project',
  'system', 'systems', 'tool', 'tools', 'feature', 'features', 'user', 'users',
  // Indonesian
  'yang', 'dan', 'atau', 'untuk', 'dengan', 'tanpa', 'dari', 'ke', 'di', 'pada',
  'adalah', 'ini', 'itu', 'saya', 'aku', 'gua', 'gue', 'kita', 'kami', 'mereka',
  'bisa', 'dapat', 'akan', 'sudah', 'belum', 'tidak', 'bukan', 'ada', 'juga',
  'saja', 'hanya', 'lebih', 'paling', 'sangat', 'banyak', 'semua', 'setiap',
  'sebuah', 'suatu', 'para', 'dalam', 'antar', 'secara', 'agar', 'supaya',
  'mau', 'ingin', 'buat', 'buatkan', 'bikin', 'membangun', 'bangun', 'membuat',
  'aplikasi', 'aplikasinya', 'sistem', 'sistemnya', 'platform', 'produk',
  'fitur', 'fiturnya', 'pengguna', 'penggunanya', 'user', 'penggunaan',
]);

/**
 * Domain gates.
 *
 * A bag-of-words score alone produces nonsense: an "editor kolaborasi realtime"
 * idea matched `blender-animation` (because of "editor") and `lean-ux` (because
 * of "collaboration"). Those skills are for 3D animation and UX workshops, not
 * for building a collaborative editor — a wrong skill in the prompt actively
 * degrades the PRD.
 *
 * A gate says: a skill in this family only qualifies when the idea contains one
 * of its trigger terms. Skills not named here are ungated. This is the smallest
 * mechanism that removes the worst false positives without needing a taxonomy
 * for all 378 skills.
 */
interface DomainGate {
  /** Matches skill ids belonging to the family. */
  idPattern: RegExp;
  /** Idea terms (already expanded) that justify selecting the family. */
  triggers: string[];
}

const DOMAIN_GATES: DomainGate[] = [
  {
    // 3D / motion / game authoring skills.
    idPattern: /blender|animation|3d|game|shader|vfx|rigging|sculpt/i,
    triggers: ['blender', 'animation', 'animasi', '3d', 'game', 'shader', 'vfx', 'rigging'],
  },
  {
    // Brand / visual-identity skills.
    idPattern: /iconography|typography|logo|brand|imagery|illustration/i,
    triggers: ['brand', 'logo', 'typography', 'tipografi', 'icon', 'illustration', 'ilustrasi', 'identitas'],
  },
  {
    // Marketing / growth skills — relevant only when growth is the subject.
    idPattern: /cro|conversion|marketing|growth|seo|monetiz|pricing-strategy|funnel/i,
    triggers: ['marketing', 'growth', 'conversion', 'cro', 'seo', 'monetization', 'monetisasi', 'funnel'],
  },
  {
    // Workshop / facilitation skills.
    idPattern: /lean-ux|design-sprint|workshop|facilitat|retrospective/i,
    triggers: ['workshop', 'sprint', 'facilitation', 'retrospective'],
  },
  {
    // Game / interactive media.
    idPattern: /roblox|unity|unreal|godot/i,
    triggers: ['roblox', 'unity', 'unreal', 'godot', 'game'],
  },
];

/** Is this skill allowed for these idea terms? */
function passesGates(skillId: string, ideaTerms: string[]): boolean {
  for (const gate of DOMAIN_GATES) {
    if (!gate.idPattern.test(skillId)) continue;
    // In the family: only allowed when a trigger is present.
    const hasTrigger = gate.triggers.some((t) => ideaTerms.includes(t));
    if (!hasTrigger) return false;
  }
  return true;
}

/**
 * Cross-language term expansion.
 *
 * Skills are written in English; ideas are frequently written in Indonesian.
 * Without this, "pembayaran" never matches a skill described with "payments",
 * so the whole auto-selection silently fails for exactly the users this app
 * targets. Each Indonesian term maps to the English terms a skill is likely to
 * use, and both are scored.
 *
 * Kept as data (not logic) so adding a domain is a one-line change.
 */
const ID_EN: Record<string, string[]> = {
  // commerce
  pembayaran: ['payment', 'billing', 'checkout'],
  bayar: ['payment', 'checkout'],
  langganan: ['subscription', 'billing'],
  tagihan: ['invoice', 'billing'],
  faktur: ['invoice'],
  pesanan: ['order', 'checkout'],
  keranjang: ['cart', 'checkout'],
  toko: ['commerce', 'store', 'ecommerce'],
  jualan: ['commerce', 'sales'],
  belanja: ['commerce', 'shopping'],
  harga: ['pricing', 'price'],
  diskon: ['discount', 'pricing'],
  // auth / security
  masuk: ['login', 'auth'],
  login: ['login', 'auth'],
  daftar: ['signup', 'registration'],
  akun: ['account', 'auth'],
  sandi: ['password', 'auth'],
  keamanan: ['security'],
  rahasia: ['secrets', 'security'],
  izin: ['authorization', 'permission'],
  akses: ['access', 'authorization'],
  // data / infra
  basisdata: ['database', 'data'],
  database: ['database'],
  penyimpanan: ['storage'],
  unggah: ['upload', 'storage'],
  berkas: ['file', 'storage'],
  arsip: ['archive'],
  laporan: ['report', 'analytics'],
  analitik: ['analytics'],
  statistik: ['statistics', 'analytics'],
  dasbor: ['dashboard'],
  // comms / realtime
  obrolan: ['chat', 'realtime'],
  chat: ['chat', 'realtime'],
  pesan: ['message', 'messaging'],
  notifikasi: ['notification'],
  pemberitahuan: ['notification'],
  langsung: ['realtime', 'live'],
  waktu: ['time', 'realtime'],
  kolaborasi: ['collaboration'],
  bersama: ['collaborative', 'shared'],
  // AI
  kecerdasan: ['ai', 'intelligence'],
  cerdas: ['ai', 'intelligent'],
  model: ['model', 'llm'],
  latih: ['training', 'model'],
  rekomendasi: ['recommendation'],
  pencarian: ['search'],
  cari: ['search'],
  // product / process
  pengguna: ['user'],
  pelanggan: ['customer'],
  admin: ['admin', 'administrator'],
  mitra: ['partner'],
  karyawan: ['employee', 'hr'],
  absensi: ['attendance', 'hr'],
  gudang: ['warehouse', 'inventory'],
  stok: ['inventory', 'stock'],
  pengiriman: ['shipping', 'delivery'],
  kurir: ['courier', 'delivery'],
  // quality
  aksesibilitas: ['accessibility'],
  kinerja: ['performance'],
  kecepatan: ['performance', 'latency'],
  skala: ['scalability', 'scale'],
  pengujian: ['testing', 'test'],
  uji: ['test', 'testing'],
  rilis: ['release', 'deployment'],
  arsitektur: ['architecture'],
  desain: ['design'],
  // education / health
  pendidikan: ['education'],
  sekolah: ['school', 'education'],
  mahasiswa: ['student', 'education'],
  kursus: ['course', 'learning'],
  belajar: ['learning', 'education'],
  kesehatan: ['health'],
  pasien: ['patient', 'health'],
  obat: ['medicine', 'health'],
  // misc domains
  peta: ['map', 'geo'],
  lokasi: ['location', 'geo'],
  perjalanan: ['travel', 'trip'],
  wisata: ['travel', 'tourism'],
  properti: ['property', 'real estate'],
  sewa: ['rental', 'rent'],
  asuransi: ['insurance'],
  pajak: ['tax'],
};

/**
 * Expand idea terms with their cross-language equivalents.
 * Returns the original set plus any mapped English terms.
 */
function expandTerms(input: string[]): string[] {
  const out = new Set(input);
  for (const term of input) {
    const mapped = ID_EN[term];
    if (!mapped) continue;
    for (const m of mapped) {
      // Multi-word mappings are added as single terms so they can match a
      // bigram in the skill text.
      out.add(m);
    }
  }
  return [...out];
}

/**
 * Crude English/Indonesian suffix stripping.
 *
 * Without it, "invoice" does not match "invoices", "payment" does not match
 * "payments", and "requirement" does not match "requirements" — the idea and
 * the skill description almost never use the same inflection, so a large share
 * of genuine matches were being missed.
 *
 * This is not a real stemmer; it removes only the plural/gerund endings that
 * matter here and leaves short words alone so "api" or "css" survive intact.
 */
function stem(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith('ies') && word.length > 5) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3);
  return word;
}

/** Split text into comparable terms: words plus adjacent word pairs. */
function terms(text: string): string[] {
  const words = text
    .toLowerCase()
    // Keep letters/digits only, so "e-commerce" and "ecommerce" align.
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(stem);

  const out = new Set<string>(words);
  // Bigrams catch phrases that single words miss ("real time", "role based").
  for (let i = 0; i < words.length - 1; i++) {
    out.add(`${words[i]} ${words[i + 1]}`);
  }
  return [...out];
}

/** How many skills a term appears in — used to discount generic terms. */
function documentFrequencies(catalogue: SuggestibleSkill[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const skill of catalogue) {
    const text = `${skill.id.replace(/[-_]/g, ' ')} ${skill.description ?? ''}`;
    for (const term of new Set(terms(text))) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return df;
}

/**
 * Fraction of the catalogue a term may appear in and still count as "specific".
 *
 * Expressed as a ratio, not an absolute IDF: IDF is log-scaled by catalogue
 * size, so a fixed threshold behaves completely differently for 10 skills than
 * for 378. A term in ≤20% of skills is specific enough to select one on its own.
 */
const RARE_TERM_MAX_DF_RATIO = 0.2;

/**
 * Skill families that must never be auto-selected for a PRD.
 *
 * A skills directory is a mixed bag: alongside product/engineering guidance it
 * holds tooling for the agent itself (`antislop`, `oh-my-opencode-*`), asset
 * generation (`stitch-*`, `blender-*`), and platform component libraries
 * (`ios-components`, `android-*`). Those describe how to OPERATE a tool, not how
 * to design a product, so putting them in the PRD prompt adds noise and can
 * steer the document toward the wrong concerns.
 *
 * They remain available in the manual picker — this only suppresses auto-pick.
 */
const NEVER_AUTO_SELECT = [
  /^antislop/i,
  /^oh-my-opencode/i,
  /^skill-/i,
  /^stitch-/i,
  /^blender-/i,
  /^ios-/i,
  /^android-/i,
  /^unity-/i,
  /^roblox-/i,
  /^figma-/i,
  /^codex-/i,
  /^claude-code/i,
  /^context7/i,
  /^github-/i,
  /-mcp$/i,
];

function isAutoSelectable(skillId: string): boolean {
  return !NEVER_AUTO_SELECT.some((re) => re.test(skillId));
}

/**
 * Skills that improve any PRD, used when the idea matches nothing specific.
 *
 * A payments or e-commerce idea may find no matching skill simply because the
 * catalogue has none — returning nothing is correct but unhelpful. These are
 * domain-neutral and always safe to apply: they shape requirements quality and
 * architecture decisions rather than assuming a domain.
 */
const BASELINE_IDS = [
  'requirements-engineering',
  'feature-planning',
  'architecture-decision',
  'documentation-and-adrs',
];

/**
 * Pick a sensible default set when nothing specific matched.
 * Returns [] when none of the baseline skills are installed.
 */
export function baselineSkills(catalogue: SuggestibleSkill[], limit = 2): SkillSelection[] {
  const available = new Set(catalogue.map((s) => s.id));
  return BASELINE_IDS.filter((id) => available.has(id))
    .slice(0, limit)
    .map((id) => ({ id, score: 0, matched: [] }));
}

/**
 * Rank skills for an idea.
 *
 * @param idea      The user's product description.
 * @param catalogue All installed skills (id + description).
 * @param options   `limit` caps results; `minScore` drops weak matches so an
 *                  unrelated idea yields nothing instead of a random shortlist.
 */
export function selectSkillsForIdea(
  idea: string,
  catalogue: SuggestibleSkill[],
  options: { limit?: number; minScore?: number; minAbsoluteScore?: number } = {}
): SkillSelection[] {
  // A high bar on purpose. A weak match is worse than no match: putting
  // `capability-first` into a payments PRD because the word "otomatis" appeared
  // steers the document toward the wrong concerns, while falling back to the
  // domain-neutral baseline is always safe.
  const { limit = 6, minScore = 0.35 } = options;
  if (!idea.trim() || catalogue.length === 0) return [];

  const total = catalogue.length;
  // Absolute floor, scaled by catalogue size. IDF grows with log(catalogue), so
  // a fixed number that rejects noise across 378 skills also rejects every
  // genuine match across 10. Expressing it as "one strong term's worth of
  // evidence" keeps the same meaning at any size.
  const minAbsoluteScore = options.minAbsoluteScore ?? Math.max(1.5, Math.log(total + 1) * 0.6);

  const ideaTerms = expandTerms(terms(idea));
  if (ideaTerms.length === 0) return [];

  const df = documentFrequencies(catalogue);
  // Smoothed IDF; a term present in every skill scores ~0.
  const idf = (term: string) => Math.log((total + 1) / ((df.get(term) ?? 0) + 1)) + 1;

  const results: SkillSelection[] = [];

  for (const skill of catalogue) {
    // Tooling/asset skills never shape a PRD — see NEVER_AUTO_SELECT.
    if (!isAutoSelectable(skill.id)) continue;
    // Skip whole families the idea gives no reason to touch (see DOMAIN_GATES).
    if (!passesGates(skill.id, ideaTerms)) continue;

    const idText = skill.id.replace(/[-_]/g, ' ');
    const descText = skill.description ?? '';
    const idTerms = new Set(terms(idText));
    const descTerms = new Set(terms(descText));

    let score = 0;
    const matched: string[] = [];

    for (const term of ideaTerms) {
      const weight = idf(term);
      // The id is curated (short, deliberate) so it outweighs prose.
      if (idTerms.has(term)) {
        score += weight * 2.0;
        matched.push(term);
      } else if (descTerms.has(term)) {
        score += weight * 1.0;
        matched.push(term);
      }
    }

    if (score <= 0) continue;
    // A single weak word is not evidence: "online" once hit
    // ai-llm-observability, "admin" once hit motion-web. But a single RARE word
    // is strong evidence — "llm" alone legitimately identifies the LLM-output
    // skill, and demanding two terms there loses a correct match.
    //
    // So gate on information content, not count: a lone term must be rare
    // across the catalogue (high IDF) to stand on its own.
    const distinct = [...new Set(matched)];
    const hitId = distinct.some((t) => idTerms.has(t));
    const rareEnough = distinct.some(
      (t) => (df.get(t) ?? 0) / total <= RARE_TERM_MAX_DF_RATIO
    );
    if (!hitId && distinct.length < 2 && !rareEnough) continue;

    results.push({ id: skill.id, score, matched: distinct });
  }

  if (results.length === 0) return [];

  // Normalise against the best match so the threshold is idea-independent, then
  // require BOTH a relative floor and a real absolute signal.
  //
  // The relative score alone is not enough: when nothing relevant exists, the
  // best-of-a-bad-lot still normalises to 1.0 (that is how `capability-first`
  // became the top pick for a payments idea). The absolute floor makes "no
  // relevant skill" an honest empty result instead of a confident wrong answer.
  const best = Math.max(...results.map((r) => r.score));
  const normalised = results
    .map((r) => ({ ...r, score: r.score / best, absolute: r.score }))
    .filter((r) => r.score >= minScore && r.absolute >= minAbsoluteScore)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map(({ id, score, matched }) => ({ id, score, matched }));

  return normalised.slice(0, limit);
}
