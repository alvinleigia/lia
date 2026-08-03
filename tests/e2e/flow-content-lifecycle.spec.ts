import { expect, test } from "@playwright/test";
import { parseActionFlowExportJson } from "@/lib/action-flow-export";
import { buildFlowContentDocument } from "@/lib/flow-content-blocks";

test("export and import parsing preserve ordered content and stable values", () => {
  const contentDocument = buildFlowContentDocument([
    { id: "intro", text: "First", type: "text" },
    {
      displayMode: "list",
      footer: "Choose one",
      header: "Teams",
      id: "team",
      options: [
        {
          description: "Talk to sales",
          id: "sales",
          label: "Sales",
          section: "Departments",
          value: "team_sales",
        },
      ],
      text: "Second",
      type: "choice",
    },
  ]);
  const parsed = parseActionFlowExportJson(
    JSON.stringify({
      action: { name: "Ordered flow", settings: {} },
      branchRules: [],
      schemaVersion: 1,
      steps: [
        {
          id: 1,
          settings: { contentDocument },
          sortOrder: 1,
          stepType: "collect_input",
        },
      ],
    }),
  );

  expect(parsed.steps[0]?.settings.contentDocument).toEqual(contentDocument);
});
