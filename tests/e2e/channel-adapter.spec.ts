import { expect, test } from "@playwright/test";
import {
  browserChannelMessagesToFlowMessages,
  createBrowserChannelAdapter,
} from "../../src/lib/browser-channel-adapter";
import {
  CHANNEL_REPLY_CAPABILITIES,
  getRuntimeReplyCapability,
} from "../../src/lib/channel-adapter-contract";
import {
  createReferenceChannelAdapter,
  REFERENCE_CHANNEL_TYPE,
} from "../../src/lib/reference-channel-adapter";
import {
  createChoiceReply,
  createMediaReply,
  createProductReply,
  createTemplateReply,
  createTextReply,
  type RuntimeReplyOption,
  type RuntimeReplyProduct,
} from "../../src/lib/runtime-replies";
import {
  createWhatsAppChannelAdapter,
  hasNewerWhatsAppInboundMessage,
} from "../../src/lib/whatsapp";

function createOptions(count: number): RuntimeReplyOption[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `option-${index + 1}`,
    label: `Option ${index + 1}`,
    value: `option-${index + 1}`,
  }));
}

function createProduct(input: {
  id: number;
  name: string;
  retailerId: string;
}): RuntimeReplyProduct {
  return {
    currency: "USD",
    description: `${input.name} description`,
    id: input.id,
    imageUrl: null,
    name: input.name,
    priceAmount: 2500,
    productUrl: null,
    sku: null,
    whatsappRetailerId: input.retailerId,
  };
}

test("late WhatsApp replies cannot overtake newer inbound messages", () => {
  const recentMessages = [
    {
      direction: "inbound",
      payload: { message: { timestamp: "1786766160" } },
    },
  ];

  expect(
    hasNewerWhatsAppInboundMessage({
      message: { from: "15551234567", timestamp: "1786766100" },
      recentMessages,
    }),
  ).toBe(true);
  expect(
    hasNewerWhatsAppInboundMessage({
      message: { from: "15551234567", timestamp: "1786766160" },
      recentMessages,
    }),
  ).toBe(false);
  expect(
    hasNewerWhatsAppInboundMessage({
      message: { from: "15551234567" },
      recentMessages,
    }),
  ).toBe(false);
  expect(
    hasNewerWhatsAppInboundMessage({
      message: { from: "15551234567", timestamp: "1786766100" },
      recentMessages: recentMessages.map((message) => ({
        ...message,
        direction: "outbound",
      })),
    }),
  ).toBe(false);
});

test("browser adapters keep project chat and widget replies in parity", () => {
  const product = createProduct({
    id: 101,
    name: "Tenant A Product",
    retailerId: "tenant-a-product",
  });
  const replies = [
    createTextReply("Plain reply"),
    createChoiceReply({
      displayMode: "buttons",
      options: createOptions(3),
      text: "Choose a button",
    }),
    createChoiceReply({
      displayMode: "list",
      options: createOptions(5),
      text: "Choose from the list",
    }),
    createMediaReply({
      media: {
        id: 201,
        mediaType: "image",
        mimeType: "image/png",
        originalName: "tenant-a.png",
        publicPath: "https://cdn.example.test/tenant-a.png",
      },
      text: "Project image",
    }),
    createProductReply({
      catalog: {
        externalId: "catalog-a",
        id: 301,
        name: "Tenant A Catalog",
      },
      mode: "single_product",
      products: [product],
      text: "Featured product",
    }),
    createTemplateReply({
      template: {
        body: "Hello {{1}}",
        language: "en",
        name: "tenant_a_greeting",
        status: "approved",
        variables: ["Customer"],
      },
      text: "Greeting",
    }),
  ];
  const projectChat = createBrowserChannelAdapter("project_chat");
  const widget = createBrowserChannelAdapter("widget");

  for (const [index, reply] of replies.entries()) {
    const context = { messageId: `message-${index}` };
    const projectDelivery = projectChat.adaptReply({ context, reply });
    const widgetDelivery = widget.adaptReply({ context, reply });

    expect(widgetDelivery.capability).toBe(projectDelivery.capability);
    expect(widgetDelivery.delivery).toEqual(projectDelivery.delivery);
    expect(widgetDelivery.mode).toBe(projectDelivery.mode);
    expect(widgetDelivery.warnings).toEqual(projectDelivery.warnings);
  }
});

test("browser adapters preserve separate project reply payloads", () => {
  const adapter = createBrowserChannelAdapter("widget");
  const tenantAProduct = createProduct({
    id: 401,
    name: "Tenant A Product",
    retailerId: "tenant-a",
  });
  const tenantBProduct = createProduct({
    id: 402,
    name: "Tenant B Product",
    retailerId: "tenant-b",
  });
  const tenantA = adapter.adaptReply({
    context: { messageId: "tenant-a-message" },
    reply: createProductReply({
      mode: "single_product",
      products: [tenantAProduct],
      text: "Tenant A",
    }),
  });
  const tenantB = adapter.adaptReply({
    context: { messageId: "tenant-b-message" },
    reply: createProductReply({
      mode: "single_product",
      products: [tenantBProduct],
      text: "Tenant B",
    }),
  });

  expect(tenantA.delivery.products?.map((product) => product.id)).toEqual([
    401,
  ]);
  expect(tenantB.delivery.products?.map((product) => product.id)).toEqual([
    402,
  ]);
  expect(tenantA.delivery.text).toBe("Tenant A");
  expect(tenantB.delivery.text).toBe("Tenant B");
});

test("browser adapters preserve validated runtime input requests", () => {
  const adapter = createBrowserChannelAdapter("project_chat");
  const adapted = adapter.adaptReply({
    context: { messageId: "preferred-date-request" },
    reply: createTextReply("Choose a preferred date.", {
      inputRequest: {
        fieldKey: "preferredDate",
        inputKind: "date",
        label: "Preferred Date",
        options: [],
        required: true,
      },
    }),
  });

  expect(adapted.delivery.inputRequest).toEqual({
    fieldKey: "preferredDate",
    inputKind: "date",
    label: "Preferred Date",
    options: [],
    required: true,
  });
});

test("browser history restores visitor roles and persisted rich replies", () => {
  const history = browserChannelMessagesToFlowMessages("project_chat", [
    {
      direction: "inbound",
      id: 1,
      messageType: "text",
      payload: {},
      text: "Alpha",
    },
    {
      direction: "outbound",
      id: 2,
      messageType: "buttons",
      payload: {
        displayMode: "buttons",
        options: createOptions(2),
      },
      text: "Choose a route\n\n1. Option 1\n2. Option 2",
    },
    {
      direction: "outbound",
      id: 3,
      messageType: "text",
      payload: {},
      text: "The request timed out.",
    },
  ]);

  expect(history).toEqual([
    { id: "channel-1", role: "user", text: "Alpha" },
    expect.objectContaining({
      id: "channel-2",
      role: "assistant",
      text: "Choose a route",
    }),
    {
      id: "channel-3",
      media: undefined,
      productMode: undefined,
      products: undefined,
      role: "assistant",
      text: "The request timed out.",
    },
  ]);
});

test("WhatsApp keeps typed input requests as a text fallback", async () => {
  const adapter = createWhatsAppChannelAdapter();
  const adapted = await adapter.adaptReply({
    context: { serviceWindowOpen: true, to: "15550001111" },
    reply: createTextReply("Choose a preferred date.", {
      inputRequest: {
        fieldKey: "preferredDate",
        inputKind: "date",
        label: "Preferred Date",
        options: [],
        required: true,
      },
    }),
  });

  expect(adapted.mode).toBe("native");
  expect(adapted.delivery.deliveryMode).toBe("text");
  expect(adapted.delivery.body).toMatchObject({
    text: {
      body: "Choose a preferred date.",
    },
    type: "text",
  });
  expect(JSON.stringify(adapted.delivery.body)).not.toContain("inputRequest");
});

test("reference adapter preserves the universal future-channel envelope", () => {
  const adapter = createReferenceChannelAdapter();
  const reply = createChoiceReply({
    displayMode: "buttons",
    options: createOptions(2),
    text: "Choose a service",
  });
  const adapted = adapter.adaptReply({
    context: { correlationId: "future-channel-message-1" },
    reply,
  });

  expect(adapter.profile.channelType).toBe(REFERENCE_CHANNEL_TYPE);
  expect(adapted.capability).toBe("buttons");
  expect(adapted.mode).toBe("native");
  expect(adapted.warnings).toEqual([]);
  expect(adapted.delivery).toEqual({
    correlationId: "future-channel-message-1",
    fallbackText: reply.fallbackText,
    kind: "buttons",
    payload: reply.payload,
    schemaVersion: 1,
    text: "Choose a service",
  });
});

test("all runtime reply capabilities cross the shared adapter boundary", async () => {
  const product = createProduct({
    id: 450,
    name: "Certified Product",
    retailerId: "certified-product",
  });
  const catalog = {
    externalId: "certified-catalog",
    id: 451,
    name: "Certified Catalog",
  };
  const replies = [
    createTextReply("Text"),
    createChoiceReply({
      displayMode: "buttons",
      options: createOptions(2),
      text: "Buttons",
    }),
    createChoiceReply({
      displayMode: "list",
      options: createOptions(4),
      text: "List",
    }),
    createMediaReply({
      media: {
        id: 452,
        mediaType: "image",
        mimeType: "image/png",
        originalName: "certified.png",
        publicPath: "https://cdn.example.test/certified.png",
      },
      text: "Media",
    }),
    createTemplateReply({
      template: {
        body: "Hello {{1}}",
        language: "en",
        name: "certified_template",
        status: "approved",
        variables: ["Customer"],
      },
      text: "Template",
    }),
    createProductReply({
      catalog,
      mode: "catalog",
      products: [product],
      text: "Catalog",
    }),
    createProductReply({
      catalog,
      mode: "single_product",
      products: [product],
      text: "Single product",
    }),
    createProductReply({
      catalog,
      mode: "multiple_products",
      products: [product],
      text: "Multiple products",
    }),
    {
      fallbackText: "A team member will continue this conversation.",
      payload: { requested: true },
      text: "Human handoff requested",
      type: "handoff" as const,
    },
  ];

  expect(replies.map(getRuntimeReplyCapability)).toEqual(
    CHANNEL_REPLY_CAPABILITIES,
  );

  const browser = createBrowserChannelAdapter("widget");
  const reference = createReferenceChannelAdapter();
  const whatsapp = createWhatsAppChannelAdapter();

  for (const [index, reply] of replies.entries()) {
    const capability = CHANNEL_REPLY_CAPABILITIES[index];
    expect(
      browser.adaptReply({ context: { messageId: `browser-${index}` }, reply })
        .capability,
    ).toBe(capability);
    expect(
      reference.adaptReply({
        context: { correlationId: `reference-${index}` },
        reply,
      }).capability,
    ).toBe(capability);

    const whatsappReply = await whatsapp.adaptReply({
      context: { serviceWindowOpen: true, to: "15550001111" },
      reply,
    });
    expect(whatsappReply.capability).toBe(capability);
    expect(whatsappReply.mode).toBe(
      capability === "handoff" ? "fallback" : "native",
    );
  }
});

test("WhatsApp adapter uses native delivery within provider limits", async () => {
  const adapter = createWhatsAppChannelAdapter();
  const context = { serviceWindowOpen: true, to: "15550001111" };
  const nativeButton = await adapter.adaptReply({
    context,
    reply: createChoiceReply({
      displayMode: "buttons",
      options: createOptions(3),
      text: "Choose a button",
    }),
  });
  const fallbackButton = await adapter.adaptReply({
    context,
    reply: createChoiceReply({
      displayMode: "buttons",
      options: createOptions(4),
      text: "Choose a button",
    }),
  });
  const callToActionButton = await adapter.adaptReply({
    context,
    reply: createChoiceReply({
      displayMode: "buttons",
      options: [
        {
          actionType: "url",
          actionValue: "https://example.com/services",
          id: "website",
          label: "Website",
          value: "website",
        },
      ],
      text: "Open our website",
    }),
  });
  const nativeList = await adapter.adaptReply({
    context,
    reply: createChoiceReply({
      displayMode: "list",
      footer: "Select one",
      header: "Teams",
      options: createOptions(10).map((option, index) => ({
        ...option,
        description: `Description ${index + 1}`,
        section: index < 5 ? "Sales" : "Support",
      })),
      text: "Choose from the list",
    }),
  });
  const fallbackList = await adapter.adaptReply({
    context,
    reply: createChoiceReply({
      displayMode: "list",
      options: createOptions(11),
      text: "Choose from the list",
    }),
  });

  expect(nativeButton.mode).toBe("native");
  expect(nativeButton.delivery.body.type).toBe("interactive");
  expect(fallbackButton.mode).toBe("fallback");
  expect(fallbackButton.delivery.body.type).toBe("text");
  expect(callToActionButton.mode).toBe("fallback");
  expect(callToActionButton.delivery.body.type).toBe("text");
  expect(JSON.stringify(callToActionButton.delivery.body)).toContain(
    "https://example.com/services",
  );
  expect(nativeList.mode).toBe("native");
  expect(nativeList.delivery.body.type).toBe("interactive");
  expect(nativeList.delivery.body).toMatchObject({
    interactive: {
      action: {
        sections: [
          { rows: expect.any(Array), title: "Sales" },
          { rows: expect.any(Array), title: "Support" },
        ],
      },
      footer: { text: "Select one" },
      header: { text: "Teams", type: "text" },
    },
  });
  expect(fallbackList.mode).toBe("fallback");
  expect(fallbackList.delivery.body.type).toBe("text");
});

test("WhatsApp adapter falls back when rich payload requirements are missing", async () => {
  const adapter = createWhatsAppChannelAdapter();
  const context = { serviceWindowOpen: true, to: "15550001111" };
  const product = createProduct({
    id: 501,
    name: "Fallback Product",
    retailerId: "fallback-product",
  });
  const nativeProduct = await adapter.adaptReply({
    context,
    reply: createProductReply({
      catalog: {
        externalId: "meta-catalog",
        id: 601,
        name: "Meta Catalog",
      },
      mode: "single_product",
      products: [product],
      text: "Product",
    }),
  });
  const fallbackProduct = await adapter.adaptReply({
    context,
    reply: createProductReply({
      catalog: { id: 602, name: "Browser Catalog" },
      mode: "single_product",
      products: [product],
      text: "Product",
    }),
  });
  const nativeMedia = await adapter.adaptReply({
    context,
    reply: createMediaReply({
      media: {
        id: 701,
        mediaType: "image",
        mimeType: "image/png",
        originalName: "public.png",
        publicPath: "https://cdn.example.test/public.png",
      },
      text: "Public image",
    }),
  });
  const fallbackMedia = await adapter.adaptReply({
    context,
    reply: createMediaReply({
      media: {
        id: 702,
        mediaType: "image",
        mimeType: "image/png",
        originalName: "local.png",
        publicPath: "local.png",
      },
      text: "Local image",
    }),
  });

  expect(nativeProduct.mode).toBe("native");
  expect(nativeProduct.delivery.messageType).toBe("product");
  expect(fallbackProduct.mode).toBe("fallback");
  expect(fallbackProduct.delivery.body.type).toBe("text");
  expect(nativeMedia.mode).toBe("native");
  expect(nativeMedia.delivery.body.type).toBe("image");
  expect(fallbackMedia.mode).toBe("fallback");
  expect(fallbackMedia.delivery.body.type).toBe("text");
});

test("WhatsApp adapter supports image, video, audio, and document media", async () => {
  const adapter = createWhatsAppChannelAdapter();
  const context = { serviceWindowOpen: true, to: "15550001111" };

  for (const [index, mediaType] of [
    "image",
    "video",
    "audio",
    "file",
  ].entries()) {
    const adapted = await adapter.adaptReply({
      context,
      reply: createMediaReply({
        media: {
          id: 800 + index,
          mediaType,
          mimeType: "application/octet-stream",
          originalName: `${mediaType}.bin`,
          publicPath: `https://cdn.example.test/${mediaType}.bin`,
        },
        text: `${mediaType} attachment`,
      }),
    });

    expect(adapted.mode).toBe("native");
    expect(adapted.delivery.body.type).toBe(
      mediaType === "file" ? "document" : mediaType,
    );
  }
});

test("WhatsApp adapter enforces the service window and permits approved templates", async () => {
  const adapter = createWhatsAppChannelAdapter();
  const context = { serviceWindowOpen: false, to: "15550001111" };

  await expect(
    adapter.adaptReply({ context, reply: createTextReply("Regular reply") }),
  ).rejects.toThrow("WhatsApp service window is closed");

  const approvedTemplate = await adapter.adaptReply({
    context,
    reply: createTemplateReply({
      template: {
        body: "Hello {{1}}",
        language: "en",
        name: "approved_greeting",
        status: "approved",
        variables: ["Customer"],
      },
      text: "Greeting",
    }),
  });
  expect(approvedTemplate.mode).toBe("native");
  expect(approvedTemplate.delivery.body.type).toBe("template");

  await expect(
    adapter.adaptReply({
      context,
      reply: createTemplateReply({
        template: {
          body: "Hello {{1}}",
          language: "en",
          name: "draft_greeting",
          status: "draft",
          variables: ["Customer"],
        },
        text: "Greeting",
      }),
    }),
  ).rejects.toThrow("WhatsApp service window is closed");
});
