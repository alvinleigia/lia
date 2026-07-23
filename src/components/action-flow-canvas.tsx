"use client";

import {
  Background,
  type Connection,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesState,
} from "@xyflow/react";
import {
  CheckCircle2,
  GitBranch,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Route,
  Unlink,
  Wand2,
  Workflow,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  clearCanvasDefaultRouteAction,
  createCanvasBranchRuleAction,
  createCanvasStepAction,
  deleteCanvasBranchRuleAction,
  saveCanvasStepPositionsAction,
  setCanvasDefaultRouteAction,
  updateCanvasBranchRuleAction,
  updateCanvasStepAction,
  updateCanvasStepBasicsAction,
} from "@/app/projects/actions/canvas-actions";
import { BranchRuleForm } from "@/components/action-flow-canvas/branch-rule-form";
import {
  CanvasToolbar,
  FlowComponentPalette,
  RouteValidationPanel,
} from "@/components/action-flow-canvas/chrome";
import {
  buildEdges,
  countBlockingDiagnostics,
  countWarningDiagnostics,
  getBranchConditionText,
  getBranchLabel,
  getStepById,
  getStepLabel,
  getStepRouteLabel,
} from "@/components/action-flow-canvas/model";
import { StepBasicsForm } from "@/components/action-flow-canvas/quick-step-form";
import { StepCreateForm } from "@/components/action-flow-canvas/step-form";
import { buildNodes } from "@/components/action-flow-canvas/step-node";
import type {
  ActionFlowCanvasProps,
  CanvasBranchRuleInput,
  CanvasMutationResult,
  CanvasStepBasicsInput,
  CanvasStepInput,
  InspectorSelection,
} from "@/components/action-flow-canvas/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isFlowActionStepType } from "@/lib/flow-action-editor";
import { getFlowComponentLabel } from "@/lib/flow-components";

export function ActionFlowCanvas({
  actionId,
  branchRules,
  catalogProducts,
  mediaAssets,
  operations,
  productCatalogs,
  projectActions,
  routeIssues,
  steps,
}: ActionFlowCanvasProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState("");
  const [hasUnsavedLayout, setHasUnsavedLayout] = useState(false);
  const [isCreateStepDialogOpen, setIsCreateStepDialogOpen] = useState(false);
  const [paletteStepType, setPaletteStepType] = useState("collect_input");
  const [quickEditingStepId, setQuickEditingStepId] = useState<number | null>(
    null,
  );
  const [selection, setSelection] = useState<InspectorSelection>(null);
  const [isPending, startTransition] = useTransition();
  const runMutation = useCallback(
    (mutation: () => Promise<CanvasMutationResult>, onSuccess?: () => void) => {
      setFeedback("");
      startTransition(async () => {
        const result = await mutation();

        setFeedback(result.message);
        if (result.ok) {
          onSuccess?.();
          router.refresh();
        }
      });
    },
    [router],
  );
  const handleQuickEditChange = useCallback(
    (stepId: number, isEditing: boolean) => {
      setQuickEditingStepId((currentStepId) =>
        isEditing ? stepId : currentStepId === stepId ? null : currentStepId,
      );
    },
    [],
  );
  const quickSaveStep = useCallback(
    async (stepId: number, input: CanvasStepBasicsInput) => {
      setFeedback("");
      const result = await updateCanvasStepBasicsAction({
        actionId,
        stepId,
        ...input,
      });

      setFeedback(result.message);
      if (result.ok) {
        router.refresh();
      }

      return result;
    },
    [actionId, router],
  );
  const initialNodes = useMemo(
    () =>
      buildNodes({
        catalogProducts,
        mediaAssets,
        onQuickEditChange: handleQuickEditChange,
        onQuickSave: quickSaveStep,
        productCatalogs,
        routeIssues,
        steps,
      }),
    [
      catalogProducts,
      handleQuickEditChange,
      mediaAssets,
      productCatalogs,
      quickSaveStep,
      routeIssues,
      steps,
    ],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const edges = useMemo(
    () => buildEdges({ branchRules, routeIssues, steps }),
    [branchRules, routeIssues, steps],
  );
  const defaultRoutes = useMemo(
    () =>
      steps
        .filter((step) => step.nextStepId !== null)
        .map((step) => ({
          sourceStep: step,
          targetStep: getStepById(steps, step.nextStepId),
        })),
    [steps],
  );
  const selectedStep =
    selection?.type === "node"
      ? getStepById(steps, Number(selection.id))
      : null;
  const selectedBranchRule =
    selection?.type === "edge" && selection.id.startsWith("branch-")
      ? (branchRules.find((rule) => `branch-${rule.id}` === selection.id) ??
        null)
      : null;
  const selectedDefaultRoute =
    selection?.type === "edge" && selection.id.startsWith("default-")
      ? (defaultRoutes.find(
          ({ sourceStep }) =>
            `default-${sourceStep.id}-${sourceStep.nextStepId}` ===
            selection.id,
        ) ?? null)
      : null;
  const selectedOrderedRoute =
    selection?.type === "edge" && selection.id.startsWith("ordered-")
      ? edges.find((edge) => edge.id === selection.id)
      : null;
  const activeBranchRuleCount = branchRules.filter(
    (rule) => rule.isEnabled,
  ).length;
  const defaultRouteCount = steps.filter(
    (step) => step.nextStepId !== null,
  ).length;
  const blockingRouteIssueCount = countBlockingDiagnostics(routeIssues);
  const routeWarningCount = countWarningDiagnostics(routeIssues);

  useEffect(() => {
    setNodes(initialNodes);
    setHasUnsavedLayout(false);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        const zIndex =
          Number(node.id) === quickEditingStepId ? 10_000 : undefined;

        return node.zIndex === zIndex ? node : { ...node, zIndex };
      }),
    );
  }, [quickEditingStepId, setNodes]);

  const createStep = useCallback(
    (input: CanvasStepInput) => {
      runMutation(() =>
        createCanvasStepAction({
          actionId,
          ...input,
        }),
      );
    },
    [actionId, runMutation],
  );

  const updateStep = useCallback(
    (stepId: number, input: CanvasStepInput) => {
      runMutation(() =>
        updateCanvasStepAction({
          actionId,
          stepId,
          ...input,
        }),
      );
    },
    [actionId, runMutation],
  );

  const updateStepBasics = useCallback(
    (stepId: number, input: CanvasStepBasicsInput) => {
      runMutation(
        () =>
          updateCanvasStepBasicsAction({
            actionId,
            stepId,
            ...input,
          }),
        () => setSelection(null),
      );
    },
    [actionId, runMutation],
  );

  const saveLayout = useCallback(() => {
    runMutation(
      () =>
        saveCanvasStepPositionsAction({
          actionId,
          positions: nodes.map((node) => ({
            stepId: Number(node.id),
            x: node.position.x,
            y: node.position.y,
          })),
        }),
      () => setHasUnsavedLayout(false),
    );
  }, [actionId, nodes, runMutation]);

  const saveDefaultRoute = useCallback(
    (sourceStepId: number, targetStepId: number) => {
      runMutation(() =>
        setCanvasDefaultRouteAction({
          actionId,
          sourceStepId,
          targetStepId,
        }),
      );
    },
    [actionId, runMutation],
  );

  const clearDefaultRoute = useCallback(
    (sourceStepId: number) => {
      runMutation(() =>
        clearCanvasDefaultRouteAction({
          actionId,
          sourceStepId,
        }),
      );
    },
    [actionId, runMutation],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const sourceStepId = Number(connection.source);
      const targetStepId = Number(connection.target);

      if (!Number.isInteger(sourceStepId) || !Number.isInteger(targetStepId)) {
        setFeedback("Invalid canvas route.");
        return;
      }

      saveDefaultRoute(sourceStepId, targetStepId);
    },
    [saveDefaultRoute],
  );

  const createBranchRule = useCallback(
    (input: CanvasBranchRuleInput) => {
      runMutation(() =>
        createCanvasBranchRuleAction({
          actionId,
          ...input,
        }),
      );
    },
    [actionId, runMutation],
  );

  const updateBranchRule = useCallback(
    (ruleId: number, input: CanvasBranchRuleInput) => {
      runMutation(() =>
        updateCanvasBranchRuleAction({
          actionId,
          ruleId,
          ...input,
        }),
      );
    },
    [actionId, runMutation],
  );

  const deleteBranchRule = useCallback(
    (ruleId: number) => {
      runMutation(
        () =>
          deleteCanvasBranchRuleAction({
            actionId,
            ruleId,
          }),
        () => setSelection(null),
      );
    },
    [actionId, runMutation],
  );

  return (
    <div className="space-y-3">
      <CanvasToolbar
        actionId={actionId}
        branchRuleCount={activeBranchRuleCount}
        defaultRouteCount={defaultRouteCount}
        hasUnsavedLayout={hasUnsavedLayout}
        isPending={isPending}
        onSaveLayout={saveLayout}
        routeIssueCount={blockingRouteIssueCount}
        routeWarningCount={routeWarningCount}
        stepCount={steps.length}
      />

      {feedback && (
        <p
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
            feedback.toLowerCase().includes("saved") ||
            feedback.toLowerCase().includes("cleared") ||
            feedback.toLowerCase().includes("created") ||
            feedback.toLowerCase().includes("updated") ||
            feedback.toLowerCase().includes("deleted")
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          {feedback}
        </p>
      )}

      <div className="grid min-h-[760px] grid-cols-[260px_minmax(760px,1fr)] gap-3 overflow-x-auto">
        <FlowComponentPalette
          onSelectStepType={(stepType) => {
            setPaletteStepType(stepType);
            setSelection(null);
            setIsCreateStepDialogOpen(true);
          }}
          selectedStepType={paletteStepType}
        />

        <div className="relative h-[760px] min-w-[760px] overflow-hidden rounded-md border bg-white">
          <ReactFlow
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.25}
            nodes={nodes}
            onConnect={handleConnect}
            onEdgeClick={(_, edge) => {
              setIsCreateStepDialogOpen(false);
              setSelection({ id: edge.id, type: "edge" });
            }}
            onNodeClick={(_, node) => {
              setIsCreateStepDialogOpen(false);
              setSelection({ id: node.id, type: "node" });
            }}
            onNodeDragStop={() => setHasUnsavedLayout(true)}
            onNodesChange={onNodesChange}
            onPaneClick={() => setSelection(null)}
            nodesDraggable={!isPending}
            nodesConnectable={!isPending}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
          {steps.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-md border bg-white px-4 py-3 text-center shadow-sm">
                <p className="text-sm font-medium">No Steps Yet</p>
                <p className="text-xs text-muted-foreground">
                  Choose a block from the left panel to create the first step.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={isCreateStepDialogOpen}
        onOpenChange={setIsCreateStepDialogOpen}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create Step
            </DialogTitle>
            <DialogDescription>
              Configure the selected block and add it to this flow.
            </DialogDescription>
          </DialogHeader>
          <StepCreateForm
            branchRules={branchRules}
            catalogProducts={catalogProducts}
            defaultStepType={paletteStepType}
            isPending={isPending}
            mediaAssets={mediaAssets}
            onSubmit={createStep}
            operations={operations}
            productCatalogs={productCatalogs}
            projectActions={projectActions}
            steps={steps}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={selection !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelection(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedStep ? (
                <>
                  <Pencil className="h-5 w-5" />
                  Edit Step
                </>
              ) : selectedBranchRule ? (
                <>
                  <GitBranch className="h-5 w-5" />
                  Edit Branch
                </>
              ) : (
                <>
                  <Route className="h-5 w-5" />
                  Route Details
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {selectedStep
                ? "Update the visitor-facing content and common behavior."
                : selectedBranchRule
                  ? "Update this conditional route."
                  : "Review or clear this route."}
            </DialogDescription>
          </DialogHeader>

          {isPending && (
            <p className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving changes
            </p>
          )}

          {selectedStep && (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4 rounded-md border bg-gray-50 p-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Step {selectedStep.sortOrder}
                  </p>
                  <p className="mt-1 font-medium">
                    {getStepLabel(selectedStep)}
                  </p>
                </div>
                <span className="rounded-full border bg-white px-2.5 py-1 text-xs text-muted-foreground">
                  {getFlowComponentLabel(selectedStep.stepType)}
                </span>
              </div>

              <StepBasicsForm
                branchRules={branchRules}
                catalogProducts={catalogProducts}
                isPending={isPending}
                mediaAssets={mediaAssets}
                onSubmit={(input) => updateStepBasics(selectedStep.id, input)}
                operations={operations}
                productCatalogs={productCatalogs}
                projectActions={projectActions}
                step={selectedStep}
                steps={steps}
              />

              {!isFlowActionStepType(selectedStep.stepType) && (
                <details className="group rounded-md border bg-white">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
                    <span className="flex items-center gap-2">
                      <Wand2 className="h-4 w-4" />
                      Advanced settings
                    </span>
                    <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                      Validation, integrations, and channel controls
                    </span>
                  </summary>
                  <div className="border-t p-4">
                    <StepCreateForm
                      branchRules={branchRules}
                      catalogProducts={catalogProducts}
                      isPending={isPending}
                      mediaAssets={mediaAssets}
                      onSubmit={(input) => updateStep(selectedStep.id, input)}
                      operations={operations}
                      productCatalogs={productCatalogs}
                      projectActions={projectActions}
                      step={selectedStep}
                      steps={steps}
                      submitLabel="Save Advanced Settings"
                    />
                  </div>
                </details>
              )}

              <details className="group rounded-md border bg-white">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
                  <span className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    Branching
                  </span>
                  <span className="text-xs font-normal text-muted-foreground group-open:hidden">
                    Add a conditional route from this step
                  </span>
                </summary>
                <div className="border-t p-4">
                  <BranchRuleForm
                    key={`create-branch-${selectedStep.id}`}
                    branchRules={branchRules}
                    isPending={isPending}
                    mode="create"
                    onSubmit={createBranchRule}
                    sourceStep={selectedStep}
                    steps={steps}
                  />
                </div>
              </details>
            </div>
          )}

          {selectedBranchRule && (
            <div className="space-y-5">
              <div className="rounded-md border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Selected Branch
                </p>
                <p className="font-medium">
                  {getBranchLabel(selectedBranchRule)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  When {getBranchConditionText(selectedBranchRule)}, go to{" "}
                  {getStepRouteLabel(steps, selectedBranchRule.targetStepId)}.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedBranchRule.isEnabled ? "Enabled" : "Disabled"}
                </p>
              </div>

              <BranchRuleForm
                key={`edit-branch-${selectedBranchRule.id}`}
                branchRules={branchRules}
                isPending={isPending}
                mode="edit"
                onDelete={() => deleteBranchRule(selectedBranchRule.id)}
                onSubmit={(input) =>
                  updateBranchRule(selectedBranchRule.id, input)
                }
                rule={selectedBranchRule}
                sourceStep={
                  getStepById(steps, selectedBranchRule.sourceStepId) ??
                  steps[0]
                }
                steps={steps}
              />
            </div>
          )}

          {selectedDefaultRoute && (
            <div className="space-y-4">
              <div className="rounded-md border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Selected Default Route
                </p>
                <p className="font-medium">
                  {selectedDefaultRoute.sourceStep.sortOrder}.{" "}
                  {getStepLabel(selectedDefaultRoute.sourceStep)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedDefaultRoute.targetStep
                    ? `Routes to ${selectedDefaultRoute.targetStep.sortOrder}. ${getStepLabel(
                        selectedDefaultRoute.targetStep,
                      )}`
                    : `Routes to missing step #${selectedDefaultRoute.sourceStep.nextStepId}`}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  clearDefaultRoute(selectedDefaultRoute.sourceStep.id)
                }
                disabled={isPending}
              >
                <Unlink className="h-4 w-4" />
                Clear Default Route
              </Button>
            </div>
          )}

          {selectedOrderedRoute && (
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Ordered Fallback
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                This dashed route is implicit runtime behavior. Connect nodes to
                save an explicit default route.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <RouteValidationPanel routeIssues={routeIssues} />

      <div className="rounded-md border bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <Link2 className="h-4 w-4" />
              Default Route Editing
            </p>
            {feedback && (
              <p
                className={`mt-1 text-sm ${
                  feedback.toLowerCase().includes("saved") ||
                  feedback.toLowerCase().includes("cleared")
                    ? "text-green-700"
                    : "text-red-700"
                }`}
              >
                {feedback}
              </p>
            )}
          </div>
          {isPending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving
            </p>
          )}
        </div>

        {defaultRoutes.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No explicit default routes are configured.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {defaultRoutes.map(({ sourceStep, targetStep }) => (
              <div
                key={sourceStep.id}
                className="flex flex-col gap-3 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {sourceStep.sortOrder}. {getStepLabel(sourceStep)}
                  </p>
                  <p className="text-muted-foreground">
                    {targetStep
                      ? `Routes to ${targetStep.sortOrder}. ${getStepLabel(
                          targetStep,
                        )}`
                      : `Routes to missing step #${sourceStep.nextStepId}`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => clearDefaultRoute(sourceStep.id)}
                  disabled={isPending}
                >
                  <Unlink className="h-4 w-4" />
                  Clear
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-md border bg-white p-4">
          <p className="flex items-center gap-2 font-medium">
            <Route className="h-4 w-4" />
            Default route
          </p>
          <p className="mt-1 text-muted-foreground">
            Solid dark edges use a step's configured next step.
          </p>
        </div>
        <div className="rounded-md border bg-white p-4">
          <p className="flex items-center gap-2 font-medium">
            <GitBranch className="h-4 w-4" />
            Branch route
          </p>
          <p className="mt-1 text-muted-foreground">
            Blue edges represent enabled conditional branch rules.
          </p>
        </div>
        <div className="rounded-md border bg-white p-4">
          <p className="flex items-center gap-2 font-medium">
            <Workflow className="h-4 w-4" />
            Ordered fallback
          </p>
          <p className="mt-1 text-muted-foreground">
            Dashed edges show the runtime's next enabled step fallback.
          </p>
        </div>
      </div>
    </div>
  );
}
