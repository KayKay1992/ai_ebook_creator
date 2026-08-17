// Lightweight, purely visual mirror of backend/config/exportTemplates.js —
// just enough to render a distinct preview swatch per template. The actual
// font/margin/heading values used at export time live server-side; keep
// these two files in sync by hand if templates are added/changed there.
const TEMPLATE_OPTIONS = [
  {
    id: "classic",
    name: "Classic",
    description: "Traditional serif body, generous margins.",
    fontClass: "font-serif",
    headingAlign: "text-left",
    bodyAlign: "text-justify",
    uppercase: false,
  },
  {
    id: "modern",
    name: "Modern",
    description: "Clean sans-serif, tighter spacing, minimal headers.",
    fontClass: "font-sans",
    headingAlign: "text-left",
    bodyAlign: "text-justify",
    uppercase: false,
  },
  {
    id: "manuscript",
    name: "Manuscript",
    description: "Double-spaced Courier, standard submission format.",
    fontClass: "font-mono",
    headingAlign: "text-center",
    bodyAlign: "text-left",
    uppercase: true,
  },
];

const SAMPLE_BODY =
  "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt.";

const ExportTemplatePicker = ({ value = "classic", onChange }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {TEMPLATE_OPTIONS.map((tpl) => {
        const isSelected = value === tpl.id;
        return (
          <button
            key={tpl.id}
            type="button"
            onClick={() => onChange(tpl.id)}
            className={`text-left rounded-2xl border-2 p-3 transition-all ${
              isSelected
                ? "border-accent bg-accent-muted/40 shadow-sm"
                : "border-gray-100 hover:border-gray-200"
            }`}
          >
            {/* Mini "page" preview swatch */}
            <div className="aspect-[3/4] bg-white border border-gray-200 rounded-lg p-3 mb-3 overflow-hidden">
              <p
                className={`${tpl.fontClass} ${tpl.headingAlign} text-[10px] font-bold text-gray-900 mb-1.5 ${
                  tpl.uppercase ? "uppercase tracking-wide" : ""
                }`}
              >
                Chapter One
              </p>
              <p
                className={`${tpl.fontClass} ${tpl.bodyAlign} text-[6.5px] leading-snug text-gray-400`}
              >
                {SAMPLE_BODY}
              </p>
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-sm text-gray-900">{tpl.name}</p>
              {isSelected && (
                <span className="text-[10px] font-medium text-accent-hover bg-accent-50 px-2 py-0.5 rounded-full">
                  Selected
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{tpl.description}</p>
          </button>
        );
      })}
    </div>
  );
};

export default ExportTemplatePicker;
