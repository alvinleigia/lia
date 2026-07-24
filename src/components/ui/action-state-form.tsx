"use client";

import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useActionState,
  useContext,
} from "react";
import type { ActionFormState } from "@/lib/action-form-state";
import { cn } from "@/lib/utils";

type ActionStateFormAction = (
  previousState: ActionFormState,
  formData: FormData,
) => Promise<ActionFormState>;

type ActionStateFormProps = Omit<ComponentProps<"form">, "action"> & {
  action: ActionStateFormAction;
  children: ReactNode;
};

const FormStateContext = createContext<ActionFormState>({});

export function ActionStateForm({
  action,
  children,
  ...props
}: ActionStateFormProps) {
  const [state, formAction] = useActionState(action, {});

  return (
    <FormStateContext.Provider value={state}>
      <form action={formAction} {...props}>
        {children}
      </form>
    </FormStateContext.Provider>
  );
}

export function ActionFormError({ className }: { className?: string }) {
  const { error } = useContext(FormStateContext);

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
