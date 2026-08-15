"use client";

import { createContext, type ReactNode, useContext } from "react";

const FormPendingContext = createContext(false);

export function FormPendingProvider({
  children,
  pending,
}: {
  children: ReactNode;
  pending: boolean;
}) {
  return (
    <FormPendingContext.Provider value={pending}>
      {children}
    </FormPendingContext.Provider>
  );
}

export function useActionStateFormPending() {
  return useContext(FormPendingContext);
}
