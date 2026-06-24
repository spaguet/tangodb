import PersonalLessonsPageContainer from "../components/personal-lessons/PersonalLessonsPageContainer";
import { useToast } from "../App";

interface PersonalLessonsPageProps {
  initialTab?: "view" | "sell";
}

export default function PersonalLessonsPage({ initialTab = "view" }: PersonalLessonsPageProps) {
  const toast = useToast();
  return <PersonalLessonsPageContainer initialTab={initialTab} toast={toast} />;
}
