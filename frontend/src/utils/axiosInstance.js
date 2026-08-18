import axios from 'axios';
import {BASE_URL} from './apiPaths';

const axiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 120000, // 2 minutes timeout
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

//Request interceptor to add the token to headers
axiosInstance.interceptors.request.use(
  (config) => {
    // Only fill in the token from localStorage if the caller didn't already
    // set an explicit Authorization header. Without this check, this
    // interceptor unconditionally clobbers any explicit header — e.g.
    // LoginPage.jsx fetches the freshly-logged-in user's profile using the
    // token it just received, specifically to avoid depending on
    // localStorage (which may still hold a *different* stale session's
    // token at that exact moment, before login() has written the new one).
    // That explicit header was being silently overwritten with the old
    // token, so the "who am I" profile fetch after login could return the
    // previous session's user/role instead of the one that just signed in.
    const accessToken = localStorage.getItem('token');
    if (accessToken && !config.headers.Authorization) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

//Response interceptor to handle errors globally
axiosInstance.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    //handle common errors globally
    if (error.response) {
      if (error.response.status === 500) {
        console.error('Internal Server Error');
      }
    }else if (error.code === 'ECONNABORTED') {
        console.error('Request timeout. Please try again.');
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;