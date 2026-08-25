import { useState, useEffect, useRef } from "react";
import {
  Plus,
  Sparkles,
  Trash2,
  ArrowLeft,
  BookOpen,
  Hash,
  Lightbulb,
  Palette,
  Check,
} from "lucide-react";
import Modal from "../ui/Modal";
import InputField from "../ui/inputField";
import Button from "../ui/Button";
import TonePicker from "../shared/TonePicker";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import toast from "react-hot-toast";
import { useAuth } from "../../context/AuthContext";

const CreateBookModal = ({ isOpen, onClose, onBookCreated }) => {
  const { user } = useAuth();

  const [step, setStep] = useState(1);
  const [bookTitle, setBookTitle] = useState("");
  const [numChapters, setNumChapters] = useState(5);
  const [aiTopic, setAiTopic] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [useIntroConclusion, setUseIntroConclusion] = useState(true);
  const [selectedTones, setSelectedTones] = useState(["Informative"]);
  const [chapters, setChapters] = useState([]);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [isFinalizingBook, setIsFinalizingBook] = useState(false);
  const chaptersContainerRef = useRef(null);

  const resetModal = () => {
    setStep(1);
    setBookTitle("");
    setNumChapters(5);
    setAiTopic("");
    setAiDescription("");
    setUseIntroConclusion(true);
    setSelectedTones(["Informative"]);
    setChapters([]);
    setIsGeneratingOutline(false);
    setIsFinalizingBook(false);
  };

  const handleGenerateOutline = async () => {
    if (!bookTitle || !numChapters) {
      toast.error("Please fill in all required fields.");
      return;
    }
    if (selectedTones.length === 0) {
      toast.error("Please select at least one tone.");
      return;
    }
    setIsGeneratingOutline(true);
    try {
      const response = await axiosInstance.post(API_PATHS.AI.GENERATE_OUTLINE, {
        title: bookTitle,
        numChapters: Number(numChapters),
        topic: aiTopic || "",
        description: aiDescription || "",
        tones: selectedTones,
        useIntroConclusionStructure: useIntroConclusion,
      });
      setChapters(response.data.outline || []);
      setStep(2);
      toast.success("Outline generated successfully!");
    } catch (error) {
      toast.error(error.response?.data?.message || "Error generating outline.");
    } finally {
      setIsGeneratingOutline(false);
    }
  };

  const handleChapterChange = (index, field, value) => {
    const updated = [...chapters];
    updated[index][field] = value;
    setChapters(updated);
  };

  const handleDeleteChapter = (index) => {
    if (chapters.length <= 1) return;
    setChapters(chapters.filter((_, i) => i !== index));
  };

  const handleAddChapter = () => {
    setChapters([
      ...chapters,
      { title: `Chapter ${chapters.length + 1}`, description: "" },
    ]);
  };

  const handleFinalizeBook = async () => {
    if (!bookTitle || chapters.length === 0) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setIsFinalizingBook(true);
    try {
      const response = await axiosInstance.post(API_PATHS.BOOKS.CREATE_BOOK, {
        title: bookTitle,
        author: user?.name || "Unknown Author",
        description: aiDescription || "",
        chapters,
        tones: selectedTones,
        useIntroConclusionStructure: useIntroConclusion,
      });
      onBookCreated(response.data._id);
      toast.success("Book created successfully!");
      onClose();
      resetModal();
    } catch (error) {
      toast.error(error.response?.data?.message || "Error creating book.");
    } finally {
      setIsFinalizingBook(false);
    }
  };

  useEffect(() => {
    if (step === 2 && chaptersContainerRef.current) {
      chaptersContainerRef.current.scrollTo({
        top: chaptersContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [chapters.length, step]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        resetModal();
      }}
      title="Create New eBook"
    >
      {/* Progress Steps */}
      <div className="flex items-center justify-center gap-4 mb-10">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all ${
              step === 1
                ? "bg-accent text-white shadow-lg shadow-accent-500/30"
                : "bg-emerald-500 text-white"
            }`}
          >
            {step > 1 ? <Check className="w-5 h-5" /> : "1"}
          </div>
          <span className={`text-sm font-medium ${step === 1 ? "text-accent" : "text-gray-500"}`}>
            Details
          </span>
        </div>

        <div className={`w-16 h-0.5 ${step > 1 ? "bg-emerald-500" : "bg-gray-200"}`} />

        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-all ${
              step === 2
                ? "bg-accent text-white shadow-lg shadow-accent-500/30"
                : "bg-gray-100 text-gray-400"
            }`}
          >
            2
          </div>
          <span className={`text-sm font-medium ${step === 2 ? "text-accent" : "text-gray-400"}`}>
            Outline
          </span>
        </div>
      </div>

      {/* STEP 1 */}
      {step === 1 && (
        <div className="space-y-6">
          <InputField
            icon={BookOpen}
            label="Book Title"
            value={bookTitle}
            onChange={(e) => setBookTitle(e.target.value)}
            placeholder="e.g. The Art of Modern Storytelling"
          />

          <InputField
            icon={Hash}
            label="Number of Chapters"
            type="number"
            min={1}
            max={20}
            value={numChapters}
            onChange={(e) => setNumChapters(e.target.value)}
            placeholder="5"
          />

          <InputField
            icon={Lightbulb}
            label="Topic (Optional)"
            value={aiTopic}
            onChange={(e) => setAiTopic(e.target.value)}
            placeholder="e.g. Personal growth, science fiction, history..."
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-700">
              Description (Optional)
            </label>
            <textarea
              value={aiDescription}
              onChange={(e) => setAiDescription(e.target.value)}
              placeholder="e.g. A practical guide for young professionals on breaking financial trauma and building wealth from scratch"
              rows={3}
              className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-all duration-200 resize-none"
            />
            <p className="text-xs text-gray-400">
              Topic is a broad category (e.g. "personal finance"). Description
              is this book's specific angle, argument, audience, or premise.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-gray-700">
                Introduction & Conclusion Structure
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                First chapter frames a genuine introduction, last chapter a
                genuine conclusion with action steps.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setUseIntroConclusion((v) => !v)}
              className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${
                useIntroConclusion ? "bg-accent" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  useIntroConclusion ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
              <Palette className="w-4 h-4 text-gray-400" />
              Tone & Voice
              <span className="text-gray-400 font-normal">(choose 1-7)</span>
            </label>
            <TonePicker value={selectedTones} onChange={setSelectedTones} />
          </div>

          <div className="pt-4">
            <Button
              onClick={handleGenerateOutline}
              loading={isGeneratingOutline}
              className="w-full flex items-center justify-center gap-2"
            >
              <Sparkles className="w-5 h-5" />
              Generate Outline with AI
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2 */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Review & Edit Chapters</h3>
              <p className="text-sm text-gray-500 mt-1">
                {chapters.length} chapter{chapters.length !== 1 ? "s" : ""} generated
              </p>
            </div>
          </div>

          <div
            ref={chaptersContainerRef}
            className="max-h-[380px] overflow-y-auto space-y-4 pr-2"
          >
            {chapters.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <BookOpen className="w-12 h-12 mx-auto mb-4 opacity-40" />
                <p>No chapters yet. Go back and generate an outline.</p>
              </div>
            ) : (
              chapters.map((chapter, index) => (
                <div
                  key={index}
                  className="bg-gray-50 border border-gray-100 rounded-2xl p-5 hover:border-accent-200 transition-colors"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-8 h-8 rounded-xl bg-accent-100 text-accent-hover flex items-center justify-center text-sm font-semibold flex-shrink-0">
                      {index + 1}
                    </div>
                    <input
                      type="text"
                      value={chapter.title}
                      onChange={(e) => handleChapterChange(index, "title", e.target.value)}
                      className="flex-1 bg-transparent border-none outline-none font-medium text-gray-900 placeholder:text-gray-400"
                      placeholder="Chapter Title"
                    />
                    <button
                      onClick={() => handleDeleteChapter(index)}
                      className="text-gray-400 hover:text-red-500 transition-colors p-1"
                      title="Delete Chapter"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <textarea
                    value={chapter.description}
                    onChange={(e) => handleChapterChange(index, "description", e.target.value)}
                    placeholder="Brief description of this chapter..."
                    rows={2}
                    className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 resize-none"
                  />
                </div>
              ))
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <Button
              variant="secondary"
              onClick={() => setStep(1)}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>

            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={handleAddChapter}
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Chapter
              </Button>

              <Button
                onClick={handleFinalizeBook}
                loading={isFinalizingBook}
                className="flex items-center gap-2"
              >
                Create Book
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default CreateBookModal;