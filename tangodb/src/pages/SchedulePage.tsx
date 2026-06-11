import SchedulePanel from "../components/SchedulePanel";
import { useToast } from "../App";

export default function SchedulePage() {
  const toast = useToast();
  return <SchedulePanel toast={toast} />;
}
