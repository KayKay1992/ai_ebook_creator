import { Type } from "lucide-react";
import MDEditor, { commands } from "@uiw/react-md-editor";

const SimpleMDEditor = ({ value, onChange }) => {
  return (
    <div className="h-full flex flex-col" data-color-mode="light">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50/80">
        <Type className="w-4 h-4 text-accent" />
        <span className="text-sm font-medium text-gray-700">Markdown Editor</span>
      </div>

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
            commands.image,
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