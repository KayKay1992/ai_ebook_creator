import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, BookX, ShoppingBag } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import FlipCover from "../components/kenlibs/FlipCover";
import Button from "../components/ui/Button";
import { useAuth } from "../context/AuthContext";
import { getBookBadge } from "../utils/kenlibsPricing";
import useDocumentTitle from "../hooks/useDocumentTitle";

const KenlibsBookDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [book, setBook] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useDocumentTitle(book ? `${book.title} — Kenlibs` : "Kenlibs");

  useEffect(() => {
    const fetchBook = async () => {
      try {
        const res = await axiosInstance.get(`${API_PATHS.PUBLIC.KENLIBS_BOOK}/${id}`);
        setBook(res.data);
      } catch {
        // 404 just means unpublished/removed/invalid id — not an app error.
        setBook(null);
      } finally {
        setIsLoading(false);
      }
    };
    fetchBook();
  }, [id]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <KenlibsNav />
        <div className="max-w-5xl mx-auto px-6 lg:px-8 py-16 grid md:grid-cols-[280px_1fr] gap-12 animate-pulse">
          <div className="aspect-[2/3] w-full max-w-[280px] rounded-2xl bg-gray-100" />
          <div className="space-y-4">
            <div className="h-8 bg-gray-100 rounded-lg w-3/4" />
            <div className="h-4 bg-gray-100 rounded-lg w-1/3" />
            <div className="h-24 bg-gray-100 rounded-lg w-full mt-6" />
          </div>
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="min-h-screen bg-gray-50">
        <KenlibsNav />
        <div className="flex flex-col items-center justify-center py-32 text-center px-6">
          <div className="w-20 h-20 bg-accent-50 rounded-3xl flex items-center justify-center mb-6">
            <BookX className="w-10 h-10 text-accent-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            This book isn't available
          </h2>
          <p className="text-gray-500 max-w-md mb-8">
            It may have been unpublished, or the link may be incorrect.
          </p>
          <Link to="/kenlibs">
            <Button className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Kenlibs
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const badge = getBookBadge(book);
  const blurb = book.coverDesign?.back?.blurb?.trim();
  const authorBio = book.coverDesign?.back?.authorBio?.trim();
  const authorPhoto = book.coverDesign?.back?.authorPhoto;
  const canBuy = badge?.type === "price";

  return (
    <div className="min-h-screen bg-gray-50">
      <KenlibsNav />

      <div className="max-w-5xl mx-auto px-6 lg:px-8 py-12">
        <Link
          to="/kenlibs"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Kenlibs
        </Link>

        <div className="grid md:grid-cols-[280px_1fr] gap-12">
          <div className="group w-full max-w-[280px] mx-auto md:mx-0">
            <FlipCover
              title={book.title}
              subtitle={book.subtitle}
              author={book.author}
              coverImage={book.coverImage}
              coverDesign={book.coverDesign}
              size="lg"
              rounded="rounded-2xl"
              className="shadow-xl"
            />
          </div>

          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
              {book.title || "Untitled Book"}
            </h1>
            {book.subtitle && (
              <p className="text-lg text-gray-500 mt-1 font-serif italic">
                {book.subtitle}
              </p>
            )}
            <p className="text-gray-600 mt-3">
              by <span className="font-medium">{book.author || "Unknown Author"}</span>
            </p>

            <div className="mt-5">
              {badge?.type === "price" ? (
                <span className="inline-flex px-4 py-1.5 rounded-full text-sm font-semibold bg-accent text-white">
                  {badge.label}
                </span>
              ) : (
                <span className="inline-flex px-4 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-500">
                  Coming Soon
                </span>
              )}
            </div>

            {blurb && (
              <p className="mt-6 text-gray-700 leading-relaxed font-serif italic max-w-xl">
                {blurb}
              </p>
            )}

            {authorBio && (
              <div className="mt-8 flex items-start gap-3 border-t border-gray-100 pt-6 max-w-xl">
                {authorPhoto ? (
                  <img
                    src={authorPhoto}
                    alt=""
                    className="w-11 h-11 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-gray-100 flex-shrink-0" />
                )}
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {book.author || "Unknown Author"}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">{authorBio}</p>
                </div>
              </div>
            )}

            <div className="mt-10">
              <Button
                disabled={!canBuy}
                title={canBuy ? undefined : "This book isn't purchasable yet."}
                onClick={() => {
                  const checkoutPath = `/kenlibs/checkout/book/${id}`;
                  if (!isAuthenticated) {
                    navigate("/kenlibs/login", { state: { from: checkoutPath } });
                  } else {
                    navigate(checkoutPath);
                  }
                }}
                className="flex items-center gap-2"
              >
                <ShoppingBag className="w-4 h-4" />
                {canBuy ? "Request to Buy" : "Coming Soon"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default KenlibsBookDetailPage;
