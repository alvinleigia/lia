"use client";

import { Building2, Check, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { selectCompanyFromHeaderAction } from "@/app/profile/actions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCompanyRole } from "@/lib/company-roles";

type CompanyOption = {
  id: number;
  name: string;
  role: string;
};

type CompanySelectorModalProps = {
  selectedCompanyId: number;
  selectedCompanyLabel: string;
  companies: CompanyOption[];
};

export function CompanySelectorModal({
  selectedCompanyId,
  selectedCompanyLabel,
  companies,
}: CompanySelectorModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const filteredCompanies = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return companies;
    }

    return companies.filter((company) =>
      company.name.toLowerCase().includes(normalized),
    );
  }, [companies, query]);

  const selectCompany = (companyId: number) => {
    setError("");
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("companyId", String(companyId));
        await selectCompanyFromHeaderAction(formData);
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to select account.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-800 hover:bg-sky-200"
        >
          <Building2 className="h-3.5 w-3.5" />
          Account: {selectedCompanyLabel}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Select an Account</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="text-muted-foreground absolute left-3 top-2.5 h-4 w-4" />
            <Input
              className="pl-9"
              placeholder="Search accounts..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border">
            {filteredCompanies.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                No matching accounts.
              </p>
            ) : (
              <div className="divide-y">
                {filteredCompanies.map((company) => (
                  <button
                    key={company.id}
                    type="button"
                    className="hover:bg-accent flex w-full items-center justify-between p-3 text-left text-sm"
                    onClick={() => selectCompany(company.id)}
                    disabled={isPending}
                  >
                    <div>
                      <p className="font-medium">{company.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatCompanyRole(company.role)}
                      </p>
                    </div>
                    {company.id === selectedCompanyId ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
                        <Check className="h-3 w-3" />
                        Selected
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        Select
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isPending && (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Switching account...
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
