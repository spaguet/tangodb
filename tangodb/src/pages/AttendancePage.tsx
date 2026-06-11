import AttendancePanel from "../components/AttendancePanel";
import { useMarkAttendance, useScheduleDates, useSubsForDate } from "../hooks/useAttendance";
import { useToast } from "../App";

export default function AttendancePage() {
  const toast = useToast();
  const { getScheduleDatesForMonth, isLoading: scheduleLoading } = useScheduleDates();
  const { getSubsForDate, isLoading: subsLoading } = useSubsForDate();
  const markAttendanceMutation = useMarkAttendance();

  if (scheduleLoading || subsLoading) return null;

  const onMarkAttendance = async (
    dateStr: string,
    subId: string,
    status: "present" | "absent" | "freeze"
  ) => markAttendanceMutation.mutateAsync({ dateStr, subId, status });

  return (
    <AttendancePanel
      getScheduleDatesForMonth={getScheduleDatesForMonth}
      getSubsForDate={getSubsForDate}
      onMarkAttendance={onMarkAttendance}
      toast={toast}
    />
  );
}
