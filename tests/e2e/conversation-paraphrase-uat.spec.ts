import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { conversationalTaskSnapshotV1Schema } from "../../src/lib/conversation-contracts";
import type {
  TurnFieldStateV1,
  TurnMessageV1,
} from "../../src/lib/conversation-turn-contracts";
import {
  StructuredTurnEngine,
  type ExecuteStructuredTurnInput,
} from "../../src/lib/conversation-turn-engine";
import { ProjectDocumentTurnRetriever } from "../../src/lib/conversation-turn-retrieval";
import { canonicalizeFieldCandidates } from "../../src/lib/conversational-task-field-validation";
import { db } from "../../src/lib/db-config";
import { conversationalTaskVersions } from "../../src/lib/db-schema";

// Read-only published UAT fixture. No task, submission or external message is
// written by this test. Cross-domain contracts are in statement-extraction.spec.
test("@live-openai V2 paraphrases retain question meaning and pricing inputs", async () => {
  test.skip(
    process.env.LIA_LIVE_KNOWLEDGE_UAT !== "1",
    "Opt-in metered verification only.",
  );
  test.setTimeout(240_000);
  const [version] = await db
    .select({ snapshot: conversationalTaskVersions.snapshot })
    .from(conversationalTaskVersions)
    .where(
      and(
        eq(conversationalTaskVersions.projectId, 1895),
        eq(conversationalTaskVersions.id, 980),
      ),
    );
  const snapshot = conversationalTaskSnapshotV1Schema.parse(version.snapshot);
  const engine = new StructuredTurnEngine({
    retriever: new ProjectDocumentTurnRetriever(),
  });
  let saved: Record<string, unknown> = {
    stayDates: "2026-10-26 to 2026-10-28",
    adults: 4,
    children: 0,
    roomCategory: "Premium bedroom with attached bathroom",
    roomCount: 2,
    ratePlan: "Standard Plan",
  };
  const history: TurnMessageV1[] = [
    {
      role: "user",
      content:
        "Please drop the previous request; I don't want to continue with it.",
    },
    { role: "assistant", content: "No problem. I cancelled this request." },
  ];
  function request(visitorMessage: string): ExecuteStructuredTurnInput {
    return {
      activeTask: snapshot,
      assistantBehavior: snapshot.assistantBehavior,
      assistantIntroduced: true,
      channel: "whatsapp",
      externalUserId: "12025550123",
      companyName: "Hotel",
      context: [],
      history: [...history],
      fieldState: snapshot.task.definition.fields.map((field) => ({
        fieldKey: field.key,
        label: field.label,
        required: field.required,
        sensitivity: field.sensitivity,
        state: Object.hasOwn(saved, field.key) ? "valid" : "missing",
        value: (saved[field.key] ?? null) as TurnFieldStateV1["value"],
      })),
      projectId: 1895,
      projectName: "Stayflexi Hotel UAT",
      projectPolicy: snapshot.conversationPolicy,
      publishedTasks: [],
      requestedFieldKey: "guestName",
      stage: "extraction",
      visitorMessage,
    };
  }
  const location = await engine.execute({
    ...request("Hi! Where exactly are you based?"),
    activeTask: null,
    stage: "knowledge",
  });
  console.log(
    JSON.stringify({
      case: "location",
      reply: location.proposal.reply,
      attempts: location.attempts,
      query: location.proposal.knowledgeRequest,
      grounding: location.proposal.grounding,
    }),
  );
  expect(location.proposal.reply).toMatch(/Devanahalli|Bengaluru/i);
  history.push(
    { role: "user", content: "Do you have Wi-Fi and a pool?" },
    {
      role: "assistant",
      content: "Yes, we offer Wi-Fi and have a swimming pool.",
    },
  );
  for (const [message, intent, expected] of [
    [
      "Quick detour before we continue: we'll be driving. Do we pay extra to park?",
      null,
      /free parking/,
    ],
    [
      "And is breakfast covered by the amount you just quoted?",
      null,
      /can't confirm.*included|cannot confirm.*included/,
    ],
    [
      "Is there a less expensive plan for those same dates, or any promo code we could use?",
      "offers",
      /21,262.50/,
    ],
    [
      "If I commit today, could you knock a fifth off that price?",
      "discount",
      /team's approval/,
    ],
    [
      "Let's stick with Standard. Actually, make it two adults plus two kids, aged five and ten, and we'll leave on 29 October 2026 instead. What's the revised amount?",
      "quote",
      /can't quote.*exact details/,
    ],
    [
      "I'll have a couple of Google Meet calls while I'm there. Will the connection cope?",
      null,
      /can.t confirm|cannot confirm|clarify/i,
    ],
  ] as const) {
    const extracted = await engine.execute(request(message));
    console.log(JSON.stringify({ message, proposal: extracted.proposal }));
    if (extracted.proposal.knowledgeRequest)
      expect(extracted.proposal.knowledgeRequest.pricingIntent).toBe(intent);
    expect(
      extracted.proposal.fieldCandidates.some(
        (field) => field.fieldKey === "callbackRequested",
      ),
    ).toBe(false);
    const candidates = await canonicalizeFieldCandidates({
      definition: snapshot.task.definition,
      candidates: extracted.proposal.fieldCandidates.map((field) => ({
        fieldKey: field.fieldKey,
        naturalValue: field.naturalValue,
        state: "candidate",
        provenance: { source: "visitor", sourceReference: null },
        validation: { valid: false, code: null, message: null },
      })),
      contextValues: new Map([["lia_timezone", "Asia/Kolkata"]]),
      fieldValues: new Map(Object.entries(saved)),
      projectId: 1895,
    });
    for (const candidate of candidates) {
      expect(candidate.state).toBe("valid");
      const value = candidate.canonicalValue as {
        start?: string;
        end?: string;
      };
      saved[candidate.fieldKey] =
        value?.start && value?.end
          ? `${value.start} to ${value.end}`
          : candidate.canonicalValue;
    }
    const answer = await engine.execute({
      ...request(message),
      stage: "knowledge",
      // Exercise the secondary semantic handoff too: extraction may omit the
      // question when concentrating on supplied corrections.
      knowledgeRequest:
        intent === "quote" ? null : extracted.proposal.knowledgeRequest,
    });
    console.log(
      JSON.stringify({
        reply: answer.proposal.reply,
        source: answer.source,
        query: answer.proposal.knowledgeRequest,
      }),
    );
    expect(answer.proposal.reply).toMatch(expected);
    if (intent)
      expect(answer.proposal.grounding.excerptIds).toEqual([
        `task:${snapshot.task.id}:price-table`,
      ]);
    history.push(
      { role: "user", content: message },
      { role: "assistant", content: answer.proposal.reply },
    );
  }
  expect(saved).toMatchObject({
    stayDates: "2026-10-26 to 2026-10-29",
    adults: 2,
    children: 2,
    ratePlan: "Standard Plan",
  });
  const followUp = await engine.execute(
    request("Could you check that with them and get back to me?"),
  );
  const reason = followUp.proposal.fieldCandidates.find(
    (field) => field.fieldKey === "followUpQuestion",
  );
  expect(followUp.proposal.turnKind).toBe("follow_up_request");
  expect(String(reason?.naturalValue)).toMatch(
    /Wi-Fi|connection|video|Google Meet/i,
  );
  saved.guestName = "Hotel WhatsApp Test V2";
  saved.callbackRequested = true;
  saved.callbackWindow = "24 October 2026, 2 to 4pm India time";
  history.push(
    {
      role: "user",
      content:
        "I'm Hotel WhatsApp Test V2. You can reach me on the number I'm messaging from. Could someone call on 24 October 2026, from 2 to 4pm India time?",
    },
    { role: "assistant", content: "Which phone number may our team use?" },
  );
  const interruption = await engine.execute({
    ...request(
      "Quick detour before we continue: we'll be driving. Do we pay extra to park?",
    ),
    requestedFieldKey: "contactNumber",
  });
  expect(interruption.proposal.knowledgeRequest?.query).toMatch(/park/i);
  expect(interruption.proposal.fieldCandidates).toEqual([]);
});
