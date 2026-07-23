import {
  ImageIcon,
  ListChecks,
  type LucideIcon,
  MessageSquareText,
  Package,
  ShoppingBag,
  Wand2,
  Workflow,
} from "lucide-react";
import {
  type FlowContentComponentKey,
  type FlowContentEligibilityContext,
  resolveFlowContentMenu,
} from "@/lib/flow-content-components";

const FLOW_CONTENT_COMPONENT_ICONS = {
  catalog: ShoppingBag,
  choice_buttons: ListChecks,
  handoff: Workflow,
  list: ListChecks,
  media: ImageIcon,
  multiple_products: ShoppingBag,
  single_product: Package,
  template: Wand2,
  text: MessageSquareText,
} satisfies Record<FlowContentComponentKey, LucideIcon>;

export function FlowAddContentMenuItems({
  context,
  onAdd,
}: {
  context: FlowContentEligibilityContext;
  onAdd: (key: FlowContentComponentKey) => void;
}) {
  const items = resolveFlowContentMenu(context);

  return (
    <div className="space-y-3">
      {(["message", "action"] as const).map((group) => {
        const groupItems = items.filter(
          (item) => item.component.group === group,
        );

        return (
          <div key={group} className="space-y-1">
            <p className="px-3 py-1 text-[11px] font-medium uppercase text-muted-foreground">
              {group === "message" ? "Message content" : "Actions"}
            </p>
            {groupItems.map(({ component, disabledReason, enabled }) => {
              const Icon = FLOW_CONTENT_COMPONENT_ICONS[component.key];

              return (
                <button
                  key={component.key}
                  type="button"
                  disabled={!enabled}
                  title={disabledReason ?? component.description}
                  onClick={() => onAdd(component.key)}
                  className="flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors enabled:hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-muted-foreground"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {component.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                      {disabledReason ?? component.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
