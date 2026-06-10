import SchedulePanel from "../components/SchedulePanel";
import { useStore } from "../hooks/PlaceholderStoreContext";
import { useToast } from "../App";

export default function SchedulePage() {
  const store = useStore();
  const toast = useToast();
  if (store.loading) return null;

  return (
    <SchedulePanel
      schedule={store.schedule}
      onAddScheduleSlot={store.addScheduleSlot}
      onDeleteScheduleSlot={store.deleteScheduleSlot}
      toast={toast}
    />
  );
}
