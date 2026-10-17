'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PRD, PRDContent, PRDSectionKey, PRDStatus, PRDFormInput, PlanStructure, PlanStep } from '@/types';

export interface PendingEngineConfig {
  /** Saved CustomEngine id — key stays server-side; resolved per request. */
  engineId?: string;
}

interface PRDState {
  // Pending generation request (set by form, consumed by editor)
  pendingInput: PRDFormInput | null;
  pendingModel: string | null;
  pendingEngine: PendingEngineConfig | null;
  setPendingGeneration: (input: PRDFormInput, model: string, engine?: PendingEngineConfig) => void;
  clearPendingGeneration: () => void;

  // Workspace flow (Struktur → PRD → Task): the idea + resolved model/engine
  // set by the idea-first /new page, consumed by the workspace page.
  pendingIdea: string | null;
  /** Engineering-skill ids to apply to this run (empty = none). */
  pendingSkills: string[];
  /** When true the server picks skills for the idea instead of `pendingSkills`. */
  pendingAutoSkills: boolean;
  setPendingIdea: (idea: string, model: string, engine?: PendingEngineConfig, skills?: string[], autoSkills?: boolean) => void;
  clearPendingIdea: () => void;

  // Persisted workspace structure across the three phases.
  structure: PlanStructure | null;
  setStructure: (structure: PlanStructure | null) => void;
  activeStep: PlanStep;
  setActiveStep: (step: PlanStep) => void;

  // Current PRD
  currentPRD: PRD | null;
  setCurrentPRD: (prd: PRD | null) => void;

  // Streaming state
  isStreaming: boolean;
  currentSection: PRDSectionKey | null;
  streamedSections: Partial<PRDContent>;
  streamTokens: string; // accumulator for current section tokens

  startStreaming: () => void;
  stopStreaming: () => void;
  setCurrentSection: (section: PRDSectionKey | null) => void;
  appendToken: (token: string) => void;
  finalizeSection: (section: PRDSectionKey) => void;
  resetStream: () => void;

  // PRD list
  prdList: PRD[];
  setPRDList: (list: PRD[]) => void;
  updatePRDInList: (id: string, updates: Partial<PRD>) => void;
  removePRDFromList: (id: string) => void;

  // Status
  updateStatus: (status: PRDStatus) => void;
}

export const usePRDStore = create<PRDState>()(
  persist((set, get) => ({
  pendingInput: null,
  pendingModel: null,
  pendingEngine: null,
  setPendingGeneration: (input, model, engine) => set({ pendingInput: input, pendingModel: model, pendingEngine: engine ?? null }),
  clearPendingGeneration: () => set({ pendingInput: null, pendingModel: null, pendingEngine: null }),

  pendingIdea: null,
  pendingSkills: [],
  pendingAutoSkills: false,
  setPendingIdea: (idea, model, engine, skills, autoSkills) =>
    set({
      pendingIdea: idea,
      pendingModel: model,
      pendingEngine: engine ?? null,
      pendingSkills: skills ?? [],
      pendingAutoSkills: autoSkills ?? false,
    }),
  clearPendingIdea: () => set({ pendingIdea: null, pendingSkills: [], pendingAutoSkills: false }),

  structure: null,
  setStructure: (structure) => set({ structure }),
  activeStep: 'structure',
  setActiveStep: (activeStep) => set({ activeStep }),

  currentPRD: null,
  setCurrentPRD: (prd) => set({ currentPRD: prd }),

  isStreaming: false,
  currentSection: null,
  streamedSections: {},
  streamTokens: '',

  startStreaming: () =>
    set({
      isStreaming: true,
      currentSection: null,
      streamedSections: {},
      streamTokens: '',
    }),

  stopStreaming: () => set({ isStreaming: false, currentSection: null }),

  setCurrentSection: (section) =>
    set({ currentSection: section, streamTokens: '' }),

  appendToken: (token) =>
    set((state) => ({ streamTokens: state.streamTokens + token })),

  finalizeSection: (section) =>
    set((state) => ({
      streamedSections: {
        ...state.streamedSections,
        [section]: state.streamTokens,
      },
      streamTokens: '',
    })),

  resetStream: () =>
    set({
      isStreaming: false,
      currentSection: null,
      streamedSections: {},
      streamTokens: '',
    }),

  prdList: [],
  setPRDList: (list) => set({ prdList: list }),

  updatePRDInList: (id, updates) =>
    set((state) => ({
      prdList: state.prdList.map((p) =>
        p.id === id ? { ...p, ...updates } : p
      ),
      currentPRD:
        state.currentPRD?.id === id
          ? { ...state.currentPRD, ...updates }
          : state.currentPRD,
    })),

  removePRDFromList: (id) =>
    set((state) => ({
      prdList: state.prdList.filter((p) => p.id !== id),
    })),

  updateStatus: (status) => {
    const { currentPRD } = get();
    if (currentPRD) {
      set({ currentPRD: { ...currentPRD, status } });
    }
  },
}),
  {
    name: 'forge-workspace',
    // sessionStorage, not localStorage: a half-finished plan belongs to this
    // tab's session, and a new tab should start clean.
    storage: createJSONStorage(() => sessionStorage),
    // Persist ONLY what must survive a reload of the workspace page.
    //
    // The bug this fixes: `pendingIdea` lived in memory only, so reloading
    // /workspace/<id>?generate=true — which the browser does on refresh, and
    // which happens automatically if the tab is restored — found an empty
    // store and showed "Ide tidak ditemukan" with no way forward, even though
    // the idea had already been sent to the server.
    //
    // Streaming/UI state is deliberately excluded: it is per-render and would
    // resurrect stale spinners.
    partialize: (state) => ({
      pendingIdea: state.pendingIdea,
      pendingModel: state.pendingModel,
      pendingEngine: state.pendingEngine,
      pendingSkills: state.pendingSkills,
      pendingAutoSkills: state.pendingAutoSkills,
      structure: state.structure,
      activeStep: state.activeStep,
    }),
    // Bump when the persisted shape changes, so stale payloads are discarded
    // instead of hydrating a mismatched object.
    version: 1,
  })
);
