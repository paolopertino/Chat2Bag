import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { submitExtraction } from "../api/client";
import type { ExtractionConfigSchema } from "../api/types";

interface LaunchParams {
  bagPath: string;
  centerNs: number;
  defaultWindowS: number;
}

export function useExtractionLauncher(
  schema: ExtractionConfigSchema | null,
  onJobSubmitted: () => void,
) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [params, setParams] = useState<LaunchParams | null>(null);
  const [bagPath, setBagPath] = useState("");
  const [windowS, setWindowS] = useState(10);
  const [outputFolder, setOutputFolder] = useState("");
  const [userConfig, setUserConfig] = useState<Record<string, unknown>>({});

  // Populate form defaults from schema when schema loads
  useEffect(() => {
    if (schema?.defaults) {
      setUserConfig(schema.defaults as Record<string, unknown>);
    }
  }, [schema]);

  const open = useCallback(
    (launchParams: LaunchParams) => {
      setParams(launchParams);
      setBagPath(launchParams.bagPath);
      setWindowS(launchParams.defaultWindowS);
      setOutputFolder("");
      if (schema?.defaults) {
        setUserConfig(schema.defaults as Record<string, unknown>);
      }
      setIsOpen(true);
    },
    [schema],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setParams(null);
  }, []);

  const submit = useCallback(async () => {
    if (!params) return;
    setIsSubmitting(true);
    try {
      await submitExtraction({
        bag_path: bagPath.trim() || params.bagPath,
        mode: "window",
        timestamp_ns: params.centerNs,
        window_length_s: windowS,
        user_config: userConfig,
        output_folder: outputFolder.trim() || undefined,
      });
      toast.success("Extraction job submitted successfully.");
      setIsOpen(false);
      onJobSubmitted();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to submit extraction.";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  }, [params, bagPath, windowS, userConfig, outputFolder, onJobSubmitted]);

  const setFieldValue = useCallback((field: string, value: unknown) => {
    setUserConfig((prev) => ({ ...prev, [field]: value }));
  }, []);

  return {
    isOpen,
    isSubmitting,
    params,
    bagPath,
    windowS,
    outputFolder,
    userConfig,
    open,
    close,
    submit,
    setBagPath,
    setWindowS,
    setOutputFolder,
    setFieldValue,
  };
}
