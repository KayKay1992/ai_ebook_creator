import React from "react";
import { Routes, Route } from "react-router-dom";
import AdminRoute from "./components/auth/AdminRoute";
import ReaderRoute from "./components/auth/ReaderRoute";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import DashboardPage from "./pages/DashboardPage";
import ProfilePage from "./pages/ProfilePage";
import EditorPage from "./pages/EditorPage";
import CoverDesignerPage from "./pages/CoverDesignerPage";
import ViewBookPage from "./pages/ViewBookPage";
import ReadBookPage from "./pages/ReadBookPage";
import AdminBundlesPage from "./pages/AdminBundlesPage";
import KenlibsPage from "./pages/KenlibsPage";
import KenlibsBookDetailPage from "./pages/KenlibsBookDetailPage";
import KenlibsBundleDetailPage from "./pages/KenlibsBundleDetailPage";
import KenlibsLoginPage from "./pages/KenlibsLoginPage";
import KenlibsSignupPage from "./pages/KenlibsSignupPage";
import KenlibsCheckoutPage from "./pages/KenlibsCheckoutPage";
import KenlibsMyBooksPage from "./pages/KenlibsMyBooksPage";
import OfflineBanner from "./components/shared/OfflineBanner";

const App = () => {
  return (
    <div>
      <OfflineBanner />
      <Routes>
        {/* public route */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/read/:shareId" element={<ReadBookPage />} />

        {/* Kenlibs storefront + auth — genuinely public, no route guard at
            all (see KENLIBS-ARCHITECTURE.md's route map). */}
        <Route path="/kenlibs" element={<KenlibsPage />} />
        <Route path="/kenlibs/book/:id" element={<KenlibsBookDetailPage />} />
        <Route path="/kenlibs/bundle/:id" element={<KenlibsBundleDetailPage />} />
        <Route path="/kenlibs/login" element={<KenlibsLoginPage />} />
        <Route path="/kenlibs/signup" element={<KenlibsSignupPage />} />

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

          {/* admin-only route (creator surface — see KENLIBS-ARCHITECTURE.md) */}
          <Route path="/dashboard" element={<AdminRoute><DashboardPage /></AdminRoute>} />
          <Route path="/profile" element={<AdminRoute><ProfilePage /></AdminRoute>} />
          <Route path='/editor/:bookId' element={<AdminRoute><EditorPage /></AdminRoute>} />
          <Route path='/editor/:bookId/cover' element={<AdminRoute><CoverDesignerPage /></AdminRoute>} />
          <Route path='/view-book/:bookId' element={<AdminRoute><ViewBookPage /></AdminRoute>} />
          <Route path='/admin/bundles' element={<AdminRoute><AdminBundlesPage /></AdminRoute>} />
      </Routes>
    </div>
  );
};

export default App;
