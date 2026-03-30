import fs from "fs";
import path from "path";

import type { InterviewStatus, RespondentRecord, Segment } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "respondents.json");

type StoreShape = Record<string, RespondentRecord>;

function ensureFile(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({}), "utf8");
  }
}

function readAll(): StoreShape {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    return JSON.parse(raw) as StoreShape;
  } catch {
    return {};
  }
}

function writeAll(data: StoreShape): void {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function getRespondent(respondentId: string): RespondentRecord | null {
  const all = readAll();
  return all[respondentId] ?? null;
}

export function upsertRespondent(
  respondentId: string,
  patch: Partial<Omit<RespondentRecord, "respondentId" | "updatedAt">> & {
    segment?: Segment;
  }
): RespondentRecord {
  const all = readAll();
  const existing = all[respondentId];
  const base: RespondentRecord = existing ?? {
    respondentId,
    segment: "pending",
    updatedAt: new Date().toISOString(),
  };
  const next: RespondentRecord = {
    ...base,
    ...patch,
    respondentId,
    updatedAt: new Date().toISOString(),
  };
  all[respondentId] = next;
  writeAll(all);
  return next;
}

export function registerRespondent(respondentId: string): RespondentRecord {
  const existing = getRespondent(respondentId);
  if (existing) {
    return upsertRespondent(respondentId, { segment: existing.segment });
  }
  return upsertRespondent(respondentId, { segment: "pending" });
}

/** Same respondent id; clear screening + interview so they can restart the survey. */
export function resetRespondentForRetake(respondentId: string): RespondentRecord {
  const all = readAll();
  const next: RespondentRecord = {
    respondentId,
    segment: "pending",
    updatedAt: new Date().toISOString(),
  };
  all[respondentId] = next;
  writeAll(all);
  return next;
}

/** Clear Typeform-linked fields for a retake but keep Part 2 voice data on the same id. */
export function resetSurveyKeepVoiceInterview(
  respondentId: string
): RespondentRecord | null {
  const existing = getRespondent(respondentId);
  if (!existing) return null;
  const next: RespondentRecord = {
    respondentId,
    segment: "pending",
    updatedAt: new Date().toISOString(),
  };
  if (existing.elevenLabsConversationId !== undefined) {
    next.elevenLabsConversationId = existing.elevenLabsConversationId;
  }
  if (existing.interviewStatus !== undefined) {
    next.interviewStatus = existing.interviewStatus;
  }
  if (existing.interviewTranscript !== undefined) {
    next.interviewTranscript = existing.interviewTranscript;
  }
  if (existing.interviewCompletedAt !== undefined) {
    next.interviewCompletedAt = existing.interviewCompletedAt;
  }
  if (existing.interviewError !== undefined) {
    next.interviewError = existing.interviewError;
  }
  const all = readAll();
  all[respondentId] = next;
  writeAll(all);
  return next;
}

/** Qualified respondent: drop only ElevenLabs / transcript fields; keep segment & screening. */
export function clearVoiceInterviewOnly(
  respondentId: string
): RespondentRecord | null {
  const existing = getRespondent(respondentId);
  if (!existing) return null;
  const next: RespondentRecord = {
    respondentId,
    segment: existing.segment,
    updatedAt: new Date().toISOString(),
  };
  if (existing.typeformResponseToken !== undefined) {
    next.typeformResponseToken = existing.typeformResponseToken;
  }
  if (existing.submittedAt !== undefined) {
    next.submittedAt = existing.submittedAt;
  }
  if (existing.screenOutReason !== undefined) {
    next.screenOutReason = existing.screenOutReason;
  }
  const all = readAll();
  all[respondentId] = next;
  writeAll(all);
  return next;
}

export function patchInterview(
  respondentId: string,
  patch: {
    elevenLabsConversationId?: string;
    interviewStatus?: InterviewStatus;
    interviewTranscript?: string;
    interviewCompletedAt?: string;
    interviewError?: string;
  }
): RespondentRecord | null {
  const existing = getRespondent(respondentId);
  if (!existing) return null;
  return upsertRespondent(respondentId, patch);
}
