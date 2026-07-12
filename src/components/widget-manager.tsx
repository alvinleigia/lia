"use client";

import {
  KeyRound,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Save,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isTokenActive, setIsTokenActive] = useState(hasActiveToken);
  const [allowedDomainsInput, setAllowedDomainsInput] = useState(
    initialAllowedDomains.join("\n"),
  );
  const [savedDomains, setSavedDomains] = useState(initialAllowedDomains);

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

      <Button onClick={generateToken} disabled={isGenerating}>
        {isGenerating ? (
          <RefreshCw className="h-4 w-4 animate-spin" />
        ) : isTokenActive ? (
          <RefreshCw className="h-4 w-4" />
        ) : (
          <KeyRound className="h-4 w-4" />
        )}
        {isGenerating
          ? "Generating..."
          : isTokenActive
            ? "Rotate Widget Token"
            : "Generate Widget Token"}
      </Button>

      <Button
        variant="outline"
        onClick={toggleTokenStatus}
        disabled={(!hasWidgetConfig && !token) || isUpdatingStatus}
      >
        {isUpdatingStatus ? (
          <RefreshCw className="h-4 w-4 animate-spin" />
        ) : isTokenActive ? (
          <PauseCircle className="h-4 w-4" />
        ) : (
          <PlayCircle className="h-4 w-4" />
        )}
        {isUpdatingStatus
          ? "Updating..."
          : isTokenActive
            ? "Disable Widget Token"
            : "Enable Widget Token"}
      </Button>

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
        </div>
      )}
    </div>
  );
}
