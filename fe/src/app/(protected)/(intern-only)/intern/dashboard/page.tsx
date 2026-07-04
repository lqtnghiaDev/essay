import DashboardContent from "@/components/roles/intern/Dashboard/DashboardContent";
import React from "react";

const page = ({
  searchParams
}: {
  searchParams?: { assignmentId?: string };
}) => {
  return (
    <DashboardContent
      initialAssignmentId={searchParams?.assignmentId ?? null}
    />
  );
};

export default page;
