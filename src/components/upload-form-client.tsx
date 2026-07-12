"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { processDocumentFile } from "@/app/upload/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type UploadFormClientProps = {
  projectId: number;
  projectName: string;
};

export function UploadFormClient({
  projectId,
  projectName,
}: UploadFormClientProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("document", file);
      formData.append("projectId", String(projectId));

      const result = await processDocumentFile(formData);

      if (result.success) {
        setMessage({
          type: "success",
          text: result.message || "Document processed successfully",
        });
        e.target.value = "";
        setTimeout(() => {
          router.refresh();
        }, 1500);
        router.refresh();
      } else {
        setMessage({
          type: "error",
          text: result.error || "Failed to process document",
        });
      }
    } catch {
      setMessage({
        type: "error",
        text: "An error occurred while processing the document",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          <FileUp className="h-5 w-5" />
          Upload Document to {projectName}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="document-upload">
            Upload PDF, Markdown, or Text File
          </Label>
          <Input
            id="document-upload"
            type="file"
            accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
            onChange={handleFileUpload}
            disabled={isLoading}
            className="mt-2"
          />
        </div>

        {isLoading && (
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-muted-foreground">
              Processing document...
            </span>
          </div>
        )}

        {message && (
          <Alert variant={message.type === "error" ? "destructive" : "default"}>
            <AlertTitle>
              {message.type === "error" ? "Error!" : "Success!"}
            </AlertTitle>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
