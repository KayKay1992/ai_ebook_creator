import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'

const ProtectedRoute = ({ children }) => {
const isAunthenticated = false;
const loading = false;
const location = useLocation();

if(loading){
    // show loading spinner here
  return <h1>Loading...</h1>
}
if(!isAunthenticated){
  return <Navigate to='/login' state={{from: location}} replace />
}
return children;
}
export default ProtectedRoute