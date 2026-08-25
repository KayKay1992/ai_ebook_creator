import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Sparkles,
  Trash2,
  Plus,
  GripVertical,
  BookOpen,
  Wand2,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Button from "../ui/Button";
import Modal from "../ui/Modal";

const MAX_GENERATE_MORE_CHAPTERS = 10;

const SortableItem = ({
  chapter,
  index,
  onSelectChapter,
  onDeleteChapter,
  selectedChapterIndex,
  onGenerateChapterContent,
  isGenerating,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chapter._id || `new-${index}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : "auto",
  };

  const isSelected = selectedChapterIndex === index;
  const isGeneratingThis = isGenerating === index;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex items-center gap-2 p-2 rounded-2xl transition-all duration-200 ${
        isDragging ? "opacity-80 shadow-2xl scale-[1.02]" : ""
      } ${isSelected ? "bg-accent-muted ring-1 ring-accent-200" : "hover:bg-gray-50"}`}
    >
      <button
        {...listeners}
        {...attributes}
        // touch-none: without it, the browser's own touch-action handling
        // on this element can race dnd-kit's TouchSensor for the same
        // gesture. Scoped to just this small handle, not the row/list, so
        // normal scrolling elsewhere is completely unaffected. Padding
        // bumped from p-1.5 (a ~28px hit area) to p-3 (~40px) — this is the
        // only way to reorder chapters on mobile, so it needs to be
        // reliably tappable, not just technically draggable.
        className="flex-shrink-0 p-3 -m-1.5 touch-none text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing rounded-lg hover:bg-gray-100 transition-colors"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <button
        onClick={() => onSelectChapter(index)}
        className="flex-1 text-left min-w-0 py-1.5"
      >
        <div className="flex items-center gap-3">
          <span
            className={`flex-shrink-0 w-7 h-7 rounded-xl flex items-center justify-center text-xs font-semibold ${
              isSelected
                ? "bg-accent text-white"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {index + 1}
          </span>
          <span
            className={`truncate text-sm font-serif font-medium ${
              isSelected ? "text-accent-900" : "text-gray-700"
            }`}
          >
            {chapter.title || `Chapter ${index + 1}`}
          </span>
        </div>
      </button>

      {/* Same hover-gating issue as the dashboard book-card icons: Tailwind's
          hover:/group-hover: variants are wrapped in `@media (hover: hover)`
          and never activate on touchscreens — always show below md, keep
          the desktop fade-in-on-hover above it. */}
      <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onGenerateChapterContent(index)}
          disabled={isGeneratingThis}
          className="p-2 rounded-xl text-accent hover:bg-accent-100 transition-colors disabled:opacity-50"
          title="Generate content with AI"
        >
          {isGeneratingThis ? (
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
        </button>

        <button
          onClick={() => onDeleteChapter(index)}
          className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Delete chapter"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

const ChapterSidebar = ({
  book,
  selectedChapterIndex,
  onSelectChapter,
  onAddChapter,
  onDeleteChapter,
  onReorderChapters,
  onGenerateChapterContent,
  isGenerating,
  onGenerateMoreChapters,
  isGeneratingMoreChapters,
  onToggleIntroConclusionStructure,
  isGeneratingIntroConclusion,
}) => {
  const navigate = useNavigate();
  const [isGenerateMoreOpen, setIsGenerateMoreOpen] = useState(false);
  const [moreChapterCount, setMoreChapterCount] = useState(5);

  // No `sensors` prop previously meant dnd-kit's default (PointerSensor with
  // no activation constraint) — it starts a drag on the very first pointer
  // movement, which on a touchscreen races the browser's own native scroll
  // gesture with nothing to tell them apart, so the drag either never wins
  // or eats all scrolling. MouseSensor + TouchSensor (rather than
  // PointerSensor alongside either) is dnd-kit's own documented combination
  // here — PointerSensor also receives touch pointer events in browsers
  // that support the Pointer Events API, which would double-activate
  // against a separate TouchSensor. TouchSensor's delay/tolerance is the
  // standard fix for the scroll-vs-drag ambiguity: a touch has to hold
  // still on the handle for 250ms (moving no more than 5px) before a drag
  // starts, so a normal scroll swipe that starts on/near the handle is left
  // alone and reaches the browser instead.
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const chapterIds = book.chapters.map(
    (chapter, index) => chapter._id || `new-${index}`
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = chapterIds.indexOf(active.id);
    const newIndex = chapterIds.indexOf(over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      onReorderChapters(oldIndex, newIndex);
    }
  };

  const handleConfirmGenerateMore = async () => {
    await onGenerateMoreChapters(moreChapterCount);
    setIsGenerateMoreOpen(false);
  };

  return (
    <aside className="flex flex-col h-full w-full bg-white">
      <div className="p-5 border-b border-gray-100">
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-accent transition-colors mb-4 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Dashboard
        </button>

        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-secondary flex items-center justify-center flex-shrink-0 shadow-lg shadow-accent-500/20">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900 truncate leading-tight">
              {book.title || "Untitled Book"}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {book.chapters.length} chapter
              {book.chapters.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={chapterIds}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1.5">
              {book.chapters.map((chapter, index) => (
                <SortableItem
                  key={chapter._id || `new-${index}`}
                  chapter={chapter}
                  index={index}
                  onSelectChapter={onSelectChapter}
                  onDeleteChapter={onDeleteChapter}
                  selectedChapterIndex={selectedChapterIndex}
                  onGenerateChapterContent={onGenerateChapterContent}
                  isGenerating={isGenerating}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="p-4 border-t border-gray-100 space-y-2">
        <Button
          variant="secondary"
          onClick={onAddChapter}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl"
        >
          <Plus className="w-4 h-4" />
          Add New Chapter
        </Button>

        <Button
          variant="secondary"
          onClick={() => setIsGenerateMoreOpen(true)}
          disabled={isGeneratingMoreChapters}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl"
        >
          <Wand2 className="w-4 h-4" />
          Generate More Chapters
        </Button>

        {/* Small settings affordance, deliberately understated compared to
            the two actions above (smaller switch, smaller text, muted
            background) — same underlying book.useIntroConclusionStructure
            field as BookDetailsTab.jsx's toggle. Routed through
            onToggleIntroConclusionStructure (EditorPage.jsx) rather than
            the plain onBookChange used elsewhere — turning this ON can
            trigger a retrofit confirmation + AI generation for an existing
            book's Intro/Conclusion, so it needs its own decision tree, not
            just a field write. Still one source of truth: the flag itself
            still lands via the same handleBookChange/autosave path once
            that decision tree resolves. */}
        <div
          className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-3 py-2"
          title="When on, AI outline generation (initial or Generate More Chapters) frames the first chapter as an Introduction and the last as a Conclusion with action steps."
        >
          <span className="text-xs text-gray-500 leading-snug">
            Introduction first / Conclusion last
          </span>
          <button
            type="button"
            onClick={onToggleIntroConclusionStructure}
            disabled={isGeneratingIntroConclusion}
            className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors disabled:opacity-60 ${
              book.useIntroConclusionStructure ? "bg-accent" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                book.useIntroConclusionStructure ? "translate-x-4" : ""
              }`}
            />
          </button>
        </div>
      </div>

      <Modal
        isOpen={isGenerateMoreOpen}
        onClose={() => !isGeneratingMoreChapters && setIsGenerateMoreOpen(false)}
        title="Generate More Chapters"
      >
        <p className="text-gray-600 leading-relaxed mb-6">
          AI continues this book's actual arc from where it currently leaves
          off, using the existing chapters, voice profile, and description as
          context, not generic chapters loosely related to the topic.
        </p>

        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Number of chapters to generate
        </label>
        <input
          type="number"
          min={1}
          max={MAX_GENERATE_MORE_CHAPTERS}
          value={moreChapterCount}
          onChange={(e) => {
            const next = Number(e.target.value);
            setMoreChapterCount(
              Number.isFinite(next)
                ? Math.min(MAX_GENERATE_MORE_CHAPTERS, Math.max(1, next))
                : 1
            );
          }}
          className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 text-gray-900 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-all duration-200"
        />
        <p className="text-xs text-gray-400 mt-1.5">
          Up to {MAX_GENERATE_MORE_CHAPTERS} at a time.
        </p>

        <div className="flex justify-end gap-3 mt-6">
          <Button
            variant="secondary"
            onClick={() => setIsGenerateMoreOpen(false)}
            disabled={isGeneratingMoreChapters}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmGenerateMore}
            loading={isGeneratingMoreChapters}
            className="flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Generate
          </Button>
        </div>
      </Modal>
    </aside>
  );
};

export default ChapterSidebar;