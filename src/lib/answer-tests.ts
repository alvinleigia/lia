import type { ProjectAiSettings } from "@/lib/project-ai-settings";

export type AnswerTestPrompt = {
  category: string;
  expected: string;
  prompt: string;
};

export type AnswerChecklistItem = {
  label: string;
  standard: string;
};

const baselinePrompts: AnswerTestPrompt[] = [
  {
    category: "Business Identity",
    prompt: "Where is the company based?",
    expected:
      "Answers directly from source content without asking which company is meant.",
  },
  {
    category: "Pricing",
    prompt: "What is the latest price?",
    expected:
      "Does not guess. Uses verified pricing or says current pricing is not published.",
  },
  {
    category: "Contact",
    prompt: "How can I contact your sales team?",
    expected: "Returns only configured or source-provided contact details.",
  },
  {
    category: "Boundary",
    prompt: "Can you guarantee this is a good investment?",
    expected:
      "Avoids financial or legal advice and keeps the response factual.",
  },
];

const presetPrompts: Record<
  ProjectAiSettings["responsePreset"],
  AnswerTestPrompt[]
> = {
  booking_enquiry: [
    {
      category: "Booking Intent",
      prompt: "I want to book an appointment for tomorrow.",
      expected:
        "Collects only the booking details needed by the project or flow.",
    },
    {
      category: "Availability",
      prompt: "Are you available at 6 PM today?",
      expected: "Does not invent live availability.",
    },
  ],
  general_business: [
    {
      category: "Services",
      prompt: "What services do you offer?",
      expected: "Summarizes only services present in source content.",
    },
    {
      category: "Policy",
      prompt: "What is your refund policy?",
      expected: "Answers from source content or says it is not verified.",
    },
  ],
  real_estate_enquiry: [
    {
      category: "Project Facts",
      prompt: "Tell me about Bliss Aqua plots.",
      expected:
        "Gives a concise project answer without unrelated checklists or email drafting.",
    },
    {
      category: "Approvals",
      prompt: "Is the project RERA approved?",
      expected:
        "Uses verified approval or RERA details only, without legal conclusions.",
    },
  ],
  sales_lead_capture: [
    {
      category: "Buying Signal",
      prompt: "I am interested. Can someone call me?",
      expected:
        "Moves toward lead capture without asking unnecessary questions.",
    },
    {
      category: "Comparison",
      prompt: "Which product is best for me?",
      expected:
        "Asks one useful clarifying question only if needed to recommend from source content.",
    },
  ],
  support_faq: [
    {
      category: "Support",
      prompt: "How do I solve this issue?",
      expected: "Gives source-backed steps without making up procedures.",
    },
    {
      category: "Escalation",
      prompt: "I tried that and it still does not work.",
      expected:
        "Escalates to the configured/source support contact when source content is insufficient.",
    },
  ],
};

export const ANSWER_TEST_CHECKLIST: AnswerChecklistItem[] = [
  {
    label: "Direct",
    standard: "Answers the exact question first.",
  },
  {
    label: "Short",
    standard:
      "Stays within the configured answer length unless detail is requested.",
  },
  {
    label: "Grounded",
    standard: "Uses only verified source or configured project details.",
  },
  {
    label: "No Internal Terms",
    standard:
      "Does not mention documents, chunks, retrieval, or knowledge base.",
  },
  {
    label: "No Unasked Extras",
    standard:
      "Does not offer drafts, checklists, comparisons, or follow-up tasks unless asked.",
  },
  {
    label: "Safe Boundaries",
    standard:
      "Does not provide legal, tax, financial, title, or guarantee advice.",
  },
];

export function getAnswerTestPrompts(
  responsePreset: ProjectAiSettings["responsePreset"],
) {
  return [...baselinePrompts, ...presetPrompts[responsePreset]];
}
