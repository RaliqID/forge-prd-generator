/**
 * The only catalogue information suggestions need: the ids that exist.
 * Deliberately narrower than SkillMeta so the client (which receives metadata
 * without `restricted`/`body`) can call this without a cast.
 */
export interface SuggestibleSkill {
  id: string;
}

/**
 * Suggest engineering skills for a product idea.
 *
 * The goal is not to pick for the user but to remove the "I don't know what
 * these 378 skills are for" problem: the picker opens with a handful that are
 * plausibly relevant, and the user adjusts.
 *
 * Matching is deliberately transparent — each suggestion carries the keyword
 * that triggered it, so a wrong suggestion is obviously wrong rather than
 * mysterious. Everything is client-safe: it takes the catalogue the API already
 * returned and does no I/O.
 */

interface Rule {
  /** Keywords (lowercase, substring match) that indicate this skill applies. */
  keywords: string[];
  /** Skill id to suggest. Ignored when not present in the catalogue. */
  id: string;
  /** Why it applies, shown as the reason. */
  reason: string;
}

/**
 * Rules are ordered by specificity: a product-specific signal (payments,
 * realtime) beats a generic one (any product needs requirements).
 */
const RULES: Rule[] = [
  {
    id: 'ai-structured-output-and-tool-calling',
    keywords: ['llm', 'ai agent', 'openai', 'gpt', 'chatbot', 'prompt', 'rag', 'embedding', 'machine learning'],
    reason: 'produk memakai LLM/AI',
  },
  {
    id: 'ai-agent-reliability-and-guardrails',
    keywords: ['agent', 'autonomous', 'tool calling', 'workflow agent'],
    reason: 'ada agent otonom yang perlu guardrail',
  },
  {
    id: 'ai-llm-observability-and-cost',
    keywords: ['llm', 'ai', 'token', 'inference'],
    reason: 'biaya & kualitas AI perlu dipantau',
  },
  {
    id: 'api-design',
    keywords: ['api', 'sdk', 'webhook', 'integration', 'integrasi', 'public api', 'developer'],
    reason: 'ada permukaan API/integrasi',
  },
  {
    id: 'clean-architecture',
    keywords: ['arsitektur', 'architecture', 'microservice', 'monolith', 'refactor', 'modular'],
    reason: 'keputusan arsitektur perlu dijaga',
  },
  {
    id: 'domain-driven-design',
    keywords: ['domain', 'bounded context', 'multi-tenant', 'complex business', 'enterprise'],
    reason: 'domain bisnis cukup kompleks',
  },
  {
    id: 'architecture-decision',
    keywords: ['arsitektur', 'architecture', 'stack', 'infrastructure', 'database'],
    reason: 'perlu mencatat keputusan arsitektur',
  },
  {
    id: 'security-review',
    keywords: ['auth', 'login', 'payment', 'pembayaran', 'pii', 'kesehatan', 'health', 'keuangan', 'finance', 'security', 'enkripsi'],
    reason: 'menangani data sensitif / auth',
  },
  {
    id: 'accessibility',
    keywords: ['aksesibilitas', 'accessibility', 'public', 'publik', 'pemerintah', 'government', 'education', 'pendidikan'],
    reason: 'audiens luas, aksesibilitas penting',
  },
  {
    id: 'design-system',
    keywords: ['design system', 'component library', 'ui kit', 'brand', 'multi-platform'],
    reason: 'butuh konsistensi UI',
  },
  {
    id: 'feature-planning',
    keywords: ['mvp', 'fitur', 'feature', 'roadmap', 'phase', 'fase'],
    reason: 'cakupan fitur perlu dipecah bertahap',
  },
  {
    id: 'product-strategy',
    keywords: ['bisnis', 'business', 'monetisasi', 'revenue', 'pricing', 'competitor', 'kompetitor', 'market'],
    reason: 'ada dimensi bisnis/pasar',
  },
  {
    id: 'documentation-and-adrs',
    keywords: ['dokumentasi', 'documentation', 'adr', 'spec', 'prd'],
    reason: 'dokumen ini jadi acuan tim',
  },
  {
    id: 'requirements-engineering',
    keywords: [],
    reason: 'setiap PRD butuh requirement yang bisa diuji',
  },
];

/** Always-on baseline: the skills that improve any PRD. */
const BASELINE = ['requirements-engineering'];

export interface SkillSuggestion {
  id: string;
  reason: string;
}

/**
 * Rank skills for a given idea.
 *
 * Returns at most `limit` suggestions, each with the reason it was chosen.
 * Ids missing from the catalogue are dropped, so a suggestion never points at
 * something the user cannot select.
 */
export function suggestSkills(
  idea: string,
  catalogue: SuggestibleSkill[],
  limit = 4
): SkillSuggestion[] {
  const text = idea.toLowerCase();
  const available = new Set(catalogue.map((s) => s.id));
  const picked: SkillSuggestion[] = [];
  const seen = new Set<string>();

  const push = (id: string, reason: string) => {
    if (seen.has(id) || !available.has(id)) return;
    seen.add(id);
    picked.push({ id, reason });
  };

  for (const rule of RULES) {
    if (rule.keywords.length === 0) continue;
    if (rule.keywords.some((k) => text.includes(k))) {
      push(rule.id, rule.reason);
      if (picked.length >= limit) break;
    }
  }

  // Fill any remaining slots with the baseline, then the rule with no keywords.
  for (const id of BASELINE) {
    if (picked.length >= limit) break;
    push(id, 'dasar requirement yang bisa diuji');
  }
  const fallbackRule = RULES.find((r) => r.keywords.length === 0);
  if (fallbackRule && picked.length < limit) push(fallbackRule.id, fallbackRule.reason);

  return picked.slice(0, limit);
}
