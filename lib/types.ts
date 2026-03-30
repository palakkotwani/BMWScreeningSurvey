/** Qualification outcome after screening (Part 1). */
export type Segment =
  | "pending"
  | "screened_out"
  | "bmw_customer"
  | "potential_bmw_customer";

export type InterviewStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "failed";

export type RespondentRecord = {
  respondentId: string;
  typeformResponseToken?: string;
  submittedAt?: string;
  segment: Segment;
  screenOutReason?: string;
  updatedAt: string;
  /** Part 2: ElevenLabs conversation */
  elevenLabsConversationId?: string;
  interviewStatus?: InterviewStatus;
  interviewTranscript?: string;
  interviewCompletedAt?: string;
  interviewError?: string;
};
