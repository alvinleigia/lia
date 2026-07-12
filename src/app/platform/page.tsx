import { Building2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { writeAuditLog } from "@/lib/audit";
import {
  listTenantCompanies,
  resolvePlatformAdmin,
} from "@/lib/platform-admin";
import { updateTenantStatusAction } from "./actions";

type PlatformPageProps = {
  searchParams: Promise<{
    error?: string;
    updated?: string;
  }>;
};

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "active";

  return (
    <span
      className={`rounded-md border px-2 py-1 text-xs capitalize ${
        isActive
          ? "border-green-200 bg-green-50 text-green-700"
          : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      {status}
    </span>
  );
}

export default async function PlatformPage({
  searchParams,
}: PlatformPageProps) {
  const params = await searchParams;
  const platformUser = await resolvePlatformAdmin().catch(() => null);
  if (!platformUser) {
    notFound();
  }

  const tenants = await listTenantCompanies();
  const activeTenants = tenants.filter(
    ({ company }) => company.status === "active",
  ).length;

  await writeAuditLog({
    user: platformUser,
    action: "platform.tenants_reviewed",
    targetType: "platform",
    metadata: {
      tenantCount: tenants.length,
      activeTenantCount: activeTenants,
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl flex items-center gap-2">
              <ShieldCheck className="h-6 w-6" />
              Platform
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {params.error && (
              <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2">
                {params.error}
              </p>
            )}
            {params.updated === "1" && (
              <p className="text-sm text-green-700 bg-green-50 rounded-md px-3 py-2">
                Tenant updated.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Signed In
                </p>
                <p className="mt-1 font-medium">
                  {platformUser.name ?? platformUser.email}
                </p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Tenants
                </p>
                <p className="mt-1 text-2xl font-semibold">{tenants.length}</p>
              </div>
              <div className="rounded-md border bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Active
                </p>
                <p className="mt-1 text-2xl font-semibold">{activeTenants}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Tenants
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tenants.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tenants have been created yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="py-2 pr-4">Tenant</th>
                      <th className="py-2 pr-4">Owner</th>
                      <th className="py-2 pr-4">Members</th>
                      <th className="py-2 pr-4">Projects</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenants.map(
                      ({ company, owner, memberCount, projectCount }) => (
                        <tr
                          key={company.id}
                          className="border-b align-middle last:border-b-0"
                        >
                          <td className="py-3 pr-4">
                            <Link
                              href={`/platform/companies/${company.id}`}
                              className="font-medium underline-offset-4 hover:underline"
                            >
                              {company.name}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              ID: {company.id}
                            </p>
                          </td>
                          <td className="py-3 pr-4">
                            <p>{owner?.name ?? "No name"}</p>
                            <p className="text-xs text-muted-foreground">
                              {owner?.email ?? "No email"}
                            </p>
                          </td>
                          <td className="py-3 pr-4">{memberCount}</td>
                          <td className="py-3 pr-4">{projectCount}</td>
                          <td className="py-3 pr-4">
                            <StatusBadge status={company.status} />
                          </td>
                          <td className="py-3 pr-4">
                            <form
                              action={updateTenantStatusAction}
                              className="flex justify-end"
                            >
                              <input
                                type="hidden"
                                name="companyId"
                                value={company.id}
                              />
                              <input
                                type="hidden"
                                name="status"
                                value={
                                  company.status === "active"
                                    ? "disabled"
                                    : "active"
                                }
                              />
                              <Button type="submit" variant="outline" size="sm">
                                {company.status === "active"
                                  ? "Disable"
                                  : "Enable"}
                              </Button>
                            </form>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
