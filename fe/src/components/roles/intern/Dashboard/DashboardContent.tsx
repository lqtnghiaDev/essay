"use client";

import { useEffect, useRef, useState } from "react";
import { Assignment, AssignmentStatus } from "@/types/trainingPlan.type";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  closestCenter
} from "@dnd-kit/core";

import { arrayMove } from "@dnd-kit/sortable";
import { PageHeader } from "@/components/HeaderContent";
import { ClipboardList } from "lucide-react";
import DroppableColumn from "@/components/shared/Assignments/DroppableColumn";
import AssignmentCard from "@/components/shared/Assignments/AssignmentCard";
import { useGetInternInfoAll } from "@/hooks/useIntern";
import { assignmentServices } from "@/services/assignment.services";
import { AssignmentDetailModal } from "@/components/shared/TrainingPlans/AssignmentDetail/AssignmentDetailModal";
import { DashboardSkeleton } from "@/components/common/Skeleton";
import OverAllProgress from "@/components/roles/intern/Dashboard/OverAllProgressIntern";
import TrainingPlanIntern from "@/components/roles/intern/Dashboard/TrainingPlanIntern";
import MentorIntern from "@/components/roles/intern/Dashboard/MentorIntern";
const STATUSES: AssignmentStatus[] = [
  "Todo",
  "InProgress",
  "Submitted",
  "Reviewed"
];

type AssignmentsByStatus = Record<AssignmentStatus, Assignment[]>;

interface DashboardContentProps {
  initialAssignmentId?: string | null;
}

export default function DashboardContent({
  initialAssignmentId
}: DashboardContentProps) {
  const { data, isLoading } = useGetInternInfoAll();
  const internInfo = data?.data?.internInformation;
  const total = data?.data?.countAssignments;
  const assignments = internInfo?.plan.assignments;
  const reviewed = total?.reviewed ?? 0;
  const totalAssignments = total?.total ?? 0;
  const inProgress = total?.inProgress ?? 0;

  const [itemsByStatus, setItemsByStatus] = useState<AssignmentsByStatus>(
    () => {
      // Initialize with empty arrays for all statuses
      const initial = STATUSES.reduce((acc, status) => {
        acc[status] = [];
        return acc;
      }, {} as AssignmentsByStatus);

      // If assignments exist, filter them
      if (assignments && Array.isArray(assignments)) {
        STATUSES.forEach((status) => {
          initial[status] = assignments.filter(
            (a: Assignment) => a.status === status
          );
        });
      }

      return initial;
    }
  );

  useEffect(() => {
    if (!assignments || !Array.isArray(assignments)) {
      return;
    }

    const grouped = STATUSES.reduce((acc, status) => {
      acc[status] = assignments.filter((a: Assignment) => a.status === status);
      return acc;
    }, {} as AssignmentsByStatus);

    setItemsByStatus(grouped);
  }, [assignments]);

  const [activeAssignment, setActiveAssignment] = useState<Assignment | null>(
    null
  );

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] =
    useState<Assignment | null>(null);
  const openedAssignmentIdRef = useRef<string | null>(null);

  const handleView = (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    setDetailOpen(true);
  };

  useEffect(() => {
    if (!initialAssignmentId || !assignments || !Array.isArray(assignments)) {
      return;
    }

    if (openedAssignmentIdRef.current === initialAssignmentId) {
      return;
    }

    const foundAssignment = assignments.find(
      (assignment) => assignment.id === initialAssignmentId
    );

    if (!foundAssignment) {
      return;
    }

    setSelectedAssignment(foundAssignment);
    setDetailOpen(true);
    openedAssignmentIdRef.current = initialAssignmentId;
  }, [assignments, initialAssignmentId]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const fromStatus = active.data.current?.status as AssignmentStatus;

    const found =
      itemsByStatus[fromStatus]?.find((a) => a.id === active.id) || null;
    setActiveAssignment(found);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !active) {
      setActiveAssignment(null);
      return;
    }

    const fromStatus = active.data.current?.status as AssignmentStatus;
    let toStatus = over.data.current?.column as AssignmentStatus | undefined;

    if (!toStatus) {
      const hoveredId = over.id as string;
      for (const status of STATUSES) {
        if (itemsByStatus[status].some((a) => a.id === hoveredId)) {
          toStatus = status;
          break;
        }
      }
    }

    if (!fromStatus || !toStatus) {
      setActiveAssignment(null);
      return;
    }

    const activeItem = itemsByStatus[fromStatus].find(
      (a) => a.id === active.id
    );
    if (!activeItem) {
      setActiveAssignment(null);
      return;
    }

    if (toStatus === "Reviewed") {
      setActiveAssignment(null);
      return;
    }

    setItemsByStatus((prev) => {
      const updatedFrom = prev[fromStatus].filter((a) => a.id !== active.id);
      const targetList = [...prev[toStatus]];

      if (fromStatus === toStatus) {
        const oldIndex = prev[fromStatus].findIndex((a) => a.id === active.id);
        const newIndex = prev[toStatus].findIndex((a) => a.id === over.id);

        const reordered = arrayMove(prev[toStatus], oldIndex, newIndex);
        return {
          ...prev,
          [fromStatus]: reordered
        };
      }

      const overIndex = targetList.findIndex((a) => a.id === over.id);
      const insertIndex = overIndex >= 0 ? overIndex : targetList.length;
      targetList.splice(insertIndex, 0, { ...activeItem, status: toStatus });

      return {
        ...prev,
        [fromStatus]: updatedFrom,
        [toStatus]: targetList
      };
    });

    // Gọi API 1 lần ngoài setState (tránh React gọi updater 2 lần → 2 request → 2 thông báo)
    if (fromStatus !== toStatus && activeItem.assignedTo) {
      assignmentServices.updateAssignmentStatus(activeItem.id, {
        status: toStatus
      });
    }

    setActiveAssignment(null);
  };

  if (isLoading) {
    return (
      <>
        <PageHeader
          title="Assignments Board"
          description="Overview of system activity and stats."
          icon={<ClipboardList className="w-5 h-5 " />}
        />
        <div className="space-y-6 py-4 px-4 sm:px-20">
          <DashboardSkeleton />
        </div>
      </>
    );
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
    >
      <PageHeader
        title="Assignments Board"
        description="Overview of system activity and stats."
        icon={<ClipboardList className="w-5 h-5 " />}
      />
      <div className="space-y-6 py-4 px-4 sm:px-20">
        <div className="space-y-6">
          <div className="grid sm:grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="flex flex-col gap-4">
              <MentorIntern internInfo={internInfo} />

              <TrainingPlanIntern internInfo={internInfo} />
            </div>
            <OverAllProgress
              reviewed={reviewed}
              totalAssignments={totalAssignments}
              inProgress={inProgress}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STATUSES.map((status) => (
            <DroppableColumn
              key={status}
              id={status}
              title={status}
              assignments={itemsByStatus[status]}
              role="intern"
              onView={handleView}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activeAssignment ? (
          <AssignmentCard assignment={activeAssignment} role="intern" />
        ) : null}
      </DragOverlay>

      <AssignmentDetailModal
        assignment={selectedAssignment}
        role="intern"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onLinkSubmit={async (link) => {
          if (!selectedAssignment) return;
          try {
            await assignmentServices.assignmentSubmit(selectedAssignment.id, {
              submittedLink: link
            });
            setSelectedAssignment((prev) =>
              prev ? { ...prev, submittedLink: link } : prev
            );
            // Update the item inside the current board without changing status
            setItemsByStatus((prev) => {
              const updated: AssignmentsByStatus = {
                ...prev
              } as AssignmentsByStatus;
              (Object.keys(updated) as AssignmentStatus[]).forEach((status) => {
                updated[status] = updated[status].map((a) =>
                  a.id === selectedAssignment.id
                    ? { ...a, submittedLink: link }
                    : a
                );
              });
              return updated;
            });
          } catch (error) {
            console.error("Link submit failed", error);
          }
        }}
      />
    </DndContext>
  );
}
