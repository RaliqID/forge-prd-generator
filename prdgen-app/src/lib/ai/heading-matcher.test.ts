import { describe, it, expect } from 'vitest';
import { PRD_SECTIONS } from '@/types';
import {
  normalizeHeading,
  buildHeadingIndex,
  matchHeading,
  headingTextOf,
} from './heading-matcher';

/**
 * These tests lock in the fix for a real production failure: the model emitted
 * numbered headings ("## 1. Executive Summary"), the matcher did not strip the
 * numeral, no section was ever started, and every PRD came out EMPTY while
 * still reporting success. Reproduced against 9Router + deepseek-v4.1-flash,
 * which numbers every heading.
 */

describe('normalizeHeading', () => {
  it('lowercases and collapses punctuation/whitespace', () => {
    expect(normalizeHeading('Goals & Success Metrics')).toBe('goals and success metrics');
    expect(normalizeHeading('Data Model / Schema')).toBe('data model schema');
    expect(normalizeHeading('  Executive   Summary  ')).toBe('executive summary');
  });

  it('treats "and" and "&" as equivalent', () => {
    expect(normalizeHeading('Goals & Metrics')).toBe(normalizeHeading('Goals and Metrics'));
  });

  it('strips leading numeric enumeration (the actual bug)', () => {
    expect(normalizeHeading('1. Executive Summary')).toBe('executive summary');
    expect(normalizeHeading('12. Roadmap')).toBe('roadmap');
    expect(normalizeHeading('2.3 Data Model')).toBe('data model');
    expect(normalizeHeading('2.3) Data Model')).toBe('data model');
    expect(normalizeHeading('4 - Risk Assessment')).toBe('risk assessment');
    expect(normalizeHeading('5: Open Questions')).toBe('open questions');
  });

  it('strips leading roman-numeral enumeration', () => {
    expect(normalizeHeading('IV. Roadmap')).toBe('roadmap');
    expect(normalizeHeading('III - Risk Assessment')).toBe('risk assessment');
  });

  it('does NOT strip a number that is part of the title', () => {
    // "3-Tier Architecture" must keep its leading token.
    expect(normalizeHeading('3-Tier Architecture')).toBe('3 tier architecture');
    expect(normalizeHeading('OAuth 2.0 Flow')).toBe('oauth 2 0 flow');
  });
});

describe('buildHeadingIndex + matchHeading', () => {
  const index = buildHeadingIndex();

  it('matches every official section title to its key', () => {
    for (const section of PRD_SECTIONS) {
      expect(matchHeading(index, section.title)).toBe(section.key);
    }
  });

  it('matches the numbered form of an official title', () => {
    expect(matchHeading(index, '1. Executive Summary')).toBe('executive_summary');
    expect(matchHeading(index, '3. Functional Requirements')).toBe('functional_requirements');
    expect(matchHeading(index, '10. Non-Functional Requirements')).toBe('non_functional_requirements');
  });

  it('accepts the raw snake_case key as a heading', () => {
    expect(matchHeading(index, 'executive_summary')).toBe('executive_summary');
    expect(matchHeading(index, 'open_questions')).toBe('open_questions');
  });

  it('is agnostic to "&" vs "and" and to casing', () => {
    expect(matchHeading(index, 'goals and success metrics')).toBe('goals_metrics');
    expect(matchHeading(index, 'GOALS & SUCCESS METRICS')).toBe('goals_metrics');
  });

  it('returns undefined for a heading that is not a requested section', () => {
    expect(matchHeading(index, 'Appendix')).toBeUndefined();
    expect(matchHeading(index, 'Glossary of Terms Extra')).toBeUndefined();
  });

  it('does not match a sub-heading depth-prefixed title by accident', () => {
    // The parser only feeds h1/h2 lines, but be explicit: an unrelated deep
    // heading must not resolve to a section.
    expect(matchHeading(index, 'Solo Sam Persona')).toBeUndefined();
  });
});

describe('translated (Bahasa Indonesia) headings', () => {
  const index = buildHeadingIndex();

  // These are the EXACT headings captured from a live generation against
  // 9Router/deepseek-v4.1-flash, which follows the prompt's "write in the same
  // language as the idea" rule. An English-only index matched 3 of 41 headings,
  // so nearly a finished document was discarded and the run never converged.
  const REAL_MODEL_HEADINGS: [string, string][] = [
    ['# Product Requirements Document (PRD)', ''],
    ['## 1. Ringkasan Eksekutif', 'executive_summary'],
    ['## 2. Latar Belakang & Problem Statement', 'problem_statement'],
    ['### 2.1 Problem Statement', ''], // h3 — not fed to the parser
    ['## 3. Goals & Objectives', 'goals_metrics'],
    ['## 4. Target Users', 'user_personas'],
    ['## 5. User Stories', 'user_stories'],
    ['## 6. Fitur & Requirements', 'feature_list'],
    ['## 7. User Flow (Alur Utama)', 'diagrams'],
    ['## 8. Functional Requirements', 'functional_requirements'],
    ['## 9. Non-Functional Requirements', 'non_functional_requirements'],
    ['## 10. Success Metrics (KPI)', 'goals_metrics'],
    ['## 11. Tech Stack (Rekomendasi)', 'system_architecture'],
    ['## 12. Release Plan', 'roadmap'],
    ['## 13. Risiko & Mitigasi', 'risk_assessment'],
    ['## 15. Open Questions', 'open_questions'],
    ['## 16. Lampiran', ''],
  ];

  it('resolves the Indonesian headings the model actually writes', () => {
    for (const [heading, expected] of REAL_MODEL_HEADINGS) {
      // Go through headingTextOf, the way the parser does: it is what decides
      // whether a line is even a section boundary (depth <= 2).
      const text = headingTextOf(heading);
      const got = text === null ? undefined : matchHeading(index, text);
      if (expected === '') {
        // An unknown title, or a heading deeper than section level (### 2.1).
        // Neither may be misattributed to some other section.
        expect(got, `"${heading}" should not match`).toBeUndefined();
      } else {
        expect(got, `"${heading}" -> ${expected}`).toBe(expected);
      }
    }
  });

  it('only treats h1/h2 as section boundaries', () => {
    // Sub-headings inside a section must NOT restart it.
    expect(headingTextOf('### 2.1 Problem Statement')).toBeNull();
    expect(headingTextOf('#### F1 — Buat Catatan')).toBeNull();
    expect(headingTextOf('###### deep')).toBeNull();
    // Section level.
    expect(headingTextOf('## Problem Statement')).toBe('Problem Statement');
    expect(headingTextOf('# Executive Summary')).toBe('Executive Summary');
    // Not headings.
    expect(headingTextOf('just text')).toBeNull();
    expect(headingTextOf('##')).toBeNull();
  });

  it('accepts the common Indonesian section names', () => {
    expect(matchHeading(index, 'Ringkasan Eksekutif')).toBe('executive_summary');
    expect(matchHeading(index, 'Pernyataan Masalah')).toBe('problem_statement');
    expect(matchHeading(index, 'Tujuan')).toBe('goals_metrics');
    expect(matchHeading(index, 'Persona Pengguna')).toBe('user_personas');
    expect(matchHeading(index, 'Glosarium')).toBe('glossary');
    expect(matchHeading(index, 'Kebutuhan Fungsional')).toBe('functional_requirements');
    expect(matchHeading(index, 'Kebutuhan Non-Fungsional')).toBe('non_functional_requirements');
    expect(matchHeading(index, 'Arsitektur Sistem')).toBe('system_architecture');
    expect(matchHeading(index, 'Model Data')).toBe('data_model');
    expect(matchHeading(index, 'Spesifikasi API')).toBe('api_specification');
    expect(matchHeading(index, 'Risiko & Mitigasi')).toBe('risk_assessment');
    expect(matchHeading(index, 'Pertanyaan Terbuka')).toBe('open_questions');
    expect(matchHeading(index, 'Rencana Rilis')).toBe('roadmap');
    expect(matchHeading(index, 'Daftar Task')).toBe('task_breakdown');
  });

  it('matches the translated form with a numeric prefix too', () => {
    expect(matchHeading(index, '1. Ringkasan Eksekutif')).toBe('executive_summary');
    expect(matchHeading(index, '13. Risiko & Mitigasi')).toBe('risk_assessment');
    expect(matchHeading(index, '6. Fitur & Requirements')).toBe('feature_list');
  });

  it('is case- and punctuation-insensitive on aliases', () => {
    expect(matchHeading(index, 'RINGKASAN EKSEKUTIF')).toBe('executive_summary');
    expect(matchHeading(index, 'risiko dan mitigasi')).toBe('risk_assessment');
    expect(matchHeading(index, 'Fitur   &   Requirements')).toBe('feature_list');
  });
});
