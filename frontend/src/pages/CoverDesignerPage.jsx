import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  UploadCloud,
  Sparkles,
  Plus,
  Trash2,
  Check,
  Loader2,
  AlertCircle,
  AlignLeft,
  AlignCenter,
  AlignRight,
  BookOpen,
  FileText,
  User,
  Image as ImageIcon,
  Type,
  Tag,
  Quote,
  Boxes,
  Info,
} from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import CoverPreview from "../components/cards/CoverPreview";
import Button from "../components/ui/Button";

const AUTOSAVE_DELAY_MS = 2500;

const TITLE_COLOR_PRESETS = ["#ffffff", "#111827", "#fef3c7", "#fecdd3", "#c4b5fd"];

// Curated, tasteful gradient pairs — deliberately not a full color wheel,
// so the choice stays "designed" rather than garish. "Signature" is
// intentionally empty (from/to: "") so it maps to the theme's own
// --color-accent/--color-accent-secondary tokens in CoverPreview.jsx,
// which is also what every book with gradient style rendered before this
// picker existed — picking it back is a true no-op, not a new gradient
// that happens to look similar.
const GRADIENT_PRESETS = [
  { name: "Signature", from: "", to: "" },
  { name: "Midnight", from: "#1e3a5f", to: "#4338ca" },
  { name: "Charcoal", from: "#1f2937", to: "#475569" },
  { name: "Crimson", from: "#991b1b", to: "#7f1d1d" },
  { name: "Forest", from: "#14532d", to: "#0f766e" },
  { name: "Amber", from: "#92400e", to: "#c2410c" },
  { name: "Rose", from: "#be185d", to: "#a21caf" },
  { name: "Ocean", from: "#1e40af", to: "#0891b2" },
];

const TEXTAREA_CLASS =
  "w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-all duration-200 resize-none";
const INPUT_CLASS =
  "w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-all duration-200";

// A distinct header band (icon + tracked-out eyebrow label) separates each
// section from its fields, so the sidebar reads as a considered panel of
// grouped controls rather than one long stack of same-weight labels.
const SectionCard = ({ title, icon: Icon, children }) => (
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
    <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50/70">
      {Icon && <Icon className="w-3.5 h-3.5 text-accent-hover" />}
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        {title}
      </h3>
    </div>
    <div className="p-5 space-y-4">{children}</div>
  </div>
);

const Field = ({ label, children, action }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      {action}
    </div>
    {children}
  </div>
);

const Toggle = ({ checked, onChange }) => (
  <button
    type="button"
    onClick={onChange}
    className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${
      checked ? "bg-accent" : "bg-gray-300"
    }`}
  >
    <span
      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
        checked ? "translate-x-5" : ""
      }`}
    />
  </button>
);

// Dedicated full front/back cover editor — extends Step 15's CoverPreview
// (rather than reimplementing cover rendering) with everything a published
// book cover needs: background style, title styling, and a full back cover
// with blurb, author bio/photo, and review quotes.
const CoverDesignerPage = () => {
  const { bookId } = useParams();
  const navigate = useNavigate();

  const [book, setBook] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSide, setActiveSide] = useState("front");
  const [saveStatus, setSaveStatus] = useState("saved");
  const [isUploadingFront, setIsUploadingFront] = useState(false);
  const [isUploadingAuthorPhoto, setIsUploadingAuthorPhoto] = useState(false);
  const [isGeneratingBlurb, setIsGeneratingBlurb] = useState(false);
  const [isUploadingRender3DFront, setIsUploadingRender3DFront] = useState(false);
  const [isUploadingRender3DBack, setIsUploadingRender3DBack] = useState(false);

  const frontFileInputRef = useRef(null);
  const authorPhotoInputRef = useRef(null);
  const render3DFrontInputRef = useRef(null);
  const render3DBackInputRef = useRef(null);
  const autosaveTimerRef = useRef(null);

  useEffect(() => {
    const fetchBook = async () => {
      try {
        const response = await axiosInstance.get(
          `${API_PATHS.BOOKS.GET_BOOK_BY_ID}/${bookId}`
        );
        setBook(response.data);
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to load book"));
        navigate("/dashboard");
      } finally {
        setIsLoading(false);
      }
    };
    fetchBook();
  }, [bookId, navigate]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (saveStatus === "unsaved" || saveStatus === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [saveStatus]);

  const scheduleAutosave = (updatedBook) => {
    setSaveStatus("unsaved");
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await axiosInstance.put(
          `${API_PATHS.BOOKS.UPDATE_BOOK}/${bookId}`,
          updatedBook
        );
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, AUTOSAVE_DELAY_MS);
  };

  const updateFront = (patch) => {
    const updatedBook = {
      ...book,
      coverDesign: {
        ...book.coverDesign,
        front: { ...book.coverDesign.front, ...patch },
      },
    };
    setBook(updatedBook);
    scheduleAutosave(updatedBook);
  };

  const updateBack = (patch) => {
    const updatedBook = {
      ...book,
      coverDesign: {
        ...book.coverDesign,
        back: { ...book.coverDesign.back, ...patch },
      },
    };
    setBook(updatedBook);
    scheduleAutosave(updatedBook);
  };

  const updateRender3D = (patch) => {
    const updatedBook = {
      ...book,
      coverDesign: {
        ...book.coverDesign,
        render3D: { ...book.coverDesign.render3D, ...patch },
      },
    };
    setBook(updatedBook);
    scheduleAutosave(updatedBook);
  };

  const handleFrontImageUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);
    setIsUploadingFront(true);
    try {
      const response = await axiosInstance.put(
        `${API_PATHS.BOOKS.UPLOAD_COVER_DESIGN_FRONT_IMAGE}/${bookId}`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setBook(response.data);
      toast.success("Cover image updated!");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to upload image"));
    } finally {
      setIsUploadingFront(false);
    }
  };

  const handleAuthorPhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);
    setIsUploadingAuthorPhoto(true);
    try {
      const response = await axiosInstance.put(
        `${API_PATHS.BOOKS.UPLOAD_COVER_DESIGN_AUTHOR_PHOTO}/${bookId}`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setBook(response.data);
      toast.success("Author photo updated!");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to upload photo"));
    } finally {
      setIsUploadingAuthorPhoto(false);
    }
  };

  const handleRender3DFrontUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);
    setIsUploadingRender3DFront(true);
    try {
      const response = await axiosInstance.put(
        `${API_PATHS.BOOKS.UPLOAD_RENDER3D_FRONT_IMAGE}/${bookId}`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setBook(response.data);
      toast.success("Front mockup uploaded!");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to upload image"));
    } finally {
      setIsUploadingRender3DFront(false);
    }
  };

  const handleRender3DBackUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const formData = new FormData();
    formData.append("image", file);
    setIsUploadingRender3DBack(true);
    try {
      const response = await axiosInstance.put(
        `${API_PATHS.BOOKS.UPLOAD_RENDER3D_BACK_IMAGE}/${bookId}`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      setBook(response.data);
      toast.success("Back mockup uploaded!");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to upload image"));
    } finally {
      setIsUploadingRender3DBack(false);
    }
  };

  const handleGenerateBlurb = async () => {
    setIsGeneratingBlurb(true);
    try {
      const response = await axiosInstance.post(API_PATHS.AI.GENERATE_BLURB, {
        bookId,
      });
      updateBack({ blurb: response.data.blurb });
      toast.success("Blurb generated!");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to generate blurb"));
    } finally {
      setIsGeneratingBlurb(false);
    }
  };

  const handleAddQuote = () => {
    const current = book.coverDesign.back.reviewQuotes || [];
    if (current.length >= 3) return;
    updateBack({ reviewQuotes: [...current, { quote: "", attribution: "" }] });
  };

  const handleQuoteChange = (index, field, value) => {
    const current = [...(book.coverDesign.back.reviewQuotes || [])];
    current[index] = { ...current[index], [field]: value };
    updateBack({ reviewQuotes: current });
  };

  const handleRemoveQuote = (index) => {
    const current = (book.coverDesign.back.reviewQuotes || []).filter(
      (_, i) => i !== index
    );
    updateBack({ reviewQuotes: current });
  };

  if (isLoading || !book) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  const front = book.coverDesign.front;
  const back = book.coverDesign.back;
  const quotes = back.reviewQuotes || [];
  const render3D = book.coverDesign.render3D;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-gray-200">
        <div className="flex items-center justify-between px-4 lg:px-8 h-16">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => navigate(`/editor/${bookId}`)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-600 hover:bg-gray-100 flex-shrink-0"
              title="Back to editor"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-gray-900 truncate">
                Cover Designer
              </h1>
              <p className="text-xs text-gray-500 truncate">
                {book.title || "Untitled Book"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {saveStatus === "saved" && (
              <span className="hidden sm:flex items-center gap-1.5 text-sm text-emerald-600">
                <Check className="w-4 h-4" />
                Saved
              </span>
            )}
            {saveStatus === "saving" && (
              <span className="hidden sm:flex items-center gap-1.5 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving…
              </span>
            )}
            {saveStatus === "unsaved" && (
              <span className="hidden sm:flex items-center gap-1.5 text-sm text-gray-500">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Unsaved changes
              </span>
            )}
            {saveStatus === "error" && (
              <span className="hidden sm:flex items-center gap-1.5 text-sm text-red-600">
                <AlertCircle className="w-4 h-4" />
                Couldn't save
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8 max-w-7xl w-full mx-auto px-4 lg:px-8 py-8">
        {/* ===== Live Preview ===== */}
        <div className="flex flex-col items-center">
          <div className="flex items-center bg-gray-100 p-1 rounded-2xl mb-6">
            <button
              onClick={() => setActiveSide("front")}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-all ${
                activeSide === "front"
                  ? "bg-white text-accent-hover shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <BookOpen className="w-4 h-4" />
              Front Cover
            </button>
            <button
              onClick={() => setActiveSide("back")}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-all ${
                activeSide === "back"
                  ? "bg-white text-accent-hover shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <FileText className="w-4 h-4" />
              Back Cover
            </button>
            <button
              onClick={() => setActiveSide("3d")}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium transition-all ${
                activeSide === "3d"
                  ? "bg-white text-accent-hover shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <Boxes className="w-4 h-4" />
              3D Mockup
            </button>
          </div>

          <div className="w-full max-w-sm">
            {activeSide === "3d" ? (
              render3D.frontImage ? (
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-3xl shadow-2xl bg-gray-100">
                  <img
                    src={render3D.frontImage}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  {render3D.isActive && (
                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500 text-white shadow-sm">
                      Active cover
                    </span>
                  )}
                </div>
              ) : (
                <div className="aspect-[2/3] w-full rounded-3xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-center px-6 text-gray-400">
                  <Boxes className="w-10 h-10 mb-3" />
                  <p className="text-sm">
                    Upload a front mockup image to preview it here.
                  </p>
                </div>
              )
            ) : (
              <CoverPreview
                title={book.title}
                subtitle={book.subtitle}
                author={book.author}
                coverImage={book.coverImage}
                coverDesign={book.coverDesign}
                side={activeSide}
                size="lg"
                rounded="rounded-3xl"
                className="shadow-2xl"
              />
            )}
          </div>
        </div>

        {/* ===== Editing Controls ===== */}
        <div className="space-y-5">
          {render3D.isActive && activeSide !== "3d" && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 text-amber-700 text-xs rounded-2xl px-4 py-3">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                The 3D Cover Mockup is currently active as this book's cover
                — changes here won't be visible until you turn it off in the
                3D Mockup tab.
              </span>
            </div>
          )}

          {activeSide === "front" ? (
            <>
              <SectionCard title="Background" icon={ImageIcon}>
                <Field label="Style">
                  <div className="flex items-center gap-2">
                    {["image", "gradient", "solid"].map((style) => (
                      <button
                        key={style}
                        type="button"
                        onClick={() => updateFront({ backgroundStyle: style })}
                        className={`px-4 py-2 rounded-full text-sm font-medium border transition-all capitalize ${
                          front.backgroundStyle === style
                            ? "bg-accent text-white border-accent"
                            : "bg-white text-gray-600 border-gray-200 hover:border-accent-300"
                        }`}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </Field>

                {front.backgroundStyle === "image" && (
                  <Field label="Cover Image">
                    <input
                      type="file"
                      ref={frontFileInputRef}
                      accept="image/*"
                      onChange={handleFrontImageUpload}
                      className="hidden"
                    />
                    <Button
                      onClick={() => frontFileInputRef.current?.click()}
                      loading={isUploadingFront}
                      variant="secondary"
                      className="flex items-center gap-2 w-full justify-center"
                    >
                      <UploadCloud className="w-4 h-4" />
                      {isUploadingFront ? "Uploading..." : "Upload Image"}
                    </Button>
                  </Field>
                )}

                {front.backgroundStyle === "gradient" && (
                  <Field label="Gradient Colors">
                    <div className="flex items-center gap-2 flex-wrap">
                      {GRADIENT_PRESETS.map((preset) => {
                        const isSelected =
                          (front.gradientFrom || "") === preset.from &&
                          (front.gradientTo || "") === preset.to;
                        return (
                          <button
                            key={preset.name}
                            type="button"
                            onClick={() =>
                              updateFront({
                                gradientFrom: preset.from,
                                gradientTo: preset.to,
                              })
                            }
                            className={`w-8 h-8 rounded-full border-2 transition-all ${
                              isSelected ? "border-accent scale-110" : "border-gray-200"
                            }`}
                            style={{
                              background: `linear-gradient(to bottom right, ${
                                preset.from || "var(--color-accent)"
                              }, ${preset.to || "var(--color-accent-secondary)"})`,
                            }}
                            title={preset.name}
                          />
                        );
                      })}
                    </div>
                  </Field>
                )}
              </SectionCard>

              <SectionCard title="Title Styling" icon={Type}>
                <Field label="Text Color">
                  <div className="flex items-center gap-2 flex-wrap">
                    {TITLE_COLOR_PRESETS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => updateFront({ titleColor: color })}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${
                          front.titleColor === color
                            ? "border-accent scale-110"
                            : "border-gray-200"
                        }`}
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                    <label
                      className="w-8 h-8 rounded-full border-2 border-gray-200 overflow-hidden cursor-pointer relative flex-shrink-0"
                      title="Custom color"
                    >
                      <input
                        type="color"
                        value={front.titleColor || "#ffffff"}
                        onChange={(e) => updateFront({ titleColor: e.target.value })}
                        className="absolute -inset-1 cursor-pointer"
                      />
                    </label>
                  </div>
                </Field>

                <Field label="Alignment">
                  <div className="flex items-center gap-1 bg-gray-100 rounded-2xl p-1 w-fit">
                    {[
                      { key: "left", icon: AlignLeft },
                      { key: "center", icon: AlignCenter },
                      { key: "right", icon: AlignRight },
                    ].map(({ key, icon: Icon }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => updateFront({ titleAlign: key })}
                        className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                          front.titleAlign === key
                            ? "bg-white text-accent-hover shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </button>
                    ))}
                  </div>
                </Field>

                <Field
                  label="Show Subtitle"
                  action={
                    <Toggle
                      checked={front.showSubtitle}
                      onChange={() => updateFront({ showSubtitle: !front.showSubtitle })}
                    />
                  }
                >
                  <span />
                </Field>
              </SectionCard>

              <SectionCard title="Genre Tag" icon={Tag}>
                <Field label="Shown as a small badge on the cover (optional)">
                  <input
                    type="text"
                    value={front.genreTag || ""}
                    onChange={(e) => updateFront({ genreTag: e.target.value })}
                    placeholder="e.g. Fiction, Self-Help, Sci-Fi"
                    className={INPUT_CLASS}
                  />
                </Field>
              </SectionCard>
            </>
          ) : activeSide === "back" ? (
            <>
              <SectionCard title="Blurb" icon={FileText}>
                <Field
                  label="Back cover description"
                  action={
                    <Button
                      onClick={handleGenerateBlurb}
                      loading={isGeneratingBlurb}
                      variant="secondary"
                      className="!px-3 !py-1.5 !text-xs flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Generate with AI
                    </Button>
                  }
                >
                  <textarea
                    value={back.blurb || ""}
                    onChange={(e) => updateBack({ blurb: e.target.value })}
                    placeholder="A compelling summary that hooks readers..."
                    rows={6}
                    className={TEXTAREA_CLASS}
                  />
                </Field>
              </SectionCard>

              <SectionCard title="Author" icon={User}>
                <Field label="Author Photo (optional)">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full bg-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {back.authorPhoto ? (
                        <img
                          src={back.authorPhoto}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <User className="w-6 h-6 text-gray-300" />
                      )}
                    </div>
                    <input
                      type="file"
                      ref={authorPhotoInputRef}
                      accept="image/*"
                      onChange={handleAuthorPhotoUpload}
                      className="hidden"
                    />
                    <Button
                      onClick={() => authorPhotoInputRef.current?.click()}
                      loading={isUploadingAuthorPhoto}
                      variant="secondary"
                      className="flex items-center gap-2"
                    >
                      <UploadCloud className="w-4 h-4" />
                      {isUploadingAuthorPhoto ? "Uploading..." : "Upload"}
                    </Button>
                  </div>
                </Field>

                <Field label="Author Bio">
                  <textarea
                    value={back.authorBio || ""}
                    onChange={(e) => updateBack({ authorBio: e.target.value })}
                    placeholder="A short bio about you, the author..."
                    rows={4}
                    className={TEXTAREA_CLASS}
                  />
                </Field>
              </SectionCard>

              <SectionCard title="Review Quotes" icon={Quote}>
                <div className="space-y-4">
                  {quotes.map((q, index) => (
                    <div
                      key={index}
                      className="bg-gray-50 border border-gray-100 rounded-2xl p-4 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <textarea
                          value={q.quote}
                          onChange={(e) =>
                            handleQuoteChange(index, "quote", e.target.value)
                          }
                          placeholder='"A stunning achievement..."'
                          rows={2}
                          className={`${TEXTAREA_CLASS} bg-white`}
                        />
                        <button
                          onClick={() => handleRemoveQuote(index)}
                          className="text-gray-400 hover:text-red-500 transition-colors p-1 flex-shrink-0"
                          title="Remove quote"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={q.attribution}
                        onChange={(e) =>
                          handleQuoteChange(index, "attribution", e.target.value)
                        }
                        placeholder="Attribution, e.g. The New York Times"
                        className={`${INPUT_CLASS} bg-white`}
                      />
                    </div>
                  ))}

                  {quotes.length < 3 && (
                    <Button
                      onClick={handleAddQuote}
                      variant="secondary"
                      className="flex items-center gap-2 w-full justify-center"
                    >
                      <Plus className="w-4 h-4" />
                      Add Quote ({quotes.length}/3)
                    </Button>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="Genre Tag" icon={Tag}>
                <Field label="Shown as a small badge on the back cover (optional)">
                  <input
                    type="text"
                    value={back.genreTag || ""}
                    onChange={(e) => updateBack({ genreTag: e.target.value })}
                    placeholder="e.g. Fiction, Self-Help, Sci-Fi"
                    className={INPUT_CLASS}
                  />
                </Field>
              </SectionCard>
            </>
          ) : (
            <>
              <SectionCard title="3D Cover Mockup" icon={Boxes}>
                <div className="flex items-start gap-2 bg-gray-50 border border-gray-100 text-gray-600 text-xs rounded-2xl px-4 py-3">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-accent-hover" />
                  <span>
                    Upload a finished front + back render made elsewhere (AI
                    image tools, mockup generators, Photoshop) — this is a
                    pre-rendered image, not something built in the editor.
                  </span>
                </div>

                <Field label="Front Mockup">
                  <div className="flex items-center gap-4">
                    <div className="w-14 aspect-[2/3] rounded-xl bg-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {render3D.frontImage ? (
                        <img
                          src={render3D.frontImage}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Boxes className="w-5 h-5 text-gray-300" />
                      )}
                    </div>
                    <input
                      type="file"
                      ref={render3DFrontInputRef}
                      accept="image/*"
                      onChange={handleRender3DFrontUpload}
                      className="hidden"
                    />
                    <Button
                      onClick={() => render3DFrontInputRef.current?.click()}
                      loading={isUploadingRender3DFront}
                      variant="secondary"
                      className="flex items-center gap-2"
                    >
                      <UploadCloud className="w-4 h-4" />
                      {isUploadingRender3DFront
                        ? "Uploading..."
                        : render3D.frontImage
                          ? "Replace"
                          : "Upload"}
                    </Button>
                  </div>
                </Field>

                <Field label="Back Mockup">
                  <div className="flex items-center gap-4">
                    <div className="w-14 aspect-[2/3] rounded-xl bg-gray-100 overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {render3D.backImage ? (
                        <img
                          src={render3D.backImage}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Boxes className="w-5 h-5 text-gray-300" />
                      )}
                    </div>
                    <input
                      type="file"
                      ref={render3DBackInputRef}
                      accept="image/*"
                      onChange={handleRender3DBackUpload}
                      className="hidden"
                    />
                    <Button
                      onClick={() => render3DBackInputRef.current?.click()}
                      loading={isUploadingRender3DBack}
                      variant="secondary"
                      className="flex items-center gap-2"
                    >
                      <UploadCloud className="w-4 h-4" />
                      {isUploadingRender3DBack
                        ? "Uploading..."
                        : render3D.backImage
                          ? "Replace"
                          : "Upload"}
                    </Button>
                  </div>
                </Field>
              </SectionCard>

              <SectionCard title="Active Cover" icon={render3D.isActive ? Check : ImageIcon}>
                <Field
                  label="Use this 3D mockup as the book's cover"
                  action={
                    <Toggle
                      checked={render3D.isActive}
                      onChange={() => {
                        if (!render3D.isActive && !render3D.frontImage) {
                          toast.error("Upload a front mockup image first.");
                          return;
                        }
                        updateRender3D({ isActive: !render3D.isActive });
                      }}
                    />
                  }
                >
                  <p className="text-xs text-gray-500">
                    {render3D.isActive
                      ? "This 3D mockup is the book's cover everywhere it's shown — the flat cover design (Front Cover / Back Cover tabs) is hidden while this is on."
                      : "Off — the standard flat cover design (Front Cover / Back Cover tabs) is used as the book's cover."}
                  </p>
                </Field>
              </SectionCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CoverDesignerPage;
