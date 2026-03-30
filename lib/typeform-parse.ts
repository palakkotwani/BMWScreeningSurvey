import type { ParsedAnswer } from "./segmentation";

/** Raw answer shape from Typeform webhook `form_response.answers`. */
export type RawAnswer = {
  type: string;
  field?: { id?: string; ref?: string; type?: string };
  choice?: { label?: string; id?: string };
  choices?: { labels?: string[]; ids?: string[] };
  boolean?: boolean;
  text?: string;
  number?: number;
};

export function rawAnswersToParsed(answers: RawAnswer[]): ParsedAnswer[] {
  const out: ParsedAnswer[] = [];
  for (const a of answers) {
    const ref = a.field?.ref ?? "";
    if (!ref) continue;

    if (a.type === "choice" && a.choice?.label) {
      out.push({ ref, label: a.choice.label });
    } else if (a.type === "choices") {
      const labels = a.choices?.labels?.filter(Boolean) ?? [];
      if (labels.length > 0) {
        out.push({ ref, labels });
      }
    } else if (a.type === "boolean") {
      out.push({ ref, label: a.boolean ? "Yes" : "No" });
    } else if (a.type === "text" && a.text != null) {
      // Includes dropdown answers (Typeform often uses type "text" for dropdown)
      out.push({ ref, label: a.text });
    } else if (a.type === "number" && a.number != null) {
      out.push({ ref, label: String(a.number) });
    }
  }
  return out;
}

/**
 * Typeform sometimes sends multiple answer objects with the same field `ref`
 * (e.g. multi-select as repeated `choice` rows). We merge them so `brands` is one entry.
 */
export function mergeParsedAnswersByRef(parsed: ParsedAnswer[]): ParsedAnswer[] {
  const map = new Map<string, string[]>();
  for (const a of parsed) {
    const parts = [
      ...(a.labels ?? []),
      ...(a.label != null && a.label !== "" ? [a.label] : []),
    ].map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const existing = map.get(a.ref) ?? [];
    map.set(a.ref, existing.concat(parts));
  }

  const out: ParsedAnswer[] = [];
  for (const [ref, labels] of map) {
    const uniq = [...new Set(labels)];
    if (uniq.length === 1) {
      out.push({ ref, label: uniq[0] });
    } else {
      out.push({ ref, labels: uniq });
    }
  }
  return out;
}
