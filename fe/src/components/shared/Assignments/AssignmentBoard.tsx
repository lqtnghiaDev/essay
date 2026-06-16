"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { Assignment, AssignmentStatus } from "@/types/trainingPlan.type";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  closestCenter
} from "@dnd-kit/core";
import DroppableColumn from "./DroppableColumn";
import AssignmentCard from "./AssignmentCard";
import { arrayMove } from "@dnd-kit/sortable";
import { PageHeader } from "@/components/HeaderContent";
import { ClipboardList, Download, Search } from "lucide-react";
import { useGetAssigmentAll } from "@/hooks/useAssignment";
import { assignmentServices } from "@/services/assignment.services";
import { useAuthStore } from "@/store/useAuthStore";
import { AssignmentDetailModal } from "@/components/shared/TrainingPlans/AssignmentDetail/AssignmentDetailModal";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { useGetInfoMentorDashboard } from "@/hooks/useDashboard";
import { useGetUsersAllByRole } from "@/hooks/useUser";
import { CSVExportButton } from "@/components/shared/Assignments/CSVExportButton";
import { Button } from "@/components/ui/button";
import { useToastMessage } from "@/hooks/useToastMessage";
import { AssignmentBoardSkeleton } from "@/components/common/Skeleton";

const STATUSES: AssignmentStatus[] = [
  "Todo",
  "InProgress",
  "Submitted",
  "Reviewed"
];

type AssignmentsByStatus = Record<AssignmentStatus, Assignment[]>;

function matchesAssignmentSearch(
  assignment: Assignment,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const parts = [
    assignment.task?.name,
    assignment.task?.description,
    assignment.assignee?.fullName,
    assignment.assignee?.username,
    assignment.creator?.fullName,
    assignment.creator?.username,
    assignment.status,
    assignment.feedback,
    assignment.submittedLink,
    ...(assignment.skills?.map((s) => s.skill?.name) ?? [])
  ];

  return parts.some((part) => part?.toLowerCase().includes(q));
}

export default function AssignmentBoard() {
  const { showToastSuccess, showToastError } = useToastMessage();
  const [isOpenExport, setIsOpenExport] = useState(false);
  const {
    data: assignments,
    mutate,
    isLoading
  } = useGetAssigmentAll({
    isAssigned: true
  });
  const { userDetails } = useAuthStore();
  const userRole: string = userDetails?.role ?? "";
  const [filterIntern, setFilterIntern] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearch = useDebounce(searchQuery, 300);

  const { data: mentorData } = useGetInfoMentorDashboard(
    userDetails?.role === "mentor"
  );

  const { data: adminData } = useGetUsersAllByRole(
    "intern",
    userDetails?.role === "admin"
  );

  const internList = useMemo(() => {
    if (!userDetails) return [];
    switch (userDetails.role) {
      case "mentor":
        return (
          mentorData?.myInterns?.map((i) => ({
            id: i.internId,
            userName: i.intern.username,
            email: i.intern.email,
            planId: i.planId
          })) ?? []
        );
      case "admin":
        return (
          adminData?.data?.users?.map((u) => ({
            id: u.internInformation?.internId,
            userName: u.username,
            email: u.email,
            planId: u.internInformation?.planId
          })) ?? []
        );
    }
  }, [userDetails, mentorData, adminData]);

  const [itemsByStatus, setItemsByStatus] = useState<AssignmentsByStatus>(
    () => {
      const initial = STATUSES.reduce((acc, status) => {
        acc[status] = [];
        return acc;
      }, {} as AssignmentsByStatus);

      if (assignments && Array.isArray(assignments)) {
        STATUSES.forEach((status) => {
          initial[status] = assignments.filter(
            (a: Assignment) => a.status === status && a.assignedTo !== null
          );
        });
      }
      if (filterIntern === "all") return initial;
      else {
        const filteredByIntern = STATUSES.reduce((acc, status) => {
          acc[status] = initial[status].filter(
            (a: Assignment) => a.assignedTo === filterIntern
          );
          return acc;
        }, {} as AssignmentsByStatus);
        return filteredByIntern;
      }
    }
  );

  const groupAssignments = useCallback(
    (list: Assignment[]) => {
      return STATUSES.reduce((acc, status) => {
        acc[status] = list.filter(
          (a) =>
            a.status === status &&
            a.assignedTo != null &&
            (filterIntern === "all" || a.assignedTo === filterIntern) &&
            matchesAssignmentSearch(a, debouncedSearch)
        );
        return acc;
      }, {} as AssignmentsByStatus);
    },
    [filterIntern, debouncedSearch]
  );

  useEffect(() => {
    if (!assignments || !Array.isArray(assignments)) {
      return;
    }

    setItemsByStatus(groupAssignments(assignments));
  }, [assignments, groupAssignments]);
  const [activeAssignment, setActiveAssignment] = useState<Assignment | null>(
    null
  );

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] =
    useState<Assignment | null>(null);

  const handleView = (assignment: Assignment) => {
    setSelectedAssignment(assignment);
    // Defer open to next tick to avoid Radix dropdown closing conflicts
    setTimeout(() => setDetailOpen(true), 0);
  };

  const handleDelete = async (id: string) => {
    try {
      await assignmentServices.deleteAssignment(id);
      showToastSuccess("Assignment deleted successfully!");

      // Cập nhật UI bằng cách refetch data
      await mutate();

      setItemsByStatus((prev) => {
        const updated: AssignmentsByStatus = {
          ...prev
        } as AssignmentsByStatus;
        STATUSES.forEach((status) => {
          updated[status] = updated[status].filter((a) => a.id !== id);
        });
        return updated;
      });
    } catch (error) {
      console.error("Failed to delete assignment:", error);
      showToastError("Failed to delete assignment");
    }
  };

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

  if (isLoading && !assignments) {
    return (
      <>
        <PageHeader
          title="Assignments Board"
          description="Overview of system activity and stats."
          icon={<ClipboardList className="w-5 h-5 " />}
        />
        <div className="space-y-6 p-4 sm:px-20">
          <AssignmentBoardSkeleton />
        </div>
      </>
    );
  }

  return (
    <>
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
        <div className="py-4 px-4 sm:px-24">
          <Card className="p-4 rounded-md w-full flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tasks, interns, skills..."
                className="pl-10 bg-gray-50 border-gray-200 focus:bg-white"
              />
            </div>
            <Select
              value={filterIntern ?? undefined}
              onValueChange={setFilterIntern}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Choose Intern" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {(internList ?? []).map((intern) => (
                  <SelectItem key={intern.id} value={intern.id || ""}>
                    Intern: {`${intern.userName}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsOpenExport(true)}
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </Card>
        </div>
        <div className="space-y-6 p-4 sm:px-20">
          <div className="grid  grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {STATUSES.map((status) => (
              <DroppableColumn
                key={status}
                id={status}
                title={status}
                assignments={itemsByStatus[status]}
                role={userRole}
                onView={handleView}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeAssignment ? (
            <AssignmentCard assignment={activeAssignment} role={userRole} />
          ) : null}
        </DragOverlay>

        <AssignmentDetailModal
          assignment={selectedAssignment}
          role={userRole}
          open={detailOpen}
          onClose={() => setDetailOpen(false)}
          onFeedbackSubmit={async (newFeedback) => {
            if (!selectedAssignment) return;
            try {
              await assignmentServices.assignmentReview(selectedAssignment.id, {
                feedback: newFeedback
              });
              setSelectedAssignment((prev) =>
                prev ? { ...prev, feedback: newFeedback } : prev
              );
              setItemsByStatus((prev) => {
                const updated: AssignmentsByStatus = {
                  ...prev
                } as AssignmentsByStatus;
                (Object.keys(updated) as AssignmentStatus[]).forEach(
                  (status) => {
                    updated[status] = updated[status].map((a) =>
                      a.id === selectedAssignment.id
                        ? { ...a, feedback: newFeedback }
                        : a
                    );
                  }
                );
                return updated;
              });
            } catch (error) {
              console.error("Feedback update failed", error);
            }
          }}
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
                (Object.keys(updated) as AssignmentStatus[]).forEach(
                  (status) => {
                    updated[status] = updated[status].map((a) =>
                      a.id === selectedAssignment.id
                        ? { ...a, submittedLink: link }
                        : a
                    );
                  }
                );
                return updated;
              });
            } catch (error) {
              console.error("Link submit failed", error);
            }
          }}
        />
      </DndContext>
      <CSVExportButton
        isOpen={isOpenExport}
        onClose={() => setIsOpenExport(false)}
        assignments={assignments || []}
        selectedInternId={filterIntern}
        internList={internList || []}
      />
    </>
  );
}
