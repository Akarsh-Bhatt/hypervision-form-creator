import { Suspense } from "react";
import DashboardPage from "./dashboard/page";

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#090e1a]" />}>
      <DashboardPage />
    </Suspense>
  );
}
