"use client";

import { Loader2 } from "lucide-react";
import { type ComponentProps, type ReactNode, useRef } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useActionStateFormPending } from "@/components/ui/form-pending-context";

type ButtonVariant = ComponentProps<typeof Button>["variant"];

export type ActionConfirmation = {
  cancelLabel?: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  description: string;
  title: string;
};

type ConfirmActionButtonProps = Omit<
  ComponentProps<typeof Button>,
  "onClick" | "type"
> & {
  confirmation: ActionConfirmation;
  onConfirm: () => void;
  pending?: boolean;
  pendingContent?: ReactNode;
};

export function ConfirmActionButton({
  children,
  confirmation,
  disabled,
  onConfirm,
  pending = false,
  pendingContent,
  variant,
  ...props
}: ConfirmActionButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          {...props}
          type="button"
          variant={variant}
          disabled={disabled || pending}
          aria-busy={pending}
        >
          {pending
            ? (pendingContent ?? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Please wait...
                </>
              ))
            : children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirmation.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {confirmation.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              type="button"
              variant={confirmation.confirmVariant ?? variant}
              onClick={onConfirm}
            >
              {confirmation.confirmLabel}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ConfirmSubmitButtonProps = Omit<
  ConfirmActionButtonProps,
  "onConfirm" | "pending"
>;

export function ConfirmSubmitButton({
  confirmation,
  name,
  pendingContent,
  value,
  ...props
}: ConfirmSubmitButtonProps) {
  const submitterRef = useRef<HTMLButtonElement>(null);
  const { pending: nativeFormPending } = useFormStatus();
  const actionStateFormPending = useActionStateFormPending();
  const pending = nativeFormPending || actionStateFormPending;

  function submitForm() {
    const submitter = submitterRef.current;
    submitter?.form?.requestSubmit(submitter);
  }

  return (
    <>
      <ConfirmActionButton
        {...props}
        confirmation={confirmation}
        onConfirm={submitForm}
        pending={pending}
        pendingContent={pendingContent}
      />
      <button
        ref={submitterRef}
        type="submit"
        name={name}
        value={value}
        form={props.form}
        hidden
        aria-hidden="true"
        tabIndex={-1}
      />
    </>
  );
}
