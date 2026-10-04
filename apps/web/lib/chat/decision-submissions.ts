import { create } from "zustand";
import type { PendingDecision } from "@/lib/session-store/types";
import type { WaitCommand } from "@/lib/net/execution-client";

export interface DecisionSubmission {
  decision: PendingDecision;
  command: WaitCommand;
  status: "sending" | "unknown" | "answered" | "declined" | "rejected" | "closed";
  error?: string;
}

export interface DecisionDiscussion {
  command: WaitCommand;
  message: string;
  feedback: string;
  busy: boolean;
  sent: boolean;
}

// Session UI receipts, not Workflow checkpoints. Keeping the command while
// navigating also prevents an uncertain delivery from acquiring a new ID.
export const useDecisionSubmissions = create<{
  submissions: Record<string, DecisionSubmission>;
  discussions: Record<string, DecisionDiscussion>;
  setDiscussion: (key: string, request: DecisionDiscussion) => void;
  setSubmission: (id: string, submission: DecisionSubmission) => void;
}>((set) => ({
  submissions: {},
  discussions: {},
  setDiscussion: (key, request) => set(state => ({
    discussions: { ...state.discussions, [key]: request },
  })),
  setSubmission: (id, submission) => set(state => ({
    submissions: { ...state.submissions, [id]: submission },
  })),
}));
