export function getHandoffAssignmentAvailability(assignedUserId: unknown) {
  const isAssigned =
    typeof assignedUserId === "number" &&
    Number.isInteger(assignedUserId) &&
    assignedUserId > 0;

  return {
    canClaim: !isAssigned,
    canRelease: isAssigned,
  };
}
