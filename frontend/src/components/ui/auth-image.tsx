import { useEffect, useState } from "react";

import { fetchImageAsObjectUrl } from "../../api/client";

interface AuthImageProps {
  filePath: string;
  alt: string;
  className?: string;
  onError?: () => void;
}

export function AuthImage({ filePath, alt, className, onError }: AuthImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    fetchImageAsObjectUrl(filePath)
      .then((fetched) => {
        if (!cancelled) {
          url = fetched;
          setObjectUrl(fetched);
        } else {
          URL.revokeObjectURL(fetched);
        }
      })
      .catch(() => {
        if (!cancelled) onError?.();
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // onError is intentionally excluded — callers must stabilize it with useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  if (!objectUrl) {
    return <div className={className} />;
  }

  return <img src={objectUrl} alt={alt} className={className} />;
}
