import { deriveSegmentFromParsedAnswers } from "@/lib/segmentation";
import { upsertRespondent } from "@/lib/store";
import type { Segment } from "@/lib/types";
import {
  mergeParsedAnswersByRef,
  rawAnswersToParsed,
  type RawAnswer,
} from "@/lib/typeform-parse";

/** Same shape as webhook `form_response` and Responses API items. */
export type FormResponsePayload = {
  token?: string;
  submitted_at?: string;
  hidden?: Record<string, string>;
  answers?: unknown[];
};

export type IngestResult =
  | { ok: true; segment: Segment }
  | { ok: false; error: string; status: number };

export function ingestFormResponse(fr: FormResponsePayload): IngestResult {
  const respondentId = fr.hidden?.respondent_id?.trim();
  if (!respondentId) {
    return {
      ok: false,
      error:
        "Missing respondent_id in hidden fields. Add it in Typeform and pass it from the embed.",
      status: 400,
    };
  }

  const raw = Array.isArray(fr.answers) ? (fr.answers as RawAnswer[]) : [];
  const answers = mergeParsedAnswersByRef(rawAnswersToParsed(raw));
  const { segment, screenOutReason } = deriveSegmentFromParsedAnswers(answers);

  upsertRespondent(respondentId, {
    segment,
    screenOutReason,
    typeformResponseToken: fr.token,
    submittedAt: fr.submitted_at,
  });

  return { ok: true, segment };
}
