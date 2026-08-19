export const BASE_URL = "http://localhost:8000";   // Change this to your backend URL in production

export const API_PATHS = {
  AUTH: {
    LOGIN: "/api/auth/login",
    REGISTER: "/api/auth/register",
    PROFILE: "/api/auth/profile",
    UPDATE_PROFILE: "/api/auth/profile",
  },
  BOOKS: {
    CREATE_BOOK: "/api/books",
    GET_BOOKS: "/api/books",
    GET_BOOK_BY_ID: "/api/books",
    UPDATE_BOOK: "/api/books",
    DELETE_BOOK: "/api/books",
    UPDATE_COVER: "/api/books/cover",
    UPLOAD_CHAPTER_IMAGE: "/api/books/chapter-image",
    TOGGLE_PUBLISH: "/api/books",
    UPLOAD_COVER_DESIGN_FRONT_IMAGE: "/api/books/cover-design/front-image",
    UPLOAD_COVER_DESIGN_AUTHOR_PHOTO: "/api/books/cover-design/author-photo",
  },
  PUBLIC: {
    GET_BOOK_BY_SHARE_ID: "/api/public/books",
  },
  AI: {
    GENERATE_OUTLINE: "/api/ai/generate-outline",
    GENERATE_CHAPTER_CONTENT: "/api/ai/generate-chapter-content",
    EDIT_SELECTION: "/api/ai/edit-selection",
    GENERATE_BLURB: "/api/ai/generate-blurb",
  },
  EXPORT: {
    PDF: "/api/export",
    DOC: "/api/export",
    EPUB: "/api/export",
  },
  BUNDLES: {
    BASE: "/api/bundles",
  },
};