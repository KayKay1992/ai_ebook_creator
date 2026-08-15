import MDEditor from "@uiw/react-md-editor";
import { BASE_URL } from "../../utils/apiPaths";

const resolveImageSrc = (src) => {
  if (!src) return src;
  if (/^(https?:)?\/\//.test(src) || src.startsWith("data:")) {
    return src;
  }
  return `${BASE_URL}${src.startsWith("/") ? "" : "/"}${src}`.replace(/\\/g, "/");
};

const MarkdownImage = ({ src, ...props }) => (
  <img {...props} src={resolveImageSrc(src)} />
);

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
        components={{ img: MarkdownImage }}
      />
    </div>
  );
};

export default MarkdownContent;
