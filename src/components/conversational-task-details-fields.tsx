import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type ConversationalTaskDetailsFieldsProps = {
  defaultValues?: {
    description?: string | null;
    name?: string;
    objective?: string;
  };
};

export function ConversationalTaskDetailsFields({
  defaultValues,
}: ConversationalTaskDetailsFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="taskName">Task Name</Label>
        <Input
          id="taskName"
          name="name"
          placeholder="e.g. Book a Spa Service"
          defaultValue={defaultValues?.name}
          maxLength={120}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="taskObjective">Objective</Label>
        <Textarea
          id="taskObjective"
          name="objective"
          placeholder="Help the visitor choose a service and submit an appointment request."
          defaultValue={defaultValues?.objective}
          maxLength={600}
          required
        />
        <p className="text-xs text-muted-foreground">
          Describe one clear result this task should achieve.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="taskDescription">
          Internal Notes{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="taskDescription"
          name="description"
          placeholder="Add context for teammates configuring this task."
          defaultValue={defaultValues?.description ?? ""}
          maxLength={2000}
        />
      </div>
    </>
  );
}
