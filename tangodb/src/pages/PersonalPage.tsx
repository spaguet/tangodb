import PersonalLessonsPanel from "../components/PersonalLessonsPanel";
import { useStore } from "../hooks/PlaceholderStoreContext";
import { useToast } from "../App";

interface PersonalPageProps {
  initialTab: "view" | "book";
}

export default function PersonalPage({ initialTab }: PersonalPageProps) {
  const store = useStore();
  const toast = useToast();
  if (store.loading) return null;

  return (
    <PersonalLessonsPanel
      initialTab={initialTab}
      clients={store.clients}
      personalLessons={store.personalLessons}
      prices={store.prices}
      onAddPersonalLessons={store.addPersonalLessons}
      onUpdatePersonalPaid={store.updatePersonalLessonPaid}
      onDeletePersonal={store.deletePersonalLessonRow}
      toast={toast}
    />
  );
}
