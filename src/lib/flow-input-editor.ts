import type {
  ActionStepInputType,
  ActionStepType,
} from "@/lib/action-flow-constants";

export const FLOW_INPUT_STEP_TYPES = [
  "collect_input",
  "choice",
  "date",
  "date_range",
  "address",
  "time",
  "number",
  "email",
  "phone",
  "location",
  "file_upload",
  "product_selection",
] as const satisfies readonly ActionStepType[];

export const FLOW_ANSWER_FORMATS = [
  { label: "Text", value: "text" },
  { label: "Email address", value: "email" },
  { label: "Phone number", value: "phone" },
  { label: "Date", value: "date" },
  { label: "Time", value: "time" },
  { label: "Whole number", value: "int" },
  { label: "Number", value: "float" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: ActionStepInputType;
}>;

export type FlowInputStepType = (typeof FLOW_INPUT_STEP_TYPES)[number];

export type FlowInputFamily =
  | "address"
  | "choice"
  | "date"
  | "date_range"
  | "email"
  | "file"
  | "location"
  | "number"
  | "phone"
  | "product"
  | "text"
  | "time";

export type FlowInputValidationCapabilities = {
  customPattern: boolean;
  dateRange: boolean;
  fileTypes: boolean;
  length: boolean;
  numberRange: boolean;
};

export type FlowInputFamilyDefinition = {
  answerLabel: string;
  answerPlaceholder: string;
  description: string;
  family: FlowInputFamily;
  fixedInputType: ActionStepInputType | null;
  questionLabel: string;
  questionPlaceholder: string;
  title: string;
  validation: FlowInputValidationCapabilities;
};

const NO_SPECIAL_VALIDATION: FlowInputValidationCapabilities = {
  customPattern: false,
  dateRange: false,
  fileTypes: false,
  length: false,
  numberRange: false,
};

const FAMILY_DEFINITIONS: Record<
  FlowInputFamily,
  Omit<FlowInputFamilyDefinition, "family">
> = {
  address: {
    answerLabel: "Structured address",
    answerPlaceholder: "Address line, city, region, postal code, and country",
    description: "Collect address details in a reusable structured format.",
    fixedInputType: "text",
    questionLabel: "Address question",
    questionPlaceholder: "What address should we use?",
    title: "Address",
    validation: NO_SPECIAL_VALIDATION,
  },
  choice: {
    answerLabel: "Selected option",
    answerPlaceholder: "The visitor chooses from the configured options",
    description: "Let visitors choose from clear buttons, a list, or text.",
    fixedInputType: "text",
    questionLabel: "Choice question",
    questionPlaceholder: "Which option would you like?",
    title: "Choice",
    validation: NO_SPECIAL_VALIDATION,
  },
  date: {
    answerLabel: "Date",
    answerPlaceholder: "YYYY-MM-DD",
    description:
      "Collect one calendar date with optional earliest and latest dates.",
    fixedInputType: "date",
    questionLabel: "Date question",
    questionPlaceholder: "What date would you prefer?",
    title: "Date",
    validation: {
      ...NO_SPECIAL_VALIDATION,
      dateRange: true,
    },
  },
  date_range: {
    answerLabel: "Start and end dates",
    answerPlaceholder: "YYYY-MM-DD to YYYY-MM-DD",
    description: "Collect a valid start date followed by an end date.",
    fixedInputType: "text",
    questionLabel: "Date range question",
    questionPlaceholder: "What date range works for you?",
    title: "Date range",
    validation: NO_SPECIAL_VALIDATION,
  },
  email: {
    answerLabel: "Email address",
    answerPlaceholder: "name@example.com",
    description: "Collect and automatically validate an email address.",
    fixedInputType: "email",
    questionLabel: "Email question",
    questionPlaceholder: "What email address should we use?",
    title: "Email address",
    validation: {
      ...NO_SPECIAL_VALIDATION,
      customPattern: true,
      length: true,
    },
  },
  file: {
    answerLabel: "Uploaded file",
    answerPlaceholder: "A supported image, document, audio, or video file",
    description:
      "Ask visitors to upload a file with optional type restrictions.",
    fixedInputType: "text",
    questionLabel: "Upload request",
    questionPlaceholder: "Please upload the file you would like to share.",
    title: "File upload",
    validation: {
      ...NO_SPECIAL_VALIDATION,
      fileTypes: true,
    },
  },
  location: {
    answerLabel: "Location",
    answerPlaceholder: "A place name, address, or shared coordinates",
    description: "Collect a named location or browser-provided coordinates.",
    fixedInputType: "text",
    questionLabel: "Location question",
    questionPlaceholder: "Which location should we use?",
    title: "Location",
    validation: NO_SPECIAL_VALIDATION,
  },
  number: {
    answerLabel: "Number",
    answerPlaceholder: "Enter a numeric value",
    description: "Collect a whole or decimal number within optional limits.",
    fixedInputType: "float",
    questionLabel: "Number question",
    questionPlaceholder: "What number should we use?",
    title: "Number",
    validation: {
      ...NO_SPECIAL_VALIDATION,
      numberRange: true,
    },
  },
  phone: {
    answerLabel: "Phone number",
    answerPlaceholder: "+91 98765 43210",
    description: "Collect and automatically validate a reachable phone number.",
    fixedInputType: "phone",
    questionLabel: "Phone question",
    questionPlaceholder: "What phone number should we use?",
    title: "Phone number",
    validation: {
      ...NO_SPECIAL_VALIDATION,
      customPattern: true,
      length: true,
    },
  },
  product: {
    answerLabel: "Selected product",
    answerPlaceholder: "The visitor chooses from active catalog products",
    description: "Collect one or more product selections from a catalog.",
    fixedInputType: "text",
    questionLabel: "Product question",
    questionPlaceholder: "Which product would you like?",
    title: "Product selection",
    validation: NO_SPECIAL_VALIDATION,
  },
  text: {
    answerLabel: "Text answer",
    answerPlaceholder: "The visitor types a response",
    description: "Collect a free-form answer with optional length rules.",
    fixedInputType: null,
    questionLabel: "Question shown to the visitor",
    questionPlaceholder: "What would you like to ask?",
    title: "Question",
    validation: {
      ...NO_SPECIAL_VALIDATION,
      customPattern: true,
      length: true,
    },
  },
  time: {
    answerLabel: "Time",
    answerPlaceholder: "HH:MM",
    description: "Collect and automatically validate a time of day.",
    fixedInputType: "time",
    questionLabel: "Time question",
    questionPlaceholder: "What time would you prefer?",
    title: "Time",
    validation: NO_SPECIAL_VALIDATION,
  },
};

const FIXED_STEP_FAMILIES: Partial<Record<ActionStepType, FlowInputFamily>> = {
  address: "address",
  choice: "choice",
  date: "date",
  date_range: "date_range",
  email: "email",
  file_upload: "file",
  location: "location",
  number: "number",
  phone: "phone",
  product_selection: "product",
  time: "time",
};

const INPUT_TYPE_FAMILIES: Record<ActionStepInputType, FlowInputFamily> = {
  date: "date",
  email: "email",
  float: "number",
  int: "number",
  phone: "phone",
  text: "text",
  time: "time",
};

export function isFlowInputStepType(
  stepType: string,
): stepType is FlowInputStepType {
  return FLOW_INPUT_STEP_TYPES.includes(stepType as FlowInputStepType);
}

export function getFlowInputFamily(
  stepType: string,
  inputType: string | null | undefined,
): FlowInputFamily | null {
  if (!isFlowInputStepType(stepType)) {
    return null;
  }

  const fixedFamily = FIXED_STEP_FAMILIES[stepType];
  if (fixedFamily) {
    return fixedFamily;
  }

  return INPUT_TYPE_FAMILIES[inputType as ActionStepInputType] ?? "text";
}

export function getFlowInputFamilyDefinition(
  stepType: string,
  inputType: string | null | undefined,
): FlowInputFamilyDefinition | null {
  const family = getFlowInputFamily(stepType, inputType);

  return family
    ? {
        family,
        ...FAMILY_DEFINITIONS[family],
      }
    : null;
}

export function getFlowInputType(
  stepType: string,
  inputType: string | null | undefined,
): ActionStepInputType {
  if (allowsFlowAnswerFormatSelection(stepType)) {
    return FLOW_ANSWER_FORMATS.some((format) => format.value === inputType)
      ? (inputType as ActionStepInputType)
      : "text";
  }

  const definition = getFlowInputFamilyDefinition(stepType, inputType);

  if (definition?.fixedInputType) {
    return definition.fixedInputType;
  }

  return "text";
}

export function allowsFlowAnswerFormatSelection(stepType: string) {
  return stepType === "collect_input";
}
