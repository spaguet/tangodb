import AttendancePanel from "../components/AttendancePanel";
import { useToast } from "../App";

export default function AttendancePage() {
  const toast = useToast();
  return <AttendancePanel toast={toast} />;
}
