import { useRef } from "react";
import { Type, Image as ImageIcon } from "lucide-react";
import MDEditor, { commands } from "@uiw/react-md-editor";
import toast from "react-hot-toast";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"];
const MAX_IMAGE_SIZE = 8 * 1024 * 1024; // 8MB — matches the backend's chapter-image limit

const SimpleMDEditor = ({ value, onChange, bookId }) => {
  const fileInputRef = useRef(null);
  const pendingApiRef = useRef(null);

  const uploadImageCommand = {
    name: "upload-image",
    keyCommand: "upload-image",
    buttonProps: { "aria-label": "Insert image", title: "Insert image" },
    icon: <ImageIcon size={13} />,
    execute: (_state, api) => {
      pendingApiRef.current = api;
      fileInputRef.current?.click();
    },
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    const api = pendingApiRef.current;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Only JPG, PNG, or GIF images are allowed.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      toast.error("Image must be smaller than 8MB.");
      return;
    }

    const toastId = toast.loading("Uploading image...");
    try {
      const formData = new FormData();
      formData.append("chapterImage", file);

      const response = await axiosInstance.post(
        `${API_PATHS.BOOKS.UPLOAD_CHAPTER_IMAGE}/${bookId}`,
        formData,
        { headers: { "Content-Type": "multipart/form-data" } }
      );

      api?.replaceSelection(`![${file.name}](${response.data.path})`);
      toast.success("Image inserted", { id: toastId });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to upload image", {
        id: toastId,
      });
    }
  };

  return (
    <div className="h-full flex flex-col" data-color-mode="light">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50/80">
        <Type className="w-4 h-4 text-accent" />
        <span className="text-sm font-medium text-gray-700">Markdown Editor</span>
      </div>

      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        onChange={handleFileSelected}
        className="hidden"
      />

      <div className="flex-1 min-h-[400px]">
        <MDEditor
          value={value}
          onChange={onChange}
          height="100%"
          preview="edit"
          visibleDragbar={false}
          commands={[
            commands.bold,
            commands.italic,
            commands.strikethrough,
            commands.hr,
            commands.title,
            commands.divider,
            commands.quote,
            commands.code,
            commands.link,
            uploadImageCommand,
            commands.unorderedListCommand,
            commands.orderedListCommand,
            commands.checkedListCommand,
          ]}
          extraCommands={[]}
        />
      </div>

      <style>{`
        .w-md-editor {
          border: none !important;
          box-shadow: none !important;
          background: transparent !important;
          height: 100% !important;
        }
        .w-md-editor-toolbar {
          background: #f9fafb !important;
          border-bottom: 1px solid #f3f4f6 !important;
        }
        .w-md-editor-content {
          background: white !important;
        }
      `}</style>
    </div>
  );
};

export default SimpleMDEditor;
