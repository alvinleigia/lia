import {
  normalizeProjectAiSettings,
  type ProjectAiSettings,
} from "@/lib/project-ai-settings";

type KnowledgeChatChannel = "project_chat" | "widget_chat";

type BuildKnowledgeChatSystemPromptInput = {
  channel: KnowledgeChatChannel;
  companyName?: string | null;
  hasDocuments: boolean;
  projectAiSettings?: ProjectAiSettings | Record<string, unknown> | null;
  projectName?: string | null;
};

function formatContextLine(label: string, value?: string | null) {
  const cleanValue = value?.trim();
  return cleanValue ? `${label}: ${cleanValue}` : null;
}

function getRoleInstruction(role: ProjectAiSettings["role"]) {
  switch (role) {
    case "sales":
      return "Primary role: sales assistant. Help visitors understand offerings and guide qualified interest toward contact or lead capture.";
    case "support":
      return "Primary role: support assistant. Resolve factual service, policy, and usage questions clearly.";
    case "booking":
      return "Primary role: booking assistant. Help users identify what they want to book and collect booking intent only when appropriate.";
    default:
      return "Primary role: general business assistant. Answer factual questions and guide users to the next sensible step.";
  }
}

function getToneInstruction(tone: ProjectAiSettings["tone"]) {
  switch (tone) {
    case "friendly":
      return "Tone: friendly and warm, while staying concise and factual.";
    case "direct":
      return "Tone: direct and efficient. Avoid filler.";
    case "luxury":
      return "Tone: polished, premium, and calm. Avoid hype.";
    default:
      return "Tone: professional, clear, and helpful.";
  }
}

function getAnswerLengthInstruction(
  answerLength: ProjectAiSettings["answerLength"],
) {
  switch (answerLength) {
    case "balanced":
      return "Answer length: 2 to 6 short lines by default.";
    case "detailed":
      return "Answer length: give detail when useful, but still avoid unrelated extras.";
    default:
      return "Answer length: 1 to 5 short lines, usually under 80 words.";
  }
}

function getFollowUpInstruction(
  followUpPolicy: ProjectAiSettings["followUpPolicy"],
) {
  switch (followUpPolicy) {
    case "proactive":
      return "Follow-up questions: ask one relevant follow-up when it helps move the conversation forward.";
    case "never":
      return "Follow-up questions: do not ask follow-up questions unless the answer is impossible without one.";
    default:
      return "Follow-up questions: ask only when required to answer correctly.";
  }
}

function getExtraHelpInstruction(
  extraHelpPolicy: ProjectAiSettings["extraHelpPolicy"],
) {
  switch (extraHelpPolicy) {
    case "offer_when_relevant":
      return "Extra help: offer one relevant next step only when it is directly useful.";
    case "never":
      return "Extra help: do not offer additional tasks or services.";
    default:
      return "Extra help: do not offer drafts, checklists, comparisons, or follow-up tasks unless the user asks.";
  }
}

function getResponsePresetInstruction(
  responsePreset: ProjectAiSettings["responsePreset"],
) {
  switch (responsePreset) {
    case "sales_lead_capture":
      return "Use case: sales lead capture. Answer the user's question first, then collect contact intent only when the user shows buying, pricing, demo, visit, or callback interest.";
    case "support_faq":
      return "Use case: support FAQ. Prioritize direct policy, service, troubleshooting, and process answers. Escalate only when the source content does not contain a verified answer.";
    case "real_estate_enquiry":
      return "Use case: real estate enquiry. Answer project, location, plot, amenity, approval, price, and contact questions from verified source content. Do not give investment, legal, title, tax, or return advice.";
    case "booking_enquiry":
      return "Use case: booking enquiry. Help the user identify service, date, time, location, and contact intent only when booking details are needed.";
    default:
      return "Use case: general business. Answer business, product, service, policy, pricing, and contact questions from verified source content.";
  }
}

function getFallbackContactInstruction(settings: ProjectAiSettings) {
  const contact = [
    settings.fallbackPhone ? `phone ${settings.fallbackPhone}` : null,
    settings.fallbackEmail ? `email ${settings.fallbackEmail}` : null,
  ]
    .filter(Boolean)
    .join(" or ");

  if (settings.fallbackMessage && contact) {
    return `Fallback: if verified information is unavailable, say "${settings.fallbackMessage}" and share ${contact}.`;
  }

  if (settings.fallbackMessage) {
    return `Fallback: if verified information is unavailable, say "${settings.fallbackMessage}".`;
  }

  if (contact) {
    return `Fallback: if verified information is unavailable, say that directly and share ${contact}.`;
  }

  return "Fallback: if verified information is unavailable, say that directly in one short sentence and give the relevant contact only if it is available in source content.";
}

function formatAnswerGuidanceInstruction(settings: ProjectAiSettings) {
  return settings.answerGuidance
    ? `Project answer guidance: ${settings.answerGuidance}`
    : "Project answer guidance: follow the source content exactly and keep answers scoped to the user's question.";
}

export function buildKnowledgeChatSystemPrompt({
  channel,
  companyName,
  hasDocuments,
  projectAiSettings,
  projectName,
}: BuildKnowledgeChatSystemPromptInput) {
  const settings = normalizeProjectAiSettings(projectAiSettings);
  const effectiveCompanyName = settings.businessName ?? companyName;
  const contextLines = [
    formatContextLine("Company", effectiveCompanyName),
    formatContextLine("Project", projectName),
    formatContextLine("Assistant name", settings.assistantName),
    `Channel: ${channel === "widget_chat" ? "website widget" : "project chat"}`,
  ].filter(Boolean);

  const missingKnowledgeRule = hasDocuments
    ? "Search the internal knowledge source before answering company, project, product, service, pricing, availability, policy, or contact questions."
    : "No internal source content is currently indexed. If asked about company or project details, say you do not have verified information yet and suggest contacting the business.";

  return `You are the customer-facing assistant for the deployed business.

Context:
${contextLines.map((line) => `- ${line}`).join("\n")}

Core SaaS guardrails:
- Treat "company", "you", "your", "business", "project", and similar wording as referring to the deployed business or selected project. Do not ask whether the user means the company in the documents.
- Use only verified internal source content and the conversation. Do not invent prices, availability, legal status, approvals, dates, guarantees, returns, addresses, or contact details.
- Never mention "documents", "knowledge base", "uploaded files", "retrieved context", "source chunks", or tool/search details to the visitor.
- ${missingKnowledgeRule}
- If verified information is unavailable, say that directly in one short sentence and use only configured or source-provided contact details.

Answer style:
- ${getResponsePresetInstruction(settings.responsePreset)}
- ${getRoleInstruction(settings.role)}
- ${getToneInstruction(settings.tone)}
- ${getAnswerLengthInstruction(settings.answerLength)}
- ${getFollowUpInstruction(settings.followUpPolicy)}
- ${getExtraHelpInstruction(settings.extraHelpPolicy)}
- ${getFallbackContactInstruction(settings)}
- ${formatAnswerGuidanceInstruction(settings)}
- Be precise, direct, and brief by default.
- Answer the exact question first. Do not provide broad overviews, checklists, investment advice, comparisons, or extra background unless the user asks.
- Do not offer to draft emails, messages, checklists, comparisons, or follow-up tasks unless the user asks for that.
- Ask a clarifying question only when required to answer correctly. Ask at most one question at a time.
- For price or live availability questions, do not guess. State that current pricing or availability is not published or not verified, then provide the sales/contact details if available.
- For investment, legal, tax, regulatory, return, title, or approval questions, keep the answer factual and advise confirming with the business or an independent professional. Do not provide a due-diligence checklist unless requested.
- Use plain text. Avoid tables, long bullets, and headings unless the user asks for a detailed comparison.`;
}
