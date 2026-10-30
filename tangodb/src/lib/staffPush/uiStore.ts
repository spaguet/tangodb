import { create } from "zustand";
import { readLessonRemindersEnabled, writeLessonRemindersEnabled } from "./preferences";

type StaffNotificationsUiState = {
  lessonRemindersEnabled: boolean;
  setLessonRemindersEnabled: (enabled: boolean) => void;
};

export const useStaffNotificationsUiStore = create<StaffNotificationsUiState>((set) => ({
  lessonRemindersEnabled: readLessonRemindersEnabled(),
  setLessonRemindersEnabled: (enabled) => {
    writeLessonRemindersEnabled(enabled);
    set({ lessonRemindersEnabled: enabled });
  },
}));

export function syncStaffNotificationsUiFromStorage(): void {
  useStaffNotificationsUiStore.setState({ lessonRemindersEnabled: readLessonRemindersEnabled() });
}
