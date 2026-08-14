import { BookOpen } from "lucide-react";

const AuthLoadingScreen = () => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center">
    <div className="flex flex-col items-center gap-6">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-2xl border-4 border-accent-200 border-t-accent animate-spin"></div>
        <div className="absolute inset-2 bg-gradient-to-br from-accent to-accent-secondary rounded-xl flex items-center justify-center shadow-lg shadow-accent-500/20">
          <BookOpen className="w-5 h-5 text-white" />
        </div>
      </div>
      <p className="text-gray-500 font-medium">Loading…</p>
    </div>
  </div>
);

export default AuthLoadingScreen;
