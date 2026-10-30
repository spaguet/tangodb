import AttendancePanel from "../AttendancePanel";
import { useToast } from "../../lib/toastContext";

/** Journal panel — same CRM UI and hooks as the desktop attendance panel. */
export default function PhoneAttendancePanel() {
  const toast = useToast();
  return <AttendancePanel toast={toast} />;
}
