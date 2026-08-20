"use client";

import {
  type ComponentProps,
  createContext,
  type Key,
  type ReactNode,
  useActionState,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { toast } from "sonner";
import type { ActionFormState } from "@/lib/action-form-state";
import { cn } from "@/lib/utils";
import { FormPendingProvider } from "./form-pending-context";

type ActionStateFormAction = (
  previousState: ActionFormState,
  formData: FormData,
) => Promise<ActionFormState>;

type ActionStateFormProps = Omit<ComponentProps<"form">, "action" | "ref"> & {
  action: ActionStateFormAction;
  children: ReactNode;
  preserveScroll?: boolean;
  resetKey?: Key;
};

const FormStateContext = createContext<ActionFormState>({});

type RestorableControl =
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement;

type ControlSnapshot = {
  checked?: boolean;
  key: string;
  occurrence: number;
  selectedValues?: string[];
  value: string;
};

function getControlKey(control: RestorableControl) {
  const type =
    control instanceof HTMLInputElement ? control.type : control.tagName;
  return `${control.name}:${type}`;
}

function getRestorableControls(form: HTMLFormElement) {
  return Array.from(form.elements).filter(
    (element): element is RestorableControl => {
      if (
        !(
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement
        ) ||
        !element.name
      ) {
        return false;
      }

      return !(
        element instanceof HTMLInputElement &&
        ["button", "file", "image", "reset", "submit"].includes(element.type)
      );
    },
  );
}

function captureFormControls(form: HTMLFormElement) {
  const occurrences = new Map<string, number>();

  return getRestorableControls(form).map((control): ControlSnapshot => {
    const key = getControlKey(control);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);

    return {
      checked:
        control instanceof HTMLInputElement &&
        ["checkbox", "radio"].includes(control.type)
          ? control.checked
          : undefined,
      key,
      occurrence,
      selectedValues:
        control instanceof HTMLSelectElement && control.multiple
          ? Array.from(control.selectedOptions, (option) => option.value)
          : undefined,
      value: control.value,
    };
  });
}

function restoreFormControls(
  form: HTMLFormElement,
  snapshot: ControlSnapshot[],
) {
  const controls = new Map<string, RestorableControl[]>();

  for (const control of getRestorableControls(form)) {
    const key = getControlKey(control);
    controls.set(key, [...(controls.get(key) ?? []), control]);
  }

  for (const saved of snapshot) {
    const control = controls.get(saved.key)?.[saved.occurrence];
    if (!control) {
      continue;
    }

    if (
      control instanceof HTMLInputElement &&
      ["checkbox", "radio"].includes(control.type)
    ) {
      control.checked = saved.checked === true;
      continue;
    }

    if (
      control instanceof HTMLSelectElement &&
      control.multiple &&
      saved.selectedValues
    ) {
      const selectedValues = new Set(saved.selectedValues);
      for (const option of control.options) {
        option.selected = selectedValues.has(option.value);
      }
      continue;
    }

    control.value = saved.value;
  }
}

export function ActionStateForm({ resetKey, ...props }: ActionStateFormProps) {
  return <StatefulActionStateForm key={resetKey} {...props} />;
}

function StatefulActionStateForm({
  action,
  children,
  onSubmit,
  preserveScroll = true,
  ...props
}: Omit<ActionStateFormProps, "resetKey">) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const snapshotRef = useRef<ControlSnapshot[]>([]);
  const handleSubmit: NonNullable<ComponentProps<"form">["onSubmit"]> = (
    event,
  ) => {
    snapshotRef.current = captureFormControls(event.currentTarget);
    onSubmit?.(event);
  };

  useLayoutEffect(() => {
    if (state.error && formRef.current) {
      restoreFormControls(formRef.current, snapshotRef.current);
    }
  }, [state]);

  return (
    <FormStateContext.Provider value={state}>
      <FormPendingProvider pending={pending}>
        <form
          action={formAction}
          data-preserve-scroll={preserveScroll ? "true" : undefined}
          onSubmit={handleSubmit}
          ref={formRef}
          {...props}
        >
          {children}
        </form>
      </FormPendingProvider>
    </FormStateContext.Provider>
  );
}

export function ActionFormError({ className }: { className?: string }) {
  const { error } = useContext(FormStateContext);

  return <FormErrorMessage className={className} error={error} />;
}

export function ActionFormSuccessToast() {
  const state = useContext(FormStateContext);

  useEffect(() => {
    if (state.success) {
      toast.success(state.success);
    }
  }, [state]);

  return null;
}

export function FormErrorMessage({
  className,
  error,
}: {
  className?: string;
  error?: string | null;
}) {
  if (!error) {
    return null;
  }

  return (
    <p
      role="alert"
      aria-live="polite"
      className={cn(
        "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700",
        className,
      )}
    >
      {error}
    </p>
  );
}
