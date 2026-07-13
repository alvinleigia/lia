export const FLOW_CONTENT_BLOCK_TYPES = ["text", "choice"] as const;

export type FlowContentBlockType = (typeof FLOW_CONTENT_BLOCK_TYPES)[number];

type FlowTextContentBlock = {
  id: string;
  text: string;
  type: "text";
};

type FlowChoiceContentBlock = {
  displayMode: "buttons" | "list" | "text";
  id: string;
  options: string[];
  text: string;
  type: "choice";
};

export type FlowContentBlock = FlowChoiceContentBlock | FlowTextContentBlock;

const MAX_CONTENT_BLOCKS = 10;
const MAX_OPTIONS_PER_BLOCK = 20;

function getText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getBlockId(value: unknown, index: number) {
  const id = getText(value, 80);
  return id || `content-${index + 1}`;
}

function parseChoiceDisplayMode(value: unknown) {
  return value === "list" || value === "text" || value === "buttons"
    ? value
    : "buttons";
}

export function parseFlowContentBlocks(value: unknown): FlowContentBlock[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_CONTENT_BLOCKS)
    .map((item, index): FlowContentBlock | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const block = item as Record<string, unknown>;

      if (block.type === "text") {
        const text = getText(block.text, 2000);
        return text
          ? {
              id: getBlockId(block.id, index),
              text,
              type: "text",
            }
          : null;
      }

      if (block.type === "choice") {
        const text = getText(block.text, 1000);
        const options = Array.isArray(block.options)
          ? block.options
              .slice(0, MAX_OPTIONS_PER_BLOCK)
              .map((option) => getText(option, 160))
              .filter(Boolean)
          : [];

        if (!text || options.length === 0) {
          return null;
        }

        return {
          displayMode: parseChoiceDisplayMode(block.displayMode),
          id: getBlockId(block.id, index),
          options,
          text,
          type: "choice",
        };
      }

      return null;
    })
    .filter((block): block is FlowContentBlock => block !== null);
}

export function getFlowContentBlocks(settings: Record<string, unknown>) {
  return parseFlowContentBlocks(settings.contentBlocks);
}

export function getFlowChoiceContentBlock(settings: Record<string, unknown>) {
  return (
    getFlowContentBlocks(settings).find((block) => block.type === "choice") ??
    null
  );
}

export function formatFlowContentBlockText(settings: Record<string, unknown>) {
  return getFlowContentBlocks(settings)
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n\n");
}
