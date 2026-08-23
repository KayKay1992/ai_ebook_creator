import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import AdminRoute from "./components/auth/AdminRoute";
import ReaderRoute from "./components/auth/ReaderRoute";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import DashboardPage from "./pages/DashboardPage";
import ProfilePage from "./pages/ProfilePage";
import EditorPage from "./pages/EditorPage";
import CoverDesignerPage from "./pages/CoverDesignerPage";
import ViewBookPage from "./pages/ViewBookPage";
import ReadBookPage from "./pages/ReadBookPage";
import AdminBundlesPage from "./pages/AdminBundlesPage";
import AdminPurchasesPage from "./pages/AdminPurchasesPage";
import KenlibsPage from "./pages/KenlibsPage";
import KenlibsBookDetailPage from "./pages/KenlibsBookDetailPage";
import KenlibsBundleDetailPage from "./pages/KenlibsBundleDetailPage";
import KenlibsLoginPage from "./pages/KenlibsLoginPage";
import KenlibsSignupPage from "./pages/KenlibsSignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import KenlibsForgotPasswordPage from "./pages/KenlibsForgotPasswordPage";
import KenlibsResetPasswordPage from "./pages/KenlibsResetPasswordPage";
import KenlibsCheckoutPage from "./pages/KenlibsCheckoutPage";
import KenlibsMyBooksPage from "./pages/KenlibsMyBooksPage";
import KenlibsReferralsPage from "./pages/KenlibsReferralsPage";
import KenlibsReadPage from "./pages/KenlibsReadPage";
import KenlibsTermsPage from "./pages/KenlibsTermsPage";
import KenlibsPrivacyPage from "./pages/KenlibsPrivacyPage";
import KenlibsRefundPolicyPage from "./pages/KenlibsRefundPolicyPage";
import KenlibsSupportPage from "./pages/KenlibsSupportPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import AdminAnalyticsPage from "./pages/AdminAnalyticsPage";
import AdminReviewsPage from "./pages/AdminReviewsPage";
import OfflineBanner from "./components/shared/OfflineBanner";
import KenlibsThemeLayout from "./components/kenlibs/KenlibsThemeLayout";

const App = () => {
  return (
    <div>
      <OfflineBanner />
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
      </Routes>
    </div>
  );
};

export default App;
