"use client";

import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FRIENDLY_TASK_FIELD_TYPES,
  GUIDED_CONDITION_OPERATORS,
  type GuidedConditionOperator,
  parseFriendlyValidation,
  parseGuidedRequiredWhen,
  TASK_FIELD_RESOURCE_TYPES,
  type TaskField,
} from "@/lib/conversational-task-builder";
import { cn } from "@/lib/utils";

type CatalogOption = { id: number; name: string };
type RequirementMode = "always" | "optional" | "conditional";

export function TaskFieldFormFields({
  catalogs,
  field,
  fields,
  idPrefix,
}: {
  catalogs: CatalogOption[];
  field?: TaskField;
  fields: TaskField[];
  idPrefix: string;
}) {
  const availableDependencies = fields.filter(
    (candidate) => candidate.id !== field?.id,
  );
  const guidedCondition = parseGuidedRequiredWhen(field?.requiredWhen ?? null);
  const requirementMode = field?.required
    ? "always"
    : field?.requiredWhen
      ? "conditional"
      : "optional";
  const [selectedRequirementMode, setSelectedRequirementMode] =
    useState<RequirementMode>(requirementMode);
  const [selectedConditionField, setSelectedConditionField] = useState(
    guidedCondition?.fieldKey ?? "",
  );
  const [selectedConditionOperator, setSelectedConditionOperator] =
    useState<GuidedConditionOperator>(guidedCondition?.operator ?? "present");
  const [selectedConditionValue, setSelectedConditionValue] = useState(
    guidedCondition?.value ?? "",
  );
  const showCondition = selectedRequirementMode === "conditional";
  const showConditionValue =
    selectedConditionOperator === "equals" ||
    selectedConditionOperator === "not_equals";
  const validation = parseFriendlyValidation(field?.validation ?? null);
  const staticOptions =
    field?.optionSource?.kind === "static"
      ? field.optionSource.options
          .map((option) => `${option.value}|${option.label}`)
          .join("\n")
      : "";
  const resourceSource =
    field?.optionSource?.kind === "project_resource"
      ? field.optionSource
      : null;

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-label`}>Visitor Label</Label>
          <Input
            id={`${idPrefix}-label`}
            name="label"
            defaultValue={field?.label}
            placeholder="Guest Email"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-type`}>Answer Type</Label>
          <select
            id={`${idPrefix}-type`}
            name="type"
            defaultValue={field?.type ?? "text"}
            className="h-9 w-full rounded-md border bg-white px-3 text-sm"
          >
            {FRIENDLY_TASK_FIELD_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-requirementMode`}>Required</Label>
        <select
          id={`${idPrefix}-requirementMode`}
          name="requirementMode"
          value={selectedRequirementMode}
          onChange={(event) =>
            setSelectedRequirementMode(event.target.value as RequirementMode)
          }
          className="h-9 w-full rounded-md border bg-white px-3 text-sm"
        >
          <option value="always">Always required</option>
          <option value="optional">Optional</option>
          <option value="conditional">Required only when...</option>
        </select>
      </div>

      {showCondition && (
        <div
          className={cn(
            "grid gap-4 rounded-md border bg-gray-50 p-4",
            showConditionValue ? "md:grid-cols-3" : "md:grid-cols-2",
          )}
        >
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-conditionField`}>When field</Label>
            <select
              id={`${idPrefix}-conditionField`}
              name="conditionField"
              value={selectedConditionField}
              onChange={(event) =>
                setSelectedConditionField(event.target.value)
              }
              className="h-9 w-full rounded-md border bg-white px-3 text-sm"
            >
              <option value="">Choose a field</option>
              {availableDependencies.map((candidate) => (
                <option key={candidate.id} value={candidate.key}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-conditionOperator`}>Condition</Label>
            <select
              id={`${idPrefix}-conditionOperator`}
              name="conditionOperator"
              value={selectedConditionOperator}
              onChange={(event) =>
                setSelectedConditionOperator(
                  event.target.value as GuidedConditionOperator,
                )
              }
              className="h-9 w-full rounded-md border bg-white px-3 text-sm"
            >
              {GUIDED_CONDITION_OPERATORS.map((operator) => (
                <option key={operator.value} value={operator.value}>
                  {operator.label}
                </option>
              ))}
            </select>
          </div>
          {showConditionValue && (
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-conditionValue`}>Value</Label>
              <Input
                id={`${idPrefix}-conditionValue`}
                name="conditionValue"
                value={selectedConditionValue}
                onChange={(event) =>
                  setSelectedConditionValue(event.target.value)
                }
                placeholder="Enter a value"
              />
            </div>
          )}
        </div>
      )}

      <Accordion type="multiple" className="rounded-md border px-4">
        <AccordionItem value="wording">
          <AccordionTrigger>Visitor wording</AccordionTrigger>
          <AccordionContent forceMount className="space-y-2">
            <Label htmlFor={`${idPrefix}-prompt`}>Exact Question</Label>
            <Textarea
              id={`${idPrefix}-prompt`}
              name="prompt"
              rows={3}
              defaultValue={field?.prompt ?? ""}
              placeholder="Leave blank to let Lia ask naturally."
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="choices">
          <AccordionTrigger>Choices and project data</AccordionTrigger>
          <AccordionContent forceMount className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-optionSourceKind`}>
                Answer Source
              </Label>
              <select
                id={`${idPrefix}-optionSourceKind`}
                name="optionSourceKind"
                defaultValue={field?.optionSource?.kind ?? "none"}
                className="h-9 w-full rounded-md border bg-white px-3 text-sm"
              >
                <option value="none">Visitor enters an answer</option>
                <option value="static">Use a fixed choice list</option>
                <option value="project_resource">
                  Use project catalog data
                </option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-staticOptions`}>Fixed Choices</Label>
              <Textarea
                id={`${idPrefix}-staticOptions`}
                name="staticOptions"
                rows={4}
                defaultValue={staticOptions}
                placeholder={"massage|Massage\nfacial|Facial"}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-resourceType`}>Project Data</Label>
                <select
                  id={`${idPrefix}-resourceType`}
                  name="resourceType"
                  defaultValue={resourceSource?.resourceType ?? "service"}
                  className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                >
                  {TASK_FIELD_RESOURCE_TYPES.map((resource) => (
                    <option key={resource.value} value={resource.value}>
                      {resource.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-collectionKey`}>Catalog</Label>
                <select
                  id={`${idPrefix}-collectionKey`}
                  name="collectionKey"
                  defaultValue={resourceSource?.collectionKey ?? ""}
                  className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="">Any active catalog</option>
                  {catalogs.map((catalog) => (
                    <option key={catalog.id} value={`catalog:${catalog.id}`}>
                      {catalog.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-filterByField`}>
                  Filter Using
                </Label>
                <select
                  id={`${idPrefix}-filterByField`}
                  name="filterByField"
                  defaultValue={resourceSource?.filterByField ?? ""}
                  className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="">No field filter</option>
                  {availableDependencies.map((candidate) => (
                    <option key={candidate.id} value={candidate.key}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="rules">
          <AccordionTrigger>Validation and privacy</AccordionTrigger>
          <AccordionContent forceMount className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-cardinality`}>
                  Answers Allowed
                </Label>
                <select
                  id={`${idPrefix}-cardinality`}
                  name="cardinality"
                  defaultValue={field?.cardinality ?? "single"}
                  className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="single">One answer</option>
                  <option value="multiple">Multiple answers</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-sensitivity`}>Privacy</Label>
                <select
                  id={`${idPrefix}-sensitivity`}
                  name="sensitivity"
                  defaultValue={field?.sensitivity ?? "standard"}
                  className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="standard">Standard</option>
                  <option value="personal">Personal information</option>
                  <option value="sensitive">Sensitive information</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-confirmation`}>Confirmation</Label>
                <select
                  id={`${idPrefix}-confirmation`}
                  name="confirmation"
                  defaultValue={field?.confirmation ?? "when_changed"}
                  className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="never">Do not confirm</option>
                  <option value="when_changed">Confirm corrections</option>
                  <option value="always">Always confirm</option>
                </select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_12rem]">
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-validationKind`}>Validation</Label>
                <select
                  id={`${idPrefix}-validationKind`}
                  name="validationKind"
                  defaultValue={validation.kind}
                  className="h-9 w-full rounded-md border bg-white px-3 text-sm"
                >
                  <option value="none">Use answer type validation</option>
                  <option value="minimum_length">Minimum characters</option>
                  <option value="maximum_length">Maximum characters</option>
                  {validation.kind === "existing" && (
                    <option value="existing">Keep existing custom rule</option>
                  )}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-validationValue`}>
                  Characters
                </Label>
                <Input
                  id={`${idPrefix}-validationValue`}
                  name="validationValue"
                  type="number"
                  min={1}
                  max={10000}
                  defaultValue={validation.value}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Recheck after these answers change</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {availableDependencies.map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      name="dependsOn"
                      value={candidate.key}
                      defaultChecked={field?.dependsOn.includes(candidate.key)}
                    />
                    {candidate.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-normalization`}>
                Phone Formatting
              </Label>
              <select
                id={`${idPrefix}-normalization`}
                name="normalization"
                defaultValue={field?.normalization ?? ""}
                className="h-9 w-full rounded-md border bg-white px-3 text-sm"
              >
                <option value="">No special formatting</option>
                <option value="E.164">
                  International phone format (E.164)
                </option>
              </select>
            </div>
          </AccordionContent>
        </AccordionItem>

        {!field && (
          <AccordionItem value="advanced">
            <AccordionTrigger>Advanced</AccordionTrigger>
            <AccordionContent forceMount className="space-y-2">
              <Label htmlFor={`${idPrefix}-key`}>Internal Field Key</Label>
              <Input
                id={`${idPrefix}-key`}
                name="key"
                placeholder="Generated from the visitor label"
              />
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      {field && (
        <>
          <input type="hidden" name="fieldId" value={field.id} />
          <input type="hidden" name="key" value={field.key} />
          <input
            type="hidden"
            name="existingRequiredWhen"
            value={field.requiredWhen ?? ""}
          />
          <input
            type="hidden"
            name="existingValidation"
            value={field.validation ?? ""}
          />
        </>
      )}
    </>
  );
}
