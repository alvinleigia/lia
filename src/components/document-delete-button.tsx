"use client";

import { Trash2 } from "lucide-react";
import {
  deleteAllDocumentsFromUploadAction,
  deleteSourceDocumentFromUploadAction,
} from "@/app/upload/actions";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FormSubmitButton } from "@/components/ui/form-submit-button";

type DocumentDeleteButtonProps = {
  documentTitle?: string;
  projectId: number;
  projectName: string;
  sourceDocumentId?: number;
};

export function DocumentDeleteButton({
  documentTitle,
  projectId,
  projectName,
  sourceDocumentId,
}: DocumentDeleteButtonProps) {
  const deleteAll = sourceDocumentId === undefined;
  const action = deleteAll
    ? deleteAllDocumentsFromUploadAction
    : deleteSourceDocumentFromUploadAction;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive">
          <Trash2 className="h-4 w-4" />
          {deleteAll ? "Delete All Documents in This Project" : "Delete"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deleteAll
              ? "Delete all project documents?"
              : "Delete this document?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deleteAll
              ? "This permanently deletes every document and indexed chunk from " +
                projectName +
                "."
              : "This permanently deletes " +
                (documentTitle ?? "this document") +
                " and its indexed chunks from " +
                projectName +
                "."}{" "}
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep documents</AlertDialogCancel>
          <form action={action}>
            <input type="hidden" name="projectId" value={projectId} />
            {sourceDocumentId !== undefined && (
              <input
                type="hidden"
                name="sourceDocumentId"
                value={sourceDocumentId}
              />
            )}
            <FormSubmitButton
              className="w-full sm:w-auto"
              label={deleteAll ? "Delete All Documents" : "Delete Document"}
              pendingLabel="Deleting..."
              variant="destructive"
              icon={<Trash2 className="h-4 w-4" />}
            />
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
