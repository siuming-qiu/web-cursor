"use client";

import { create } from "zustand";

export const AgentActivitySource = {
  Parent: "parent",
  Subagent: "subagent",
} as const;

export type AgentActivitySource =
  typeof AgentActivitySource[keyof typeof AgentActivitySource];

type ConversationState = {
  busy: boolean;
  writing: boolean;
  activeAiId: string;
  activityText: string;
  activitySource: AgentActivitySource;
  startTurn: (aiId: string) => void;
  setActivity: (source: AgentActivitySource, text: string) => void;
  setWriting: (writing: boolean) => void;
  finishTurn: () => void;
  stopTurn: () => void;
};

export const useConversationStore = create<ConversationState>((set) => ({
  busy: false,
  writing: false,
  activeAiId: "",
  activityText: "",
  activitySource: AgentActivitySource.Parent,
  startTurn: (activeAiId) => set({
    activeAiId,
    busy: true,
    writing: true,
    activityText: "正在生成…",
    activitySource: AgentActivitySource.Parent,
  }),
  setActivity: (activitySource, activityText) => set({
    activitySource,
    activityText,
  }),
  setWriting: (writing) => set({ writing }),
  finishTurn: () => set({
    busy: false,
    writing: false,
    activityText: "",
    activitySource: AgentActivitySource.Parent,
  }),
  stopTurn: () => set({
    busy: false,
    writing: false,
    activityText: "已停止",
    activitySource: AgentActivitySource.Parent,
  }),
}));
