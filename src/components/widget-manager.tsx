"use client";

import {
  Eye,
  KeyRound,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Save,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/ui/confirm-action-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type WidgetManagerProps = {
  projectId: number;
  appBaseUrl: string;
  hasActiveToken: boolean;
  hasWidgetConfig: boolean;
  initialAllowedDomains: string[];
};

export function WidgetManager({
  projectId,
  appBaseUrl,
  hasActiveToken,
  hasWidgetConfig,
  initialAllowedDomains,
}: WidgetManagerProps) {
  const [token, setToken] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSavingDomains, setIsSavingDomains] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isTokenActive, setIsTokenActive] = useState(hasActiveToken);
  const [allowedDomainsInput, setAllowedDomainsInput] = useState(
    initialAllowedDomains.join("\n"),
  );
  const [savedDomains, setSavedDomains] = useState(initialAllowedDomains);
  const previewRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const closePreview = (event: MessageEvent) => {
      if (
        event.source === previewRef.current?.contentWindow &&
        event.data?.type === "RAG_WIDGET_CLOSE"
      ) {
        setIsPreviewOpen(false);
      }
    };

    window.addEventListener("message", closePreview);
    return () => window.removeEventListener("message", closePreview);
  }, []);

  const embedSnippet = useMemo(() => {
    if (!token) {
      return "";
    }
    return `<script src="${appBaseUrl}/widget.js" data-token="${token}" data-base-url="${appBaseUrl}"></script>`;
  }, [appBaseUrl, token]);

  const generateToken = async () => {
    try {
      setIsGenerating(true);
      setError("");

      const res = await fetch("/api/projects/widget-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });

      if (!res.ok) {
        throw new Error("Failed to generate token");
      }

      const data = (await res.json()) as { token: string };
      setToken(data.token);
      setIsPreviewOpen(false);
      setIsTokenActive(true);
      setSuccess("Widget token ready. Copy and store it safely.");
    } catch {
      setError("Could not generate widget token.");
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleTokenStatus = async () => {
    try {
      setIsUpdatingStatus(true);
      setError("");
      setSuccess("");

      const res = await fetch("/api/projects/widget-token", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          isActive: !isTokenActive,
        }),
      });

      const data = (await res.json()) as { isActive?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Failed to update widget token status");
      }

      const active = Boolean(data.isActive);
      setIsTokenActive(active);
      setSuccess(active ? "Widget token enabled." : "Widget token disabled.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to update token status.",
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const saveAllowedDomains = async () => {
    try {
      setIsSavingDomains(true);
      setError("");
      setSuccess("");

      const res = await fetch("/api/projects/widget-token", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          allowedDomains: allowedDomainsInput,
        }),
      });

      const data = (await res.json()) as {
        allowedDomains?: string[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Failed to save allowed domains");
      }

      const normalized = data.allowedDomains ?? [];
      setSavedDomains(normalized);
      setAllowedDomainsInput(normalized.join("\n"));
      setSuccess("Allowed domains saved.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to save allowed domains.",
      );
    } finally {
      setIsSavingDomains(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Generate a deployable widget token for this project and embed it on any
        third-party website.
      </p>

      {isTokenActive ? (
        <ConfirmActionButton
          onConfirm={generateToken}
          disabled={isGenerating}
          pending={isGenerating}
          confirmation={{
            title: "Rotate the widget token?",
            description:
              "Existing widget embeds using the current token will stop working until they are updated.",
            confirmLabel: "Rotate Token",
            confirmVariant: "destructive",
          }}
          pendingContent={
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Generating...
            </>
          }
        >
          <RefreshCw className="h-4 w-4" />
          Rotate Widget Token
        </ConfirmActionButton>
      ) : (
        <Button onClick={generateToken} disabled={isGenerating}>
          {isGenerating ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          {isGenerating ? "Generating..." : "Generate Widget Token"}
        </Button>
      )}

      {isTokenActive ? (
        <ConfirmActionButton
          variant="outline"
          onConfirm={toggleTokenStatus}
          disabled={(!hasWidgetConfig && !token) || isUpdatingStatus}
          pending={isUpdatingStatus}
          confirmation={{
            title: "Disable the widget token?",
            description:
              "All widget embeds using this token will become unavailable until it is enabled again.",
            confirmLabel: "Disable Token",
            confirmVariant: "destructive",
          }}
          pendingContent={
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Updating...
            </>
          }
        >
          <PauseCircle className="h-4 w-4" />
          Disable Widget Token
        </ConfirmActionButton>
      ) : (
        <Button
          variant="outline"
          onClick={toggleTokenStatus}
          disabled={(!hasWidgetConfig && !token) || isUpdatingStatus}
        >
          {isUpdatingStatus ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4" />
          )}
          {isUpdatingStatus ? "Updating..." : "Enable Widget Token"}
        </Button>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
          {success}
        </p>
      )}

      <div className="space-y-2">
        <Label>Allowed Domains</Label>
        <p className="text-xs text-muted-foreground">
          Add one or multiple domains. Use one per line or comma-separated.
          Leave empty to allow all domains.
        </p>
        <textarea
          className="w-full min-h-24 rounded-md border bg-background p-2 text-sm"
          placeholder={"example.com\nwww.example.com"}
          value={allowedDomainsInput}
          onChange={(e) => setAllowedDomainsInput(e.target.value)}
          disabled={!isTokenActive || isSavingDomains}
        />
        <Button
          variant="outline"
          onClick={saveAllowedDomains}
          disabled={!isTokenActive || isSavingDomains}
        >
          {isSavingDomains ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {isSavingDomains ? "Saving..." : "Save Allowed Domains"}
        </Button>
        {savedDomains.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Current allowlist: {savedDomains.join(", ")}
          </div>
        )}
      </div>

      {token && (
        <div className="space-y-2">
          <Label>Widget Token (shown once)</Label>
          <Input value={token} readOnly />
          <Label>Embed Snippet</Label>
          <textarea
            className="w-full min-h-24 rounded-md border bg-background p-2 text-sm"
            value={embedSnippet}
            readOnly
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsPreviewOpen((current) => !current)}
          >
            <Eye className="h-4 w-4" />
            {isPreviewOpen ? "Close Widget Preview" : "Open Widget Preview"}
          </Button>
          {isPreviewOpen && (
            <iframe
              ref={previewRef}
              className="h-[560px] max-h-[70vh] w-full rounded-lg border bg-background"
              src={`/widget/embed?token=${encodeURIComponent(token)}`}
              title="Widget conversation preview"
            />
          )}
        </div>
      )}
    </div>
  );
}
