import { SurveyFlow } from "@/components/SurveyFlow";

/** Avoid stale cached HTML on hosts that aggressively cache static routes. */
export const dynamic = "force-dynamic";

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export default function Home() {
  const formId = process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID?.trim();

  if (!formId) {
    return (
      <div className="min-h-full bg-[#f0f2f5] text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="h-1 bg-[#1c69d4]" aria-hidden />
        <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">
            Configuration required
          </h1>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
            Set{" "}
            <code className="rounded bg-zinc-200/80 px-1.5 py-0.5 text-sm dark:bg-zinc-800">
              NEXT_PUBLIC_TYPEFORM_FORM_ID
            </code>{" "}
            in{" "}
            <code className="rounded bg-zinc-200/80 px-1.5 py-0.5 text-sm dark:bg-zinc-800">
              .env.local
            </code>{" "}
            (copy from{" "}
            <code className="rounded bg-zinc-200/80 px-1.5 py-0.5 text-sm dark:bg-zinc-800">
              .env.example
            </code>
            ). Restart the dev server after changing env.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#f0f2f5] text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="h-1 bg-[#1c69d4]" aria-hidden />

      <div className="mx-auto w-full max-w-[min(100%,96rem)] px-4 pb-14 pt-8 sm:px-6 sm:pb-16 sm:pt-12 lg:px-10 xl:px-14">
        <header>
          <p className="text-[0.8125rem] font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
            Confidential research
          </p>
          <h1 className="mt-3 text-[1.875rem] font-semibold leading-[1.15] tracking-tight text-zinc-900 dark:text-white sm:text-[2.125rem]">
            BMW Research Survey
          </h1>
          <p className="mt-4 max-w-[min(100%,65ch)] text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
            We are gathering feedback on vehicle ownership and brand experience.
            The questions below are used only for this study. If you need to step
            away, you can close this page and return later on{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              the same browser
            </span>
            —your progress is saved automatically.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-200/90 bg-white px-3.5 py-2 text-[0.8125rem] font-medium text-zinc-700 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900 dark:text-zinc-200">
              <ClockIcon className="shrink-0 text-[#1c69d4]" />
              <span>
                About 5 minutes for the questions below. If you&apos;re invited
                to continue with a short follow-up afterward, allow about
                10–15 minutes more.
              </span>
            </div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-200/90 bg-white px-3.5 py-2 text-[0.8125rem] font-medium text-zinc-700 shadow-sm dark:border-zinc-700/80 dark:bg-zinc-900 dark:text-zinc-200">
              <LockIcon className="shrink-0 text-[#1c69d4]" />
              <span>Your answers stay confidential</span>
            </div>
          </div>
        </header>

        <div className="mt-10 overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_24px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]">
          <div className="p-1.5 sm:p-2.5">
            <SurveyFlow formId={formId} />
          </div>
        </div>

        <footer className="mt-10 border-t border-zinc-200/90 pt-8 text-center dark:border-zinc-800">
          <p className="text-[0.8125rem] leading-relaxed text-zinc-500 dark:text-zinc-500">
            This survey is conducted for market research. Participation is voluntary.
            Please answer honestly; there are no right or wrong responses.
          </p>
          <p className="mt-3 text-[0.75rem] text-zinc-400 dark:text-zinc-600">
            Survey hosted with Typeform.
          </p>
        </footer>
      </div>
    </div>
  );
}
