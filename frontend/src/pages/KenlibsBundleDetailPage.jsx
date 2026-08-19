import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, PackageX, ShoppingBag } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import CoverPreview from "../components/cards/CoverPreview";
import Button from "../components/ui/Button";
import { useAuth } from "../context/AuthContext";
import { formatNaira } from "../utils/kenlibsPricing";
import useDocumentTitle from "../hooks/useDocumentTitle";

const KenlibsBundleDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [bundle, setBundle] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useDocumentTitle(bundle ? `${bundle.title} — Kenlibs` : "Kenlibs");

  useEffect(() => {
    const fetchBundle = async () => {
      try {
        const res = await axiosInstance.get(`${API_PATHS.PUBLIC.KENLIBS_BUNDLE}/${id}`);
        setBundle(res.data);
      } catch {
        setBundle(null);
      } finally {
        setIsLoading(false);
      }
    };
    fetchBundle();
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

  if (!bundle) {
    return (
      <div className="min-h-screen bg-gray-50">
        <KenlibsNav />
        <div className="flex flex-col items-center justify-center py-32 text-center px-6">
          <div className="w-20 h-20 bg-accent-50 rounded-3xl flex items-center justify-center mb-6">
            <PackageX className="w-10 h-10 text-accent-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            This bundle isn't available
          </h2>
          <p className="text-gray-500 max-w-md mb-8">
            It may have been unlisted, or the link may be incorrect.
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

  const books = bundle.books || [];

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
          <div className="w-full max-w-[280px] mx-auto md:mx-0">
            {bundle.coverImage ? (
              <img
                src={bundle.coverImage}
                alt=""
                className="w-full aspect-[2/3] object-cover rounded-2xl shadow-xl"
              />
            ) : (
              <div className="grid grid-cols-2 grid-rows-2 gap-1 aspect-[2/3] rounded-2xl overflow-hidden shadow-xl bg-gray-300">
                {books.slice(0, 4).map((b) => {
                  const cover = b.coverDesign?.front?.backgroundImage || b.coverImage;
                  return (
                    <div key={b._id} className="relative overflow-hidden bg-gray-800">
                      {cover && (
                        <img
                          src={cover}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
              {bundle.title}
            </h1>
            <p className="text-gray-600 mt-3">
              {books.length} book{books.length === 1 ? "" : "s"} in this bundle
            </p>

            <div className="mt-5">
              <span className="inline-flex px-4 py-1.5 rounded-full text-sm font-semibold bg-accent text-white">
                {formatNaira(bundle.price)}
              </span>
            </div>

            {bundle.description && (
              <p className="mt-6 text-gray-700 leading-relaxed max-w-xl">
                {bundle.description}
              </p>
            )}

            {books.length > 0 && (
              <div className="mt-8 border-t border-gray-100 pt-6">
                <h2 className="text-sm font-semibold text-gray-900 mb-4">
                  What's included
                </h2>
                <div className="flex flex-wrap gap-4">
                  {books.map((b) => (
                    <Link
                      key={b._id}
                      to={`/kenlibs/book/${b._id}`}
                      className="w-20 flex-shrink-0"
                    >
                      <CoverPreview
                        title={b.title}
                        author={b.author}
                        coverImage={b.coverImage}
                        coverDesign={b.coverDesign}
                        size="sm"
                        rounded="rounded-lg"
                      />
                      <p className="text-xs text-gray-600 mt-1.5 line-clamp-2">
                        {b.title}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-10">
              <Button
                onClick={() => {
                  const checkoutPath = `/kenlibs/checkout/bundle/${id}`;
                  if (!isAuthenticated) {
                    navigate("/kenlibs/login", { state: { from: checkoutPath } });
                  } else {
                    navigate(checkoutPath);
                  }
                }}
                className="flex items-center gap-2"
              >
                <ShoppingBag className="w-4 h-4" />
                Request to Buy
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default KenlibsBundleDetailPage;
