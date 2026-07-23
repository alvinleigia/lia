import { expect, test } from "@playwright/test";
import {
  conversationalTaskDetailsSchema,
  conversationalTaskIdSchema,
} from "../../src/lib/conversational-task-schema";

test("conversational task details normalize a valid draft", () => {
  const parsed = conversationalTaskDetailsSchema.parse({
    description: "  Used by the booking team.  ",
    name: "  Book a Spa Service  ",
    objective: "  Help a visitor submit an appointment request.  ",
  });

  expect(parsed).toEqual({
    description: "Used by the booking team.",
    name: "Book a Spa Service",
    objective: "Help a visitor submit an appointment request.",
  });
});

test("conversational task details require a name and objective", () => {
  expect(
    conversationalTaskDetailsSchema.safeParse({
      description: "",
      name: " ",
      objective: " ",
    }).success,
  ).toBe(false);
});

test("conversational task details enforce draft field limits", () => {
  expect(
    conversationalTaskDetailsSchema.safeParse({
      name: "n".repeat(121),
      objective: "o".repeat(601),
    }).success,
  ).toBe(false);
});

test("conversational task ids accept only positive integers", () => {
  expect(conversationalTaskIdSchema.parse("42")).toBe(42);
  expect(conversationalTaskIdSchema.safeParse("0").success).toBe(false);
  expect(conversationalTaskIdSchema.safeParse("1.5").success).toBe(false);
});
