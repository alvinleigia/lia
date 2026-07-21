import { expect, test } from "@playwright/test";
import { createBrowserChannelAdapter } from "../../src/lib/browser-channel-adapter";
import {
  createChoiceReply,
  createMediaReply,
  createProductReply,
  createTemplateReply,
  createTextReply,
  type RuntimeReplyOption,
  type RuntimeReplyProduct,
} from "../../src/lib/runtime-replies";
import { createWhatsAppChannelAdapter } from "../../src/lib/whatsapp";

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
  const nativeList = await adapter.adaptReply({
    context,
    reply: createChoiceReply({
      displayMode: "list",
      options: createOptions(10),
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
  expect(nativeList.mode).toBe("native");
  expect(nativeList.delivery.body.type).toBe("interactive");
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
