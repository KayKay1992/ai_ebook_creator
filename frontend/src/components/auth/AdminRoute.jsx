import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import AuthLoadingScreen from "../skeletons/AuthLoadingScreen";

// Guards every creator/admin surface (dashboard, editor, cover designer,
// profile, the creator's own book preview). Anyone not authenticated goes
// to /login same as before; anyone authenticated but not role: 'admin'
// (i.e. a reader) is bounced to /kenlibs rather than treated as "logged in,
// so let them through" — a reader must never reach these routes, even by
// typing the URL directly. See KENLIBS-ARCHITECTURE.md section 4.
const AdminRoute = ({ children }) => {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AuthLoadingScreen />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (user?.role !== "admin") {
    return <Navigate to="/kenlibs" replace />;
  }
  return children;
};

export default AdminRoute;
