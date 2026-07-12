import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const rootDir = process.cwd();
const outputDir = path.join(rootDir, ".next", "domain-resolution-test");
const compiledFile = path.join(outputDir, "domains.js");
const tscBin = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
const require = createRequire(import.meta.url);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

rmSync(outputDir, { force: true, recursive: true });
execFileSync(
  process.execPath,
  [
    tscBin,
    "src/lib/domains.ts",
    "--target",
    "ES2022",
    "--module",
    "CommonJS",
    "--moduleResolution",
    "Node",
    "--outDir",
    outputDir,
    "--rootDir",
    "src/lib",
    "--skipLibCheck",
    "--strict",
    "--esModuleInterop",
  ],
  { stdio: "inherit" },
);

const {
  isAdminSurfaceAllowedOnDomain,
  normalizeHostname,
  resolveDomainContext,
} = require(compiledFile);

const knownDomains = [
  {
    companyId: 10,
    domainType: "subdomain",
    hostname: "salon.leigia.com",
    id: 1,
    status: "active",
  },
  {
    companyId: 11,
    domainType: "custom",
    hostname: "chat.customer.com",
    id: 2,
    status: "active",
  },
  {
    companyId: 12,
    domainType: "subdomain",
    hostname: "disabled.leigia.com",
    id: 3,
    status: "disabled",
  },
];

assert(
  normalizeHostname("https://Salon.Leigia.com:443/projects?a=1") ===
    "salon.leigia.com",
  "Expected hostname normalization to remove protocol, port and path.",
);

const central = resolveDomainContext({
  centralHost: "app.leigia.com",
  host: "app.leigia.com",
  knownDomains,
  rootDomain: "leigia.com",
});
assert(central.kind === "central", "Expected central host to resolve.");
assert(
  isAdminSurfaceAllowedOnDomain({
    pathname: "/projects",
    resolution: central,
  }),
  "Expected central host to allow product app routes.",
);

const subdomain = resolveDomainContext({
  centralHost: "app.leigia.com",
  host: "salon.leigia.com",
  knownDomains,
  rootDomain: "leigia.com",
});
assert(
  subdomain.kind === "company_subdomain" && subdomain.companyId === 10,
  "Expected active company subdomain to resolve to company.",
);
assert(
  !isAdminSurfaceAllowedOnDomain({
    pathname: "/projects",
    resolution: subdomain,
  }),
  "Expected company subdomain to block product app routes.",
);
assert(
  isAdminSurfaceAllowedOnDomain({
    pathname: "/public/chat",
    resolution: subdomain,
  }),
  "Expected company subdomain to allow future public surfaces.",
);

const customDomain = resolveDomainContext({
  centralHost: "app.leigia.com",
  host: "chat.customer.com",
  knownDomains,
  rootDomain: "leigia.com",
});
assert(
  customDomain.kind === "custom_domain" && customDomain.companyId === 11,
  "Expected active custom domain to resolve to company.",
);
assert(
  !isAdminSurfaceAllowedOnDomain({
    pathname: "/sign-in",
    resolution: customDomain,
  }),
  "Expected custom domain to block auth routes while deferred.",
);

const disabled = resolveDomainContext({
  centralHost: "app.leigia.com",
  host: "disabled.leigia.com",
  knownDomains,
  rootDomain: "leigia.com",
});
assert(
  disabled.kind === "unknown" && disabled.reason === "domain_not_active",
  "Expected disabled domain to avoid tenant resolution.",
);

const unknownSubdomain = resolveDomainContext({
  centralHost: "app.leigia.com",
  host: "unknown.leigia.com",
  knownDomains,
  rootDomain: "leigia.com",
});
assert(
  unknownSubdomain.kind === "unknown" &&
    unknownSubdomain.reason === "no_active_subdomain",
  "Expected unknown platform subdomain to avoid tenant resolution.",
);

const unknownExternal = resolveDomainContext({
  centralHost: "app.leigia.com",
  host: "other.example.com",
  knownDomains,
  rootDomain: "leigia.com",
});
assert(
  unknownExternal.kind === "unknown" &&
    unknownExternal.reason === "unknown_host",
  "Expected unrelated host to avoid tenant resolution.",
);

console.log("Domain resolution checks passed.");
