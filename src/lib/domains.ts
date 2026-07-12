export const DOMAIN_TYPES = ["subdomain", "custom"] as const;
export const DOMAIN_STATUSES = [
  "pending",
  "active",
  "disabled",
  "failed_verification",
] as const;
export const DOMAIN_CONTEXT_KINDS = [
  "central",
  "company_subdomain",
  "custom_domain",
  "unknown",
] as const;

export type DomainType = (typeof DOMAIN_TYPES)[number];
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];
export type DomainContextKind = (typeof DOMAIN_CONTEXT_KINDS)[number];

export type KnownCompanyDomain = {
  companyId: number;
  domainType: DomainType;
  hostname: string;
  id: number;
  status: DomainStatus;
};

export type DomainResolutionInput = {
  centralHost: string;
  host: string | null | undefined;
  knownDomains?: KnownCompanyDomain[];
  rootDomain: string;
};

export type DomainResolution =
  | {
      companyId: null;
      hostname: string | null;
      kind: "central";
      matchedDomainId: null;
      reason: "central_host";
      subdomain: null;
    }
  | {
      companyId: number;
      hostname: string;
      kind: "company_subdomain" | "custom_domain";
      matchedDomainId: number;
      reason: "active_domain";
      subdomain: string | null;
    }
  | {
      companyId: null;
      hostname: string | null;
      kind: "unknown";
      matchedDomainId: number | null;
      reason:
        | "domain_not_active"
        | "invalid_host"
        | "no_active_domain"
        | "no_active_subdomain"
        | "unknown_host";
      subdomain: string | null;
    };

const CENTRAL_ADMIN_PREFIXES = [
  "/account-disabled",
  "/platform",
  "/profile",
  "/projects",
  "/team",
] as const;

const AUTH_PATHS = [
  "/forgot-password",
  "/invite/accept",
  "/reset-password",
  "/sign-in",
  "/sign-up",
] as const;

export function normalizeHostname(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const raw = value.trim().toLowerCase();
  if (!raw) {
    return null;
  }

  const withoutProtocol = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const withoutPath = withoutProtocol.split(/[/?#]/)[0] ?? "";
  const withoutPort = withoutPath.replace(/:\d+$/, "");
  const hostname = withoutPort.replace(/\.$/, "");

  if (!hostname || hostname.includes("..") || hostname.includes(" ")) {
    return null;
  }

  return hostname;
}

export function resolveDomainContext(
  input: DomainResolutionInput,
): DomainResolution {
  const hostname = normalizeHostname(input.host);
  if (!hostname) {
    return {
      companyId: null,
      hostname: null,
      kind: "unknown",
      matchedDomainId: null,
      reason: "invalid_host",
      subdomain: null,
    };
  }

  const centralHost = normalizeHostname(input.centralHost);
  if (centralHost && hostname === centralHost) {
    return {
      companyId: null,
      hostname,
      kind: "central",
      matchedDomainId: null,
      reason: "central_host",
      subdomain: null,
    };
  }

  const matchedDomain = input.knownDomains
    ?.map((domain) => ({
      ...domain,
      normalizedHostname: normalizeHostname(domain.hostname),
    }))
    .find((domain) => domain.normalizedHostname === hostname);

  if (matchedDomain) {
    if (matchedDomain.status !== "active") {
      return {
        companyId: null,
        hostname,
        kind: "unknown",
        matchedDomainId: matchedDomain.id,
        reason: "domain_not_active",
        subdomain: getSubdomain(hostname, input.rootDomain),
      };
    }

    return {
      companyId: matchedDomain.companyId,
      hostname,
      kind:
        matchedDomain.domainType === "subdomain"
          ? "company_subdomain"
          : "custom_domain",
      matchedDomainId: matchedDomain.id,
      reason: "active_domain",
      subdomain:
        matchedDomain.domainType === "subdomain"
          ? getSubdomain(hostname, input.rootDomain)
          : null,
    };
  }

  const subdomain = getSubdomain(hostname, input.rootDomain);
  if (subdomain) {
    return {
      companyId: null,
      hostname,
      kind: "unknown",
      matchedDomainId: null,
      reason: "no_active_subdomain",
      subdomain,
    };
  }

  return {
    companyId: null,
    hostname,
    kind: "unknown",
    matchedDomainId: null,
    reason: "unknown_host",
    subdomain: null,
  };
}

export function isCentralAdminPath(pathname: string) {
  return CENTRAL_ADMIN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isAuthPath(pathname: string) {
  return AUTH_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function isAdminSurfaceAllowedOnDomain(input: {
  pathname: string;
  resolution: DomainResolution;
}) {
  if (!isCentralAdminPath(input.pathname) && !isAuthPath(input.pathname)) {
    return true;
  }

  return input.resolution.kind === "central";
}

function getSubdomain(hostname: string, rootDomain: string) {
  const normalizedRoot = normalizeHostname(rootDomain);
  if (!normalizedRoot || hostname === normalizedRoot) {
    return null;
  }

  const suffix = `.${normalizedRoot}`;
  if (!hostname.endsWith(suffix)) {
    return null;
  }

  const subdomain = hostname.slice(0, -suffix.length);
  return subdomain && !subdomain.includes(".") ? subdomain : null;
}
