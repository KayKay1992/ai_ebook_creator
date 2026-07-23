import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const ProtectedRoute = ({ children }) => {
  // const isAunthenticated = false;
  // const loading = false;

  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    // show loading spinner here
    return <h1>Loading...</h1>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
};
export default ProtectedRoute;
