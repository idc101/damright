import React, { useState, useEffect, useMemo } from "react";
import { Photo } from "../../types";
import { useApi } from "../../services/ApiProvider";
import { formatExifDate } from "../../utils/slideshow";
import { Calendar, Sparkles } from "lucide-react";
import "./MarkdownReader.css";

interface MarkdownReaderProps {
  photo: Photo;
  content?: string;
  variant?: "lightbox" | "slideshow" | "inline";
  className?: string;
}

interface ParsedBlock {
  type: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "blockquote" | "ul" | "ol" | "code" | "hr" | "image";
  content?: string;
  items?: string[];
  lang?: string;
  imageSrc?: string;
  imageAlt?: string;
}

export const MarkdownReader: React.FC<MarkdownReaderProps> = ({
  photo,
  content: propContent,
  variant = "lightbox",
  className = "",
}) => {
  const api = useApi();
  const [fetchedContent, setFetchedContent] = useState<string | null>(propContent || null);
  const [loading, setLoading] = useState<boolean>(!propContent);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (propContent !== undefined) {
      setFetchedContent(propContent);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    const loadContent = async () => {
      try {
        const url = api.getAssetUrl(photo.path);
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to load file (${res.status})`);
        }
        const text = await res.text();
        if (isMounted) {
          setFetchedContent(text);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || "Failed to load markdown content");
          setLoading(false);
        }
      }
    };

    loadContent();

    return () => {
      isMounted = false;
    };
  }, [photo.path, propContent, api]);

  // Extract base directory for relative image resolution
  const photoDir = useMemo(() => {
    const norm = photo.path.replace(/\\/g, "/");
    const lastSlash = norm.lastIndexOf("/");
    return lastSlash !== -1 ? norm.substring(0, lastSlash) : "";
  }, [photo.path]);

  const resolveImageSrc = (src: string): string => {
    if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:") || src.startsWith("asset://")) {
      return src;
    }
    const cleanSrc = src.startsWith("./") ? src.substring(2) : src;
    const fullPath = photoDir ? `${photoDir}/${cleanSrc}` : cleanSrc;
    return api.getAssetUrl(fullPath);
  };

  // Parse markdown text into structured blocks
  const parsedBlocks = useMemo<ParsedBlock[]>(() => {
    if (!fetchedContent) return [];

    let text = fetchedContent;
    // Strip YAML frontmatter if present
    if (text.startsWith("---")) {
      const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
      if (match) {
        text = text.substring(match[0].length);
      }
    }

    const lines = text.split(/\r?\n/);
    const blocks: ParsedBlock[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      // Code block
      if (trimmed.startsWith("```")) {
        const lang = trimmed.substring(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++; // skip closing ```
        blocks.push({ type: "code", content: codeLines.join("\n"), lang });
        continue;
      }

      // Horizontal rule
      if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
        blocks.push({ type: "hr" });
        i++;
        continue;
      }

      // Headings
      if (trimmed.startsWith("# ")) {
        blocks.push({ type: "h1", content: trimmed.substring(2).trim() });
        i++;
        continue;
      }
      if (trimmed.startsWith("## ")) {
        blocks.push({ type: "h2", content: trimmed.substring(3).trim() });
        i++;
        continue;
      }
      if (trimmed.startsWith("### ")) {
        blocks.push({ type: "h3", content: trimmed.substring(4).trim() });
        i++;
        continue;
      }
      if (trimmed.startsWith("#### ")) {
        blocks.push({ type: "h4", content: trimmed.substring(5).trim() });
        i++;
        continue;
      }
      if (trimmed.startsWith("##### ")) {
        blocks.push({ type: "h5", content: trimmed.substring(6).trim() });
        i++;
        continue;
      }
      if (trimmed.startsWith("###### ")) {
        blocks.push({ type: "h6", content: trimmed.substring(7).trim() });
        i++;
        continue;
      }

      // Blockquote
      if (trimmed.startsWith(">")) {
        const quoteLines: string[] = [trimmed.replace(/^>\s?/, "")];
        i++;
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
          i++;
        }
        blocks.push({ type: "blockquote", content: quoteLines.join("\n") });
        continue;
      }

      // Unordered list
      if (/^[-*+]\s+/.test(trimmed)) {
        const items: string[] = [trimmed.replace(/^[-*+]\s+/, "")];
        i++;
        while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*+]\s+/, ""));
          i++;
        }
        blocks.push({ type: "ul", items });
        continue;
      }

      // Ordered list
      if (/^\d+\.\s+/.test(trimmed)) {
        const items: string[] = [trimmed.replace(/^\d+\.\s+/, "")];
        i++;
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
          i++;
        }
        blocks.push({ type: "ol", items });
        continue;
      }

      // Standalone Image: ![alt](src)
      const standaloneImageMatch = trimmed.match(/^!\[(.*?)\]\((.*?)\)$/);
      if (standaloneImageMatch) {
        blocks.push({
          type: "image",
          imageAlt: standaloneImageMatch[1],
          imageSrc: standaloneImageMatch[2],
        });
        i++;
        continue;
      }

      // Paragraph (collect consecutive non-empty lines)
      const pLines: string[] = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        !lines[i].trim().startsWith("#") &&
        !lines[i].trim().startsWith("```") &&
        !lines[i].trim().startsWith(">") &&
        !/^[-*+]\s+/.test(lines[i].trim()) &&
        !/^\d+\.\s+/.test(lines[i].trim()) &&
        lines[i].trim() !== "---" &&
        lines[i].trim() !== "***"
      ) {
        pLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "p", content: pLines.join(" ") });
    }

    return blocks;
  }, [fetchedContent]);

  // Helper to render inline markdown: bold, italic, inline code, links, images
  const renderInline = (text: string): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    // Tokenize inline markdown: images, links, code, bold/italic
    const regex = /(!\[.*?\]\(.*?\)|\[.*?\]\(.*?\)|`[^`]+`|\*\*\*.*?\*\*\*|\*\*.*?\*\*|\*.*?\*|__.*?__|_.*?_)/g;
    const parts = text.split(regex);

    parts.forEach((part, idx) => {
      if (!part) return;

      // Image: ![alt](src)
      const imgMatch = part.match(/^!\[(.*?)\]\((.*?)\)$/);
      if (imgMatch) {
        const alt = imgMatch[1];
        const src = resolveImageSrc(imgMatch[2]);
        nodes.push(
          <div key={`img-${idx}`} className="markdown-inline-image-container">
            <img className="markdown-inline-image" src={src} alt={alt} />
            {alt && <span className="markdown-image-caption">{alt}</span>}
          </div>
        );
        return;
      }

      // Link: [text](url)
      const linkMatch = part.match(/^\[(.*?)\]\((.*?)\)$/);
      if (linkMatch) {
        nodes.push(
          <a
            key={`link-${idx}`}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
          >
            {linkMatch[1]}
          </a>
        );
        return;
      }

      // Inline code: `code`
      if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
        nodes.push(<code key={`code-${idx}`}>{part.slice(1, -1)}</code>);
        return;
      }

      // Bold + Italic: ***text***
      if (part.startsWith("***") && part.endsWith("***") && part.length >= 6) {
        nodes.push(
          <strong key={`bi-${idx}`}>
            <em>{part.slice(3, -3)}</em>
          </strong>
        );
        return;
      }

      // Bold: **text** or __text__
      if ((part.startsWith("**") && part.endsWith("**") && part.length >= 4) ||
          (part.startsWith("__") && part.endsWith("__") && part.length >= 4)) {
        nodes.push(<strong key={`b-${idx}`}>{part.slice(2, -2)}</strong>);
        return;
      }

      // Italic: *text* or _text_
      if ((part.startsWith("*") && part.endsWith("*") && part.length >= 2) ||
          (part.startsWith("_") && part.endsWith("_") && part.length >= 2)) {
        nodes.push(<em key={`i-${idx}`}>{part.slice(1, -1)}</em>);
        return;
      }

      // Plain text
      nodes.push(<span key={`txt-${idx}`}>{part}</span>);
    });

    return nodes;
  };

  const formattedDate = formatExifDate(photo.capture_time);
  const tagList = photo.tags
    ? photo.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  const displayTitle =
    photo.title ||
    parsedBlocks.find((b) => b.type === "h1")?.content ||
    photo.path.split(/[/\\]/).pop()?.replace(/\.md$/i, "").replace(/[-_]/g, " ");

  if (loading) {
    return (
      <div className={`markdown-reader variant-${variant} ${className}`}>
        <div className="markdown-reader-loading">Loading post content...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`markdown-reader variant-${variant} ${className}`}>
        <div className="markdown-reader-error">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`markdown-reader variant-${variant} ${className}`} data-testid="markdown-reader">
      {/* Article Header */}
      <header className="markdown-reader-header">
        <div className="markdown-reader-meta">
          {formattedDate && (
            <span className="markdown-reader-date">
              <Calendar size={14} />
              {formattedDate}
            </span>
          )}
          {photo.event && (
            <span className="markdown-reader-event">
              <Sparkles size={12} />
              {photo.event}
            </span>
          )}
        </div>

        {displayTitle && <h1 className="markdown-reader-title">{displayTitle}</h1>}

        {tagList.length > 0 && (
          <div className="markdown-reader-tags">
            {tagList.map((tag) => (
              <span key={tag} className="markdown-reader-tag">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* Main Markdown Rendered Content */}
      <article className="markdown-content">
        {parsedBlocks.map((block, idx) => {
          switch (block.type) {
            case "h1":
              // If H1 is identical to displayTitle, skip duplicating it
              if (block.content === displayTitle && idx === 0) return null;
              return <h1 key={idx}>{renderInline(block.content || "")}</h1>;
            case "h2":
              return <h2 key={idx}>{renderInline(block.content || "")}</h2>;
            case "h3":
              return <h3 key={idx}>{renderInline(block.content || "")}</h3>;
            case "h4":
              return <h4 key={idx}>{renderInline(block.content || "")}</h4>;
            case "h5":
              return <h5 key={idx}>{renderInline(block.content || "")}</h5>;
            case "h6":
              return <h6 key={idx}>{renderInline(block.content || "")}</h6>;
            case "p":
              return <p key={idx}>{renderInline(block.content || "")}</p>;
            case "blockquote":
              return (
                <blockquote key={idx}>
                  {block.content?.split("\n").map((line, qIdx) => (
                    <p key={qIdx}>{renderInline(line)}</p>
                  ))}
                </blockquote>
              );
            case "ul":
              return (
                <ul key={idx}>
                  {block.items?.map((item, itemIdx) => (
                    <li key={itemIdx}>{renderInline(item)}</li>
                  ))}
                </ul>
              );
            case "ol":
              return (
                <ol key={idx}>
                  {block.items?.map((item, itemIdx) => (
                    <li key={itemIdx}>{renderInline(item)}</li>
                  ))}
                </ol>
              );
            case "code":
              return (
                <pre key={idx}>
                  <code>{block.content}</code>
                </pre>
              );
            case "hr":
              return <hr key={idx} />;
            case "image": {
              const src = resolveImageSrc(block.imageSrc || "");
              return (
                <div key={idx} className="markdown-inline-image-container">
                  <img className="markdown-inline-image" src={src} alt={block.imageAlt || ""} />
                  {block.imageAlt && <span className="markdown-image-caption">{block.imageAlt}</span>}
                </div>
              );
            }
            default:
              return null;
          }
        })}
      </article>
    </div>
  );
};
