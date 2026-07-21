"use client";

import {
  CalendarDays,
  CheckSquare2,
  Clock3,
  FileUp,
  Hash,
  ListChecks,
  LocateFixed,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  ShoppingBag,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  allowsFlowAnswerFormatSelection,
  FLOW_ANSWER_FORMATS,
  type FlowInputFamily,
  getFlowInputFamilyDefinition,
  getFlowInputType,
} from "@/lib/flow-input-editor";

function getFamilyIcon(family: FlowInputFamily) {
  switch (family) {
    case "address":
      return MapPin;
    case "choice":
      return ListChecks;
    case "date":
    case "date_range":
      return CalendarDays;
    case "email":
      return Mail;
    case "file":
      return FileUp;
    case "location":
      return LocateFixed;
    case "number":
      return Hash;
    case "phone":
      return Phone;
    case "product":
      return ShoppingBag;
    case "time":
      return Clock3;
    default:
      return MessageSquareText;
  }
}

function getAnswerFormatLabel(value: string) {
  return (
    FLOW_ANSWER_FORMATS.find((format) => format.value === value)?.label ??
    "Text"
  );
}

export function FlowInputPrimaryFields({
  defaultEnabled = true,
  defaultInputType = "text",
  defaultLabel = "",
  defaultPrompt = "",
  defaultRequired = true,
  idPrefix,
  onInputTypeChange,
  stepType,
}: {
  defaultEnabled?: boolean;
  defaultInputType?: string | null;
  defaultLabel?: string | null;
  defaultPrompt?: string | null;
  defaultRequired?: boolean;
  idPrefix: string;
  onInputTypeChange?: (inputType: string) => void;
  stepType: string;
}) {
  const [answerFormat, setAnswerFormat] = useState(
    getFlowInputType(stepType, defaultInputType),
  );
  const canChooseFormat = allowsFlowAnswerFormatSelection(stepType);
  const resolvedInputType = canChooseFormat
    ? answerFormat
    : getFlowInputType(stepType, defaultInputType);
  const definition = getFlowInputFamilyDefinition(stepType, resolvedInputType);

  useEffect(() => {
    setAnswerFormat(getFlowInputType(stepType, defaultInputType));
  }, [defaultInputType, stepType]);

  if (!definition) {
    return null;
  }

  const Icon = getFamilyIcon(definition.family);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border bg-gray-50/70 p-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white text-gray-700 shadow-xs">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{definition.title}</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {definition.description}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${idPrefix}-label`}>
          Step name
        </label>
        <input
          id={`${idPrefix}-label`}
          name="label"
          defaultValue={defaultLabel ?? ""}
          placeholder={definition.title}
          className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          Used by your team to recognize this step on the canvas.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor={`${idPrefix}-prompt`}>
          {definition.questionLabel}
        </label>
        <textarea
          id={`${idPrefix}-prompt`}
          name="prompt"
          rows={3}
          defaultValue={defaultPrompt ?? ""}
          placeholder={definition.questionPlaceholder}
          className="flex min-h-24 w-full resize-y rounded-md border border-input bg-white px-3 py-3 text-sm leading-6 shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      {canChooseFormat ? (
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor={`${idPrefix}-input-type`}
          >
            Answer format
          </label>
          <select
            id={`${idPrefix}-input-type`}
            name="inputType"
            value={answerFormat}
            onChange={(event) => {
              const nextFormat = event.currentTarget.value;
              setAnswerFormat(nextFormat as typeof answerFormat);
              onInputTypeChange?.(nextFormat);
            }}
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {FLOW_ANSWER_FORMATS.map((format) => (
              <option key={format.value} value={format.value}>
                {format.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Lia validates the visitor&apos;s answer using this format.
          </p>
        </div>
      ) : (
        <>
          <input
            type="hidden"
            name="inputType"
            value={resolvedInputType}
            readOnly
          />
          <div className="flex items-center gap-3 rounded-md border bg-white px-3 py-3">
            <CheckSquare2 className="h-4 w-4 shrink-0 text-green-700" />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Answer format: {getAnswerFormatLabel(resolvedInputType)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                This format is selected automatically for this block.
              </p>
            </div>
          </div>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-white p-3">
          <input
            type="checkbox"
            name="isRequired"
            defaultChecked={defaultRequired}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-medium">Answer required</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Visitors must answer before the flow continues.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-white p-3">
          <input
            type="checkbox"
            name="isEnabled"
            defaultChecked={defaultEnabled}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <span className="block text-sm font-medium">Step active</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Include this question when the flow runs.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}

export function FlowInputAnswerStorageField({
  defaultValue = "",
  idPrefix,
}: {
  defaultValue?: string | null;
  idPrefix: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={`${idPrefix}-field-key`}>
        Save answer as
      </label>
      <input
        id={`${idPrefix}-field-key`}
        name="fieldKey"
        defaultValue={defaultValue ?? ""}
        placeholder="customerName"
        className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <p className="text-xs leading-5 text-muted-foreground">
        Later steps, branches, templates, and integrations can reuse this
        answer. Use a short name without spaces, such as customerName.
      </p>
    </div>
  );
}
