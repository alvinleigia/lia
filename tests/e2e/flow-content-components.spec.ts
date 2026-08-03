import { expect, test } from "@playwright/test";
import {
  FLOW_CONTENT_COMPONENT_KEYS,
  resolveFlowContentMenu,
} from "../../src/lib/flow-content-components";

const readyContext = {
  answerCollectionDisabledReason: null,
  blockCount: 0,
  catalogProductCount: 2,
  hasResponseCollector: false,
  mediaAssetCount: 1,
  productCatalogCount: 1,
};

test("universal content menu always returns every registered option", () => {
  const menu = resolveFlowContentMenu({
    ...readyContext,
    answerCollectionDisabledReason:
      "Response collectors can only be added to steps that collect a visitor answer.",
    catalogProductCount: 0,
    mediaAssetCount: 0,
    productCatalogCount: 0,
  });

  expect(menu.map((item) => item.component.key)).toEqual(
    FLOW_CONTENT_COMPONENT_KEYS,
  );
  expect(menu.find((item) => item.component.key === "text")?.enabled).toBe(
    true,
  );
  expect(
    menu.find((item) => item.component.key === "choice_buttons")
      ?.disabledReason,
  ).toContain("collect a visitor answer");
  expect(
    menu.find((item) => item.component.key === "media")?.disabledReason,
  ).toContain("Media Library");
  expect(
    menu.find((item) => item.component.key === "single_product")
      ?.disabledReason,
  ).toContain("Create a product catalog");
});

test("ready content data enables every inline content family", () => {
  const menu = resolveFlowContentMenu(readyContext);
  const inlineItems = menu.filter(
    (item) => item.component.target === "content_block",
  );
  const standaloneItems = menu.filter(
    (item) => item.component.target === "step",
  );

  expect(inlineItems.every((item) => item.enabled)).toBe(true);
  expect(standaloneItems.every((item) => !item.enabled)).toBe(true);
  expect(
    standaloneItems.every((item) =>
      item.disabledReason?.includes("Blocks panel"),
    ),
  ).toBe(true);
});

test("one response collector disables both collector presentations consistently", () => {
  const menu = resolveFlowContentMenu({
    ...readyContext,
    hasResponseCollector: true,
  });

  for (const key of ["choice_buttons", "list"] as const) {
    const item = menu.find((entry) => entry.component.key === key);
    expect(item?.enabled).toBe(false);
    expect(item?.disabledReason).toContain("already has a response collector");
  }
});

test("content limit disables every option with one clear reason", () => {
  const menu = resolveFlowContentMenu({ ...readyContext, blockCount: 10 });

  expect(menu.every((item) => !item.enabled)).toBe(true);
  expect(
    menu.every((item) => item.disabledReason?.includes("maximum of 10")),
  ).toBe(true);
});
