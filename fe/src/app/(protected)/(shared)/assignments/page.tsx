import AssignmentBoard from "@/components/shared/Assignments/AssignmentBoard";

export default async function AssignmentsPage({
  searchParams
}: {
  searchParams?: { assignmentId?: string };
}) {
  return (
    <div>
      <AssignmentBoard
        initialAssignmentId={searchParams?.assignmentId ?? null}
      />
    </div>
  );
}
