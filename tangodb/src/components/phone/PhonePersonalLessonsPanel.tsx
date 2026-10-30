import { useLocation } from "react-router-dom";
import PersonalLessonsPageContainer from "../personal-lessons/PersonalLessonsPageContainer";
import { useToast } from "../../lib/toastContext";

function initialTabFromPath(pathname: string): "view" | "sell" {
  if (pathname === "/personal/sell" || pathname === "/personal/book") return "sell";
  return "view";
}

/** Personal lessons — same CRM flows as desktop. */
export default function PhonePersonalLessonsPanel() {
  const toast = useToast();
  const { pathname } = useLocation();
  return <PersonalLessonsPageContainer initialTab={initialTabFromPath(pathname)} toast={toast} />;
}
