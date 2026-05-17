import { ImagePlus, Search, X } from "lucide-react";
import { useRef, type FormEvent } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface SearchInputProps {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onClear: () => void;
  onImageUpload: (file: File) => void;
}

export function SearchInput({
  value,
  placeholder,
  disabled = false,
  onChange,
  onSubmit,
  onClear,
  onImageUpload,
}: SearchInputProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    onSubmit(value.trim());
  };

  const handleClearClick = () => {
    onChange("");
    onClear();
  };

  const handleImageButtonClick = () => {
    fileRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImageUpload(file);
    e.target.value = "";
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-soft)]" />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "Search…"}
          disabled={disabled}
          className="h-9 pl-9 pr-8"
        />
        {value ? (
          <button
            type="button"
            onClick={handleClearClick}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--ink-soft)] hover:bg-[var(--bg-sand)]"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleImageButtonClick}
        disabled={disabled}
        title="Search by image"
      >
        <ImagePlus className="h-4 w-4" />
      </Button>
      <Button type="submit" disabled={disabled || !value.trim()}>
        Search
      </Button>
    </form>
  );
}
