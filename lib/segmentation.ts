import type { Segment } from "./types";

/** Normalized Typeform answer shapes we care about from webhooks. */
export type ParsedAnswer = {
  ref: string;
  /** Multiple choice single label */
  label?: string;
  /** Multi-select labels */
  labels?: string[];
};

const AGE_TERMINATE = new Set([
  "under 18",
  "less than 18",
  "<18",
  "under 18 years",
]);

const CAR_NO = new Set(["no", "n"]);

const TERMINATE_BRANDS = new Set([
  "toyota",
  "honda",
  "ford",
  "tesla",
  "other",
]);

const BMW_LABELS = new Set(["bmw"]);
function norm(s: string): string {
  return s.trim().toLowerCase();
}

function isAgeTerminate(label: string): boolean {
  const n = norm(label);
  return AGE_TERMINATE.has(n) || n.includes("under 18") || n === "< 18";
}

function isCarNo(label: string): boolean {
  return CAR_NO.has(norm(label));
}

function parseBrandTokens(labels: string[]): {
  hasTerminate: boolean;
  hasBmw: boolean;
  hasPotential: boolean;
} {
  let hasTerminate = false;
  let hasBmw = false;
  let hasPotential = false;
  for (const raw of labels) {
    const n = norm(raw);
    if (TERMINATE_BRANDS.has(n)) hasTerminate = true;
    if (BMW_LABELS.has(n) || n === "bmw") hasBmw = true;
    if (n.includes("mercedes") || n.includes("audi")) hasPotential = true;
  }
  return { hasTerminate, hasBmw, hasPotential };
}

/**
 * Map Typeform question refs (configure in Typeform) to logic.
 * Defaults match recommended refs in README; override via env in caller if needed.
 */
const DEFAULT_REFS = {
  age: process.env.TYPEFORM_REF_AGE ?? "age",
  ownsCar: process.env.TYPEFORM_REF_owns_car ?? "owns_car",
  brands: process.env.TYPEFORM_REF_brands ?? "brands",
};

export type SegmentResult = {
  segment: Segment;
  screenOutReason?: string;
};

/**
 * Derive segment from parsed answers. Uses field refs from your Typeform.
 */
export function deriveSegmentFromParsedAnswers(
  answers: ParsedAnswer[]
): SegmentResult {
  const byRef = new Map(answers.map((a) => [a.ref, a]));

  const age = byRef.get(DEFAULT_REFS.age);
  if (age?.label && isAgeTerminate(age.label)) {
    return { segment: "screened_out", screenOutReason: "age_under_18" };
  }

  const owns = byRef.get(DEFAULT_REFS.ownsCar);
  if (owns?.label && isCarNo(owns.label)) {
    return { segment: "screened_out", screenOutReason: "no_vehicle" };
  }

  const brands = byRef.get(DEFAULT_REFS.brands);
  const labels = brands?.labels?.length
    ? brands.labels
    : brands?.label
      ? [brands.label]
      : [];

  if (labels.length === 0) {
    return {
      segment: "screened_out",
      screenOutReason: "missing_brands",
    };
  }

  const { hasTerminate, hasBmw, hasPotential } = parseBrandTokens(labels);
  if (hasTerminate) {
    return {
      segment: "screened_out",
      screenOutReason: "non_qualifying_brand",
    };
  }
  if (hasBmw) {
    return { segment: "bmw_customer" };
  }
  if (hasPotential) {
    return { segment: "potential_bmw_customer" };
  }

  return { segment: "screened_out", screenOutReason: "non_qualifying_brand" };
}
