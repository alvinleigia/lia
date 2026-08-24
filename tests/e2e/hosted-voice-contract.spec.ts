import { expect, test } from "@playwright/test";
import {
  compileHostedVoiceAgent,
  HOSTED_VOICE_CAPABILITIES,
  HostedVoiceCapabilityError,
  type HostedVoiceProviderAdapter,
  type HostedVoiceProviderCompiler,
  hashVoiceAgentDefinitionV1,
  normalizeVoiceAgentDefinitionV1,
  type VoiceAgentDefinitionV1,
  voiceAgentDefinitionV1Schema,
} from "../../src/lib/hosted-voice-contract";
import {
  createTelnyxHostedVoiceCompiler,
  TELNYX_HOSTED_VOICE_PROVIDER,
} from "../../src/lib/telnyx-hosted-voice";

const voiceDefinition = {
  schemaVersion: 1,
  key: "dentalReceptionist",
  name: "Dental Receptionist",
  instructions:
    "Handle clinic questions and use approved tools for appointment work.",
  greeting: {
    strategy: "exact",
    text: "Thanks for calling. How can I help?",
  },
  locale: {
    language: "en-AU",
    timezone: "Australia/Sydney",
  },
  publishedTaskVersions: [
    { taskId: 95, taskVersionId: 501 },
    { taskId: 96, taskVersionId: 502 },
  ],
  tools: [
    { id: "operation:901", version: 2 },
    { id: "operation:902", version: 1 },
  ],
  confirmation: {
    writeOperations: "explicit",
  },
  identity: {
    defaultRequirement: "verified",
    verificationFactors: ["dateOfBirth", "patientName"],
  },
  handoff: {
    mode: "available",
  },
  retention: {
    mode: "metadata_only",
    days: 30,
  },
  requiredCapabilities: [
    "native_conversation",
    "interruptions",
    "synchronous_tools",
    "asynchronous_tools",
    "transfer",
    "versioned_deployment",
  ],
} as const;

const referenceProfile = {
  provider: "reference_hosted",
  capabilities: Object.fromEntries(
    HOSTED_VOICE_CAPABILITIES.map((capability) => [capability, true]),
  ) as Record<(typeof HOSTED_VOICE_CAPABILITIES)[number], boolean>,
};

type ReferenceManagedConfig = {
  greeting: VoiceAgentDefinitionV1["greeting"];
  instructions: string;
  name: string;
  toolReferences: VoiceAgentDefinitionV1["tools"];
};

const referenceAdapter: HostedVoiceProviderAdapter<ReferenceManagedConfig> = {
  profile: referenceProfile,
  compile({ definition }) {
    return {
      greeting: definition.greeting,
      instructions: definition.instructions,
      name: definition.name,
      toolReferences: definition.tools,
    };
  },
  async createDraft(_input) {
    return {
      assistantId: "reference-agent-1",
      previousMainVersionId: null,
      versionId: "version-2",
    };
  },
  async deactivate() {},
  async inspect(_input) {
    return {
      activeVersionId: "version-1",
      assistantId: "reference-agent-1",
      managedConfig: {
        greeting: voiceDefinition.greeting,
        instructions: voiceDefinition.instructions,
        name: voiceDefinition.name,
        toolReferences: voiceDefinition.tools.map((tool) => ({ ...tool })),
      },
      versionId: "version-2",
    };
  },
  async promote() {},
};

test("hosted voice definitions reject provider deployment details", () => {
  const parsed = voiceAgentDefinitionV1Schema.safeParse({
    ...voiceDefinition,
    telnyxAssistantId: "assistant-1",
    telnyxApiKey: "must-not-enter-the-contract",
  });

  expect(parsed.success).toBe(false);
});

test("hosted voice definitions reject incomplete safety policies", () => {
  const missingGreeting = voiceAgentDefinitionV1Schema.safeParse({
    ...voiceDefinition,
    greeting: { strategy: "exact", text: null },
  });
  const missingIdentityFactor = voiceAgentDefinitionV1Schema.safeParse({
    ...voiceDefinition,
    identity: {
      defaultRequirement: "verified",
      verificationFactors: [],
    },
  });
  const missingRetentionPeriod = voiceAgentDefinitionV1Schema.safeParse({
    ...voiceDefinition,
    retention: { mode: "transcript", days: null },
  });

  expect(missingGreeting.success).toBe(false);
  expect(missingIdentityFactor.success).toBe(false);
  expect(missingRetentionPeriod.success).toBe(false);
});

test("hosted voice definition hashes are stable across unordered references", () => {
  const reordered = {
    ...voiceDefinition,
    identity: {
      ...voiceDefinition.identity,
      verificationFactors: ["patientName", "dateOfBirth"],
    },
    publishedTaskVersions: [...voiceDefinition.publishedTaskVersions].reverse(),
    requiredCapabilities: [...voiceDefinition.requiredCapabilities].reverse(),
    tools: [...voiceDefinition.tools].reverse(),
  };

  expect(hashVoiceAgentDefinitionV1(reordered)).toBe(
    hashVoiceAgentDefinitionV1(voiceDefinition),
  );
  expect(normalizeVoiceAgentDefinitionV1(reordered)).toEqual(
    normalizeVoiceAgentDefinitionV1(voiceDefinition),
  );
});

test("one provider-neutral definition compiles through Telnyx and a second provider", () => {
  const telnyx = compileHostedVoiceAgent({
    compiler: createTelnyxHostedVoiceCompiler({
      modelId: "moonshotai/Kimi-K2.6",
      transcriptionLanguage: "en",
      transcriptionModelId: "deepgram/flux",
      voiceId: "Telnyx.Ultra.australian_female",
    }),
    definition: voiceDefinition,
  });
  const reference = compileHostedVoiceAgent({
    compiler: referenceAdapter,
    definition: voiceDefinition,
  });

  expect(telnyx.provider).toBe(TELNYX_HOSTED_VOICE_PROVIDER);
  expect(reference.provider).toBe("reference_hosted");
  expect(telnyx.definitionHash).toBe(reference.definitionHash);
  expect(telnyx.managedConfig).toMatchObject({
    enabled_features: ["telephony"],
    greeting: "Thanks for calling. How can I help?",
    instructions: voiceDefinition.instructions,
    model: "moonshotai/Kimi-K2.6",
    privacy_settings: { data_retention: true },
    transcription: { language: "en", model: "deepgram/flux" },
    voice_settings: { voice: "Telnyx.Ultra.australian_female" },
  });
  expect(JSON.stringify(telnyx.definition)).not.toContain("Telnyx");
  expect(JSON.stringify(telnyx.definition)).not.toContain("deepgram");
  expect(JSON.stringify(telnyx.definition)).not.toContain("Kimi");
});

test("Telnyx greeting strategies compile to the current Assistant API values", () => {
  const compiler = createTelnyxHostedVoiceCompiler({
    modelId: "moonshotai/Kimi-K2.6",
    transcriptionLanguage: "en",
    transcriptionModelId: "deepgram/flux",
    voiceId: "Telnyx.Ultra.australian_female",
  });
  const wait = compileHostedVoiceAgent({
    compiler,
    definition: {
      ...voiceDefinition,
      greeting: { strategy: "wait", text: null },
    },
  });
  const generated = compileHostedVoiceAgent({
    compiler,
    definition: {
      ...voiceDefinition,
      greeting: { strategy: "generated", text: null },
    },
  });

  expect(wait.managedConfig.greeting).toBe("");
  expect(generated.managedConfig.greeting).toBe(
    "<assistant-speaks-first-with-model-generated-message>",
  );
});

test("missing required provider capabilities block compilation", () => {
  const compiler = {
    profile: {
      ...referenceProfile,
      capabilities: {
        ...referenceProfile.capabilities,
        asynchronous_tools: false,
      },
    },
    compile() {
      return { unreachable: true };
    },
  } satisfies HostedVoiceProviderCompiler<{ unreachable: boolean }>;

  const error = (() => {
    try {
      compileHostedVoiceAgent({ compiler, definition: voiceDefinition });
      return null;
    } catch (caught) {
      return caught;
    }
  })();

  expect(error).toBeInstanceOf(HostedVoiceCapabilityError);
  expect(error).toMatchObject({
    report: {
      compatible: false,
      missingCapabilities: ["asynchronous_tools"],
      provider: "reference_hosted",
    },
  });
});

test("hosted provider lifecycle keeps remote identifiers outside the definition", async () => {
  const compiled = compileHostedVoiceAgent({
    compiler: referenceAdapter,
    definition: voiceDefinition,
  });
  const remote = await referenceAdapter.createDraft({
    definitionHash: compiled.definitionHash,
    managedConfig: compiled.managedConfig,
    remoteAssistantId: null,
    versionName: "Lia reference version",
  });

  expect(remote).toEqual({
    assistantId: "reference-agent-1",
    previousMainVersionId: null,
    versionId: "version-2",
  });
  expect(compiled.definition).not.toHaveProperty("assistantId");
  expect(compiled.definition).not.toHaveProperty("versionId");
});
