"use client";

import {
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { getFlowInputFamilyDefinition } from "@/lib/flow-input-editor";

const DOCUMENT_FILE_TYPES = ".pdf,.txt,.md,.doc,.docx";

function getFileTypePreset(value: string) {
  if (!value) {
    return "common";
  }

  if (value === "image/*") {
    return "images";
  }

  if (value === DOCUMENT_FILE_TYPES) {
    return "documents";
  }

  return "custom";
}

function getAutomaticValidationMessage(family: string) {
  switch (family) {
    case "address":
      return "Lia collects address line, city, region, postal code, and country as structured details.";
    case "date":
      return "Lia checks that the answer is a valid calendar date.";
    case "date_range":
      return "Lia checks both dates and ensures the end date is not before the start date.";
    case "email":
      return "Lia checks that the answer follows a valid email-address format.";
    case "location":
      return "Visitors can enter a place or share valid browser coordinates.";
    case "number":
      return "Lia checks that the answer is numeric before continuing.";
    case "phone":
      return "Lia accepts international phone formats containing 7 to 15 digits.";
    case "time":
      return "Lia checks that the answer is a valid 24-hour time.";
    default:
      return "Lia applies the selected answer format before the flow continues.";
  }
}

export function FlowInputValidationFields({
  defaultAllowedFileTypes = "",
  defaultInvalidMessage = "",
  defaultMaxDate = "",
  defaultMaxLength,
  defaultMaxNumber,
  defaultMinDate = "",
  defaultMinLength,
  defaultMinNumber,
  defaultRegex = "",
  defaultRequiredMessage = "",
  idPrefix,
  inputType,
  stepType,
}: {
  defaultAllowedFileTypes?: string | null;
  defaultInvalidMessage?: string | null;
  defaultMaxDate?: string | null;
  defaultMaxLength?: number | string | null;
  defaultMaxNumber?: number | string | null;
  defaultMinDate?: string | null;
  defaultMinLength?: number | string | null;
  defaultMinNumber?: number | string | null;
  defaultRegex?: string | null;
  defaultRequiredMessage?: string | null;
  idPrefix: string;
  inputType: string | null | undefined;
  stepType: string;
}) {
  const definition = getFlowInputFamilyDefinition(stepType, inputType);
  const initialAllowedFileTypes = defaultAllowedFileTypes ?? "";
  const [fileTypePreset, setFileTypePreset] = useState(
    getFileTypePreset(initialAllowedFileTypes),
  );
  const [customFileTypes, setCustomFileTypes] = useState(
    getFileTypePreset(initialAllowedFileTypes) === "custom"
      ? initialAllowedFileTypes
      : "",
  );

  if (!definition) {
    return null;
  }

  const allowedFileTypes =
    fileTypePreset === "images"
      ? "image/*"
      : fileTypePreset === "documents"
        ? DOCUMENT_FILE_TYPES
        : fileTypePreset === "custom"
          ? customFileTypes
          : "";

  return (
    <div className="space-y-4 rounded-md border bg-gray-50/50 p-4">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4" />
          Answer rules
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Show a helpful response when the visitor skips or enters an invalid
          answer.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor={`${idPrefix}-required-message`}
          >
            When no answer is provided
          </label>
          <input
            id={`${idPrefix}-required-message`}
            name="requiredMessage"
            defaultValue={defaultRequiredMessage ?? ""}
            placeholder="Please provide this detail."
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        <div className="space-y-2">
          <label
            className="text-sm font-medium"
            htmlFor={`${idPrefix}-invalid-message`}
          >
            When the answer is invalid
          </label>
          <input
            id={`${idPrefix}-invalid-message`}
            name="validationMessage"
            defaultValue={defaultInvalidMessage ?? ""}
            placeholder="Please enter a valid value."
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
      </div>

      <div className="flex gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs leading-5 text-green-900">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{getAutomaticValidationMessage(definition.family)}</span>
      </div>

      {definition.validation.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-min-length`}
            >
              Minimum characters
            </label>
            <input
              id={`${idPrefix}-min-length`}
              name="validationMinLength"
              type="number"
              min="0"
              defaultValue={defaultMinLength ?? ""}
              className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-max-length`}
            >
              Maximum characters
            </label>
            <input
              id={`${idPrefix}-max-length`}
              name="validationMaxLength"
              type="number"
              min="1"
              defaultValue={defaultMaxLength ?? ""}
              className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        </div>
      ) : (
        <>
          <input type="hidden" name="validationMinLength" value="" />
          <input type="hidden" name="validationMaxLength" value="" />
        </>
      )}

      {definition.validation.numberRange ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-min-number`}
            >
              Minimum value
            </label>
            <input
              id={`${idPrefix}-min-number`}
              name="validationMinNumber"
              type="number"
              step="any"
              defaultValue={defaultMinNumber ?? ""}
              className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-max-number`}
            >
              Maximum value
            </label>
            <input
              id={`${idPrefix}-max-number`}
              name="validationMaxNumber"
              type="number"
              step="any"
              defaultValue={defaultMaxNumber ?? ""}
              className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        </div>
      ) : (
        <>
          <input type="hidden" name="validationMinNumber" value="" />
          <input type="hidden" name="validationMaxNumber" value="" />
        </>
      )}

      {definition.validation.dateRange ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-min-date`}
            >
              Earliest date
            </label>
            <input
              id={`${idPrefix}-min-date`}
              name="validationMinDate"
              type="date"
              defaultValue={defaultMinDate ?? ""}
              className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-max-date`}
            >
              Latest date
            </label>
            <input
              id={`${idPrefix}-max-date`}
              name="validationMaxDate"
              type="date"
              defaultValue={defaultMaxDate ?? ""}
              className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
        </div>
      ) : (
        <>
          <input type="hidden" name="validationMinDate" value="" />
          <input type="hidden" name="validationMaxDate" value="" />
        </>
      )}

      {definition.validation.fileTypes ? (
        <div className="space-y-3 rounded-md border bg-white p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <FileCheck2 className="h-4 w-4" />
            Files visitors may upload
          </p>
          <select
            aria-label="Allowed upload types"
            value={fileTypePreset}
            onChange={(event) => setFileTypePreset(event.currentTarget.value)}
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="common">Common files</option>
            <option value="images">Images only</option>
            <option value="documents">Documents only</option>
            <option value="custom">Custom file types</option>
          </select>
          <input
            type="hidden"
            name="validationAllowedFileTypes"
            value={allowedFileTypes}
            readOnly
          />
          {fileTypePreset === "custom" && (
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`${idPrefix}-file-types`}
              >
                File extensions or media types
              </label>
              <input
                id={`${idPrefix}-file-types`}
                value={customFileTypes}
                onChange={(event) => setCustomFileTypes(event.target.value)}
                placeholder=".pdf,image/*"
                className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
          )}
        </div>
      ) : (
        <input type="hidden" name="validationAllowedFileTypes" value="" />
      )}

      {definition.validation.customPattern ? (
        <details className="group rounded-md border bg-white">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
            Custom answer pattern
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-2 border-t p-3">
            <label
              className="text-sm font-medium"
              htmlFor={`${idPrefix}-regex`}
            >
              Regular expression
            </label>
            <input
              id={`${idPrefix}-regex`}
              name="validationRegex"
              defaultValue={defaultRegex ?? ""}
              placeholder="^[A-Z0-9-]+$"
              className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 font-mono text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Optional advanced rule. Leave empty to use Lia&apos;s normal
              validation for this answer format.
            </p>
          </div>
        </details>
      ) : (
        <input type="hidden" name="validationRegex" value="" />
      )}
    </div>
  );
}
