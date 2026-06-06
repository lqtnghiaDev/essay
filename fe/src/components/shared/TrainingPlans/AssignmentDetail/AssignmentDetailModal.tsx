"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { useState, useEffect } from "react";
import { Assignment } from "@/types/trainingPlan.type";
import { getStatusColor } from "@/lib/helper";

interface AssignmentDetailModalProps {
  assignment: Assignment | null;
  role: string;
  open: boolean;
  onClose: () => void;
  onFeedbackSubmit?: (feedback: string) => void;
  onLinkSubmit?: (link: string) => void;
}

export function AssignmentDetailModal({
  assignment,
  role,
  open,
  onClose,
  onFeedbackSubmit,
  onLinkSubmit
}: AssignmentDetailModalProps) {
  const [localFeedback, setLocalFeedback] = useState("");
  const [localLink, setLocalLink] = useState("");

  useEffect(() => {
    setLocalFeedback(assignment?.feedback || "");
    setLocalLink(assignment?.submittedLink || "");
  }, [assignment, open]);

  if (!assignment) return null;

  const normalizedRole = role?.toLowerCase() ?? "";
  const isIntern = normalizedRole === "intern";
  const canEditFeedback =
    normalizedRole === "mentor" || normalizedRole === "admin";

  const handleSave = () => {
    if (canEditFeedback) onFeedbackSubmit?.(localFeedback);
    else if (isIntern) onLinkSubmit?.(localLink);
    onClose();
  };

  const displayFeedback = assignment.feedback || localFeedback;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="space-y-3 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle className="text-xl font-semibold leading-snug">
                {assignment.task.name}
              </DialogTitle>

              <div className="flex gap-2 items-center text-sm text-muted-foreground">
                <span>Estimated: {assignment.estimatedTime}h</span>
              </div>
            </div>

            <Badge
              className={`capitalize ${getStatusColor(assignment.status)}`}
            >
              {assignment.status}
            </Badge>
          </div>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed">
          {assignment.task.description || "No description provided"}
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs mb-1">Skills</p>
            <div className="flex flex-wrap gap-1">
              {assignment.skills?.length > 0 ? (
                assignment.skills.map((s) => (
                  <Badge key={s.id} variant="secondary">
                    {s.skill.name}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </div>
          </div>

          <div>
            <p className="text-muted-foreground text-xs mb-1">
              {normalizedRole === "mentor" ? "Assigned to" : "Created by"}
            </p>
            <p className="font-medium">
              {normalizedRole === "mentor"
                ? (assignment?.assignee?.fullName ?? assignment.assignedTo)
                : assignment.creator?.fullName}
            </p>
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground text-xs">Mentor Feedback</p>
          {canEditFeedback ? (
            <textarea
              className="w-full min-h-[90px] rounded-md border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={localFeedback}
              onChange={(e) => setLocalFeedback(e.target.value)}
              placeholder="Write feedback for intern..."
            />
          ) : (
            <div className="rounded-md border bg-muted/30 p-3 text-sm min-h-[60px] whitespace-pre-wrap">
              {displayFeedback ? (
                displayFeedback
              ) : (
                <span className="text-muted-foreground italic">
                  No feedback yet
                </span>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground text-xs">Submission</p>
          {isIntern ? (
            <textarea
              className="w-full min-h-[60px] rounded-md border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              value={localLink}
              onChange={(e) => setLocalLink(e.target.value)}
              placeholder="Paste your submission link..."
            />
          ) : assignment.submittedLink ? (
            <a
              href={assignment.submittedLink}
              target="_blank"
              rel="noopener noreferrer"
              className="block border rounded-md p-3 hover:bg-muted transition break-all text-blue-600"
            >
              {assignment.submittedLink}
            </a>
          ) : (
            <div className="text-muted-foreground italic border rounded-md p-3">
              No submission yet
            </div>
          )}
        </div>

        <Separator />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
          className="flex justify-end gap-2"
        >
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {(canEditFeedback || isIntern) && <Button type="submit">Save</Button>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
