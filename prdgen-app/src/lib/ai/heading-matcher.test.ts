import { describe, it, expect } from 'vitest';
import { PRD_SECTIONS } from '@/types';
import {
  normalizeHeading,
  buildHeadingIndex,
  matchHeading,
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
