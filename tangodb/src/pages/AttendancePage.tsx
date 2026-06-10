import AttendancePanel from "../components/AttendancePanel";
import { useStore } from "../hooks/PlaceholderStoreContext";
import { useToast } from "../App";

export default function AttendancePage() {
  const store = useStore();
  const toast = useToast();
  if (store.loading) return null;

  return (
    <AttendancePanel
      getScheduleDatesForMonth={store.getScheduleDatesForMonth}
      getSubsForDate={store.getSubsForDate}
      onMarkAttendance={store.markAttendance}
      toast={toast}
    />
  );
}
