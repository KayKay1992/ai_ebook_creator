import MDEditor from "@uiw/react-md-editor";

const MarkdownContent = ({
  content = "",
  className = "",
  emptyMessage = "No content available.",
  style,
}) => {
  if (!content.trim()) {
    return (
      <p className={`text-gray-400 italic ${className}`} style={style}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <div
      data-color-mode="light"
      className={`markdown-content ${className}`}
      style={style}
    >
      <MDEditor.Markdown
        source={content}
        prefixCls=""
        style={{ background: "transparent" }}
      />
    </div>
  );
};

export default MarkdownContent;
