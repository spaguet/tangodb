import PersonalLessonsPanel from "../components/PersonalLessonsPanel";
import { useToast } from "../App";

interface PersonalPageProps {
  initialTab: "view" | "sell";
}

export default function PersonalPage({ initialTab }: PersonalPageProps) {
  const toast = useToast();
  return <PersonalLessonsPanel initialTab={initialTab} toast={toast} />;
}
