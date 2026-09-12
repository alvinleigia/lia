import { z } from "zod";
import type { ConversationalTaskSnapshotV1 } from "@/lib/conversation-contracts";

// Calendar adapters expose this bounded contract; Lia owns matching and selection.
export const appointmentMatchSchema = z.object({
  appointmentRef: z.string().trim().min(1).max(200),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  spoken: z.string().trim().min(1).max(240),
});
export type AppointmentMatch = z.infer<typeof appointmentMatchSchema>;

export function isAppointmentLookup(operationType: string) {
  return ["google_calendar.lookup", "appointment.lookup"].includes(
    operationType,
  );
}

export function isReadOnlyCalendarOperation(input: {
  operationType: string;
  providerType: string;
}) {
  return (
    (input.providerType === "google_calendar" &&
      ["google_calendar.lookup", "google_calendar.availability"].includes(
        input.operationType,
      )) ||
    (["webhook", "n8n_webhook"].includes(input.providerType) &&
      ["appointment.lookup", "appointment.availability"].includes(
        input.operationType,
      ))
  );
}

export function upcomingAppointmentMatches(value: unknown, now = new Date()) {
  const parsed = z
    .object({
      status: z.literal("success"),
      appointments: z.array(appointmentMatchSchema).max(50),
    })
    .safeParse(value);
  if (!parsed.success) return null;
  const appointments = parsed.data.appointments;
  if (
    new Set(appointments.map((item) => item.appointmentRef)).size !==
      appointments.length ||
    appointments.some((item) => Date.parse(item.end) <= Date.parse(item.start))
  )
    return null;
  return appointments
    .filter((item) => Date.parse(item.start) > now.getTime())
    .sort(
      (a, b) =>
        Date.parse(a.start) - Date.parse(b.start) ||
        a.appointmentRef.localeCompare(b.appointmentRef),
    );
}

export function appointmentChoiceOptions(appointments: AppointmentMatch[]) {
  return appointments.map((item, index) => ({
    label: `${index + 1}. ${item.spoken}`.slice(0, 240),
    value: item.appointmentRef,
  }));
}

export function resolveAppointmentChoice(
  appointments: AppointmentMatch[],
  answer: string,
) {
  const text = answer.trim().toLowerCase();
  const ordinal = /^(?:option |appointment |number )?(\d+)$/.exec(text);
  const words = [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
  ];
  const index = ordinal
    ? Number(ordinal[1]) - 1
    : words.indexOf(
        text.replace(/^the /, "").replace(/ (one|appointment)$/, ""),
      );
  if (index >= 0 && index < appointments.length) return appointments[index];
  const matches = appointments.filter(
    (item, i) =>
      item.appointmentRef.toLowerCase() === text ||
      item.spoken.toLowerCase() === text ||
      `${i + 1}. ${item.spoken}`.toLowerCase() === text,
  );
  return matches.length === 1 ? matches[0] : null;
}

export function appointmentReferenceFields(
  snapshot: ConversationalTaskSnapshotV1,
) {
  return snapshot.toolDefinitions
    .filter((tool) => tool.access === "read")
    .flatMap((tool) =>
      tool.resultMappings
        .filter(
          (mapping) =>
            mapping.target === "field" &&
            /^appointments\.0\.appointmentRef$/.test(mapping.sourcePath),
        )
        .map((mapping) => ({
          key: mapping.targetKey,
          dependsOn: tool.inputSchema.fields.flatMap((field) =>
            field.source.kind === "field" ? [field.source.key] : [],
          ),
        })),
    );
}

export function appointmentIdentityDefinition(
  snapshot: ConversationalTaskSnapshotV1,
) {
  const references = appointmentReferenceFields(snapshot);
  return {
    ...snapshot.task.definition,
    fields: snapshot.task.definition.fields.map((field) => ({
      ...field,
      dependsOn: [
        ...new Set([
          ...field.dependsOn,
          ...references
            .filter((reference) => reference.key === field.key)
            .flatMap((reference) => reference.dependsOn)
            .filter((key) => key !== field.key),
        ]),
      ],
    })),
  };
}

export function appointmentSlotOptions(value: unknown) {
  const parsed = z
    .object({
      slots: z
        .array(appointmentMatchSchema.omit({ appointmentRef: true }))
        .max(16),
    })
    .safeParse(value);
  if (
    !parsed.success ||
    parsed.data.slots.some(
      (slot) => Date.parse(slot.end) <= Date.parse(slot.start),
    )
  )
    return [];
  return parsed.data.slots.map((slot) => ({
    label: slot.spoken,
    value: slot.start,
  }));
}
