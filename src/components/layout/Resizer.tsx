import React, { useCallback, useRef } from "react";

interface ResizerProps {
  onResize: (clientX: number) => void;
  className?: string;
}

export const Resizer: React.FC<ResizerProps> = ({ onResize, className = "" }) => {
  const isDragging = useRef(false);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging.current) return;
      onResize(e.clientX);
    },
    [onResize]
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    document.body.classList.remove("resizing");
  }, [handleMouseMove]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.classList.add("resizing");
    },
    [handleMouseMove, handleMouseUp]
  );

  return (
    <div
      className={`resizer-handle ${className}`}
      onMouseDown={handleMouseDown}
    />
  );
};
