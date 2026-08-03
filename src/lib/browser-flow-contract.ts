import type {
  ActiveActionFlow,
  FlowChatMessage,
  RuntimeAction,
} from "@/lib/action-runtime";
import type { RuntimeReply } from "@/lib/runtime-replies";

export type BrowserFlowRuntimeResult = {
  action: RuntimeAction | null;
  activeFlow: ActiveActionFlow | null;
  handled: boolean;
  history?: FlowChatMessage[];
  replies: RuntimeReply[];
};
