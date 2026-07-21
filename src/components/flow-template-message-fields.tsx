"use client";

import { MessageSquareText } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export function FlowTemplateMessageFields({
  body,
  category,
  language,
  name,
  status,
  variables,
}: {
  body: string;
  category: string;
  language: string;
  name: string;
  status: string;
  variables: string[];
}) {
  return (
    <section className="space-y-4 rounded-md border bg-gray-50/50 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-700">
          <MessageSquareText className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">Approved template</p>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            Send a provider-approved message when a regular reply is not
            available.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label
          className="text-sm font-medium"
          htmlFor="canvas-whatsapp-template-name"
        >
          Template name
        </label>
        <input
          id="canvas-whatsapp-template-name"
          name="whatsappTemplateName"
          defaultValue={name}
          placeholder="appointment_reminder"
          className="flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <div className="space-y-2">
        <label
          className="text-sm font-medium"
          htmlFor="canvas-whatsapp-template-body"
        >
          Message preview
        </label>
        <textarea
          id="canvas-whatsapp-template-body"
          name="whatsappTemplateBody"
          rows={4}
          maxLength={1024}
          defaultValue={body}
          placeholder="Hello {{1}}, your appointment is confirmed for {{2}}."
          className="flex min-h-24 w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm leading-6 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p className="text-xs leading-5 text-muted-foreground">
          Use the exact approved provider message, including numbered
          placeholders.
        </p>
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="template-delivery" className="rounded-md border">
          <AccordionTrigger className="px-3 hover:no-underline">
            <span className="text-left">
              <span className="block text-sm font-medium">
                Delivery details
              </span>
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                Language, category, approval, and collected values
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 border-t px-3 pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-whatsapp-template-language"
                >
                  Language code
                </label>
                <input
                  id="canvas-whatsapp-template-language"
                  name="whatsappTemplateLanguage"
                  defaultValue={language || "en_US"}
                  placeholder="en_US"
                  className="flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="canvas-whatsapp-template-category"
                >
                  Category
                </label>
                <select
                  id="canvas-whatsapp-template-category"
                  name="whatsappTemplateCategory"
                  defaultValue={category}
                  className="flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <option value="utility">Utility</option>
                  <option value="marketing">Marketing</option>
                  <option value="authentication">Authentication</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="canvas-whatsapp-template-status"
              >
                Approval status
              </label>
              <select
                id="canvas-whatsapp-template-status"
                name="whatsappTemplateStatus"
                defaultValue={status}
                className="flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <option value="draft">Draft</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="canvas-whatsapp-template-variables"
              >
                Values used in the message
              </label>
              <textarea
                id="canvas-whatsapp-template-variables"
                name="whatsappTemplateVariables"
                rows={4}
                defaultValue={variables.join("\n")}
                placeholder={"{{guestName}}\n{{preferredDate}}"}
                className="flex min-h-20 w-full resize-y rounded-md border border-input bg-white px-3 py-2 text-sm leading-6 shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
              <p className="text-xs leading-5 text-muted-foreground">
                Add one collected field per line in the same order as the
                numbered placeholders.
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
