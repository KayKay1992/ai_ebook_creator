import { Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AdminRoute from "./components/auth/AdminRoute";
import ReaderRoute from "./components/auth/ReaderRoute";
import KenlibsPage from "./pages/KenlibsPage";
import OfflineBanner from "./components/shared/OfflineBanner";
import PasskeyPromptHost from "./components/auth/PasskeyPromptHost";
import KenlibsThemeLayout from "./components/kenlibs/KenlibsThemeLayout";
import lazyWithRetry from "./utils/lazyWithRetry";

// Code-split per page: each route below loads its own chunk on first visit,
// so a storefront visitor never downloads the admin editor (markdown editor,
// drag-and-drop) or any other admin-only surface. KenlibsPage is the one
// exception — "/" redirects straight to it, so it's the first page nearly
// every visitor sees, and it stays in the main bundle alongside
// KenlibsThemeLayout rather than costing an extra round trip before
// anything renders.
const LoginPage = lazyWithRetry(() => import("./pages/LoginPage"));
const SignupPage = lazyWithRetry(() => import("./pages/SignupPage"));
const DashboardPage = lazyWithRetry(() => import("./pages/DashboardPage"));
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage"));
const EditorPage = lazyWithRetry(() => import("./pages/EditorPage"));
const CoverDesignerPage = lazyWithRetry(() => import("./pages/CoverDesignerPage"));
const ViewBookPage = lazyWithRetry(() => import("./pages/ViewBookPage"));
const ReadBookPage = lazyWithRetry(() => import("./pages/ReadBookPage"));
const AdminBundlesPage = lazyWithRetry(() => import("./pages/AdminBundlesPage"));
const AdminPurchasesPage = lazyWithRetry(() => import("./pages/AdminPurchasesPage"));
const KenlibsBookDetailPage = lazyWithRetry(() => import("./pages/KenlibsBookDetailPage"));
const KenlibsBundleDetailPage = lazyWithRetry(() => import("./pages/KenlibsBundleDetailPage"));
const KenlibsLoginPage = lazyWithRetry(() => import("./pages/KenlibsLoginPage"));
const KenlibsSignupPage = lazyWithRetry(() => import("./pages/KenlibsSignupPage"));
const ForgotPasswordPage = lazyWithRetry(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazyWithRetry(() => import("./pages/ResetPasswordPage"));
const KenlibsForgotPasswordPage = lazyWithRetry(() => import("./pages/KenlibsForgotPasswordPage"));
const KenlibsResetPasswordPage = lazyWithRetry(() => import("./pages/KenlibsResetPasswordPage"));
const KenlibsCheckoutPage = lazyWithRetry(() => import("./pages/KenlibsCheckoutPage"));
const KenlibsMyBooksPage = lazyWithRetry(() => import("./pages/KenlibsMyBooksPage"));
const KenlibsReferralsPage = lazyWithRetry(() => import("./pages/KenlibsReferralsPage"));
const KenlibsProfilePage = lazyWithRetry(() => import("./pages/KenlibsProfilePage"));
const KenlibsReadPage = lazyWithRetry(() => import("./pages/KenlibsReadPage"));
const KenlibsTermsPage = lazyWithRetry(() => import("./pages/KenlibsTermsPage"));
const KenlibsPrivacyPage = lazyWithRetry(() => import("./pages/KenlibsPrivacyPage"));
const KenlibsRefundPolicyPage = lazyWithRetry(() => import("./pages/KenlibsRefundPolicyPage"));
const KenlibsSupportPage = lazyWithRetry(() => import("./pages/KenlibsSupportPage"));
const AdminUsersPage = lazyWithRetry(() => import("./pages/AdminUsersPage"));
const AdminAnalyticsPage = lazyWithRetry(() => import("./pages/AdminAnalyticsPage"));
const AdminReviewsPage = lazyWithRetry(() => import("./pages/AdminReviewsPage"));
const AdminErrorsPage = lazyWithRetry(() => import("./pages/AdminErrorsPage"));
const AdminPaymentSettingsPage = lazyWithRetry(() => import("./pages/AdminPaymentSettingsPage"));
const AdminClientBooksPage = lazyWithRetry(() => import("./pages/AdminClientBooksPage"));

const PageFallback = () => (
  <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
    <div className="w-8 h-8 rounded-full border-2 border-gray-200 border-t-accent animate-spin" />
  </div>
);

const App = () => {
  return (
    <div>
      <OfflineBanner />
      <PasskeyPromptHost />
      <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* "/" is the app's entry point for a logged-out visitor — redirects
            straight to the Kenlibs storefront so no one lands on AI-creator
            marketing copy. Admin sign-in stays reachable directly at /login,
            unchanged. */}
        <Route path="/" element={<Navigate to="/kenlibs" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

        {/* Every reader-facing surface — the public share reader plus all of
            Kenlibs — renders inside KenlibsThemeLayout. As of Step 47 this
            is no longer a theming wrapper (the terracotta/navy/cream
            palette is the app-wide default now, admin included — see
            index.css's @theme block); it only exists to mount
            KenlibsWhatsAppButton once for every route below. */}
        <Route element={<KenlibsThemeLayout />}>
          <Route path="/read/:shareId" element={<ReadBookPage />} />

          {/* Kenlibs storefront + auth — genuinely public, no route guard at
              all (see KENLIBS-ARCHITECTURE.md's route map). */}
          <Route path="/kenlibs" element={<KenlibsPage />} />
          <Route path="/kenlibs/book/:id" element={<KenlibsBookDetailPage />} />
          <Route path="/kenlibs/bundle/:id" element={<KenlibsBundleDetailPage />} />
          <Route path="/kenlibs/login" element={<KenlibsLoginPage />} />
          <Route path="/kenlibs/signup" element={<KenlibsSignupPage />} />
          <Route path="/kenlibs/forgot-password" element={<KenlibsForgotPasswordPage />} />
          <Route
            path="/kenlibs/reset-password/:token"
            element={<KenlibsResetPasswordPage />}
          />
          <Route path="/kenlibs/terms" element={<KenlibsTermsPage />} />
          <Route path="/kenlibs/privacy" element={<KenlibsPrivacyPage />} />
          <Route path="/kenlibs/refund-policy" element={<KenlibsRefundPolicyPage />} />
          <Route path="/kenlibs/support" element={<KenlibsSupportPage />} />

          {/* Reader-authenticated Kenlibs surfaces — any logged-in user
              (reader or admin), guarded by ReaderRoute rather than AdminRoute. */}
          <Route
            path="/kenlibs/checkout/:itemType/:id"
            element={<ReaderRoute><KenlibsCheckoutPage /></ReaderRoute>}
          />
          <Route
            path="/kenlibs/my-books"
            element={<ReaderRoute><KenlibsMyBooksPage /></ReaderRoute>}
          />
          <Route
            path="/kenlibs/referrals"
            element={<ReaderRoute><KenlibsReferralsPage /></ReaderRoute>}
          />
          <Route
            path="/kenlibs/profile"
            element={<ReaderRoute><KenlibsProfilePage /></ReaderRoute>}
          />
          <Route
            path="/kenlibs/read/:bookId"
            element={<ReaderRoute><KenlibsReadPage /></ReaderRoute>}
          />
        </Route>

          {/* admin-only route (creator surface — see KENLIBS-ARCHITECTURE.md) */}
          <Route path="/dashboard" element={<AdminRoute><DashboardPage /></AdminRoute>} />
          <Route path="/profile" element={<AdminRoute><ProfilePage /></AdminRoute>} />
          <Route path='/editor/:bookId' element={<AdminRoute><EditorPage /></AdminRoute>} />
          <Route path='/editor/:bookId/cover' element={<AdminRoute><CoverDesignerPage /></AdminRoute>} />
          <Route path='/view-book/:bookId' element={<AdminRoute><ViewBookPage /></AdminRoute>} />
          <Route path='/admin/bundles' element={<AdminRoute><AdminBundlesPage /></AdminRoute>} />
          <Route path='/admin/purchases' element={<AdminRoute><AdminPurchasesPage /></AdminRoute>} />
          <Route path='/admin/users' element={<AdminRoute><AdminUsersPage /></AdminRoute>} />
          <Route path='/admin/analytics' element={<AdminRoute><AdminAnalyticsPage /></AdminRoute>} />
          <Route path='/admin/reviews' element={<AdminRoute><AdminReviewsPage /></AdminRoute>} />
          <Route path='/admin/errors' element={<AdminRoute><AdminErrorsPage /></AdminRoute>} />
          <Route path='/admin/payment-settings' element={<AdminRoute><AdminPaymentSettingsPage /></AdminRoute>} />
          <Route path='/admin/client-books' element={<AdminRoute><AdminClientBooksPage /></AdminRoute>} />
      </Routes>
      </Suspense>
    </div>
  );
};

export default App;
