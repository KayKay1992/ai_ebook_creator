import { lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import { Loader2, Mail, User } from "lucide-react";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import KenlibsFooter from "../components/kenlibs/KenlibsFooter";
import { useAuth } from "../context/AuthContext";
import useDocumentTitle from "../hooks/useDocumentTitle";

// The reader's own profile (/kenlibs/profile, ReaderRoute): account details
// and "Fingerprint & passkeys". The passkey section (and its WebAuthn code)
// loads only on this page.
const PasskeysSection = lazy(() => import("../components/auth/PasskeysSection"));

const KenlibsProfilePage = () => {
  useDocumentTitle("Profile — Kenlibs");
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-surface-warm">
      <KenlibsNav />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Your profile</h1>
          <p className="text-gray-500 mt-1">Your account and how you sign in.</p>
        </div>

        <section className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-3">
          <p className="flex items-center gap-3 text-gray-900">
            <User className="w-4 h-4 text-gray-400" />
            <span className="font-medium">{user?.name}</span>
          </p>
          <p className="flex items-center gap-3 text-gray-700 break-all">
            <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
            {user?.email}
          </p>
          <p className="text-sm text-gray-500 pt-1">
            Forgot your password?{" "}
            <Link to="/kenlibs/forgot-password" className="text-accent hover:text-accent-hover font-medium">
              Reset it by email
            </Link>
            .
          </p>
        </section>

        <Suspense
          fallback={
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 flex justify-center">
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
            </div>
          }
        >
          <PasskeysSection />
        </Suspense>
      </main>
      <KenlibsFooter />
    </div>
  );
};

export default KenlibsProfilePage;
