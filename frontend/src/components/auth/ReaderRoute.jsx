import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import AuthLoadingScreen from "../skeletons/AuthLoadingScreen";

// Guards authenticated Kenlibs surfaces (checkout, my-books, gated reading).
// Only requires *some* authenticated user — admins are deliberately let
// through too, since an admin browsing their own storefront is harmless.
// Not wired to any routes yet (those land in Steps 25/26+); this exists now
// so the guarding mechanism is proven alongside AdminRoute. See
// KENLIBS-ARCHITECTURE.md section 4.
const ReaderRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <AuthLoadingScreen />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/kenlibs/login" state={{ from: location }} replace />;
  }
  return children;
};

export default ReaderRoute;
