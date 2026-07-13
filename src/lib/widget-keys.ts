import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db-config";
import {
  companies,
  projects,
  projectWidgetKeys,
  workspaces,
} from "@/lib/db-schema";

function sha256Hex(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function generatePlainToken() {
  return `ws_${crypto.randomBytes(24).toString("base64url")}`;
}

export async function createOrRotateProjectWidgetToken(projectId: number) {
  const plainToken = generatePlainToken();
  const tokenHash = sha256Hex(plainToken);

  await db
    .insert(projectWidgetKeys)
    .values({
      projectId,
      tokenHash,
      isActive: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: projectWidgetKeys.projectId,
      set: {
        tokenHash,
        isActive: true,
        updatedAt: new Date(),
      },
    });

  return plainToken;
}

export async function getProjectWidgetConfig(projectId: number) {
  const [config] = await db
    .select()
    .from(projectWidgetKeys)
    .where(eq(projectWidgetKeys.projectId, projectId))
    .limit(1);

  return config ?? null;
}

export function normalizeDomainsInput(value: string) {
  const unique = new Set<string>();
  const parts = value
    .split(/[\n,]/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  for (const item of parts) {
    let normalized = item.replace(/\/+$/, "");
    try {
      if (normalized.includes("://")) {
        const url = new URL(normalized);
        if (url.protocol === "http:" || url.protocol === "https:") {
          normalized = url.origin.toLowerCase();
        } else {
          continue;
        }
      }
    } catch {
      // keep raw host[:port] if URL parsing fails
    }

    if (normalized) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

export async function updateProjectWidgetAllowedDomains(
  projectId: number,
  domains: string[],
) {
  const csv = domains.length > 0 ? domains.join(",") : null;
  await db
    .update(projectWidgetKeys)
    .set({
      allowedDomains: csv,
      updatedAt: new Date(),
    })
    .where(eq(projectWidgetKeys.projectId, projectId));
}

export async function updateProjectWidgetTokenStatus(
  projectId: number,
  isActive: boolean,
) {
  await db
    .update(projectWidgetKeys)
    .set({
      isActive,
      updatedAt: new Date(),
    })
    .where(eq(projectWidgetKeys.projectId, projectId));
}

export async function resolveProjectIdFromWidgetToken(token: string) {
  const tokenHash = sha256Hex(token);
  const [key] = await db
    .select({
      projectId: projectWidgetKeys.projectId,
      allowedDomains: projectWidgetKeys.allowedDomains,
    })
    .from(projectWidgetKeys)
    .where(
      and(
        eq(projectWidgetKeys.tokenHash, tokenHash),
        eq(projectWidgetKeys.isActive, true),
      ),
    )
    .limit(1);

  return key ?? null;
}

export async function resolveWidgetTokenAccess(token: string) {
  const tokenHash = sha256Hex(token);
  const [key] = await db
    .select({
      projectId: projectWidgetKeys.projectId,
      allowedDomains: projectWidgetKeys.allowedDomains,
      isActive: projectWidgetKeys.isActive,
    })
    .from(projectWidgetKeys)
    .where(eq(projectWidgetKeys.tokenHash, tokenHash))
    .limit(1);

  if (!key) {
    return null;
  }

  const [project] = await db
    .select({
      isArchived: projects.isArchived,
      projectAiSettings: projects.aiSettings,
      projectName: projects.name,
      companyName: companies.name,
      companyStatus: companies.status,
    })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .innerJoin(companies, eq(companies.id, workspaces.companyId))
    .where(eq(projects.id, key.projectId))
    .limit(1);

  return {
    projectId: key.projectId,
    allowedDomains: key.allowedDomains,
    companyName: project?.companyName ?? null,
    isActive: key.isActive,
    isArchived: Boolean(project?.isArchived),
    isTenantActive: project?.companyStatus === "active",
    projectAiSettings: project?.projectAiSettings ?? {},
    projectName: project?.projectName ?? null,
  };
}

export async function resolveWidgetTokenAccessForRequest(input: {
  headers: Headers;
  token: string;
}) {
  const widgetAccess = await resolveWidgetTokenAccess(input.token);

  if (
    !widgetAccess ||
    !widgetAccess.isActive ||
    !widgetAccess.isTenantActive ||
    widgetAccess.isArchived
  ) {
    return {
      message: "Widget is unavailable.",
      status: 403,
      widgetAccess: null,
    } as const;
  }

  const requestOrigin = extractRequestOrigin(input.headers);
  if (!isOriginAllowed(requestOrigin, widgetAccess.allowedDomains)) {
    return {
      message: "Origin not allowed.",
      status: 403,
      widgetAccess: null,
    } as const;
  }

  return {
    message: null,
    status: null,
    widgetAccess,
  } as const;
}

function parseOrigin(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function splitHostPort(value: string) {
  const clean = value.trim().toLowerCase();
  const colonCount = (clean.match(/:/g) ?? []).length;

  if (colonCount === 0) {
    return { host: clean, port: null as string | null };
  }

  if (colonCount === 1) {
    const [host, port] = clean.split(":");
    if (!host) {
      return { host: "", port: null };
    }
    if (port && /^\d+$/.test(port)) {
      return { host, port };
    }
    return { host: clean, port: null };
  }

  return { host: clean, port: null };
}

function matchesDomainRule(requestUrl: URL, rule: string) {
  const normalizedRule = rule.trim().toLowerCase().replace(/\/+$/, "");
  if (!normalizedRule) {
    return false;
  }

  if (normalizedRule.includes("://")) {
    const parsedRule = parseOrigin(normalizedRule);
    return parsedRule
      ? parsedRule.origin.toLowerCase() === requestUrl.origin.toLowerCase()
      : false;
  }

  const { host, port } = splitHostPort(normalizedRule);
  if (!host) {
    return false;
  }

  const requestedHost = requestUrl.hostname.toLowerCase();
  const requestedPort =
    requestUrl.port || (requestUrl.protocol === "https:" ? "443" : "80");

  const hostMatches = host.startsWith("*.")
    ? requestedHost === host.slice(2) ||
      requestedHost.endsWith(`.${host.slice(2)}`)
    : requestedHost === host;

  if (!hostMatches) {
    return false;
  }

  if (!port) {
    return true;
  }

  return requestedPort === port;
}

export function extractRequestOrigin(headers: Headers) {
  const originHeader = headers.get("origin");
  const parsedOrigin = parseOrigin(originHeader);
  if (parsedOrigin) {
    return parsedOrigin;
  }

  const refererHeader = headers.get("referer");
  const parsedReferer = parseOrigin(refererHeader);
  if (parsedReferer) {
    return new URL(parsedReferer.origin);
  }

  return null;
}

export function isOriginAllowed(
  requestOrigin: URL | null,
  allowedDomains: string | null,
) {
  if (!allowedDomains || allowedDomains.trim() === "") {
    return true;
  }

  if (!requestOrigin) {
    return false;
  }

  const allowed = normalizeDomainsInput(allowedDomains);
  return allowed.some((rule) => matchesDomainRule(requestOrigin, rule));
}
